"""Relevé et comparaison ligne à ligne d'une base SQLite (lot Chercher, B1).

Outil de mise en service, pas de l'application : il sert à vérifier qu'une
migration suivie d'un rejeu de l'import laisse intactes les données de
l'utilisateur et conserve les identifiants du catalogue. Procédure complète,
éprouvée sur une copie de `backend/vtes.db`, dans `docs/lot-chercher-plan.md`
(livraison de B1). Usage, depuis `backend/` :

    uv run python scripts/compare_db.py backup BASE COPIE
    uv run python scripts/compare_db.py snapshot BASE RELEVE.json
    uv run python scripts/compare_db.py diff AVANT.json APRES.json
        [--same TABLE ...] [--by-content TABLE ...]

`backup` copie la base par l'API de sauvegarde de SQLite, source ouverte en
lecture seule, et refuse d'écraser un fichier existant : la copie est
cohérente même si un autre processus lit la base. C'est la sauvegarde datée
d'avant migration, et la copie sur laquelle on fait l'essai.

`snapshot` ouvre la base en lecture seule (`mode=ro`) : il ne la modifie
jamais, même par erreur de chemin. Il relève toutes les lignes de toutes les
tables, la révision Alembic (à part, hors des tables comparées),
`integrity_check` et `foreign_key_check`.

`diff` compare deux relevés table par table, par clé primaire : lignes
disparues, nouvelles, modifiées, et colonnes touchées. `--same` nomme des
tables qui doivent être strictement identiques ; `--by-content` nomme des
tables comparées sans leur clé primaire, comme des multiensembles de lignes :
c'est le cas de `card_printing_occurrence`, que l'import réécrit en bloc à
chaque rejeu (identifiants neufs, contenu inchangé). Le code de sortie vaut 1
si une table de `--same` diffère, si une ligne a disparu d'une table
quelconque, ou si le second relevé n'est pas sain (intégrité, clés
étrangères).
"""

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ABSENT = "<absente>"


def _read_only(database: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)


def backup(database: Path, target: Path) -> None:
    source = _read_only(database)
    copy = sqlite3.connect(target)
    try:
        source.backup(copy)
    finally:
        copy.close()
        source.close()


def snapshot(database: Path) -> dict:
    connection = _read_only(database)
    try:
        names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version' "
                "ORDER BY name"
            )
        ]
        tables = {name: _table(connection, name) for name in names}
        run = connection.execute
        meta = {
            "alembic": [row[0] for row in run("SELECT * FROM alembic_version")],
            "integrity": run("PRAGMA integrity_check").fetchone()[0],
            "foreign_keys": run("PRAGMA foreign_key_check").fetchall(),
        }
    finally:
        connection.close()
    return {"meta": meta, "tables": tables}


def _table(connection: sqlite3.Connection, name: str) -> dict:
    info = list(connection.execute(f'PRAGMA table_info("{name}")'))
    columns = [row[1] for row in info]
    # `pk` (sixième colonne de `table_info`) donne la position dans la clé
    # primaire, 0 hors clé ; une table sans clé se compare sur toutes ses
    # colonnes.
    key = [row[1] for row in sorted(info, key=lambda row: row[5]) if row[5]]
    selected = connection.execute(f'SELECT * FROM "{name}"')
    rows = [dict(zip(columns, row)) for row in selected]
    return {"columns": columns, "key": key or columns, "rows": rows}


def _by_key(table: dict) -> dict[str, dict]:
    return {
        json.dumps([row[column] for column in table["key"]], default=str): row
        for row in table["rows"]
    }


def diff_table(before: dict | None, after: dict | None) -> dict:
    """Écarts d'une table entre deux relevés (une table absente compte vide)."""
    old = _by_key(before) if before else {}
    new = _by_key(after) if after else {}
    columns = Counter()
    changed = 0
    for key in old.keys() & new.keys():
        touched = [
            column
            for column in old[key].keys() | new[key].keys()
            if old[key].get(column, ABSENT) != new[key].get(column, ABSENT)
        ]
        changed += bool(touched)
        columns.update(touched)
    return {
        "before": len(old),
        "after": len(new),
        "removed": len(old.keys() - new.keys()),
        "added": len(new.keys() - old.keys()),
        "changed": changed,
        "columns": dict(sorted(columns.items())),
    }


def diff_content(before: dict | None, after: dict | None) -> dict:
    """Écarts d'une table comparée par contenu, hors clé primaire."""

    def content(table: dict | None) -> Counter:
        if not table:
            return Counter()
        kept = [c for c in table["columns"] if c not in table["key"]]
        return Counter(
            json.dumps([row[c] for c in kept], default=str) for row in table["rows"]
        )

    old, new = content(before), content(after)
    return {
        "before": sum(old.values()),
        "after": sum(new.values()),
        "removed": sum((old - new).values()),
        "added": sum((new - old).values()),
        "changed": 0,
        "columns": {},
    }


def diff(
    before: dict, after: dict, same: set[str], by_content: set[str] = frozenset()
) -> tuple[list[str], bool]:
    lines, ok = [], True
    for name in sorted(before["tables"].keys() | after["tables"].keys()):
        compare = diff_content if name in by_content else diff_table
        result = compare(before["tables"].get(name), after["tables"].get(name))
        identical = not (result["removed"] or result["added"] or result["changed"])
        verdict = "identique" if identical else _describe(result)
        if name in same and not identical:
            ok, verdict = False, f"ÉCART INTERDIT : {verdict}"
        if result["removed"]:
            ok = False
        counts = f"{result['before']:6} -> {result['after']:6}"
        lines.append(f"{name:28} {counts}  {verdict}")
    meta = after["meta"]
    healthy = meta["integrity"] == "ok" and not meta["foreign_keys"]
    ok = ok and healthy
    lines.append(
        f"révision {before['meta']['alembic']} -> {meta['alembic']} ; "
        f"integrity_check {meta['integrity']} ; "
        f"foreign_key_check {len(meta['foreign_keys'])} écart(s)"
    )
    return lines, ok


def _describe(result: dict) -> str:
    labels = (
        ("removed", "disparue(s)"),
        ("added", "nouvelle(s)"),
        ("changed", "modifiée(s)"),
    )
    parts = [f"{result[key]} {label}" for key, label in labels if result[key]]
    if result["columns"]:
        parts.append(f"colonnes {result['columns']}")
    return ", ".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    save = commands.add_parser("backup", help="copier une base, en lecture seule")
    save.add_argument("database", type=Path)
    save.add_argument("target", type=Path)
    take = commands.add_parser("snapshot", help="relever une base, en lecture seule")
    take.add_argument("database", type=Path)
    take.add_argument("output", type=Path)
    compare = commands.add_parser("diff", help="comparer deux relevés")
    compare.add_argument("before", type=Path)
    compare.add_argument("after", type=Path)
    compare.add_argument("--same", nargs="*", default=[], metavar="TABLE")
    compare.add_argument("--by-content", nargs="*", default=[], metavar="TABLE")
    args = parser.parse_args(argv)

    if not getattr(args, "database", Path(".")).exists():
        parser.error(f"base introuvable : {args.database}")
    if args.command == "backup":
        if args.target.exists():
            parser.error(f"la copie existe déjà, rien n'est écrasé : {args.target}")
        backup(args.database, args.target)
        print(f"copie écrite : {args.target}")
        return 0
    if args.command == "snapshot":
        taken = snapshot(args.database)
        args.output.write_text(json.dumps(taken, default=str), encoding="utf-8")
        counts = {name: len(t["rows"]) for name, t in taken["tables"].items()}
        print(json.dumps({"meta": taken["meta"], "rows": counts}, ensure_ascii=False))
        return 0
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))  # noqa: E731
    lines, ok = diff(
        load(args.before), load(args.after), set(args.same), set(args.by_content)
    )
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
