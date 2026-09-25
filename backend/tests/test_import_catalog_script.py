"""`scripts/import_catalog.py` en sous-processus : `--from-dir`, `--json`.

Complète `test_catalog_import.py` (qui teste `app.services.catalog_import`
directement, en mémoire) sur ce que le script ajoute : lecture de fichiers
locaux, sortie `--json`, avertissements sur la sortie d'erreur pour les
cartes sous extension tampon (D2b, D2c) — un déclenchement sans humain devant
la console (Lot 11) doit pouvoir relire le rapport.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCRIPT = BACKEND_DIR / "scripts" / "import_catalog.py"
FIXTURES = Path(__file__).parent / "fixtures"


def url_for(path: Path) -> str:
    return f"sqlite+pysqlite:///{path.as_posix()}"


def run(args: list[str], db_path: Path) -> subprocess.CompletedProcess:
    # Copie complète de l'environnement (comme `test_migrations.py`) : sur
    # Windows, `asyncio`/`_overlapped` a besoin de variables système au-delà
    # de PATH pour s'importer, même si ce script ne s'en sert pas lui-même.
    env = {
        **os.environ,
        "DATABASE_URL": url_for(db_path),
        "PYTHONIOENCODING": "utf-8",
    }
    return subprocess.run(
        args,
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def migrated_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "import.db"
    upgraded = run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], db_path
    )
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    return db_path


def local_source(tmp_path: Path) -> Path:
    """Le script attend `vtes.json`/`expansions.json` : renommage du fixture."""
    source = tmp_path / "source"
    source.mkdir()
    shutil.copyfile(FIXTURES / "krcg_vtes.json", source / "vtes.json")
    shutil.copyfile(FIXTURES / "krcg_expansions.json", source / "expansions.json")
    return source


def test_from_dir_json_report_lists_the_placeholder_card(tmp_path):
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)

    result = run(
        [
            sys.executable,
            str(SCRIPT),
            "--from-dir",
            str(source),
            "--json",
        ],
        db_path,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["cards_created"] == 10
    assert report["placeholder_cards"] == [
        {"vekn_id": 100999, "name": "Fantome Sans Extension"}
    ]
    assert report["reassign_cards"] == []
    # Avertissement sur stderr, import non mis en échec pour autant (0).
    assert "Fantome Sans Extension" in result.stderr
    assert "#100999" in result.stderr


def test_from_dir_text_report_still_warns_on_stderr(tmp_path):
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)

    result = run([sys.executable, str(SCRIPT), "--from-dir", str(source)], db_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Catalogue importé" in result.stdout
    assert "extension tampon" in result.stderr


def test_replaying_from_dir_does_not_warn_twice_about_the_same_card(tmp_path):
    """Rejeu : la même carte reste sous tampon, toujours signalée (pas d'échec)."""
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)

    first = run(
        [sys.executable, str(SCRIPT), "--from-dir", str(source), "--json"], db_path
    )
    second = run(
        [sys.executable, str(SCRIPT), "--from-dir", str(source), "--json"], db_path
    )

    assert (first.returncode, second.returncode) == (0, 0)
    second_report = json.loads(second.stdout)
    assert second_report["cards_created"] == 0
    assert second_report["cards_updated"] == 10
    assert second_report["placeholder_cards"] == [
        {"vekn_id": 100999, "name": "Fantome Sans Extension"}
    ]
