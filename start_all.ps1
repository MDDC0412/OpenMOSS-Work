# One-click start: MOSS-Image API service + AIGC Creation Platform
# Called by start_all.cmd in the same folder (the cmd entry point avoids
# the double-click execution policy restriction on .ps1 files).
#
# Layout (all relative to this script's folder, so the repo can be moved):
#   <repo>\webui                        -> MOSS-Image bridge service (OpenAI compatible)
#   <repo>\AIGC-Creation-Platform       -> the AIGC creation platform (Next.js)
#
# NOTE: this script is kept pure ASCII on purpose - Windows PowerShell 5.1
# misreads UTF-8 without a BOM, and this file is invoked through cmd.exe.
#
# Do not call the platform's own start.cmd from here: its batch file is
# UTF-8 with Chinese comments, and Start-Process + cmd mangles the encoding.
# Calling node directly is more reliable.

$repoRoot = $PSScriptRoot
if ($env:MOSS_HOME) { $repoRoot = $env:MOSS_HOME }

$mossDir = Join-Path $repoRoot 'webui'
$aigcDir = Join-Path $repoRoot 'AIGC-Creation-Platform'

if (-not (Test-Path $aigcDir)) {
    Write-Host "[ERROR] AIGC platform folder not found: $aigcDir" -ForegroundColor Red
    exit 1
}

Write-Host '== 1/2 starting MOSS-Image API (port 8188) ==' -ForegroundColor Cyan
Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/k', "`"$mossDir\start_moss_api.cmd`"" `
    -WorkingDirectory $mossDir

Start-Sleep -Seconds 1

Write-Host '== 2/2 starting AIGC Creation Platform (port 3000) ==' -ForegroundColor Cyan
# /k keeps the window open; closing it stops the service
if (Test-Path (Join-Path $aigcDir 'server.js')) {
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'set PORT=3000 && set HOSTNAME=127.0.0.1 && node server.js' `
        -WorkingDirectory $aigcDir
}
else {
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'set PORT=3000 && set HOSTNAME=127.0.0.1 && npm start' `
        -WorkingDirectory $aigcDir
}

Write-Host 'Waiting for services (about 10 seconds)...' -ForegroundColor DarkGray
Start-Sleep -Seconds 10

# Health check: failures only warn, never block
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/health' -TimeoutSec 5
    Write-Host ("  MOSS API : ok={0}  mock={1}  max_edge={2}" -f $h.ok, $h.mock, $h.max_edge) -ForegroundColor Green
}
catch {
    Write-Host '  MOSS API : no response yet (port busy or startup failed?)' -ForegroundColor Yellow
}

try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -TimeoutSec 8 -UseBasicParsing
    Write-Host '  AIGC platform: ready' -ForegroundColor Green
}
catch {
    Write-Host '  AIGC platform: still starting' -ForegroundColor Yellow
}

Start-Process 'http://127.0.0.1:3000'

Write-Host ''
Write-Host 'Done. Each service has its own console window; close one to stop it.' -ForegroundColor Green
Write-Host 'Connect once: Providers -> New, Base URL = http://127.0.0.1:8188/v1, models endpoint = /v1/models, API Key = anything' -ForegroundColor Gray
