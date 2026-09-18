<#
Lance le backend FastAPI et le frontend Vite en parallele, accessibles en
local (localhost) et depuis le reseau Wifi (pour tester sur telephone).
Ouvre deux fenetres PowerShell ; les fermer (ou Ctrl+C dedans) arrete les
serveurs.
#>

param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $backendPython)) {
    throw "venv backend introuvable : $backendPython (creer avec 'python -m venv .venv' puis 'pip install -e .[dev]' dans backend/)"
}
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    throw "node_modules introuvable dans frontend/ (lancer 'npm install' dans frontend/ d'abord)"
}

# Detecte une IP locale (Wifi/Ethernet), en ecartant loopback et adaptateurs virtuels.
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.PrefixOrigin -ne "WellKnown" -and
        $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|Virtual"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress

if (-not $lanIp) {
    Write-Warning "Aucune IP reseau locale detectee : seul l'acces localhost sera annonce et autorise en CORS."
}

$corsOrigins = @(
    "http://localhost:$FrontendPort"
    "http://127.0.0.1:$FrontendPort"
)
if ($lanIp) {
    $corsOrigins += "http://${lanIp}:${FrontendPort}"
}
$env:BACKEND_CORS_ORIGINS = ($corsOrigins -join ",")

Write-Host ""
Write-Host "Backend  (FastAPI) : http://localhost:$BackendPort" -ForegroundColor Cyan
if ($lanIp) {
    Write-Host "                     http://${lanIp}:${BackendPort}  (reseau Wifi)" -ForegroundColor Cyan
}
Write-Host "Frontend (Vite)    : http://localhost:$FrontendPort" -ForegroundColor Green
if ($lanIp) {
    Write-Host "                     http://${lanIp}:${FrontendPort}  (reseau Wifi, ex. telephone)" -ForegroundColor Green
}
Write-Host ""
Write-Host "Deux fenetres vont s'ouvrir. Fermez-les (ou Ctrl+C dedans) pour arreter." -ForegroundColor Yellow
Write-Host ""

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$backendDir'; & '$backendPython' -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort"
)

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$frontendDir'; npm run dev -- --host 0.0.0.0 --port $FrontendPort"
)
