<#
  Chinese News Text Classification System - one-click launcher (Windows PowerShell)

  What it does:
    1. Prepare a Python virtual env (.venv), created on first run
    2. Install backend dependencies (backend/requirements.txt)
    3. Build frontend/ from your 11 static pages (inject data-binding script, visuals unchanged)
    4. Start the Flask backend which also serves the frontend: http://127.0.0.1:5000

  Usage:
    Double-click start.bat, or run in this folder:
        powershell -ExecutionPolicy Bypass -File .\start.ps1

  Optional parameters:
    -Reinstall   force reinstall dependencies
    -NoBuild     skip frontend build (faster if pages were not changed)
    -Port 5000   set port (default 5000)
#>
param(
    [switch]$Reinstall,
    [switch]$NoBuild,
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"
# Force UTF-8 so Chinese paths / Chinese data do not get garbled
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Root = $PSScriptRoot
Set-Location $Root
Write-Host "==== Chinese News Text Classification System - start ====" -ForegroundColor Cyan
Write-Host "Project root: $Root"

# 1) Locate Python interpreter (candidates: python / py -3 / python3)
function Resolve-Python {
    $candidates = @(
        @("python"),
        @("py", "-3"),
        @("python3")
    )
    foreach ($c in $candidates) {
        try {
            $exe = $c[0]
            $rest = @()
            if ($c.Length -gt 1) { $rest = $c[1..($c.Length - 1)] }
            & $exe @rest --version 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { return , $c }
        } catch {}
    }
    return $null
}

$venvPy = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    $sys = Resolve-Python
    if (-not $sys) {
        Write-Host "Python not found. Please install Python 3.10+ and add it to PATH: https://www.python.org/downloads/" -ForegroundColor Red
        exit 1
    }
    Write-Host "[1/4] Creating virtual env .venv ..." -ForegroundColor Yellow
    $exe = $sys[0]
    $rest = @()
    if ($sys.Length -gt 1) { $rest = $sys[1..($sys.Length - 1)] }
    & $exe @rest -m venv (Join-Path $Root ".venv")
} else {
    Write-Host "[1/4] Virtual env .venv already exists" -ForegroundColor Green
}

# 2) Install dependencies (use a marker to avoid reinstalling every time)
$marker = Join-Path $Root ".venv\.deps_ok"
if ($Reinstall -or -not (Test-Path $marker)) {
    Write-Host "[2/4] Installing backend dependencies (first run can be slow) ..." -ForegroundColor Yellow
    & $venvPy -m pip install --upgrade pip
    & $venvPy -m pip install -r (Join-Path $Root "backend\requirements.txt")
    if ($LASTEXITCODE -ne 0) { Write-Host "Dependency install failed. Check network or pip mirror." -ForegroundColor Red; exit 1 }
    Set-Content -Path $marker -Value (Get-Date).ToString() -Encoding UTF8
} else {
    Write-Host "[2/4] Dependencies already installed (use -Reinstall to force)" -ForegroundColor Green
}

# 3) Build frontend (copy your static pages and inject the wiring script)
if (-not $NoBuild) {
    Write-Host "[3/4] Building frontend/ ..." -ForegroundColor Yellow
    & $venvPy (Join-Path $Root "backend\scripts\build_frontend.py")
} else {
    Write-Host "[3/4] Skipped frontend build (-NoBuild)" -ForegroundColor Green
}

# 4) Start the server
Write-Host "[4/4] Starting backend server ..." -ForegroundColor Yellow
$env:APP_PORT = "$Port"
Write-Host ""
Write-Host "  Open in browser:  http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Health check:     http://127.0.0.1:$Port/api/health" -ForegroundColor DarkCyan
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""
& $venvPy (Join-Path $Root "backend\app.py")
