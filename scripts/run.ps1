<#
Point d'entree unique pour le tooling du monorepo : install, test, build, dev.
Remplace les anciens scripts separes (install.ps1 / test.ps1 / build.ps1 /
dev.ps1), regroupes ici en sous-commandes plutot qu'en fichiers distincts.
Comportement inchange par rapport aux anciens scripts (uv, ruff, eslint,
detection dynamique des scripts npm, etc.) - ce fichier ne fait que fusionner
l'interface. Equivalent bash : scripts/run.sh <commande>.

Usage :
  scripts\run.ps1 install
  scripts\run.ps1 test [-SkipFrontendE2e]
  scripts\run.ps1 build
  scripts\run.ps1 dev [-BackendPort <int>] [-FrontendPort <int>]
#>

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet("install", "test", "build", "dev")]
    [string]$Command,

    [switch]$SkipFrontendE2e,

    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

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

function Test-NpmScript {
    param([string]$Name)
    $pkgPath = Join-Path $frontendDir "package.json"
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if (-not $pkg.scripts) { return $false }
    return [bool]($pkg.scripts.PSObject.Properties.Name -contains $Name)
}

function Invoke-InstallCommand {
    Invoke-Step "Backend : installation (uv sync --extra dev)" {
        Push-Location $backendDir
        try { uv sync --extra dev } finally { Pop-Location }
    }

    Invoke-Step "Frontend : installation (npm ci)" {
        Push-Location $frontendDir
        try {
            if (Test-Path "package-lock.json") { npm ci } else { npm install }
        } finally { Pop-Location }
    }

    Write-Host ""
    Write-Host "Installation terminee. Voir README.md pour lancer le dev (scripts\run.ps1 dev), les tests (scripts\run.ps1 test) ou le build (scripts\run.ps1 build)." -ForegroundColor Green
}

function Invoke-TestCommand {
    if (-not (Test-Path (Join-Path $backendDir ".venv"))) {
        throw "venv backend introuvable dans backend/.venv (lancer scripts\run.ps1 install d'abord)"
    }
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "node_modules introuvable dans frontend/ (lancer scripts\run.ps1 install d'abord)"
    }

    Invoke-Step "Backend : lint (ruff check)" {
        Push-Location $backendDir
        try { uv run ruff check . } finally { Pop-Location }
    }

    Invoke-Step "Backend : pytest" {
        Push-Location $backendDir
        try { uv run pytest } finally { Pop-Location }
    }

    Invoke-Step "Backend : contrat OpenAPI a jour (export --check)" {
        Push-Location $backendDir
        try { uv run python scripts/export_openapi.py --check } finally { Pop-Location }
    }

    Invoke-Step "Frontend : lint (eslint)" {
        Push-Location $frontendDir
        try { npm run lint } finally { Pop-Location }
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
}

function Invoke-BuildCommand {
    $backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $backendPython)) {
        throw "venv backend introuvable : $backendPython (lancer scripts\run.ps1 install d'abord)"
    }
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "node_modules introuvable dans frontend/ (lancer scripts\run.ps1 install d'abord)"
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
}

function Invoke-DevCommand {
    $backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $backendPython)) {
        throw "venv backend introuvable : $backendPython (lancer scripts\run.ps1 install d'abord)"
    }
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "node_modules introuvable dans frontend/ (lancer scripts\run.ps1 install d'abord)"
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
}

switch ($Command) {
    "install" { Invoke-InstallCommand }
    "test"    { Invoke-TestCommand }
    "build"   { Invoke-BuildCommand }
    "dev"     { Invoke-DevCommand }
}
