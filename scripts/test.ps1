<#
Lance la suite de tests des deux couches, dans le meme ordre que la CI
(.github/workflows/ci.yml) : pytest backend, garde-fou du contrat OpenAPI,
puis tests frontend (vitest / Playwright) si les scripts npm correspondants
existent deja dans frontend/package.json.

Les tests frontend (vitest, Playwright) sont ajoutes par l'agent qa-tests en
parallele de ce script : tant que "test" / "test:e2e" n'existent pas dans
frontend/package.json, les etapes correspondantes sont annoncees comme
ignorees plutot que de faire echouer le script sur un script npm absent.
#>

param(
    [switch]$SkipFrontendE2e
)

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

function Test-NpmScript {
    param([string]$Name)
    $pkgPath = Join-Path $frontendDir "package.json"
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if (-not $pkg.scripts) { return $false }
    return [bool]($pkg.scripts.PSObject.Properties.Name -contains $Name)
}

Invoke-Step "Backend : pytest" {
    Push-Location $backendDir
    try { & $backendPython -m pytest } finally { Pop-Location }
}

Invoke-Step "Backend : contrat OpenAPI a jour (export --check)" {
    Push-Location $backendDir
    try { & $backendPython scripts/export_openapi.py --check } finally { Pop-Location }
}

if (Test-NpmScript "test") {
    Invoke-Step "Frontend : tests unitaires (npm run test)" {
        Push-Location $frontendDir
        try { npm run test } finally { Pop-Location }
    }
} else {
    Write-Warning "frontend/package.json n'a pas encore de script 'test' (vitest) - etape ignoree."
}

if (-not $SkipFrontendE2e) {
    if (Test-NpmScript "test:e2e") {
        Invoke-Step "Frontend : tests e2e (npm run test:e2e)" {
            Push-Location $frontendDir
            try { npm run test:e2e } finally { Pop-Location }
        }
    } else {
        Write-Warning "frontend/package.json n'a pas encore de script 'test:e2e' (Playwright) - etape ignoree."
    }
}

Write-Host ""
Write-Host "Tests termines." -ForegroundColor Green
