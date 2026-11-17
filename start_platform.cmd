@echo off
rem ============================================================
rem  Start AIGC Creation Platform only (port 3000)
rem  Use this when MOSS API is already running on 8188.
rem  Close this window to stop the platform.
rem
rem  The path is resolved from this script's location, so the repo
rem  can live on any drive or folder name.
rem ============================================================
setlocal
cd /d "%~dp0AIGC-Creation-Platform"

if not exist "package.json" (
  echo [ERROR] AIGC platform sources not found in %CD%
  pause
  exit /b 1
)

set PORT=3000
set HOSTNAME=127.0.0.1

echo.
echo ============================================================
echo   AIGC Creation Platform
echo   http://127.0.0.1:%PORT%
echo   Close this window to stop.
echo ============================================================
echo.

start "" "http://127.0.0.1:%PORT%"

if exist "server.js" (
  node server.js
) else (
  echo No prebuilt server.js - running from source via next start.
  echo Run "npm install" and "npm run build" once beforehand.
  npm start
)

echo.
echo Platform stopped.
pause
