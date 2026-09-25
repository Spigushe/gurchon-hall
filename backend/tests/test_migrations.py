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

Note sur les données : le mode batch recrée les tables qu'il modifie. Les tests
de la dernière section migrent donc des bases **peuplées** — composition de
deck, partie jouée, catalogue — parce qu'une migration qui ne casse rien sur une
base vide peut parfaitement vider une base réelle (cf. `migrations/env.py`, qui
coupe les clés étrangères puis vérifie).
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
ARCHIVE_REVISION = "de3b00e38c8d"  # archivage et suppression logique des decks
DECK_IDENTITY_REVISION = "5dc50e3c1701"  # discriminant, decklist figée, légalité
SYNC_REVISION = "8cc70f4bbbcc"  # journal d'idempotence de la file hors ligne (Lot 3)
PROXY_REVISION = "6c9a178b7a1d"  # proxy autorisé au niveau du deck (Lot 4, passe A)
HEAD_REVISION = "b7e41d0c9a52"  # extension dans l'identité du stock (Lot 4, passe B)
REVISIONS = [
    INITIAL_REVISION,
    ARCHIVE_REVISION,
    DECK_IDENTITY_REVISION,
    SYNC_REVISION,
    PROXY_REVISION,
    HEAD_REVISION,
]

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
    "deleted_deck_card",
    "discipline",
    "game",
    "language",
    "participation",
    "player",
    "sect",
    "sync_operation",
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
            # Triées par nom : `ALTER TABLE ... ADD COLUMN` (révision de
            # `deck`) ajoute en fin de table, alors que `create_all` suit
            # l'ordre du modèle. L'ordre des colonnes n'a pas de sens métier.
            "columns": sorted(
                (
                    column["name"],
                    str(column["type"]),
                    column["nullable"],
                    str(column["default"]),
                )
                for column in inspector.get_columns(table)
            ),
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
    """Six révisions à la suite, sans branche : une racine, une tête."""
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_bases() == [INITIAL_REVISION]
    assert [rev.revision for rev in script.walk_revisions()] == REVISIONS[::-1]


# --------------------------------------------------------------------------
# upgrade head
# --------------------------------------------------------------------------


def test_upgrade_head_creates_the_twenty_three_tables(empty_db):
    assert not empty_db.exists()
    alembic(empty_db, "upgrade", "head")
    assert table_names(empty_db) == EXPECTED_TABLES
    assert len(table_names(empty_db) - {"alembic_version"}) == 23


def test_upgrade_head_stamps_the_revision(migrated):
    assert scalar(migrated, "SELECT version_num FROM alembic_version") == HEAD_REVISION
    current = alembic(migrated, "current")
    assert HEAD_REVISION in current.stdout + current.stderr


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
    """Les langues de départ satisfont la FK de `card_copy` sans autre insertion.

    L'entrée a aussi besoin d'une impression réelle (Lot 4, D2) : une carte et
    une extension, liées par `card_printing`.
    """
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
            connection.execute(
                text("INSERT INTO card_set (id, abbrev) VALUES (1, 'FN')")
            )
            connection.execute(
                text(
                    "INSERT INTO card_printing (id, card_id, card_set_id)"
                    " VALUES (1, 1, 1)"
                )
            )
            for code in ("EN", "FR", "ES", "XX"):
                connection.execute(
                    text(
                        "INSERT INTO card_copy"
                        " (card_id, language_code, card_set_id, quantity_owned)"
                        " VALUES (1, :code, 1, 1)"
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

    assert len(from_models) == 23
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
        "ck_deck_discriminator_format",
        "ck_deleted_deck_card_quantity_positive",
        "ck_deleted_deck_card_proxy_quantity_within_quantity",
        "ck_game_player_count_minimum",
        "ck_participation_victory_points_positive",
        "ck_participation_seat_positive",
        "ck_sync_operation_sync_operation_type",
        "ck_sync_operation_sync_operation_status",
        "ck_sync_operation_sync_error_code",
        "ck_sync_operation_sync_resource_kind",
        "ck_sync_operation_error_code_iff_rejected",
        "ck_sync_operation_resource_kind_when_applied",
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
                text(
                    "INSERT INTO deck (id, name, discriminator, status)"
                    " VALUES (1, 'D', '0001', 'draft')"
                )
            )
            connection.commit()

            # Carte hors collection -> refusée en deck (la FK composite de
            # `deck_card` vise `card_copy` sur les trois colonnes, Lot 4 D1).
            with pytest.raises(Exception) as no_copy:
                connection.execute(
                    text(
                        "INSERT INTO deck_card (deck_id, card_id, language_code,"
                        " card_set_id, quantity, proxy_quantity)"
                        " VALUES (1, 1, 'EN', 1, 1, 0)"
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
                    text(
                        "INSERT INTO deck (name, discriminator, status)"
                        " VALUES ('E', '0001', 'bogus')"
                    )
                )
            assert "CHECK" in str(bad_enum.value)
            connection.rollback()

            # Discriminant hors format -> refusé aussi.
            with pytest.raises(Exception) as bad_discriminator:
                connection.execute(
                    text(
                        "INSERT INTO deck (name, discriminator, status)"
                        " VALUES ('F', '42', 'draft')"
                    )
                )
            assert "CHECK" in str(bad_discriminator.value)
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
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == HEAD_REVISION


def test_alembic_check_still_passes_after_a_round_trip(migrated):
    alembic(migrated, "downgrade", "base")
    alembic(migrated, "upgrade", "head")
    assert alembic(migrated, "check", check=False).returncode == 0


# --------------------------------------------------------------------------
# Environnement
# --------------------------------------------------------------------------


def test_offline_sql_generation_works_and_touches_no_database(empty_db):
    """`upgrade <initiale> --sql` produit le DDL et les 4 INSERT sans se connecter.

    Limité à la révision initiale, et c'est structurel : celles du Lot 2
    modifient des tables existantes, donc passent par `batch_alter_table`, qui a
    besoin d'une base vivante pour réfléchir la table avant de la recréer. La
    révision du discriminant va plus loin encore, avec un rattrapage de données
    écrit en Python (numérotation par nom) qu'aucun SQL statique ne peut rendre.
    Le mode hors ligne ne sert de toute façon qu'à relire du DDL, pas à migrer.

    La révision du journal de synchronisation (`SYNC_REVISION`), elle, ne crée
    qu'une table neuve : elle se rend bien hors ligne, prise isolément — cf.
    `test_the_sync_revision_renders_offline`. Les deux révisions du Lot 4
    (proxy au niveau du deck, puis extension dans l'identité du stock) ne le
    peuvent pas non plus, mais pour une autre raison que le mode batch : leur
    garde D3 lit la base (`SELECT COUNT(*)`) avant de modifier quoi que ce
    soit — cf. `test_the_proxy_revision_does_not_render_offline` et
    `test_the_extension_revision_does_not_render_offline`.
    """
    result = alembic(empty_db, "upgrade", INITIAL_REVISION, "--sql")
    assert "CREATE TABLE card_copy" in result.stdout
    assert "CREATE TABLE deck_card" in result.stdout
    assert result.stdout.count("INSERT INTO language") == 4
    assert not empty_db.exists()


@pytest.mark.xfail(
    strict=True,
    reason=(
        "LIMITE CONNUE (et non bug) : `upgrade head --sql` échoue, le mode batch "
        "de SQLite exige une base vivante pour réfléchir les tables modifiées. "
        "Documenté dans le test hors-ligne ci-dessus."
    ),
)
def test_offline_sql_generation_works_up_to_head(empty_db):
    result = alembic(empty_db, "upgrade", "head", "--sql")
    assert "uq_deck_name_discriminator" in result.stdout
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


# --------------------------------------------------------------------------
# Révisions du cycle de vie des decks : outillage commun
# --------------------------------------------------------------------------


def execute(db_path: Path, sql: str) -> None:
    """Exécute une écriture SQL brute (clés étrangères non appliquées)."""
    engine = create_engine(url_for(db_path))
    try:
        with engine.begin() as connection:
            connection.execute(text(sql))
    finally:
        engine.dispose()


def deck_columns(db_path: Path) -> set[str]:
    engine = create_engine(url_for(db_path))
    try:
        return {column["name"] for column in inspect(engine).get_columns("deck")}
    finally:
        engine.dispose()


def foreign_key_violations(db_path: Path) -> list[tuple]:
    return rows(db_path, "PRAGMA foreign_key_check")


def seed_a_card_in_collection(db_path: Path) -> None:
    """Une carte au catalogue, possédée en deux exemplaires anglais."""
    execute(
        db_path,
        "INSERT INTO card (id, vekn_id, name, category, advanced, burn_option, trifle)"
        " VALUES (1, 1, 'X', 'crypt', 0, 0, 0)",
    )
    execute(
        db_path,
        "INSERT INTO card_copy (card_id, language_code, quantity_owned, proxy_allowed)"
        " VALUES (1, 'EN', 2, 0)",
    )


def seed_a_played_deck(db_path: Path) -> None:
    """Le deck n° 2 a servi dans une partie : une `participation` le référence."""
    execute(db_path, "INSERT INTO player (id, name, is_me) VALUES (1, 'Moi', 1)")
    execute(
        db_path,
        "INSERT INTO game (id, played_at, player_count, round_type)"
        " VALUES (1, '2026-01-01 10:00:00', 5, 'casual')",
    )
    execute(
        db_path,
        "INSERT INTO participation (game_id, player_id, deck_id) VALUES (1, 1, 2)",
    )


def seed_decks_before_the_archive_revision(db_path: Path) -> None:
    """Un deck composé (n° 2), dans le schéma d'avant `archived_at`/`deleted_at`."""
    execute(
        db_path,
        "INSERT INTO deck (id, name, status) VALUES (2, 'Grinder', 'active')",
    )
    seed_a_card_in_collection(db_path)
    execute(
        db_path,
        "INSERT INTO deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (2, 1, 'EN', 2, 0)",
    )


def seed_decks_before_the_head_revision(db_path: Path) -> None:
    """Quatre decks homonymes et un `retired`, dans le schéma sans discriminant.

    Les decks 1 et 3 sont supprimés, le 2 est vivant et composé, le 4 porte un
    autre nom. Le 5 est `retired` avec une date de modification connue : c'est
    lui qui doit devenir `active` et archivé.
    """
    execute(
        db_path,
        "INSERT INTO deck (id, name, status, archived_at, deleted_at, updated_at)"
        " VALUES"
        " (1, 'Grinder', 'draft', NULL, '2026-09-01 10:00:00', '2026-08-01 09:00:00'),"
        " (2, 'Grinder', 'active', NULL, NULL, '2026-08-02 09:00:00'),"
        " (3, 'Grinder', 'draft', NULL, '2026-09-02 10:00:00', '2026-08-03 09:00:00'),"
        " (4, 'Autre', 'draft', NULL, NULL, '2026-08-04 09:00:00'),"
        " (5, 'Rangé', 'retired', NULL, NULL, '2026-08-05 09:00:00')",
    )
    seed_a_card_in_collection(db_path)
    execute(
        db_path,
        "INSERT INTO deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (2, 1, 'EN', 2, 0)",
    )


def seed_decks_at_sync_revision(db_path: Path) -> None:
    """Le même jeu de decks, au schéma de `SYNC_REVISION` (avec discriminants,
    avant le déplacement du proxy vers le deck : `card_copy.proxy_allowed`
    existe encore, `deck.proxy_allowed` n'existe pas encore).
    """
    execute(
        db_path,
        "INSERT INTO deck (id, name, discriminator, status, deleted_at) VALUES"
        " (1, 'Grinder', '0001', 'draft', '2026-09-01 10:00:00'),"
        " (2, 'Grinder', '0002', 'active', NULL),"
        " (3, 'Grinder', '0003', 'draft', '2026-09-02 10:00:00'),"
        " (4, 'Autre', '0001', 'draft', NULL)",
    )
    seed_a_card_in_collection(db_path)
    execute(
        db_path,
        "INSERT INTO deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (2, 1, 'EN', 2, 0)",
    )
    execute(
        db_path,
        "INSERT INTO deleted_deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (1, 1, 'EN', 3, 1)",
    )


def seed_decks_at_proxy_revision(db_path: Path) -> None:
    """Le même jeu de decks, au schéma de `PROXY_REVISION` (Lot 4, passe A) :
    `card_copy` n'a plus `proxy_allowed`, `deck` l'a gagné (`false` par défaut) ;
    pas encore de `card_set_id` dans la clé de `card_copy`/`deck_card`/
    `deleted_deck_card`.
    """
    execute(
        db_path,
        "INSERT INTO deck (id, name, discriminator, status, deleted_at) VALUES"
        " (1, 'Grinder', '0001', 'draft', '2026-09-01 10:00:00'),"
        " (2, 'Grinder', '0002', 'active', NULL),"
        " (3, 'Grinder', '0003', 'draft', '2026-09-02 10:00:00'),"
        " (4, 'Autre', '0001', 'draft', NULL)",
    )
    execute(
        db_path,
        "INSERT INTO card (id, vekn_id, name, category, advanced, burn_option, trifle)"
        " VALUES (1, 1, 'X', 'crypt', 0, 0, 0)",
    )
    execute(
        db_path,
        "INSERT INTO card_copy (card_id, language_code, quantity_owned)"
        " VALUES (1, 'EN', 2)",
    )
    execute(
        db_path,
        "INSERT INTO deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (2, 1, 'EN', 2, 0)",
    )
    execute(
        db_path,
        "INSERT INTO deleted_deck_card (deck_id, card_id, language_code, quantity,"
        " proxy_quantity) VALUES (1, 1, 'EN', 3, 1)",
    )


def seed_decks_at_head(db_path: Path) -> None:
    """Le même jeu de decks, au schéma de tête actuel (Lot 4, passe B) :
    `card_copy`/`deck_card`/`deleted_deck_card` portent `card_set_id` dans leur
    clé (D1), et `card_copy` exige une impression réelle du catalogue (D2) —
    d'où la carte, l'extension et l'impression insérées avant la collection.
    """
    execute(
        db_path,
        "INSERT INTO deck (id, name, discriminator, status, deleted_at) VALUES"
        " (1, 'Grinder', '0001', 'draft', '2026-09-01 10:00:00'),"
        " (2, 'Grinder', '0002', 'active', NULL),"
        " (3, 'Grinder', '0003', 'draft', '2026-09-02 10:00:00'),"
        " (4, 'Autre', '0001', 'draft', NULL)",
    )
    execute(
        db_path,
        "INSERT INTO card (id, vekn_id, name, category, advanced, burn_option, trifle)"
        " VALUES (1, 1, 'X', 'crypt', 0, 0, 0)",
    )
    execute(db_path, "INSERT INTO card_set (id, abbrev) VALUES (1, 'FN')")
    execute(
        db_path,
        "INSERT INTO card_printing (id, card_id, card_set_id) VALUES (1, 1, 1)",
    )
    execute(
        db_path,
        "INSERT INTO card_copy (card_id, language_code, card_set_id, quantity_owned)"
        " VALUES (1, 'EN', 1, 2)",
    )
    execute(
        db_path,
        "INSERT INTO deck_card (deck_id, card_id, language_code, card_set_id,"
        " quantity, proxy_quantity) VALUES (2, 1, 'EN', 1, 2, 0)",
    )
    execute(
        db_path,
        "INSERT INTO deleted_deck_card (deck_id, card_id, language_code,"
        " card_set_id, quantity, proxy_quantity) VALUES (1, 1, 'EN', 1, 3, 1)",
    )


# --------------------------------------------------------------------------
# Révision « archivage et suppression logique des decks »
# --------------------------------------------------------------------------


def test_migration_adds_the_two_nullable_lifecycle_columns(migrated):
    assert {"archived_at", "deleted_at"} <= deck_columns(migrated)
    assert rows(migrated, "SELECT archived_at, deleted_at FROM deck") == []


def test_upgrade_from_the_initial_revision_keeps_existing_decks(empty_db):
    alembic(empty_db, "upgrade", INITIAL_REVISION)
    assert "deleted_at" not in deck_columns(empty_db)
    execute(
        empty_db,
        "INSERT INTO deck (id, name, status)"
        " VALUES (1, 'A', 'active'), (2, 'B', 'draft')",
    )

    alembic(empty_db, "upgrade", ARCHIVE_REVISION)

    assert rows(
        empty_db,
        "SELECT id, name, status, archived_at, deleted_at FROM deck ORDER BY id",
    ) == [(1, "A", "active", None, None), (2, "B", "draft", None, None)]


def test_upgrade_to_the_archive_revision_keeps_the_deck_composition(empty_db):
    """Ce que le mode batch cassait : recréer `deck` vidait `deck_card`."""
    alembic(empty_db, "upgrade", INITIAL_REVISION)
    seed_decks_before_the_archive_revision(empty_db)

    alembic(empty_db, "upgrade", ARCHIVE_REVISION)

    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]


def test_upgrade_to_the_archive_revision_succeeds_when_a_deck_has_been_played(empty_db):
    """Et ce qu'il faisait carrément échouer : un deck référencé par une partie."""
    alembic(empty_db, "upgrade", INITIAL_REVISION)
    execute(empty_db, "INSERT INTO deck (id, name, status) VALUES (2, 'G', 'draft')")
    seed_a_played_deck(empty_db)

    alembic(empty_db, "upgrade", ARCHIVE_REVISION)

    assert rows(empty_db, "SELECT deck_id FROM participation") == [(2,)]
    assert foreign_key_violations(empty_db) == []


def test_downgrade_to_the_initial_revision_suffixes_deleted_decks(empty_db):
    """La révision d'archivage rend le nom réutilisable ; son retour le reprend."""
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    seed_decks_before_the_head_revision(empty_db)

    alembic(empty_db, "downgrade", INITIAL_REVISION)

    assert (
        scalar(empty_db, "SELECT version_num FROM alembic_version") == INITIAL_REVISION
    )
    assert deck_columns(empty_db).isdisjoint({"archived_at", "deleted_at"})
    assert rows(empty_db, "SELECT id, name FROM deck ORDER BY id") == [
        (1, "Grinder [supprimé 1]"),
        (2, "Grinder"),
        (3, "Grinder [supprimé 3]"),
        (4, "Autre"),
        (5, "Rangé"),
    ]
    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]


# --------------------------------------------------------------------------
# Révision « discriminant de deck, decklist figée et légalité »
# --------------------------------------------------------------------------


def test_head_replaces_the_partial_index_with_a_unique_pair(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        indexes = {ix["name"] for ix in inspector.get_indexes("deck")}
        uniques = {
            tuple(uq["column_names"]): uq["name"]
            for uq in inspector.get_unique_constraints("deck")
        }
    finally:
        engine.dispose()
    assert "uq_deck_name_not_deleted" not in indexes
    assert uniques == {("name", "discriminator"): "uq_deck_name_discriminator"}


def test_head_keeps_the_name_and_discriminator_unique_even_for_deleted_decks(migrated):
    """L'identité d'affichage d'un deck supprimé n'est jamais réattribuée."""
    execute(
        migrated,
        "INSERT INTO deck (name, discriminator, status, deleted_at)"
        " VALUES ('Grinder', '0001', 'draft', '2026-09-01 10:00:00')",
    )
    with pytest.raises(Exception) as duplicate:
        execute(
            migrated,
            "INSERT INTO deck (name, discriminator, status)"
            " VALUES ('Grinder', '0001', 'draft')",
        )
    assert "UNIQUE" in str(duplicate.value)


def test_head_allows_the_same_name_with_another_discriminator(migrated):
    for discriminator in ("0001", "0002", "9999"):
        execute(
            migrated,
            "INSERT INTO deck (name, discriminator, status)"
            f" VALUES ('Grinder', '{discriminator}', 'draft')",
        )
    assert scalar(migrated, "SELECT COUNT(*) FROM deck WHERE name = 'Grinder'") == 3


@pytest.mark.parametrize("value", ["42", "00042", "abcd", "0000", "12 4", "", "004a"])
def test_head_refuses_a_discriminator_that_is_not_four_digits(migrated, value):
    with pytest.raises(Exception) as bad:
        execute(
            migrated,
            "INSERT INTO deck (name, discriminator, status)"
            f" VALUES ('D', '{value}', 'draft')",
        )
    assert "CHECK" in str(bad.value)


def test_head_drops_the_retired_status_from_the_check(migrated):
    with pytest.raises(Exception) as retired:
        execute(
            migrated,
            "INSERT INTO deck (name, discriminator, status)"
            " VALUES ('D', '0001', 'retired')",
        )
    assert "CHECK" in str(retired.value)


def test_head_adds_legal_from_and_the_identifying_index(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("card")}
        indexes = {ix["name"]: ix for ix in inspector.get_indexes("card")}
    finally:
        engine.dispose()
    assert columns["legal_from"]["nullable"] is True
    index = indexes["ix_card_name_group_code_advanced"]
    assert index["column_names"] == ["name", "group_code", "advanced"]
    assert not index["unique"], "un doublon krcg ne doit pas casser l'import"


def test_head_creates_the_frozen_decklist_without_a_link_to_the_collection(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        keys = inspector.get_foreign_keys("deleted_deck_card")
        primary = inspector.get_pk_constraint("deleted_deck_card")
    finally:
        engine.dispose()
    referred = {fk["referred_table"] for fk in keys}
    # Depuis Lot 4 passe B : `card_set_id` entre dans la clé, avec une FK vers
    # `card_set` (pas `card_printing` ni `card_copy`) — une decklist figée ne
    # réserve rien (D1).
    assert referred == {"deck", "card", "language", "card_set"}
    assert "card_copy" not in referred
    assert primary["constrained_columns"] == [
        "deck_id",
        "card_id",
        "language_code",
        "card_set_id",
    ]


def test_a_frozen_decklist_does_not_hold_a_collection_entry(migrated):
    """Tout l'intérêt de la table : le stock redevient supprimable."""
    seed_decks_at_head(migrated)

    engine = create_app_engine(url_for(migrated))
    try:
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM deck_card"))
            connection.execute(text("DELETE FROM card_copy"))
    finally:
        engine.dispose()

    assert scalar(migrated, "SELECT COUNT(*) FROM deleted_deck_card") == 1


def test_upgrade_numbers_existing_decks_by_name_in_id_order(empty_db):
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    seed_decks_before_the_head_revision(empty_db)

    # S'arrête à SYNC_REVISION, pas à « head » : au-delà, la garde D3 de la
    # révision du proxy (6c9a178b7a1d) exige card_copy/deck_card vides, ce que
    # ce jeu de données n'est pas (cf. test_upgrading_past_the_proxy_revision_
    # refuses_a_populated_collection).
    alembic(empty_db, "upgrade", SYNC_REVISION)

    assert rows(empty_db, "SELECT id, name, discriminator FROM deck ORDER BY id") == [
        (1, "Grinder", "0001"),
        (2, "Grinder", "0002"),
        (3, "Grinder", "0003"),
        (4, "Autre", "0001"),
        (5, "Rangé", "0001"),
    ]


def test_upgrade_turns_retired_decks_into_archived_active_decks(empty_db):
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    seed_decks_before_the_head_revision(empty_db)

    # Idem : s'arrête à SYNC_REVISION (cf. commentaire du test précédent).
    alembic(empty_db, "upgrade", SYNC_REVISION)

    assert rows(
        empty_db, "SELECT status, archived_at FROM deck WHERE id = 5"
    ) == [("active", "2026-08-05 09:00:00")]
    # Les autres ne sont pas archivés au passage.
    assert scalar(empty_db, "SELECT COUNT(*) FROM deck WHERE archived_at IS NULL") == 4


def test_upgrade_keeps_an_already_archived_date_on_a_retired_deck(empty_db):
    """Un deck à la fois `retired` et archivé garde sa date d'archivage."""
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    execute(
        empty_db,
        "INSERT INTO deck (id, name, status, archived_at, updated_at)"
        " VALUES (1, 'D', 'retired', '2026-01-01 08:00:00', '2026-08-05 09:00:00')",
    )

    alembic(empty_db, "upgrade", "head")

    assert rows(empty_db, "SELECT status, archived_at FROM deck") == [
        ("active", "2026-01-01 08:00:00")
    ]


def test_upgrade_keeps_the_deck_composition_and_the_played_deck(empty_db):
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    seed_decks_before_the_head_revision(empty_db)
    seed_a_played_deck(empty_db)

    # Idem : s'arrête à SYNC_REVISION (cf. commentaire plus haut).
    alembic(empty_db, "upgrade", SYNC_REVISION)

    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]
    assert rows(empty_db, "SELECT deck_id FROM participation") == [(2,)]
    assert foreign_key_violations(empty_db) == []


def test_upgrade_keeps_the_catalogue_tables(empty_db):
    """Le catalogue ne passe pas par le mode batch : rien ne doit y bouger."""
    alembic(empty_db, "upgrade", ARCHIVE_REVISION)
    execute(
        empty_db,
        "INSERT INTO card (id, vekn_id, name, category, advanced, burn_option, trifle)"
        " VALUES (1, 1, 'Theo Bell', 'crypt', 0, 0, 0)",
    )
    execute(empty_db, "INSERT INTO card_set (id, abbrev) VALUES (1, 'FN')")
    execute(
        empty_db,
        "INSERT INTO card_printing (id, card_id, card_set_id) VALUES (1, 1, 1)",
    )
    execute(
        empty_db,
        "INSERT INTO card_printing_occurrence (id, card_printing_id, occurrence_type)"
        " VALUES (1, 1, 'single')",
    )
    execute(empty_db, "INSERT INTO card_type (id, name) VALUES (1, 'Action')")
    execute(
        empty_db, "INSERT INTO card_type_link (card_id, card_type_id) VALUES (1, 1)"
    )
    execute(empty_db, "INSERT INTO discipline (id, name) VALUES (1, 'Dominate')")
    execute(
        empty_db,
        "INSERT INTO card_discipline_link (card_id, discipline_id, superior)"
        " VALUES (1, 1, 1)",
    )
    execute(
        empty_db,
        "INSERT INTO card_translation (card_id, language_code, name)"
        " VALUES (1, 'FR', 'Theo Bell')",
    )

    alembic(empty_db, "upgrade", "head")

    for table in (
        "card",
        "card_translation",
        "card_type_link",
        "card_discipline_link",
        "card_printing",
        "card_printing_occurrence",
    ):
        assert scalar(empty_db, f"SELECT COUNT(*) FROM {table}") == 1, table
    assert rows(empty_db, "SELECT name, legal_from FROM card") == [("Theo Bell", None)]
    assert foreign_key_violations(empty_db) == []


def test_downgrade_keeps_the_deck_composition(empty_db):
    # S'arrête à SYNC_REVISION avant de seeder : la révision du proxy
    # (6c9a178b7a1d, D3) refuserait de redescendre avec card_copy/deck_card
    # peuplées. Le comportement testé ici (fusion à la descente) se joue à la
    # révision du discriminant, bien en amont.
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)

    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]
    assert foreign_key_violations(empty_db) == []


def test_downgrade_renames_only_the_decks_that_share_a_name(empty_db):
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)

    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == (
        ARCHIVE_REVISION
    )
    assert "discriminator" not in deck_columns(empty_db)
    assert rows(empty_db, "SELECT id, name FROM deck ORDER BY id") == [
        (1, "Grinder#0001"),
        (2, "Grinder#0002"),
        (3, "Grinder#0003"),
        (4, "Autre"),
    ]


def test_downgrade_truncates_the_merged_name_to_the_column_length(empty_db):
    """Le discriminant survit à la troncature : c'est lui qui distingue."""
    alembic(empty_db, "upgrade", "head")
    long_name = "N" * 120
    execute(
        empty_db,
        "INSERT INTO deck (id, name, discriminator, status) VALUES"
        f" (1, '{long_name}', '0001', 'draft'),"
        f" (2, '{long_name}', '0002', 'draft')",
    )

    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    names = [name for (name,) in rows(empty_db, "SELECT name FROM deck ORDER BY id")]
    assert [len(name) for name in names] == [120, 120]
    assert names == ["N" * 115 + "#0001", "N" * 115 + "#0002"]


def test_downgrade_drops_the_frozen_decklists(empty_db):
    """Perte assumée : un deck supprimé redevient un deck sans composition."""
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)
    assert scalar(empty_db, "SELECT COUNT(*) FROM deleted_deck_card") == 1

    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    assert "deleted_deck_card" not in table_names(empty_db)
    assert scalar(empty_db, "SELECT COUNT(*) FROM deck WHERE id = 1") == 1


def test_downgrade_to_the_archive_revision_gives_the_archive_schema(empty_db, tmp_path):
    alembic(empty_db, "upgrade", "head")
    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    reference = tmp_path / "archive.db"
    alembic(reference, "upgrade", ARCHIVE_REVISION)

    assert snapshot_of(empty_db) == snapshot_of(reference)


def test_downgrade_to_base_from_head_leaves_nothing(empty_db):
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)

    alembic(empty_db, "downgrade", "base")

    assert table_names(empty_db) == {"alembic_version"}


def test_upgrade_again_after_the_downgrade_keeps_discriminators(empty_db):
    """Aller-retour jusqu'à `SYNC_REVISION` : les noms homonymes se fusionnent
    à la descente, puis se redistribuent à la remontée, sans perdre la
    composition du deck.

    S'arrête à `SYNC_REVISION`, pas à « head » : au-delà, la garde D3 de la
    révision du proxy (6c9a178b7a1d) exige card_copy/deck_card vides, ce
    qu'elles ne sont plus après ce va-et-vient (cf. le test suivant, qui
    vérifie justement cet arrêt).
    """
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)
    alembic(empty_db, "downgrade", ARCHIVE_REVISION)

    alembic(empty_db, "upgrade", SYNC_REVISION)

    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == SYNC_REVISION
    # Les noms fusionnés au downgrade sont désormais distincts : chacun repart
    # avec le discriminant « 0001 ».
    assert rows(empty_db, "SELECT id, name, discriminator FROM deck ORDER BY id") == [
        (1, "Grinder#0001", "0001"),
        (2, "Grinder#0002", "0001"),
        (3, "Grinder#0003", "0001"),
        (4, "Autre", "0001"),
    ]
    assert rows(empty_db, "SELECT deck_id, quantity FROM deck_card") == [(2, 2)]


def test_upgrading_past_the_proxy_revision_refuses_a_populated_collection(empty_db):
    """La garde D3 (6c9a178b7a1d) arrête la migration : ni conversion, ni
    perte silencieuse. `card_copy`/`deck_card` non vides -> rien n'est migré.
    """
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)

    result = alembic(empty_db, "upgrade", "head", check=False)

    assert result.returncode != 0
    assert "6c9a178b7a1d" in result.stdout + result.stderr
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == SYNC_REVISION




# --------------------------------------------------------------------------
# Révision « journal d'idempotence de la file hors ligne » (Lot 3)
# --------------------------------------------------------------------------


def insert_sync_row(db_path: Path, **columns) -> None:
    """Insère une ligne de journal, colonnes nommées, sans passer par l'ORM."""
    names = ", ".join(columns)
    placeholders = ", ".join(f":{name}" for name in columns)
    engine = create_engine(url_for(db_path))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO sync_operation ({names}) VALUES ({placeholders})"),
                columns,
            )
    finally:
        engine.dispose()


def applied_row(**overrides) -> dict:
    """Ligne minimale d'une opération appliquée."""
    return {
        "operation_id": "op-1",
        "batch_id": "batch-1",
        "operation_type": "deck.create",
        "request_hash": "h" * 64,
        "status": "applied",
        "resource_kind": "deck",
        "deck_id": 1,
        "recorded_at": "2026-09-20 18:00:00",
        "processed_at": "2026-09-20 18:00:05",
    } | overrides


def test_the_journal_holds_no_foreign_key(migrated):
    """Un journal décrit ce qui s'est passé, pas ce qui existe (cf. modèle)."""
    engine = create_engine(url_for(migrated))
    try:
        assert inspect(engine).get_foreign_keys("sync_operation") == []
    finally:
        engine.dispose()

    # Conséquence directe : on journalise un deck qui n'existe pas (ou plus).
    insert_sync_row(migrated, **applied_row(deck_id=4242))
    assert foreign_key_violations(migrated) == []


def test_the_idempotency_key_is_unique(migrated):
    insert_sync_row(migrated, **applied_row())
    with pytest.raises(Exception) as duplicate:
        insert_sync_row(migrated, **applied_row(batch_id="batch-2", deck_id=2))
    assert "UNIQUE" in str(duplicate.value)


def test_a_client_reference_is_claimed_by_a_single_applied_creation(migrated):
    insert_sync_row(migrated, **applied_row(client_ref="ref-1"))

    with pytest.raises(Exception) as duplicate:
        insert_sync_row(
            migrated, **applied_row(operation_id="op-2", client_ref="ref-1", deck_id=2)
        )
    assert "UNIQUE" in str(duplicate.value)


def test_a_rejected_creation_does_not_lock_its_client_reference(migrated):
    """Tout l'intérêt de l'index *partiel* : un refus se corrige et se rejoue."""
    insert_sync_row(
        migrated,
        **applied_row(
            operation_id="op-refusee",
            client_ref="ref-1",
            status="rejected",
            error_code="conflict",
            error_message="Aucun discriminant libre.",
            resource_kind=None,
            deck_id=None,
        ),
    )

    insert_sync_row(
        migrated, **applied_row(operation_id="op-reprise", client_ref="ref-1")
    )

    assert rows(
        migrated,
        "SELECT status FROM sync_operation WHERE client_ref = 'ref-1' ORDER BY id",
    ) == [("rejected",), ("applied",)]


def test_a_verdict_carries_its_reason_only_when_it_is_a_refusal(migrated):
    # Appliquée avec un motif d'erreur : incohérent.
    with pytest.raises(Exception) as applied_with_error:
        insert_sync_row(migrated, **applied_row(error_code="conflict"))
    assert "CHECK" in str(applied_with_error.value)

    # Refusée sans motif : incohérent aussi.
    with pytest.raises(Exception) as rejected_without_error:
        insert_sync_row(
            migrated,
            **applied_row(
                operation_id="op-2", status="rejected", resource_kind=None, deck_id=None
            ),
        )
    assert "CHECK" in str(rejected_without_error.value)


def test_an_applied_operation_names_the_resource_it_touched(migrated):
    with pytest.raises(Exception) as headless:
        insert_sync_row(migrated, **applied_row(resource_kind=None))
    assert "CHECK" in str(headless.value)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("operation_type", "game.create"),
        ("status", "pending"),
        ("error_code", "teapot"),
        ("resource_kind", "tournament"),
    ],
)
def test_the_journal_enumerations_are_closed(migrated, column, value):
    row = applied_row(operation_id=f"op-{column}")
    if column == "error_code":
        row |= {"status": "rejected", "resource_kind": None, "deck_id": None}
    row[column] = value
    with pytest.raises(Exception) as outside:
        insert_sync_row(migrated, **row)
    assert "CHECK" in str(outside.value)


def test_upgrading_an_existing_database_adds_only_the_journal(empty_db, tmp_path):
    """La révision ne touche à aucune table existante : rien ne doit bouger."""
    alembic(empty_db, "upgrade", DECK_IDENTITY_REVISION)
    seed_decks_at_sync_revision(empty_db)
    before = snapshot_of(empty_db)

    # S'arrête à SYNC_REVISION : au-delà, la garde D3 de 6c9a178b7a1d exige
    # card_copy/deck_card vides.
    alembic(empty_db, "upgrade", SYNC_REVISION)

    after = snapshot_of(empty_db)
    assert set(after) - set(before) == {"sync_operation"}
    for table in before:
        assert after[table] == before[table], table
    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]
    assert scalar(empty_db, "SELECT COUNT(*) FROM deleted_deck_card") == 1
    assert foreign_key_violations(empty_db) == []


def test_downgrading_the_sync_revision_drops_the_journal_and_nothing_else(
    empty_db, tmp_path
):
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)
    insert_sync_row(empty_db, **applied_row(client_ref="ref-1"))

    alembic(empty_db, "downgrade", DECK_IDENTITY_REVISION)

    reference = tmp_path / "deck-identity.db"
    alembic(reference, "upgrade", DECK_IDENTITY_REVISION)
    assert snapshot_of(empty_db) == snapshot_of(reference)
    assert rows(
        empty_db,
        "SELECT type, name FROM sqlite_master WHERE name LIKE '%sync_operation%'",
    ) == []
    assert rows(empty_db, "SELECT deck_id, card_id, quantity FROM deck_card") == [
        (2, 1, 2)
    ]
    assert foreign_key_violations(empty_db) == []


def test_the_sync_revision_renders_offline(empty_db):
    """Prise isolément, elle se rejoue en `--sql` : elle ne crée qu'une table.

    Contre-exemple utile face aux deux révisions du Lot 2, qui ne le peuvent pas
    (mode batch, rattrapage en Python). Ce n'est pas une garantie de l'histoire
    complète — `upgrade head --sql` reste en échec, cf. le `xfail` plus haut.
    """
    result = alembic(
        empty_db, "upgrade", f"{DECK_IDENTITY_REVISION}:{SYNC_REVISION}", "--sql"
    )

    assert "CREATE TABLE sync_operation" in result.stdout
    assert "ux_sync_operation_client_ref" in result.stdout
    assert not empty_db.exists()


# --------------------------------------------------------------------------
# Révision « proxy autorisé au niveau du deck » (Lot 4, passe A)
# --------------------------------------------------------------------------


def test_head_moves_proxy_allowed_from_the_collection_to_the_deck(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        deck_columns_ = {c["name"] for c in inspector.get_columns("deck")}
        copy_columns = {c["name"] for c in inspector.get_columns("card_copy")}
    finally:
        engine.dispose()
    assert "proxy_allowed" in deck_columns_
    assert "proxy_allowed" not in copy_columns


def test_deck_proxy_allowed_defaults_to_false_at_the_database_level(migrated):
    execute(
        migrated,
        "INSERT INTO deck (name, discriminator, status) VALUES ('D', '0001', 'draft')",
    )
    assert scalar(migrated, "SELECT proxy_allowed FROM deck WHERE name = 'D'") == 0


def test_upgrading_the_proxy_revision_refuses_a_populated_deleted_decklist(empty_db):
    """La garde D3 porte sur les trois tables indépendamment : ici seule
    `deleted_deck_card` reste peuplée (`card_copy` référencée par `deck_card`
    via une FK, on vide donc les deux dans cet ordre).
    """
    alembic(empty_db, "upgrade", SYNC_REVISION)
    seed_decks_at_sync_revision(empty_db)
    execute(empty_db, "DELETE FROM deck_card")
    execute(empty_db, "DELETE FROM card_copy")

    result = alembic(empty_db, "upgrade", "head", check=False)

    assert result.returncode != 0
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == SYNC_REVISION


def test_downgrading_the_proxy_revision_refuses_a_populated_collection(empty_db):
    """Symétrique à la montée : la garde D3 s'applique aussi à la descente.

    Isolée sur `PROXY_REVISION` (pas `head`, qui passe désormais par la
    révision de l'extension et sa propre garde D3, testée plus bas).
    """
    alembic(empty_db, "upgrade", PROXY_REVISION)
    seed_decks_at_proxy_revision(empty_db)

    result = alembic(empty_db, "downgrade", SYNC_REVISION, check=False)

    assert result.returncode != 0
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == PROXY_REVISION


def test_downgrade_from_the_proxy_revision_to_the_sync_revision_gives_the_sync_schema(
    empty_db, tmp_path
):
    alembic(empty_db, "upgrade", PROXY_REVISION)
    alembic(empty_db, "downgrade", SYNC_REVISION)

    reference = tmp_path / "sync.db"
    alembic(reference, "upgrade", SYNC_REVISION)

    assert snapshot_of(empty_db) == snapshot_of(reference)


def test_the_proxy_revision_does_not_render_offline(empty_db):
    """Contrairement à la révision du journal de sync, celle-ci ne se rejoue
    pas hors ligne, même prise isolément : la garde D3 lit la base (`SELECT
    COUNT(*)`), ce que le mode `--sql` ne peut pas exécuter. Limite connue du
    Lot 4, à distinguer des deux révisions du Lot 2 (mode batch) : ici c'est
    la garde elle-même, pas `batch_alter_table`, qui l'empêche.
    """
    result = alembic(
        empty_db, "upgrade", f"{SYNC_REVISION}:{PROXY_REVISION}", "--sql", check=False
    )
    assert result.returncode != 0


# --------------------------------------------------------------------------
# Révision « extension dans l'identité du stock » (Lot 4, passe B)
# --------------------------------------------------------------------------


def test_head_adds_the_card_set_id_columns_and_the_placeholder_marker(migrated):
    engine = create_engine(url_for(migrated))
    try:
        inspector = inspect(engine)
        copy_pk = inspector.get_pk_constraint("card_copy")["constrained_columns"]
        deck_card_pk = inspector.get_pk_constraint("deck_card")["constrained_columns"]
        card_set_columns = {c["name"] for c in inspector.get_columns("card_set")}
        sync_columns = {c["name"] for c in inspector.get_columns("sync_operation")}
        copy_fks = inspector.get_foreign_keys("card_copy")
    finally:
        engine.dispose()
    assert copy_pk == ["card_id", "language_code", "card_set_id"]
    assert deck_card_pk == ["deck_id", "card_id", "language_code", "card_set_id"]
    assert "is_placeholder" in card_set_columns
    assert "card_set_id" in sync_columns
    printing_fk = next(
        fk for fk in copy_fks if fk["referred_table"] == "card_printing"
    )
    assert set(printing_fk["constrained_columns"]) == {"card_id", "card_set_id"}


def test_card_set_is_placeholder_defaults_to_false_at_the_database_level(migrated):
    execute(migrated, "INSERT INTO card_set (id, abbrev) VALUES (10, 'ZZ')")
    assert scalar(migrated, "SELECT is_placeholder FROM card_set WHERE id = 10") == 0


def test_migrated_database_enforces_the_composite_foreign_key_to_card_printing(
    migrated,
):
    """`card_copy` refuse une extension où la carte n'a pas été imprimée (D2)."""
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
                text("INSERT INTO card_set (id, abbrev) VALUES (1, 'FN')")
            )
            connection.commit()

            with pytest.raises(Exception) as not_printed:
                connection.execute(
                    text(
                        "INSERT INTO card_copy"
                        " (card_id, language_code, card_set_id, quantity_owned)"
                        " VALUES (1, 'EN', 1, 1)"
                    )
                )
            assert "FOREIGN KEY" in str(not_printed.value)
            connection.rollback()

            connection.execute(
                text(
                    "INSERT INTO card_printing (id, card_id, card_set_id)"
                    " VALUES (1, 1, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO card_copy"
                    " (card_id, language_code, card_set_id, quantity_owned)"
                    " VALUES (1, 'EN', 1, 1)"
                )
            )
            connection.commit()
    finally:
        engine.dispose()


def test_upgrading_past_the_extension_revision_refuses_a_populated_collection(
    empty_db,
):
    """La garde D3 (`b7e41d0c9a52`) arrête la migration comme celle du proxy."""
    alembic(empty_db, "upgrade", PROXY_REVISION)
    seed_decks_at_proxy_revision(empty_db)

    result = alembic(empty_db, "upgrade", "head", check=False)

    assert result.returncode != 0
    assert HEAD_REVISION in result.stdout + result.stderr
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == PROXY_REVISION


def test_downgrading_the_extension_revision_refuses_a_populated_collection(empty_db):
    """Symétrique à la montée : la garde D3 s'applique aussi à la descente."""
    alembic(empty_db, "upgrade", "head")
    seed_decks_at_head(empty_db)

    result = alembic(empty_db, "downgrade", PROXY_REVISION, check=False)

    assert result.returncode != 0
    assert scalar(empty_db, "SELECT version_num FROM alembic_version") == HEAD_REVISION


def test_downgrade_from_head_to_the_proxy_revision_gives_the_proxy_schema(
    empty_db, tmp_path
):
    alembic(empty_db, "upgrade", "head")
    alembic(empty_db, "downgrade", PROXY_REVISION)

    reference = tmp_path / "proxy.db"
    alembic(reference, "upgrade", PROXY_REVISION)

    assert snapshot_of(empty_db) == snapshot_of(reference)


def test_the_extension_revision_does_not_render_offline(empty_db):
    """Comme la révision du proxy : la garde D3 lit la base, `--sql` échoue."""
    result = alembic(
        empty_db, "upgrade", f"{PROXY_REVISION}:{HEAD_REVISION}", "--sql", check=False
    )
    assert result.returncode != 0
