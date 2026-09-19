"""Migrations Alembic : le schéma migré est celui des modèles, et réversible.

Chaque test travaille sur un fichier SQLite jetable (`tmp_path`), pas sur une
base en mémoire : Alembic s'y connecte comme en usage réel, par un second
processus qui lit `DATABASE_URL` via `migrations/env.py`. Les commandes sont
lancées en sous-processus (`python -m alembic`), comme `test_openapi_contract`
le fait pour l'export OpenAPI, ce qui évite aussi que `fileConfig` d'Alembic ne
reconfigure la journalisation du processus de test.

Ces tests ne touchent jamais `backend/vtes.db` (cf. `test_migrations_never_touch
_the_default_database`).

Note sur `alembic check` : il compare tables, colonnes, index et clés
étrangères, mais **pas** les contraintes `CHECK` (Alembic ne les autogénère
pas). Le test de comparaison de schéma ci-dessous comble ce trou, car ce sont
elles qui portent les énumérations fermées et les bornes.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.db.session import DEFAULT_DATABASE_URL, create_app_engine
from app.models import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
INITIAL_REVISION = "a59a3613de12"

EXPECTED_TABLES = {
    "alembic_version",
    "bundle",
    "card",
    "card_copy",
    "card_discipline_link",
    "card_printing",
    "card_printing_occurrence",
    "card_set",
    "card_translation",
    "card_type",
    "card_type_link",
    "clan",
    "deck",
    "deck_card",
    "discipline",
    "game",
    "language",
    "participation",
    "player",
    "sect",
    "tournament",
    "venue",
}

SEEDED_LANGUAGES = [
    ("EN", "Anglais", 10),
    ("FR", "Français", 20),
    ("ES", "Espagnol", 30),
    ("XX", "Autre", 99),
]


def url_for(path: Path) -> str:
    return f"sqlite+pysqlite:///{path.as_posix()}"


def alembic(
    db_path: Path, *args: str, check: bool = True
) -> subprocess.CompletedProcess:
    """Lance `alembic <args>` sur `db_path`, depuis `backend/`."""
    env = {
        **os.environ,
        "DATABASE_URL": url_for(db_path),
        "PYTHONIOENCODING": "utf-8",
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if check:
        assert result.returncode == 0, (
            f"alembic {' '.join(args)} a échoué ({result.returncode})\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result


def table_names(db_path: Path) -> set[str]:
    engine = create_engine(url_for(db_path))
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def scalar(db_path: Path, sql: str):
    engine = create_engine(url_for(db_path))
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql)).scalar()
    finally:
        engine.dispose()


def rows(db_path: Path, sql: str) -> list[tuple]:
    engine = create_engine(url_for(db_path))
    try:
        with engine.connect() as connection:
            return [tuple(row) for row in connection.execute(text(sql))]
    finally:
        engine.dispose()


def snapshot(engine) -> dict:
    """Description comparable d'un schéma : tout ce que l'inspecteur expose."""
    inspector = inspect(engine)
    result = {}
    for table in sorted(inspector.get_table_names()):
        if table == "alembic_version":
            continue
        result[table] = {
            "columns": [
                (
                    column["name"],
                    str(column["type"]),
                    column["nullable"],
                    str(column["default"]),
                )
                for column in inspector.get_columns(table)
            ],
            "pk": inspector.get_pk_constraint(table),
            "fks": sorted(
                (
                    fk["name"],
                    tuple(fk["constrained_columns"]),
                    fk["referred_table"],
                    tuple(fk["referred_columns"]),
                    str(fk.get("options")),
                )
                for fk in inspector.get_foreign_keys(table)
            ),
            "uniques": sorted(
                (uq["name"], tuple(uq["column_names"]))
                for uq in inspector.get_unique_constraints(table)
            ),
            "indexes": sorted(
                (ix["name"], tuple(ix["column_names"]), bool(ix["unique"]))
                for ix in inspector.get_indexes(table)
            ),
            "checks": sorted(
                (check["name"], " ".join(check["sqltext"].split()))
                for check in inspector.get_check_constraints(table)
            ),
        }
    return result


def snapshot_of(db_path: Path) -> dict:
    engine = create_engine(url_for(db_path))
    try:
        return snapshot(engine)
    finally:
        engine.dispose()


@pytest.fixture(scope="module")
def migrated_template(tmp_path_factory) -> Path:
    """Base migrée une fois pour le module, à copier pour les tests en lecture."""
    path = tmp_path_factory.mktemp("migrated") / "template.db"
    alembic(path, "upgrade", "head")
    return path


@pytest.fixture
def migrated(tmp_path, migrated_template) -> Path:
    path = tmp_path / "migrated.db"
    shutil.copyfile(migrated_template, path)
    return path


@pytest.fixture
def empty_db(tmp_path) -> Path:
    return tmp_path / "fresh.db"


# --------------------------------------------------------------------------
# Historique
# --------------------------------------------------------------------------


def test_history_has_a_single_head_and_a_single_root():
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))
    assert script.get_heads() == [INITIAL_REVISION]
    assert script.get_bases() == [INITIAL_REVISION]


# --------------------------------------------------------------------------
# upgrade head
# --------------------------------------------------------------------------


def test_upgrade_head_creates_the_twenty_one_tables(empty_db):
    assert not empty_db.exists()
    alembic(empty_db, "upgrade", "head")
    assert table_names(empty_db) == EXPECTED_TABLES
    assert len(table_names(empty_db) - {"alembic_version"}) == 21


def test_upgrade_head_stamps_the_revision(migrated):
    assert (
        scalar(migrated, "SELECT version_num FROM alembic_version") == INITIAL_REVISION
    )
    current = alembic(migrated, "current")
    assert INITIAL_REVISION in current.stdout + current.stderr


def test_upgrade_head_seeds_the_four_languages(migrated):
    assert (
        rows(
            migrated, "SELECT code, label, sort_order FROM language ORDER BY sort_order"
        )
        == SEEDED_LANGUAGES
    )


def test_upgrade_head_seeds_nothing_else(migrated):
    for table in EXPECTED_TABLES - {"alembic_version", "language"}:
        assert scalar(migrated, f"SELECT COUNT(*) FROM {table}") == 0, table


def test_upgrade_head_twice_is_a_no_op(migrated):
    before = snapshot_of(migrated)
    alembic(migrated, "upgrade", "head")
    assert snapshot_of(migrated) == before
    assert scalar(migrated, "SELECT COUNT(*) FROM language") == 4
    assert scalar(migrated, "SELECT COUNT(*) FROM alembic_version") == 1


def test_seeded_language_is_usable_by_a_collection_entry(migrated):
    """Les langues de départ satisfont la FK de `card_copy` sans autre insertion."""
    engine = create_app_engine(url_for(migrated))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO card"
                    " (id, vekn_id, name, category, advanced, burn_option, trifle)"
                    " VALUES (1, 1, 'X', 'crypt', 0, 0, 0)"
                )
            )
            for code in ("EN", "FR", "ES", "XX"):
                connection.execute(
                    text(
                        "INSERT INTO card_copy (card_id, language_code, quantity_owned,"
                        " proxy_allowed) VALUES (1, :code, 1, 0)"
                    ),
                    {"code": code},
                )
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# Pas de dérive entre les modèles et la migration
# --------------------------------------------------------------------------


def test_alembic_check_reports_no_drift(migrated):
    result = alembic(migrated, "check", check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No new upgrade operations detected" in result.stdout + result.stderr


def test_alembic_check_is_not_vacuous(migrated):
    """Contrôle négatif : une colonne hors modèle doit être détectée."""
    engine = create_engine(url_for(migrated))
    try:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE deck ADD COLUMN drift TEXT"))
    finally:
        engine.dispose()
    result = alembic(migrated, "check", check=False)
    assert result.returncode != 0
    assert "drift" in result.stdout + result.stderr


def test_migrated_schema_equals_the_models_schema(migrated, tmp_path):
    """Comparaison structurelle avec `create_all`, CHECK et index partiel inclus."""
    models_path = tmp_path / "models.db"
    engine = create_engine(url_for(models_path))
    try:
        Base.metadata.create_all(engine)
        from_models = snapshot(engine)
    finally:
        engine.dispose()

    from_migration = snapshot_of(migrated)

    assert len(from_models) == 21
    assert set(from_migration) == set(from_models)
    for table in from_models:
        assert from_migration[table] == from_models[table], table


def test_migration_creates_the_named_enum_check_constraints(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        names = {
            check["name"]
            for table in inspector.get_table_names()
            for check in inspector.get_check_constraints(table)
        }
    finally:
        engine.dispose()
    assert {
        "ck_bundle_size_positive",
        "ck_card_card_category",
        "ck_card_cost_type",
        "ck_card_printing_occurrence_copies_positive",
        "ck_card_printing_occurrence_multiplier_positive",
        "ck_card_printing_occurrence_print_occurrence",
        "ck_card_discipline_requirement",
        "ck_deck_deck_status",
        "ck_tournament_deck_policy",
        "ck_tournament_tournament_format",
        "ck_game_round_type",
        "ck_card_copy_quantity_owned_positive",
        "ck_deck_card_quantity_positive",
        "ck_deck_card_proxy_quantity_within_quantity",
        "ck_game_player_count_minimum",
        "ck_participation_victory_points_positive",
        "ck_participation_seat_positive",
    } <= names


def test_migration_creates_the_partial_unique_index_on_is_me(migrated):
    sql = scalar(
        migrated, "SELECT sql FROM sqlite_master WHERE name = 'ux_player_is_me'"
    )
    assert sql is not None
    assert "UNIQUE" in sql.upper()
    assert "WHERE is_me = 1" in sql


def test_migration_adds_no_check_on_language(migrated):
    """§11.2 : la liste des langues reste ouverte, y compris après migration."""
    engine = create_engine(url_for(migrated))
    try:
        assert inspect(engine).get_check_constraints("language") == []
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# La base migrée applique bien ses contraintes
# --------------------------------------------------------------------------


def test_migrated_database_enforces_composite_foreign_key_and_partial_index(migrated):
    engine = create_app_engine(url_for(migrated))
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "INSERT INTO card"
                    " (id, vekn_id, name, category, advanced, burn_option, trifle)"
                    " VALUES (1, 1, 'X', 'crypt', 0, 0, 0)"
                )
            )
            connection.execute(
                text("INSERT INTO deck (id, name, status) VALUES (1, 'D', 'draft')")
            )
            connection.commit()

            # Carte hors collection -> refusée en deck.
            with pytest.raises(Exception) as no_copy:
                connection.execute(
                    text(
                        "INSERT INTO deck_card (deck_id, card_id, language_code,"
                        " quantity, proxy_quantity) VALUES (1, 1, 'EN', 1, 0)"
                    )
                )
            assert "FOREIGN KEY" in str(no_copy.value)
            connection.rollback()

            # Deux « Moi » -> refusés.
            connection.execute(text("INSERT INTO player (name, is_me) VALUES ('A', 1)"))
            with pytest.raises(Exception) as two_me:
                connection.execute(
                    text("INSERT INTO player (name, is_me) VALUES ('B', 1)")
                )
            assert "UNIQUE" in str(two_me.value)
            connection.rollback()

            # Valeur d'enum hors liste -> refusée par le CHECK.
            with pytest.raises(Exception) as bad_enum:
                connection.execute(
                    text("INSERT INTO deck (name, status) VALUES ('E', 'bogus')")
                )
            assert "CHECK" in str(bad_enum.value)
    finally:
        engine.dispose()


# --------------------------------------------------------------------------
# downgrade base
# --------------------------------------------------------------------------


def test_downgrade_base_leaves_only_alembic_version(migrated):
    alembic(migrated, "downgrade", "base")
    assert table_names(migrated) == {"alembic_version"}
    assert scalar(migrated, "SELECT COUNT(*) FROM alembic_version") == 0


def test_downgrade_base_leaves_no_index_or_view_behind(migrated):
    alembic(migrated, "downgrade", "base")
    leftovers = rows(
        migrated,
        "SELECT type, name FROM sqlite_master"
        " WHERE name NOT LIKE 'sqlite_%' AND name != 'alembic_version'",
    )
    assert leftovers == []


def test_downgrade_base_drops_data_too(migrated):
    """Revenir à `base`, c'est revenir à une base vide (choix documenté)."""
    engine = create_engine(url_for(migrated))
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO venue (name) VALUES ('Club')"))
    finally:
        engine.dispose()
    alembic(migrated, "downgrade", "base")
    assert "venue" not in table_names(migrated)


def test_downgrade_base_twice_is_a_no_op(migrated):
    alembic(migrated, "downgrade", "base")
    alembic(migrated, "downgrade", "base")
    assert table_names(migrated) == {"alembic_version"}


def test_downgrade_on_a_fresh_database_is_a_no_op(empty_db):
    alembic(empty_db, "downgrade", "base")
    assert "card" not in table_names(empty_db)


# --------------------------------------------------------------------------
# Aller-retour
# --------------------------------------------------------------------------


def test_upgrade_downgrade_upgrade_round_trip_is_identical(empty_db):
    alembic(empty_db, "upgrade", "head")
    first_schema = snapshot_of(empty_db)
    first_seed = rows(
        empty_db, "SELECT code, label, sort_order FROM language ORDER BY code"
    )
    first_sql = rows(
        empty_db,
        "SELECT type, name, sql FROM sqlite_master"
        " WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )

    alembic(empty_db, "downgrade", "base")
    assert table_names(empty_db) == {"alembic_version"}

    alembic(empty_db, "upgrade", "head")
    assert table_names(empty_db) == EXPECTED_TABLES
    assert snapshot_of(empty_db) == first_schema
    assert (
        rows(empty_db, "SELECT code, label, sort_order FROM language ORDER BY code")
        == first_seed
    )
    assert (
        rows(
            empty_db,
            "SELECT type, name, sql FROM sqlite_master"
            " WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        == first_sql
    )
    assert (
        scalar(empty_db, "SELECT version_num FROM alembic_version") == INITIAL_REVISION
    )


def test_alembic_check_still_passes_after_a_round_trip(migrated):
    alembic(migrated, "downgrade", "base")
    alembic(migrated, "upgrade", "head")
    assert alembic(migrated, "check", check=False).returncode == 0


# --------------------------------------------------------------------------
# Environnement
# --------------------------------------------------------------------------


def test_offline_sql_generation_works_and_touches_no_database(empty_db):
    """`upgrade head --sql` produit le DDL et les 4 INSERT sans se connecter."""
    result = alembic(empty_db, "upgrade", "head", "--sql")
    assert "CREATE TABLE card_copy" in result.stdout
    assert "CREATE TABLE deck_card" in result.stdout
    assert result.stdout.count("INSERT INTO language") == 4
    assert not empty_db.exists()


def test_migrations_read_database_url_from_the_environment(empty_db):
    """Le fichier visé est celui de `DATABASE_URL`, pas un chemin en dur."""
    alembic(empty_db, "upgrade", "head")
    assert empty_db.exists()


def test_migrations_never_touch_the_default_database(empty_db):
    default_path = Path(DEFAULT_DATABASE_URL.removeprefix("sqlite+pysqlite:///"))
    existed = default_path.exists()
    mtime = default_path.stat().st_mtime_ns if existed else None

    alembic(empty_db, "upgrade", "head")
    alembic(empty_db, "downgrade", "base")

    assert default_path.exists() == existed
    if existed:
        assert default_path.stat().st_mtime_ns == mtime
