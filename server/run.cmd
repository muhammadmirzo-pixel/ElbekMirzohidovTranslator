@echo off
REM Elbek Mirzohidov ovoz serverini ishga tushirish
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [XATO] .venv topilmadi. Avval: bash setup_env.sh
  pause
  exit /b 1
)
echo Ovoz serveri ishga tushmoqda... http://127.0.0.1:8788
echo Modellar birinchi marta ~30 soniyada yuklanadi.
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8788
pause
