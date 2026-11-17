@echo off
rem ============================================================
rem  AIGC Creation Platform - local launcher (Windows)
rem  Double-click to install deps (first run) and start the app.
rem  Kept ASCII-only on purpose: batch parsing of UTF-8 .cmd is
rem  unreliable across code pages. Chinese docs live in README.md.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo [AIGC Creation Platform] local launcher
echo.

rem --- Node.js must be on PATH; the app needs Node 24+ for node:sqlite ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo         Install Node.js 24 or newer from https://nodejs.org/ then retry.
  echo.
  pause
  exit /b 1
)

rem --- First run: install dependencies only when node_modules is absent ---
if not exist "node_modules" (
  echo [setup] node_modules missing, running npm install ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your network and retry.
    echo.
    pause
    exit /b 1
  )
)

echo [run] starting dev server at http://localhost:3000
echo [run] the browser opens automatically in a few seconds.
echo [run] press Ctrl+C in this window to stop the server.
echo.

rem --- Open the browser after a short delay so the server can boot. ---
rem ping is used as a portable ~6s sleep; `timeout` fails when stdin is
rem redirected in a background process.
start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start http://localhost:3000"

rem --- Hand the console to Next.js; Ctrl+C here stops everything ---
call npm run dev

endlocal