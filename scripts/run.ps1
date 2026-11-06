<#
Point d'entree unique pour le tooling du monorepo : install, test, crap, build, dev,
preview.
Remplace les anciens scripts separes (install.ps1 / test.ps1 / build.ps1 /
dev.ps1), regroupes ici en sous-commandes plutot qu'en fichiers distincts.
Comportement inchange par rapport aux anciens scripts (uv, ruff, eslint,
detection dynamique des scripts npm, etc.) - ce fichier ne fait que fusionner
l'interface. Equivalent bash : scripts/run.sh <commande>.

Usage :
  scripts\run.ps1 install
  scripts\run.ps1 test [-SkipFrontendE2e]
  scripts\run.ps1 crap        (tests unitaires sous couverture + score CRAP, docs/qa-crap.md)
  scripts\run.ps1 build
  scripts\run.ps1 dev [-BackendPort <int>] [-FrontendPort <int>]
  scripts\run.ps1 preview [-SkipBuild] [-BackendPort <int>] [-PreviewPort <int>]
                (build, puis back + `vite preview`, service worker compris : test sur telephone)
#>

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet("install", "test", "crap", "build", "dev", "preview")]
    [string]$Command,

    [switch]$SkipFrontendE2e,

    # `preview` : servir le build existant sans le refaire.
    [switch]$SkipBuild,

    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    # Port de `npm run preview` (build servi avec son service worker, celui qu'on
    # teste sur telephone) : autorise en CORS par `dev` comme par `preview`.
    [int]$PreviewPort = 4173
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

    # pytest tourne sous couverture pour le score CRAP (docs/qa-crap.md),
    # controle juste apres la suite.
    Invoke-BackendCrap

    Invoke-Step "Backend : contrat OpenAPI a jour (export --check)" {
        Push-Location $backendDir
        try { uv run python scripts/export_openapi.py --check } finally { Pop-Location }
    }

    Invoke-Step "Frontend : lint (eslint)" {
        Push-Location $frontendDir
        try { npm run lint } finally { Pop-Location }
    }

    if (Test-NpmScript "test") {
        Invoke-FrontendCrap
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

function Invoke-BackendCrap {
    Invoke-Step "Backend : pytest sous couverture (coverage run -m pytest)" {
        Push-Location $backendDir
        try { uv run coverage run -m pytest } finally { Pop-Location }
    }

    Invoke-Step "Backend : rapport de couverture (coverage json)" {
        Push-Location $backendDir
        try { uv run coverage json -q } finally { Pop-Location }
    }

    Invoke-Step "Backend : score CRAP (scripts/crap_report.py)" {
        Push-Location $backendDir
        try { uv run python scripts/crap_report.py } finally { Pop-Location }
    }
}

function Invoke-FrontendCrap {
    Invoke-Step "Frontend : tests unitaires sous couverture (npm run test:coverage)" {
        Push-Location $frontendDir
        try { npm run test:coverage } finally { Pop-Location }
    }

    Invoke-Step "Frontend : score CRAP (npm run crap)" {
        Push-Location $frontendDir
        try { npm run crap } finally { Pop-Location }
    }
}

function Invoke-CrapCommand {
    if (-not (Test-Path (Join-Path $backendDir ".venv"))) {
        throw "venv backend introuvable dans backend/.venv (lancer scripts\run.ps1 install d'abord)"
    }
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "node_modules introuvable dans frontend/ (lancer scripts\run.ps1 install d'abord)"
    }

    Invoke-BackendCrap
    Invoke-FrontendCrap

    Write-Host ""
    Write-Host "Score CRAP controle (references dans docs/qa-baselines/crap/)." -ForegroundColor Green
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

function Get-LanIp {
    # Detecte une IP locale (Wifi/Ethernet), en ecartant loopback et adaptateurs virtuels.
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -ne "127.0.0.1" -and
            $_.PrefixOrigin -ne "WellKnown" -and
            $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|Virtual"
        } |
        Select-Object -First 1 -ExpandProperty IPAddress
}

# Lance le back et un front (serveur de dev Vite, ou build servi par `vite preview`)
# dans deux fenetres, avec le CORS et le cookie adaptes a un acces par le reseau local.
function Start-Servers {
    param(
        [ValidateSet("dev", "preview")] [string]$Mode
    )

    $backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $backendPython)) {
        throw "venv backend introuvable : $backendPython (lancer scripts\run.ps1 install d'abord)"
    }
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "node_modules introuvable dans frontend/ (lancer scripts\run.ps1 install d'abord)"
    }

    $lanIp = Get-LanIp
    if (-not $lanIp) {
        Write-Warning "Aucune IP reseau locale detectee : seul l'acces localhost sera annonce et autorise en CORS."
    }

    if ($Mode -eq "preview") {
        # Le build fige VITE_API_BASE_URL (frontend/.env.local pour l'acces telephone) :
        # une IP changee par le DHCP donnerait un front qui appelle une API introuvable.
        $envLocal = Join-Path $frontendDir ".env.local"
        if ($lanIp -and (Test-Path $envLocal) -and -not (Select-String -Path $envLocal -Pattern ([regex]::Escape($lanIp)) -Quiet)) {
            Write-Warning "frontend/.env.local ne mentionne pas l'IP $lanIp : VITE_API_BASE_URL est peut-etre perimee."
        }
        if ($SkipBuild) {
            if (-not (Test-Path (Join-Path $frontendDir "dist"))) {
                throw "frontend/dist introuvable : relancer sans -SkipBuild"
            }
        } else {
            Invoke-Step "Frontend : build (npm run build)" {
                Push-Location $frontendDir
                try { npm run build } finally { Pop-Location }
            }
        }
    }

    # Deux origines par hote, quel que soit le mode : le serveur de dev Vite et
    # `npm run preview` (le build, seul a avoir le service worker, donc celui de la
    # verification sur telephone).
    $corsHosts = @("localhost", "127.0.0.1")
    if ($lanIp) {
        $corsHosts += $lanIp
    }
    $corsOrigins = foreach ($corsHost in $corsHosts) {
        foreach ($port in @($FrontendPort, $PreviewPort)) {
            "http://${corsHost}:${port}"
        }
    }
    $env:BACKEND_CORS_ORIGINS = ($corsOrigins -join ",")

    # Le navigateur ne garde un cookie Secure sur http:// que pour localhost : depuis
    # http://<ip-lan> (telephone), la connexion repond 200 mais la session est perdue
    # et tout le reste rend 401. Sur le reseau local, cookie sans Secure,
    # sauf si la variable est deja positionnee.
    if ($lanIp -and -not $env:SESSION_COOKIE_SECURE) {
        $env:SESSION_COOKIE_SECURE = "false"
    }

    if ($Mode -eq "preview") {
        $frontLabel = "Frontend (preview)"
        $frontPort = $PreviewPort
        $frontCommand = "npm run preview -- --host 0.0.0.0 --port $PreviewPort --strictPort"
    } else {
        $frontLabel = "Frontend (Vite)   "
        $frontPort = $FrontendPort
        $frontCommand = "npm run dev -- --host 0.0.0.0 --port $FrontendPort"
    }

    Write-Host ""
    Write-Host "Backend  (FastAPI) : http://localhost:$BackendPort" -ForegroundColor Cyan
    if ($lanIp) {
        Write-Host "                     http://${lanIp}:${BackendPort}  (reseau Wifi)" -ForegroundColor Cyan
    }
    Write-Host "$frontLabel : http://localhost:$frontPort" -ForegroundColor Green
    if ($lanIp) {
        Write-Host "                     http://${lanIp}:${frontPort}  (reseau Wifi, ex. telephone)" -ForegroundColor Green
    }
    Write-Host "CORS               : $($env:BACKEND_CORS_ORIGINS)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Deux fenetres vont s'ouvrir. Fermez-les (ou Ctrl+C dedans) pour arreter." -ForegroundColor Yellow
    Write-Host ""

    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "cd '$backendDir'; & '$backendPython' -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort"
    )

    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "cd '$frontendDir'; $frontCommand"
    )
}

switch ($Command) {
    "install" { Invoke-InstallCommand }
    "test"    { Invoke-TestCommand }
    "crap"    { Invoke-CrapCommand }
    "build"   { Invoke-BuildCommand }
    "dev"     { Start-Servers -Mode dev }
    "preview" { Start-Servers -Mode preview }
}
