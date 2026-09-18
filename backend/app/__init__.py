"""Application FastAPI du suivi VtES.

`__version__` est dérivé de `pyproject.toml` (source unique de vérité) au lieu
d'être dupliqué ici : on lit le fichier directement avec `tomllib`, ce qui
fonctionne en dev sans avoir besoin d'installer le paquet (`pip install -e .`).
Si le fichier est introuvable (paquet packagé sans son pyproject.toml, cas qui
ne se présente pas encore pour ce pilote), on retombe sur une version par
défaut plutôt que de planter au démarrage.
"""

import tomllib
from pathlib import Path

_PYPROJECT_PATH = Path(__file__).resolve().parent.parent / "pyproject.toml"
_FALLBACK_VERSION = "0.0.0"


def _read_version() -> str:
    try:
        with _PYPROJECT_PATH.open("rb") as f:
            data = tomllib.load(f)
        return data["project"]["version"]
    except (FileNotFoundError, KeyError):
        return _FALLBACK_VERSION


__version__ = _read_version()

__all__ = ["__version__"]
