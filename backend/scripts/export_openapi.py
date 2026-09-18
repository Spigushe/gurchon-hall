"""Exporte le schéma OpenAPI de l'application FastAPI vers contracts/openapi.json.

Usage (depuis `backend/`, avec l'environnement Python du projet actif) :

    python scripts/export_openapi.py            # écrit contracts/openapi.json
    python scripts/export_openapi.py --check     # vérifie sans écrire (CI)

Le fichier est écrit en UTF-8, indenté à 2 espaces, avec des retours à la
ligne `\n` explicites (paramètre `newline="\n"` à l'ouverture) pour éviter que
Windows ne les convertisse en CRLF et ne pollue le diff du contrat versionné.
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CONTRACT_PATH = REPO_ROOT / "contracts" / "openapi.json"

# Permet d'exécuter le script directement (`python scripts/export_openapi.py`)
# sans avoir installé le paquet `app`.
sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402  (import après ajustement de sys.path)


def render_schema() -> str:
    """Sérialise le schéma OpenAPI courant en texte prêt à écrire sur disque."""
    schema = app.openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def _read_current_contract() -> str | None:
    if not CONTRACT_PATH.exists():
        return None
    # newline="" désactive la traduction universelle des retours à la ligne :
    # on compare le contenu octet pour octet (LF vs CRLF inclus).
    with CONTRACT_PATH.open("r", encoding="utf-8", newline="") as f:
        return f.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="N'écrit rien ; échoue si contracts/openapi.json diverge de l'application.",
    )
    args = parser.parse_args()

    rendered = render_schema()

    if args.check:
        current = _read_current_contract()
        if current is None:
            print(f"{CONTRACT_PATH} est introuvable.", file=sys.stderr)
            return 1
        if current != rendered:
            print(
                f"{CONTRACT_PATH} est désynchronisé de l'application. "
                "Lancer `python scripts/export_openapi.py` pour le régénérer.",
                file=sys.stderr,
            )
            return 1
        print(f"{CONTRACT_PATH} est à jour.")
        return 0

    CONTRACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONTRACT_PATH.open("w", encoding="utf-8", newline="\n") as f:
        f.write(rendered)
    print(f"Écrit : {CONTRACT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
