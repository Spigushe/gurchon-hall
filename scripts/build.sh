#!/usr/bin/env bash
# Build des deux couches, plus la validation d'installabilite PWA sur le
# resultat du build frontend. Equivalent de build.ps1, pour Linux/macOS/WSL
# et reutilisation Barrin.
#
# Le backend Python n'a pas d'etape de build a proprement parler (pas de
# compilation) : ce script verifie seulement qu'il s'importe correctement
# depuis l'installation editable. Le frontend est buildé avec Vite, puis le
# build est verifie avec scripts/check-pwa-installability.mjs (manifest,
# icones, service worker — criteres reels, pas de "score Lighthouse PWA").

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

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

step "Backend : verification de l'import (sanity check)"
(cd "$backend_dir" && "$venv_python" -c "import app; print(f'app importe OK, version {app.__version__}')")

step "Frontend : build (npm run build)"
(cd "$frontend_dir" && npm run build)

step "PWA : validation d'installabilite du build"
node "$repo_root/scripts/check-pwa-installability.mjs"

echo ""
echo "Build termine (frontend/dist pret a etre servi)."
