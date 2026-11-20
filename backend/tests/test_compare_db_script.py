"""`scripts/compare_db.py` : l'outil de comparaison de la mise en service (B1).

Petites bases SQLite écrites à la main : l'outil ne connaît pas le schéma de
l'application, il compare des tables par clé primaire ou par contenu.
"""

import importlib.util
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "compare_db.py"
_spec = importlib.util.spec_from_file_location("compare_db", SCRIPT)
compare_db = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(compare_db)


def make_base(path: Path, *statements: str) -> Path:
    connection = sqlite3.connect(path)
    connection.executescript(
        "CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);"
        "INSERT INTO alembic_version VALUES ('r1');"
        "CREATE TABLE deck (id INTEGER PRIMARY KEY, name TEXT);"
        "INSERT INTO deck VALUES (1, 'Banu Princes');"
        "CREATE TABLE occurrence (id INTEGER PRIMARY KEY, card INTEGER, copies INT);"
        "INSERT INTO occurrence VALUES (1, 10, 2), (2, 11, 1);"
        + "".join(statements)
    )
    connection.commit()
    connection.close()
    return path


def snapshot_file(tmp_path: Path, name: str, *statements: str) -> Path:
    base = make_base(tmp_path / f"{name}.db", *statements)
    target = tmp_path / f"{name}.json"
    assert compare_db.main(["snapshot", str(base), str(target)]) == 0
    return target


def run_diff(before: Path, after: Path, *options: str) -> int:
    return compare_db.main(["diff", str(before), str(after), *options])


def test_backup_copies_and_never_overwrites(tmp_path, capsys):
    base = make_base(tmp_path / "base.db")
    copy = tmp_path / "copie.db"

    assert compare_db.main(["backup", str(base), str(copy)]) == 0
    with closing(sqlite3.connect(copy)) as connection:
        names = connection.execute("SELECT name FROM deck").fetchall()
    assert names == [("Banu Princes",)]
    with pytest.raises(SystemExit):
        compare_db.main(["backup", str(base), str(copy)])
    assert "rien n'est écrasé" in capsys.readouterr().err


def test_backup_writes_under_a_hidden_name_then_renames(tmp_path, monkeypatch):
    """Lot 12, D3 : pas de `vtes-*.db` visible tant que la copie n'est pas finie."""
    base = make_base(tmp_path / "base.db")
    copy = tmp_path / "vtes-20261119T033000Z.db"
    partial = tmp_path / ".vtes-20261119T033000Z.db.part"
    assert compare_db.partial_path(copy) == partial
    partial.write_bytes(b"reste d'une copie interrompue")
    seen_during_copy = []
    real_connect = sqlite3.connect

    def spying_connect(target, *args, **kwargs):
        seen_during_copy.append(sorted(p.name for p in tmp_path.glob("vtes-*.db")))
        return real_connect(target, *args, **kwargs)

    monkeypatch.setattr(compare_db.sqlite3, "connect", spying_connect)
    compare_db.backup(base, copy)

    assert seen_during_copy == [[], []]
    assert copy.exists() and not partial.exists()
    with closing(real_connect(copy)) as connection:
        assert connection.execute("SELECT name FROM deck").fetchall() == [
            ("Banu Princes",)
        ]


def test_a_failed_backup_leaves_no_file(tmp_path, monkeypatch):
    base = make_base(tmp_path / "base.db")
    copy = tmp_path / "vtes-20261119T033000Z.db"

    class BrokenSource:
        def backup(self, copy):
            raise sqlite3.OperationalError("disque plein")

        def close(self):
            pass

    monkeypatch.setattr(compare_db, "_read_only", lambda _path: BrokenSource())
    with pytest.raises(sqlite3.OperationalError):
        compare_db.backup(base, copy)
    assert list(tmp_path.glob("*vtes-*")) == []


def test_snapshot_reads_the_revision_apart_and_the_health(tmp_path):
    taken = json.loads(snapshot_file(tmp_path, "a").read_text(encoding="utf-8"))

    assert taken["meta"] == {"alembic": ["r1"], "integrity": "ok", "foreign_keys": []}
    assert set(taken["tables"]) == {"deck", "occurrence"}
    assert taken["tables"]["deck"]["key"] == ["id"]


def test_identical_bases_compare_clean(tmp_path, capsys):
    before, after = snapshot_file(tmp_path, "a"), snapshot_file(tmp_path, "b")

    assert run_diff(before, after, "--same", "deck", "occurrence") == 0
    assert "deck" in capsys.readouterr().out


def test_a_change_in_a_protected_table_fails(tmp_path, capsys):
    before = snapshot_file(tmp_path, "a")
    after = snapshot_file(tmp_path, "b", "UPDATE deck SET name = 'Autre';")

    assert run_diff(before, after) == 0  # signalée, mais permise
    assert run_diff(before, after, "--same", "deck") == 1
    assert "ÉCART INTERDIT" in capsys.readouterr().out


def test_a_removed_row_always_fails(tmp_path):
    before = snapshot_file(tmp_path, "a")
    after = snapshot_file(tmp_path, "b", "DELETE FROM deck;")

    assert run_diff(before, after) == 1


def test_renumbered_rows_compare_clean_by_content(tmp_path):
    before = snapshot_file(tmp_path, "a")
    renumbered = snapshot_file(
        tmp_path,
        "b",
        "DELETE FROM occurrence;",
        "INSERT INTO occurrence VALUES (3, 10, 2), (4, 11, 1);",
    )

    assert run_diff(before, renumbered) == 1
    assert run_diff(before, renumbered, "--by-content", "occurrence") == 0


def test_by_content_still_sees_a_lost_row(tmp_path):
    before = snapshot_file(tmp_path, "a")
    after = snapshot_file(tmp_path, "b", "DELETE FROM occurrence WHERE id = 2;")

    assert run_diff(before, after, "--by-content", "occurrence") == 1


def test_an_unknown_base_is_refused(tmp_path):
    with pytest.raises(SystemExit):
        compare_db.main(["snapshot", str(tmp_path / "absente.db"), "x.json"])
