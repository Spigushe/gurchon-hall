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


# --------------------------------------------------------------------------
# Lot Chercher : secte dérivée et `vteslibmeta.csv` (P13, P15)
# --------------------------------------------------------------------------


def test_from_dir_reads_the_library_meta_file_when_present(tmp_path):
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)
    shutil.copyfile(FIXTURES / "vteslibmeta_sample.csv", source / "vteslibmeta.csv")

    result = run(
        [sys.executable, str(SCRIPT), "--from-dir", str(source), "--json"], db_path
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["crypt_sects"] == {
        "Camarilla": 1,
        "Imbued": 1,
        "Independent": 1,
        "Sabbat": 2,
    }
    assert report["unknown_sect_cards"] == []
    assert report["library_requirements"] == 3
    assert [issue["reason"] for issue in report["library_meta_issues"]] == [
        "name_mismatch",
        "crypt_card",
        "unknown_id",
        "duplicate_id",
    ]
    assert report["library_meta_issues"][0] == {
        "id": "100111",
        "name": "Aura Absorbtion",
        "reason": "name_mismatch",
        "catalog_name": "Aura Absorption",
    }
    # Signalé sur stderr, sans faire échouer l'import.
    assert "vteslibmeta.csv en écart" in result.stderr
    assert "Aura Absorbtion" in result.stderr


def test_from_dir_without_the_library_meta_file_warns_and_keeps_going(tmp_path):
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)

    result = run(
        [sys.executable, str(SCRIPT), "--from-dir", str(source), "--json"], db_path
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["library_requirements"] is None
    assert report["library_meta_issues"] == []
    assert "vteslibmeta.csv absent" in result.stderr


def test_from_dir_refuses_a_library_meta_file_with_another_header(tmp_path):
    """Un changement de forme du fichier se voit : l'import échoue avant de
    toucher la base, qui reste vide."""
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)
    (source / "vteslibmeta.csv").write_text('"Id","Nom","Exigence"\n', encoding="utf-8")

    result = run(
        [sys.executable, str(SCRIPT), "--from-dir", str(source), "--json"], db_path
    )

    assert result.returncode != 0
    assert "en-tête inattendu" in result.stderr
    check = run(
        [
            sys.executable,
            "-c",
            "import sqlite3, sys; print(sqlite3.connect(sys.argv[1])"
            ".execute('SELECT COUNT(*) FROM card').fetchone()[0])",
            str(db_path),
        ],
        db_path,
    )
    assert check.stdout.strip() == "0"


def test_from_dir_text_summary_counts_sects_and_requirements(tmp_path):
    db_path = migrated_db(tmp_path)
    source = local_source(tmp_path)
    shutil.copyfile(FIXTURES / "vteslibmeta_sample.csv", source / "vteslibmeta.csv")

    result = run([sys.executable, str(SCRIPT), "--from-dir", str(source)], db_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "5 sectes de crypte, 3 exigences de bibliothèque." in result.stdout
