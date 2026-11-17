@echo off
rem ============================================================
rem  ONE-CLICK LAUNCHER
rem  Starts BOTH services and opens the browser:
rem    - MOSS-Image API  on port 8188
rem    - AIGC Platform   on port 3000
rem  Already-running services are detected and skipped.
rem  Uses built-in Windows PowerShell 5.1 - nothing to install.
rem ============================================================
setlocal
cd /d "%~dp0"

if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  echo [ERROR] Windows PowerShell not found. This is unexpected on Windows.
  pause
  exit /b 1
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"

echo.
echo Press any key to close this launcher window.
pause >nul
