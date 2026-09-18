#!/usr/bin/env bash
# Lance le backend FastAPI et le frontend Vite en parallele, accessibles en
# local (localhost) et depuis le reseau Wifi (pour tester sur telephone).
# Ctrl+C arrete les deux serveurs. Equivalent de dev.ps1, pour Linux/macOS/WSL
# et pour reutilisation cote barrins-project.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

backend_port="${BACKEND_PORT:-8000}"
frontend_port="${FRONTEND_PORT:-5173}"

venv_python="$backend_dir/.venv/bin/python"
if [ ! -x "$venv_python" ]; then
    venv_python="$backend_dir/.venv/Scripts/python.exe"
fi
if [ ! -x "$venv_python" ]; then
    echo "venv backend introuvable dans backend/.venv (creer avec 'python -m venv .venv' puis 'pip install -e .[dev]' dans backend/)" >&2
    exit 1
fi
if [ ! -d "$frontend_dir/node_modules" ]; then
    echo "node_modules introuvable dans frontend/ (lancer 'npm install' dans frontend/ d'abord)" >&2
    exit 1
fi

lan_ip=""
if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
elif command -v ipconfig >/dev/null 2>&1 && ipconfig getifaddr en0 >/dev/null 2>&1; then
    lan_ip="$(ipconfig getifaddr en0)"
fi

origins="http://localhost:${frontend_port},http://127.0.0.1:${frontend_port}"
if [ -n "$lan_ip" ]; then
    origins="${origins},http://${lan_ip}:${frontend_port}"
fi
export BACKEND_CORS_ORIGINS="$origins"

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
