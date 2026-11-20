"""Refus de `/sync` comptés par motif, lus dans le journal (Lot 12, B3, P4).

Outil d'exploitation, pas de l'application : il lit la table `sync_operation`
d'une base SQLite **en lecture seule** (`mode=ro`), sur le VPS ou sur une copie
rapatriée, et ne la modifie jamais, même par erreur de chemin. Le chemin de la
base est obligatoire : pas de repli silencieux sur `backend/vtes.db`. Usage,
depuis `backend/` :

    uv run python scripts/sync_report.py BASE [--since AAAA-MM-JJ]
        [--until AAAA-MM-JJ] [--user ID] [--json]

Les bornes portent sur `processed_at`, l'instant du verdict, en jours UTC
inclus des deux côtés. Le rapport donne le nombre d'opérations tranchées,
appliquées et refusées, les refus par motif (`SyncErrorCode`), par motif et
type d'opération, et par jour. Un rejeu (`replayed`) n'écrit rien au journal :
il n'y est donc pas compté, et un refus ne l'est qu'une fois, au lot qui l'a
tranché. Comme la ligne `sync.batch` des journaux de l'API, le rapport ne
reprend aucun message de refus ni aucune référence client.

Code de sortie : 0, ou 2 sur une base sans table `sync_operation` ou une date
illisible.
"""

import argparse
import json
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path


def _read_only(database: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)


def _day(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            f"date attendue au format AAAA-MM-JJ : {text!r}"
        ) from error


def _where(
    since: date | None, until: date | None, user_id: int | None
) -> tuple[str, list]:
    """Clause et paramètres de la période et du compte.

    `processed_at` est stocké en UTC naïf, au format ISO de SQLite
    (« 2026-11-18 10:00:00.123456 ») : une comparaison de chaînes suffit, et
    la borne haute est le lendemain de `until`, exclu.
    """
    clauses: list[str] = []
    params: list = []
    if since is not None:
        clauses.append("processed_at >= ?")
        params.append(since.isoformat())
    if until is not None:
        clauses.append("processed_at < ?")
        params.append((until + timedelta(days=1)).isoformat())
    if user_id is not None:
        clauses.append("user_id = ?")
        params.append(user_id)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


def _has_journal(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_operation'"
    ).fetchone()
    return row is not None


def build_report(
    database: Path,
    *,
    since: date | None = None,
    until: date | None = None,
    user_id: int | None = None,
) -> dict:
    """Rapport des opérations tranchées sur la période, en lecture seule.

    `LookupError` si la base n'a pas de journal `sync_operation`.
    """
    connection = _read_only(database)
    try:
        if not _has_journal(connection):
            raise LookupError(f"{database} : aucune table sync_operation.")
        where, params = _where(since, until, user_id)
        rejected = where + (" AND " if where else " WHERE ") + "status = 'rejected'"
        run = connection.execute
        totals = run(
            "SELECT count(*), coalesce(sum(status = 'applied'), 0), "
            "coalesce(sum(status = 'rejected'), 0), min(processed_at), "
            f"max(processed_at) FROM sync_operation{where}",
            params,
        ).fetchone()
        by_code = run(
            f"SELECT error_code, count(*) FROM sync_operation{rejected} "
            "GROUP BY error_code ORDER BY count(*) DESC, error_code",
            params,
        ).fetchall()
        by_code_and_type = run(
            "SELECT error_code, operation_type, count(*) FROM sync_operation"
            f"{rejected} GROUP BY error_code, operation_type "
            "ORDER BY count(*) DESC, error_code, operation_type",
            params,
        ).fetchall()
        by_day = run(
            "SELECT substr(processed_at, 1, 10) AS day, "
            "sum(status = 'applied'), sum(status = 'rejected') "
            f"FROM sync_operation{where} GROUP BY day ORDER BY day",
            params,
        ).fetchall()
    finally:
        connection.close()
    operations, applied, rejected_count, first, last = totals
    return {
        "database": str(database),
        "since": since.isoformat() if since else None,
        "until": until.isoformat() if until else None,
        "user_id": user_id,
        "operations": operations,
        "applied": applied,
        "rejected": rejected_count,
        "first_processed_at": first,
        "last_processed_at": last,
        "rejected_by_code": {code: count for code, count in by_code},
        "rejected_by_code_and_type": [
            {"code": code, "type": kind, "count": count}
            for code, kind, count in by_code_and_type
        ],
        "by_day": [
            {"day": day, "applied": day_applied, "rejected": day_rejected}
            for day, day_applied, day_rejected in by_day
        ],
    }


def _period(report: dict) -> str:
    since = report["since"] or "le début"
    until = report["until"] or "aujourd'hui"
    scope = f", compte {report['user_id']}" if report["user_id"] is not None else ""
    return f"du {since} à {until}{scope}"


def format_report(report: dict) -> str:
    """Le rapport en texte, pour un terminal."""
    lines = [
        f"Journal /sync de {report['database']}, {_period(report)}",
        f"Opérations tranchées : {report['operations']} "
        f"(appliquées {report['applied']}, refusées {report['rejected']})",
    ]
    if report["operations"]:
        lines.append(
            f"Premier verdict : {report['first_processed_at']} UTC ; "
            f"dernier : {report['last_processed_at']} UTC"
        )
    if not report["rejected"]:
        lines.append("Aucun refus sur la période.")
    else:
        lines.append("")
        lines.append("Refus par motif :")
        lines.extend(
            f"  {code:<24} {count:>6}"
            for code, count in report["rejected_by_code"].items()
        )
        lines.append("")
        lines.append("Refus par motif et type d'opération :")
        lines.extend(
            f"  {row['code']:<24} {row['type']:<20} {row['count']:>6}"
            for row in report["rejected_by_code_and_type"]
        )
    if report["by_day"]:
        lines.append("")
        lines.append("Par jour (UTC) :    appliquées  refusées")
        lines.extend(
            f"  {row['day']}  {row['applied']:>10}  {row['rejected']:>8}"
            for row in report["by_day"]
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("database", type=Path)
    parser.add_argument("--since", type=_day, metavar="AAAA-MM-JJ")
    parser.add_argument("--until", type=_day, metavar="AAAA-MM-JJ")
    parser.add_argument("--user", type=int, metavar="ID", dest="user_id")
    parser.add_argument("--json", action="store_true", help="rapport en JSON")
    args = parser.parse_args(argv)
    if not args.database.is_file():
        print(f"{args.database} : fichier introuvable.", file=sys.stderr)
        return 2
    try:
        report = build_report(
            args.database, since=args.since, until=args.until, user_id=args.user_id
        )
    except LookupError as error:
        print(error, file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_report(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
