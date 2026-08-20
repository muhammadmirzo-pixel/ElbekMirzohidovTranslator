#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "[1/4] venv yaratilmoqda..."
python -m venv .venv
VPY=".venv/Scripts/python.exe"
"$VPY" -m pip install --upgrade pip -q
echo "[2/4] torch (CPU) o'rnatilmoqda..."
"$VPY" -m pip install torch --index-url https://download.pytorch.org/whl/cpu -q
echo "[3/4] qolgan paketlar..."
"$VPY" -m pip install transformers soundfile librosa numpy scipy fastapi "uvicorn[standard]" python-multipart -q
echo "[4/4] versiyalar:"
"$VPY" -c "import torch,transformers,librosa,soundfile;print('torch',torch.__version__);print('transformers',transformers.__version__);print('librosa',librosa.__version__)"
echo "TAYYOR"
