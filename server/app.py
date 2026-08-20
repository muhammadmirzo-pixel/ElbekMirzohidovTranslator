"""Lokal ovoz serveri.

Chrome kengaytmasi shu serverga o'zbekcha matn yuboradi va Elbek Mirzohidov
ovozidagi WAV oladi. Server faqat 127.0.0.1 da tinglaydi.

Ishga tushirish:
    server/run.cmd
yoki
    .venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8788
"""

import os
import threading
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from voice_engine import VoiceEngine

HERE = os.path.dirname(os.path.abspath(__file__))
REF_AUDIO = os.environ.get(
    "ELBEK_VOICE",
    os.path.join(HERE, "..", "voice", "elbek_mirzohidov.mp3"),
)

app = FastAPI(title="Elbek Mirzohidov ovoz serveri", version="0.1.0")

# Kengaytma chrome-extension:// origin bilan murojaat qiladi. Server faqat
# localhost'da turgani uchun barcha origin'larga ruxsat berish xavfsiz.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = VoiceEngine(REF_AUDIO)
_load_started = time.time()
_load_error: str | None = None


def _load_models():
    global _load_error
    try:
        engine.load()
        print(f"[ovoz-server] tayyor ({time.time() - _load_started:.1f}s)", flush=True)
        # Birinchi haqiqiy so'rov sekin bo'lmasligi uchun qizdirib qo'yamiz.
        engine.speak("Salom.")
        print("[ovoz-server] qizdirildi", flush=True)
    except Exception as e:  # noqa: BLE001
        _load_error = f"{type(e).__name__}: {e}"
        print(f"[ovoz-server] XATO: {_load_error}", flush=True)


@app.on_event("startup")
def startup():
    # Modellar fonda yuklanadi, shunda /health darhol javob beradi va
    # kengaytma "yuklanmoqda" holatini ko'rsata oladi.
    threading.Thread(target=_load_models, daemon=True).start()


@app.get("/health")
def health():
    return JSONResponse(
        {
            "ready": engine.ready,
            "status": engine.status,
            "error": _load_error or engine.error,
            "voice": os.path.basename(engine.ref_audio),
            "sample_rate": engine.out_sr,
            "threads": engine.threads,
            "uptime_s": round(time.time() - _load_started, 1),
        }
    )


class SpeakRequest(BaseModel):
    text: str


@app.post("/speak")
def speak(req: SpeakRequest):
    if not engine.ready:
        raise HTTPException(status_code=503, detail=f"Ovoz dvigateli tayyor emas: {engine.status}")
    try:
        wav, meta = engine.speak(req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}") from e

    print(f"[ovoz-server] {meta} <- {req.text[:60]!r}", flush=True)
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "X-Duration": str(meta["duration"]),
            "X-RTF": str(meta["rtf"]),
            "Cache-Control": "no-store",
        },
    )


@app.get("/")
def root():
    return {
        "name": "Elbek Mirzohidov ovoz serveri",
        "endpoints": ["/health", "POST /speak {text}"],
        "ready": engine.ready,
    }
