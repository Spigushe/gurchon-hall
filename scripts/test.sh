#!/usr/bin/env bash
# Lance la suite de tests des deux couches, dans le meme ordre que la CI
# (.github/workflows/ci.yml) : pytest backend, garde-fou du contrat OpenAPI,
# puis tests frontend (vitest / Playwright) si les scripts npm correspondants
# existent deja dans frontend/package.json. Equivalent de test.ps1, pour
# Linux/macOS/WSL et reutilisation Barrin.
#
# Les tests frontend sont ajoutes par l'agent qa-tests en parallele : tant que
# "test" / "test:e2e" n'existent pas dans frontend/package.json, les etapes
# correspondantes sont annoncees comme ignorees plutot que de faire echouer
# le script sur un script npm absent.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

skip_e2e=0
for arg in "$@"; do
    case "$arg" in
        --skip-frontend-e2e) skip_e2e=1 ;;
    esac
done

venv_python="$backend_dir/.venv/bin/python"
if [ ! -x "$venv_python" ]; then
    venv_python="$backend_dir/.venv/Scripts/python.exe"
fi
if [ ! -x "$venv_python" ]; then
    echo "venv backend introuvable (lancer scripts/install.sh d'abord)" >&2
    exit 1
fi
if [ ! -d "$frontend_dir/node_modules" ]; then
    echo "node_modules introuvable dans frontend/ (lancer scripts/install.sh d'abord)" >&2
    exit 1
fi

step() { echo ""; echo "== $1 =="; }

has_npm_script() {
    node -p "!!((require('$frontend_dir/package.json').scripts)||{})['$1']" 2>/dev/null
}

step "Backend : pytest"
(cd "$backend_dir" && "$venv_python" -m pytest)

step "Backend : contrat OpenAPI a jour (export --check)"
(cd "$backend_dir" && "$venv_python" scripts/export_openapi.py --check)

if [ "$(has_npm_script test)" = "true" ]; then
    step "Frontend : tests unitaires (npm run test)"
    (cd "$frontend_dir" && npm run test)
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
