@echo off
rem ============================================================
rem  Run MOSS-Image API server only (port 8188)
rem  Normally started automatically by launcher.ps1.
rem  Close this window to stop the service.
rem
rem  NOTE: this file must stay pure ASCII. cmd.exe reads .cmd as
rem  ANSI/GBK, so any UTF-8 Chinese comment gets shredded into
rem  bogus commands. Keep comments English.
rem
rem  All paths are relative to the repo root (parent of this file),
rem  so the whole folder can be moved to any drive unchanged.
rem  Override with environment variables if needed:
rem     MOSS_HOME          repo root        (default: ..\ from here)
rem     MOSS_PYTHON        python.exe       (default: %MOSS_HOME%\env\python.exe)
rem ============================================================
setlocal

rem ---- repo root = parent of this script's folder ----
pushd "%~dp0.."
set "MOSS_HOME=%CD%"
popd

cd /d "%~dp0"

set "PY=%MOSS_PYTHON%"
if "%PY%"=="" set "PY=%MOSS_HOME%\env\python.exe"
if not exist "%PY%" (
  echo [ERROR] Python not found: %PY%
  echo         Install the environment first, or set MOSS_PYTHON to your python.exe
  pause
  exit /b 1
)

rem ---- model paths ----
set "DIFFSYNTH_MODEL_BASE_PATH=%MOSS_HOME%\models"
set DIFFSYNTH_SKIP_DOWNLOAD=True
set "HF_HOME=%MOSS_HOME%\hf-cache"
set HF_HUB_DISABLE_SYMLINKS_WARNING=1

rem ---- LoRA (optional; leave unset to hide those model variants) ----
rem set "MOSS_TURBO_LORA=%MOSS_HOME%\models\lora\turbo_lora.safetensors"
rem set "MOSS_NSFW_LORA=%MOSS_HOME%\models\lora\style_lora.safetensors"

rem ---- server ----
set MOSS_PORT=8188
rem 960 long edge: 4 steps ~47s, 50 steps ~278s.
rem 960 x 4 = 3840 = 4K, so upscale needs no extra resize.
set MOSS_MAX_EDGE=960

rem ---- upscale ----
rem Generation is followed by a 4x upscale to 4K.
rem Costs about 16s extra and 1.2GB VRAM. Comment these out to disable.
set MOSS_UPSCALE=1
set MOSS_UPSCALE_TARGET=3840

echo.
echo ============================================================
echo   MOSS-Image API server  (port 8188)
echo ------------------------------------------------------------
echo   Repo root : %MOSS_HOME%
echo   Python    : %PY%
echo   Endpoint  : http://127.0.0.1:8188/v1
echo   Models    : http://127.0.0.1:8188/v1/models
echo   Health    : http://127.0.0.1:8188/health
echo ------------------------------------------------------------
echo   Generate 960 long edge, then upscale 4x to 3840 (4K)
echo   Model loads on first request, then stays in memory.
echo   Close this window to stop.
echo ============================================================
echo.

"%PY%" "%~dp0server.py"

echo.
echo Service stopped.
pause
