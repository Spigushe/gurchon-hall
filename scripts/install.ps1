<#
Installe les dependances des deux couches : venv Python (backend) et
node_modules (frontend). A lancer une fois au demarrage, ou apres avoir tire
des changements qui touchent pyproject.toml / package.json.
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

function Invoke-Step {
    param([string]$Description, [scriptblock]$Action)
    Write-Host ""
    Write-Host "== $Description ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Echec : $Description"
    }
}

$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Invoke-Step "Backend : creation du venv (.venv)" {
        Push-Location $backendDir
        try { python -m venv .venv } finally { Pop-Location }
    }
}

Invoke-Step "Backend : installation (pip install -e .[dev])" {
    Push-Location $backendDir
    try { & $venvPython -m pip install -e ".[dev]" } finally { Pop-Location }
}

Invoke-Step "Frontend : installation (npm ci)" {
    Push-Location $frontendDir
    try {
        if (Test-Path "package-lock.json") { npm ci } else { npm install }
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "Installation terminee. Voir README.md pour lancer le dev (scripts/dev.ps1), les tests (scripts/test.ps1) ou le build (scripts/build.ps1)." -ForegroundColor Green
