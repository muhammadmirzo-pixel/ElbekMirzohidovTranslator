import os, sys, soundfile as sf, numpy as np
sys.stdout.reconfigure(encoding='utf-8')
from voice_engine import VoiceEngine
from uz_translit import latin_to_cyrillic

OUT = os.path.join("..", "samples")
os.makedirs(OUT, exist_ok=True)
eng = VoiceEngine(os.path.join("..","voice","elbek_mirzohidov.mp3"))
eng.load()

TEXT = ("Sun'iy intellekt videolarni onlayn tomosha qilish usulini o'zgartirmoqda. "
        "Bu kengaytma ularni real vaqtda o'zbek tiliga tarjima qiladi.")

# A: neytral MMS ovozi (tembr almashtirilmagan)
pieces = []
from uz_translit import split_for_tts
for ch in split_for_tts(TEXT):
    pieces.append(eng._synthesize_raw(latin_to_cyrillic(ch)))
    pieces.append(np.zeros(int(eng.tts_sr*0.12), dtype=np.float32))
raw = np.concatenate(pieces)
sf.write(os.path.join(OUT,"A_neytral_mms.wav"), raw, eng.tts_sr)

# B: Elbek tembriga o'girilgan
wav, meta = eng.speak(TEXT)
open(os.path.join(OUT,"B_elbek_ovozida.wav"),"wb").write(wav)

print("A_neytral_mms.wav      — MMS modelining o'z ovozi")
print("B_elbek_ovozida.wav    — OpenVoice Elbek tembriga o'girgan", meta)
