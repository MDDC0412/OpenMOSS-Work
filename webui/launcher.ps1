# ============================================================
#  MOSS-Image + AIGC Platform  one-click launcher
#  Called by start_moss_api.cmd
#  Compatible with Windows PowerShell 5.1 (built-in, no install needed)
#  NOTE: kept pure ASCII on purpose - PS 5.1 misreads UTF-8 without BOM
#
#  Paths are derived from this script's location, so the repo can be
#  cloned or moved anywhere. Nothing here is machine specific.
# ============================================================

# repo root = parent of the folder holding this script (webui -> repo)
$mossDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $mossDir
if ($env:MOSS_HOME) { $repoRoot = $env:MOSS_HOME }
$aigcDir = Join-Path $repoRoot 'AIGC-Creation-Platform'

function Test-Listening([int]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
}

function Wait-Ready([string]$label, [string]$url, [int]$timeoutSec = 90) {
    Write-Host ('        waiting ' + $label + ' ') -NoNewline
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ok = $false
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        try {
            $null = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
            $ok = $true
            break
        }
        catch {
            Write-Host '.' -NoNewline
            Start-Sleep -Milliseconds 700
        }
    }
    $sec = [int]$sw.Elapsed.TotalSeconds
    if ($ok) {
        Write-Host ('  READY (' + $sec + 's)') -ForegroundColor Green
    }
    else {
        Write-Host ('  TIMEOUT (' + $sec + 's)') -ForegroundColor Red
    }
    return $ok
}

Clear-Host
Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '    MOSS-Image  +  AIGC Platform    launcher' -ForegroundColor Cyan
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

# ---------------- 1. MOSS API ----------------
Write-Host '  [1/3] MOSS-Image API  (port 8188)' -ForegroundColor White
if (Test-Listening 8188) {
    Write-Host '        already running, skip' -ForegroundColor DarkGray
}
elseif (-not (Test-Path (Join-Path $mossDir 'server.py'))) {
    Write-Host ('        [ERROR] server.py not found in ' + $mossDir) -ForegroundColor Red
}
else {
    Write-Host '        starting...' -ForegroundColor DarkGray
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', ('"' + $mossDir + '\run_moss_api.cmd"') `
        -WorkingDirectory $mossDir
}
Write-Host ''

# ---------------- 2. AIGC platform ----------------
Write-Host '  [2/3] AIGC Platform  (port 3000)' -ForegroundColor White
if (Test-Listening 3000) {
    Write-Host '        already running, skip' -ForegroundColor DarkGray
}
elseif (-not (Test-Path (Join-Path $aigcDir 'package.json'))) {
    Write-Host ('        [ERROR] AIGC platform not found in ' + $aigcDir) -ForegroundColor Red
}
elseif (Test-Path (Join-Path $aigcDir 'server.js')) {
    Write-Host '        starting (prebuilt standalone)...' -ForegroundColor DarkGray
    # IMPORTANT: use set "VAR=value" quoting form.
    # Plain "set VAR=value && next" would capture the space before && into the value,
    # making HOSTNAME literally "127.0.0.1 " and Node fails with ENOTFOUND.
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'set "PORT=3000" && set "HOSTNAME=127.0.0.1" && node server.js' `
        -WorkingDirectory $aigcDir
}
else {
    Write-Host '        starting (next start, needs a prior npm run build)...' -ForegroundColor DarkGray
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'set "PORT=3000" && set "HOSTNAME=127.0.0.1" && npm start' `
        -WorkingDirectory $aigcDir
}
Write-Host ''

# ---------------- 3. wait ----------------
Write-Host '  [3/3] waiting for services' -ForegroundColor White
$mossOk = Wait-Ready 'MOSS API' 'http://127.0.0.1:8188/health'
$aigcOk = Wait-Ready 'AIGC platform' 'http://127.0.0.1:3000'
Write-Host ''

# ---------------- summary ----------------
Write-Host '  ------------------------------------------------------------' -ForegroundColor Cyan
if ($mossOk) {
    $loaded = '?'
    $edge = '?'
    try {
        $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/health' -TimeoutSec 5
        $loaded = $h.loaded
        $edge = $h.max_edge
    }
    catch { }
    Write-Host '   MOSS API       OK    http://127.0.0.1:8188/v1' -ForegroundColor Green
    Write-Host ('                        model_loaded=' + $loaded + '   max_edge=' + $edge) -ForegroundColor DarkGray
}
else {
    Write-Host '   MOSS API       FAILED   -> check the 8188 window for errors' -ForegroundColor Red
}

if ($aigcOk) {
    Write-Host '   AIGC platform  OK    http://127.0.0.1:3000' -ForegroundColor Green
}
else {
    Write-Host '   AIGC platform  FAILED   -> check the 3000 window for errors' -ForegroundColor Red
}
Write-Host '  ------------------------------------------------------------' -ForegroundColor Cyan
Write-Host ''

if ($mossOk -and $aigcOk) {
    Write-Host '   Connect once in the platform:' -ForegroundColor Yellow
    Write-Host '     Providers -> New' -ForegroundColor Gray
    Write-Host '       Name            Local MOSS-Image' -ForegroundColor Gray
    Write-Host '       Base URL        http://127.0.0.1:8188/v1' -ForegroundColor Gray
    Write-Host '       Models endpoint /v1/models' -ForegroundColor Gray
    Write-Host '       API Key         local' -ForegroundColor Gray
    Write-Host ''
    Write-Host '   Generation:' -ForegroundColor Yellow
    Write-Host '     768x768 / 50 steps = about 178 seconds, keep n = 1' -ForegroundColor Gray
    Write-Host '     small text needs JSON layout, otherwise the model invents it' -ForegroundColor Gray
    Write-Host ''
    Start-Process 'http://127.0.0.1:3000'
}
else {
    Write-Host '   Something failed. Read the error in its own console window.' -ForegroundColor Red
    Write-Host ''
}

Write-Host '   Each service runs in its own window. Close a window to stop it.' -ForegroundColor DarkGray
Write-Host ''
