"""Elbek Mirzohidov ovozida o'zbekcha nutq sintezi.

Zanjir:
    o'zbek lotin matni
      -> kirillga transliteratsiya          (uz_translit)
      -> MMS-TTS VITS (o'zbek, neytral ovoz) (facebook/mms-tts-uzb-script_cyrillic)
      -> OpenVoice V2 tone color converter   (tembrni Elbekniki bilan almashtiradi)
      -> WAV

Nega aynan shunday: GPU yo'q mashinada XTTS kabi to'g'ridan-to'g'ri klonlovchi
modellar real vaqtdan sekin ishlaydi. VITS + OpenVoice esa ikkalasi ham yengil,
va OpenVoice ataylab tildan mustaqil — u faqat tembrni ko'chiradi, shuning
uchun o'zbek tili uning o'quv to'plamida bo'lmasa ham ishlaydi.
"""

import io
import os
import sys
import types
import threading

import numpy as np
import soundfile as sf
import torch

from uz_translit import latin_to_cyrillic, split_for_tts

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "OpenVoice"))

# openvoice.api modul darajasida openvoice.text'ni import qiladi, lekin u faqat
# ingliz/xitoy tts() metodida kerak. Biz faqat convert() ishlatamiz, shuning
# uchun jieba/pypinyin kabi og'ir kutubxonalarni o'rnatmay stub qo'yamiz.
if "openvoice.text" not in sys.modules:
    _stub = types.ModuleType("openvoice.text")
    _stub.text_to_sequence = lambda *a, **k: []
    sys.modules["openvoice.text"] = _stub

from openvoice.api import OpenVoiceBaseClass, ToneColorConverter  # noqa: E402
from transformers import AutoTokenizer, VitsModel  # noqa: E402

MMS_MODEL = "facebook/mms-tts-uzb-script_cyrillic"

# Manba tembrini aniqlash uchun MMS modelining o'z ovozidan namuna kerak.
# Mazmuni ahamiyatsiz, faqat turli tovushlarni qamrasa bo'lgani.
_SRC_SAMPLES = [
    "Bugun ob-havo juda yaxshi va biz sayrga chiqamiz.",
    "Ushbu dastur video ovozini o'zbek tiliga tarjima qiladi.",
    "Salom, qalaysiz? Ishlaringiz yaxshimi? Rahmat, yaxshi.",
]


def _build_converter(config_path: str, device: str) -> ToneColorConverter:
    """ToneColorConverter'ni wavmark'siz yaratadi.

    Upstream'dagi ToneColorConverter.__init__ `enable_watermark` kalitini
    super()'ga ham uzatib yuboradi va TypeError beradi. Vendor kodini
    o'zgartirmaslik uchun obyektni qo'lda yig'amiz.
    """
    conv = ToneColorConverter.__new__(ToneColorConverter)
    OpenVoiceBaseClass.__init__(conv, config_path, device=device)
    conv.watermark_model = None  # add_watermark() buni ko'rib audioni tegmay qaytaradi
    conv.version = getattr(conv.hps, "_version_", "v1")
    return conv


class VoiceEngine:
    def __init__(self, ref_audio: str, device: str = "cpu", threads: int = 0):
        self.ref_audio = os.path.abspath(ref_audio)
        self.device = device
        self.threads = threads or max(1, (os.cpu_count() or 4) - 2)
        self.cache_dir = os.path.join(HERE, "cache")
        os.makedirs(self.cache_dir, exist_ok=True)

        self.ready = False
        self.status = "yuklanmagan"
        self.error = None
        # Torch modellari bir vaqtda bir nechta so'rovda ishlatilsa xotira
        # va CPU bo'yicha to'qnashadi, shuning uchun sintez ketma-ket boradi.
        self._lock = threading.Lock()

        self._tok = None
        self._tts = None
        self._conv = None
        self._src_se = None
        self._tgt_se = None
        self.tts_sr = None
        self.out_sr = None

    # ---------- yuklash ----------

    def load(self):
        try:
            torch.set_num_threads(self.threads)

            self.status = "MMS-TTS yuklanmoqda"
            self._tok = AutoTokenizer.from_pretrained(MMS_MODEL)
            self._tts = VitsModel.from_pretrained(MMS_MODEL).eval()
            self.tts_sr = self._tts.config.sampling_rate

            self.status = "OpenVoice converter yuklanmoqda"
            ckpt = os.path.join(HERE, "checkpoints_v2", "converter")
            cfg = os.path.join(ckpt, "config.json")
            if not os.path.exists(cfg):
                raise FileNotFoundError(
                    f"OpenVoice checkpoint topilmadi: {cfg}. "
                    "Avval `python fetch_ckpt.py` ni ishga tushiring."
                )
            self._conv = _build_converter(cfg, self.device)
            self._conv.load_ckpt(os.path.join(ckpt, "checkpoint.pth"))
            self.out_sr = self._conv.hps.data.sampling_rate

            self.status = "ovoz tembrlari hisoblanmoqda"
            self._src_se = self._load_or_build_src_se()
            self._tgt_se = self._load_or_build_tgt_se()

            self.ready = True
            self.status = "tayyor"
        except Exception as e:  # noqa: BLE001 — sabab /health orqali ko'rinishi kerak
            self.error = f"{type(e).__name__}: {e}"
            self.status = f"xato: {self.error}"
            self.ready = False
            raise

    def _load_or_build_src_se(self):
        path = os.path.join(self.cache_dir, "src_se.pth")
        if os.path.exists(path):
            return torch.load(path, map_location=self.device)
        wavs = []
        for i, text in enumerate(_SRC_SAMPLES):
            p = os.path.join(self.cache_dir, f"src_sample_{i}.wav")
            audio = self._synthesize_raw(latin_to_cyrillic(text))
            sf.write(p, audio, self.tts_sr)
            wavs.append(p)
        se = self._conv.extract_se(wavs)
        torch.save(se.cpu(), path)
        return se

    def _load_or_build_tgt_se(self):
        # Namuna fayl almashsa embedding ham qayta hisoblanishi kerak.
        stamp = int(os.path.getmtime(self.ref_audio))
        path = os.path.join(self.cache_dir, f"tgt_se_{stamp}.pth")
        if os.path.exists(path):
            return torch.load(path, map_location=self.device)
        if not os.path.exists(self.ref_audio):
            raise FileNotFoundError(f"Namuna ovoz topilmadi: {self.ref_audio}")
        se = self._conv.extract_se([self.ref_audio])
        torch.save(se.cpu(), path)
        return se

    # ---------- sintez ----------

    def _synthesize_raw(self, cyrillic_text: str) -> np.ndarray:
        inputs = self._tok(cyrillic_text, return_tensors="pt")
        with torch.no_grad():
            return self._tts(**inputs).waveform.squeeze().cpu().numpy()

    def speak(self, text_latin: str) -> tuple[bytes, dict]:
        """O'zbek lotin matnidan Elbek ovozidagi WAV baytlarini qaytaradi."""
        if not self.ready:
            raise RuntimeError(f"Ovoz dvigateli tayyor emas ({self.status})")
        text_latin = (text_latin or "").strip()
        if not text_latin:
            raise ValueError("Matn bo'sh")

        import time
        t0 = time.time()

        with self._lock:
            # Uzun matn bo'laklarga bo'linadi — VITS uzun kirishda buzilib ketadi.
            pieces = []
            for chunk in split_for_tts(text_latin):
                cyr = latin_to_cyrillic(chunk)
                if not cyr.strip():
                    continue
                pieces.append(self._synthesize_raw(cyr))
                # Gaplar orasiga qisqa jimlik.
                pieces.append(np.zeros(int(self.tts_sr * 0.12), dtype=np.float32))
            if not pieces:
                raise ValueError("Sintez qilinadigan matn qolmadi")
            raw = np.concatenate(pieces).astype(np.float32)
            t_tts = time.time() - t0

            # Tembr almashtirish bir marta, butun bo'lak ustidan — har bir
            # gapni alohida o'tkazishdan tezroq.
            buf = io.BytesIO()
            sf.write(buf, raw, self.tts_sr, format="WAV", subtype="PCM_16")
            buf.seek(0)
            t1 = time.time()
            converted = self._conv.convert(
                audio_src_path=buf,
                src_se=self._src_se,
                tgt_se=self._tgt_se,
                output_path=None,
                message=None,
            )
            t_conv = time.time() - t1

        out = io.BytesIO()
        sf.write(out, converted, self.out_sr, format="WAV", subtype="PCM_16")
        duration = len(converted) / self.out_sr
        meta = {
            "duration": round(duration, 3),
            "tts_s": round(t_tts, 3),
            "convert_s": round(t_conv, 3),
            "rtf": round((t_tts + t_conv) / duration, 3) if duration else None,
        }
        return out.getvalue(), meta
