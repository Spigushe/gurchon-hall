#!/usr/bin/env bash
# Installe les dependances des deux couches : venv Python (backend) et
# node_modules (frontend). A lancer une fois au demarrage, ou apres avoir
# tire des changements qui touchent pyproject.toml / package.json.
# Equivalent de install.ps1, pour Linux/macOS/WSL et reutilisation Barrin.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

step() { echo ""; echo "== $1 =="; }

venv_python="$backend_dir/.venv/bin/python"
if [ ! -x "$venv_python" ]; then
    step "Backend : creation du venv (.venv)"
    (cd "$backend_dir" && python3 -m venv .venv)
fi

step "Backend : installation (pip install -e .[dev])"
(cd "$backend_dir" && "$venv_python" -m pip install -e ".[dev]")

step "Frontend : installation (npm ci)"
if [ -f "$frontend_dir/package-lock.json" ]; then
    (cd "$frontend_dir" && npm ci)
else
    (cd "$frontend_dir" && npm install)
fi

echo ""
echo "Installation terminee. Voir README.md pour lancer le dev (scripts/dev.sh), les tests (scripts/test.sh) ou le build (scripts/build.sh)."
