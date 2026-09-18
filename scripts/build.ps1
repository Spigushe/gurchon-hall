<#
Build des deux couches, plus la validation d'installabilite PWA sur le
resultat du build frontend.

Le backend Python n'a pas d'etape de build a proprement parler (pas de
compilation) : ce script verifie seulement qu'il s'importe correctement
depuis l'installation editable, comme garde-fou rapide avant deploiement.
Le frontend est buildé avec Vite (tsc -b && vite build, cf.
frontend/package.json), puis le build est verifie avec
scripts/check-pwa-installability.mjs (manifest, icones, service worker —
criteres reels, pas de "score Lighthouse PWA", cf. CLAUDE.md §8).
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $backendPython)) {
    throw "venv backend introuvable : $backendPython (lancer scripts\install.ps1 d'abord)"
}
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    throw "node_modules introuvable dans frontend/ (lancer scripts\install.ps1 d'abord)"
}

function Invoke-Step {
    param([string]$Description, [scriptblock]$Action)
    Write-Host ""
    Write-Host "== $Description ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Echec : $Description"
    }
}

Invoke-Step "Backend : verification de l'import (sanity check)" {
    Push-Location $backendDir
    try { & $backendPython -c "import app; print(f'app importe OK, version {app.__version__}')" } finally { Pop-Location }
}

Invoke-Step "Frontend : build (npm run build)" {
    Push-Location $frontendDir
    try { npm run build } finally { Pop-Location }
}

Invoke-Step "PWA : validation d'installabilite du build" {
    node (Join-Path $repoRoot "scripts\check-pwa-installability.mjs")
}

Write-Host ""
Write-Host "Build termine (frontend/dist pret a etre servi)." -ForegroundColor Green
