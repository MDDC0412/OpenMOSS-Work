@echo off
rem ============================================================
rem  One-click launcher: MOSS-Image API + AIGC Creation Platform
rem  Double-click this file. Two console windows will open:
rem    - MOSS-Image API   (port 8188)
rem    - AIGC Platform    (port 3000)
rem  Browser opens automatically. Close both windows to stop all.
rem ============================================================
setlocal

where pwsh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pwsh not found. Please install PowerShell 7.
  pause
  exit /b 1
)

pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_all.ps1"

echo.
echo All services launched. You can close this window.
pause
