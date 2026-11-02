#!/usr/bin/env bash
# Point d'entree unique pour le tooling du monorepo : install, test, crap, build,
# dev. Remplace les anciens scripts separes (install.sh / test.sh / build.sh /
# dev.sh), regroupes ici en sous-commandes plutot qu'en fichiers distincts.
# Comportement inchange par rapport aux anciens scripts (uv, ruff, eslint,
# detection dynamique des scripts npm, etc.) - ce fichier ne fait que
# fusionner l'interface. Equivalent PowerShell : scripts/run.ps1 <commande>.
#
# Usage :
#   scripts/run.sh install
#   scripts/run.sh test [--skip-frontend-e2e]
#   scripts/run.sh crap           (tests unitaires sous couverture + score CRAP, docs/qa-crap.md)
#   scripts/run.sh build
#   scripts/run.sh dev            (BACKEND_PORT / FRONTEND_PORT en env pour changer les ports)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

usage() {
    echo "Usage: $(basename "$0") <install|test|crap|build|dev> [options]" >&2
    exit 1
}

subcommand="${1:-}"
[ -n "$subcommand" ] || usage
shift

step() { echo ""; echo "== $1 =="; }

has_npm_script() {
    node -p "!!((require('$frontend_dir/package.json').scripts)||{})['$1']" 2>/dev/null
}

resolve_venv_python() {
    local candidate="$backend_dir/.venv/bin/python"
    if [ ! -x "$candidate" ]; then
        candidate="$backend_dir/.venv/Scripts/python.exe"
    fi
    echo "$candidate"
}

cmd_install() {
    step "Backend : installation (uv sync --extra dev)"
    (cd "$backend_dir" && uv sync --extra dev)

    step "Frontend : installation (npm ci)"
    if [ -f "$frontend_dir/package-lock.json" ]; then
        (cd "$frontend_dir" && npm ci)
    else
        (cd "$frontend_dir" && npm install)
    fi

    echo ""
    echo "Installation terminee. Voir README.md pour lancer le dev (scripts/run.sh dev), les tests (scripts/run.sh test) ou le build (scripts/run.sh build)."
}

cmd_test() {
    local skip_e2e=0
    for arg in "$@"; do
        case "$arg" in
            --skip-frontend-e2e) skip_e2e=1 ;;
            *)
                echo "Option inconnue pour 'test' : $arg" >&2
                usage
                ;;
        esac
    done

    if [ ! -d "$backend_dir/.venv" ]; then
        echo "venv backend introuvable dans backend/.venv (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi
    if [ ! -d "$frontend_dir/node_modules" ]; then
        echo "node_modules introuvable dans frontend/ (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi

    step "Backend : lint (ruff check)"
    (cd "$backend_dir" && uv run ruff check .)

    # pytest tourne sous couverture pour le score CRAP (docs/qa-crap.md),
    # controle juste apres la suite.
    backend_crap

    step "Backend : contrat OpenAPI a jour (export --check)"
    (cd "$backend_dir" && uv run python scripts/export_openapi.py --check)

    step "Frontend : lint (eslint)"
    (cd "$frontend_dir" && npm run lint)

    if [ "$(has_npm_script test)" = "true" ]; then
        frontend_crap
    else
        echo "ATTENTION : frontend/package.json n'a pas encore de script 'test' (vitest) - etape ignoree." >&2
    fi

    if [ "$skip_e2e" -eq 0 ]; then
        if [ "$(has_npm_script test:e2e)" = "true" ]; then
            step "Frontend : tests e2e (npm run test:e2e)"
            (cd "$frontend_dir" && npm run test:e2e)
        else
            echo "ATTENTION : frontend/package.json n'a pas encore de script 'test:e2e' (Playwright) - etape ignoree." >&2
        fi
    fi

    echo ""
    echo "Tests termines."
}

backend_crap() {
    step "Backend : pytest sous couverture (coverage run -m pytest)"
    (cd "$backend_dir" && uv run coverage run -m pytest)

    step "Backend : score CRAP (scripts/crap_report.py)"
    (cd "$backend_dir" && uv run coverage json -q && uv run python scripts/crap_report.py)
}

frontend_crap() {
    step "Frontend : tests unitaires sous couverture (npm run test:coverage)"
    (cd "$frontend_dir" && npm run test:coverage)

    step "Frontend : score CRAP (npm run crap)"
    (cd "$frontend_dir" && npm run crap)
}

cmd_crap() {
    if [ ! -d "$backend_dir/.venv" ] || [ ! -d "$frontend_dir/node_modules" ]; then
        echo "venv backend ou node_modules introuvable (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi
    backend_crap
    frontend_crap

    echo ""
    echo "Score CRAP controle (references dans docs/qa-baselines/crap/)."
}

cmd_build() {
    local venv_python
    venv_python="$(resolve_venv_python)"
    if [ ! -x "$venv_python" ]; then
        echo "venv backend introuvable (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi
    if [ ! -d "$frontend_dir/node_modules" ]; then
        echo "node_modules introuvable dans frontend/ (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi

    step "Backend : verification de l'import (sanity check)"
    (cd "$backend_dir" && "$venv_python" -c "import app; print(f'app importe OK, version {app.__version__}')")

    step "Frontend : build (npm run build)"
    (cd "$frontend_dir" && npm run build)

    step "PWA : validation d'installabilite du build"
    node "$repo_root/scripts/check-pwa-installability.mjs"

    echo ""
    echo "Build termine (frontend/dist pret a etre servi)."
}

cmd_dev() {
    local venv_python
    venv_python="$(resolve_venv_python)"
    if [ ! -x "$venv_python" ]; then
        echo "venv backend introuvable dans backend/.venv (lancer scripts/run.sh install d'abord)" >&2
        exit 1
    fi
    if [ ! -d "$frontend_dir/node_modules" ]; then
        echo "node_modules introuvable dans frontend/ (lancer 'npm install' dans frontend/ d'abord)" >&2
        exit 1
    fi

    local backend_port="${BACKEND_PORT:-8000}"
    local frontend_port="${FRONTEND_PORT:-5173}"

    local lan_ip=""
    if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
        lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    elif command -v ipconfig >/dev/null 2>&1 && ipconfig getifaddr en0 >/dev/null 2>&1; then
        lan_ip="$(ipconfig getifaddr en0)"
    fi

    local origins="http://localhost:${frontend_port},http://127.0.0.1:${frontend_port}"
    if [ -n "$lan_ip" ]; then
        origins="${origins},http://${lan_ip}:${frontend_port}"
    fi
    export BACKEND_CORS_ORIGINS="$origins"

    # Le navigateur ne garde un cookie Secure sur http:// que pour localhost : depuis
    # http://<ip-lan> (telephone), la connexion repond 200 mais la session est perdue
    # et tout le reste rend 401. En dev sur le reseau local, cookie sans Secure,
    # sauf si la variable est deja positionnee.
    if [ -n "$lan_ip" ] && [ -z "${SESSION_COOKIE_SECURE:-}" ]; then
        export SESSION_COOKIE_SECURE=false
    fi

    echo ""
    echo "Backend  (FastAPI) : http://localhost:${backend_port}"
    [ -n "$lan_ip" ] && echo "                     http://${lan_ip}:${backend_port}  (reseau Wifi)"
    echo "Frontend (Vite)    : http://localhost:${frontend_port}"
    [ -n "$lan_ip" ] && echo "                     http://${lan_ip}:${frontend_port}  (reseau Wifi, ex. telephone)"
    echo ""
    echo "Ctrl+C arrete les deux serveurs."
    echo ""

    cleanup() {
        kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    (cd "$backend_dir" && "$venv_python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$backend_port") &
    backend_pid=$!

    (cd "$frontend_dir" && npm run dev -- --host 0.0.0.0 --port "$frontend_port") &
    frontend_pid=$!

    wait
}

case "$subcommand" in
    install) cmd_install "$@" ;;
    test) cmd_test "$@" ;;
    crap) cmd_crap "$@" ;;
    build) cmd_build "$@" ;;
    dev) cmd_dev "$@" ;;
    *) usage ;;
esac
