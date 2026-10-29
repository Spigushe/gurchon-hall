"""Schémas `*Create` / `*Update` : validation d'entrée.

Ce que le contrat promet à un client (et donc à la file offline qui rejoue des
opérations) : champs requis, bornes, énumérations fermées, refus des champs
inconnus (`extra="forbid"`). Les règles VtES multi-lignes (deck crypt >= 12,
library 60-90, tournoi mono-deck, VP/GW) n'appartiennent pas à ces schémas et ne
sont pas testées ici.
"""

from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

import app.schemas.catalog as catalog
import app.schemas.collection as collection
import app.schemas.play as play
import app.schemas.reference as reference
from app.models import (
    CardCopy,
    Deck,
    DeckCard,
    Game,
    Language,
    Participation,
    Player,
    Tournament,
    Venue,
)
from app.models.enums import (
    DeckPolicy,
    DeckStatus,
    EventTier,
    FinalDeckRule,
    RoundType,
    TournamentFormat,
)
from app.schemas.base import MAX_DB_INT, WriteModel
from app.schemas.collection import (
    BundleDeposit,
    CardCopyCreate,
    CardCopyUpdate,
    DeckCardCreate,
    DeckCardUpdate,
    DeckCreate,
    DeckListState,
    DeckUpdate,
)
from app.schemas.play import (
    MAX_TABLE_SIZE,
    GameCreate,
    GameTableReplace,
    GameUpdate,
    ParticipationCreate,
    PlayerCreate,
    PlayerUpdate,
    TournamentCreate,
    TournamentUpdate,
)
from app.schemas.reference import LanguageCreate, VenueCreate, VenueUpdate
from tests.helpers import (
    add_languages,
    default_user_id,
    make_card,
    make_copy,
    make_deck,
    make_game,
    make_player,
)

PLAYED_AT = datetime(2026, 2, 1, 14, 0, tzinfo=UTC)
ME = {"player": {"me": True}}
"""Ma ligne de table, la plus courte possible : une partie en a toujours une
(Lot 7, A2)."""

# schéma de création -> charge utile minimale valide
MINIMAL_CREATE = {
    LanguageCreate: {"code": "DE", "label": "Allemand"},
    VenueCreate: {"name": "Club"},
    CardCopyCreate: {"card_id": 1, "language_code": "EN", "card_set_id": 1},
    DeckCreate: {"name": "Grinder"},
    DeckCardCreate: {
        "card_id": 1,
        "language_code": "EN",
        "card_set_id": 1,
        "quantity": 1,
    },
    BundleDeposit: {"language_code": "EN"},
    PlayerCreate: {"name": "Alice"},
    ParticipationCreate: ME,
    GameCreate: {"played_at": PLAYED_AT, "player_count": 4, "participations": [ME]},
    GameTableReplace: {"participations": [ME]},
    TournamentCreate: {"name": "Open", "start_date": date(2026, 2, 1)},
}

UPDATE_SCHEMAS = [
    VenueUpdate,
    CardCopyUpdate,
    DeckUpdate,
    DeckCardUpdate,
    PlayerUpdate,
    GameUpdate,
    TournamentUpdate,
]


def error_locations(excinfo) -> set[tuple]:
    return {error["loc"] for error in excinfo.value.errors()}


def all_write_schemas() -> list[type[WriteModel]]:
    found = []
    for module in (catalog, collection, play, reference):
        for obj in vars(module).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, WriteModel)
                and obj is not WriteModel
                and obj.__module__ == module.__name__
            ):
                found.append(obj)
    return found


# --------------------------------------------------------------------------
# Propriétés communes
# --------------------------------------------------------------------------


@pytest.mark.parametrize("schema", list(MINIMAL_CREATE), ids=lambda s: s.__name__)
def test_minimal_payload_is_valid(schema):
    schema.model_validate(MINIMAL_CREATE[schema])


@pytest.mark.parametrize("schema", list(MINIMAL_CREATE), ids=lambda s: s.__name__)
def test_create_schema_rejects_unknown_fields(schema):
    """`extra="forbid"` : un client plus ancien/récent ne passe pas en silence."""
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**MINIMAL_CREATE[schema], "champ_inconnu": 1})
    assert error_locations(excinfo) == {("champ_inconnu",)}
    assert excinfo.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("schema", UPDATE_SCHEMAS, ids=lambda s: s.__name__)
def test_update_schema_rejects_unknown_fields(schema):
    with pytest.raises(ValidationError):
        schema.model_validate({"champ_inconnu": 1})


@pytest.mark.parametrize("schema", UPDATE_SCHEMAS, ids=lambda s: s.__name__)
def test_update_schema_accepts_an_empty_payload(schema):
    """Tous les champs d'une modification sont optionnels."""
    update = schema.model_validate({})
    assert update.model_fields_set == set()
    assert update.model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize("schema", UPDATE_SCHEMAS, ids=lambda s: s.__name__)
def test_update_schema_has_only_optional_fields(schema):
    assert [n for n, f in schema.model_fields.items() if f.is_required()] == []


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        (VenueUpdate, "city"),
        (DeckUpdate, "archetype"),
        (DeckUpdate, "notes"),
        (GameUpdate, "notes"),
        (TournamentUpdate, "end_date"),
        (GameUpdate, "venue"),
        (GameUpdate, "tournament"),
        (TournamentUpdate, "venue"),
        (TournamentUpdate, "final_deck_rule"),
        (CardCopyUpdate, "notes"),
    ],
)
def test_update_distinguishes_explicit_null_from_absent(schema, field):
    """`None` explicite = « efface la valeur » ; absent = « ne touche pas »."""
    cleared = schema.model_validate({field: None})
    assert cleared.model_fields_set == {field}
    assert cleared.model_dump(exclude_unset=True) == {field: None}
    assert schema.model_validate({}).model_dump(exclude_unset=True) == {}


def test_every_write_schema_is_covered_by_this_module():
    """Une classe d'écriture ajoutée au contrat doit venir avec ses tests."""
    covered = set(MINIMAL_CREATE) | set(UPDATE_SCHEMAS)
    covered |= {collection.DeckCardWrite}  # base commune, testée via DeckCardCreate
    assert set(all_write_schemas()) == covered


# --------------------------------------------------------------------------
# Champs requis
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("schema", "required"),
    [
        (LanguageCreate, {"code", "label"}),
        (VenueCreate, {"name"}),
        (CardCopyCreate, {"card_id", "language_code", "card_set_id"}),
        (DeckCreate, {"name"}),
        (DeckCardCreate, {"card_id", "language_code", "card_set_id", "quantity"}),
        (BundleDeposit, {"language_code"}),
        (PlayerCreate, {"name"}),
        (ParticipationCreate, {"player"}),
        (GameCreate, {"played_at", "player_count", "participations"}),
        (GameTableReplace, {"participations"}),
        (TournamentCreate, {"name", "start_date"}),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_required_fields_are_exactly_those_expected(schema, required):
    actual = {n for n, f in schema.model_fields.items() if f.is_required()}
    assert actual == required


@pytest.mark.parametrize("schema", list(MINIMAL_CREATE), ids=lambda s: s.__name__)
def test_empty_payload_reports_every_required_field(schema):
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({})
    expected = {(n,) for n, f in schema.model_fields.items() if f.is_required()}
    assert error_locations(excinfo) == expected
    assert {e["type"] for e in excinfo.value.errors()} == {"missing"}


# --------------------------------------------------------------------------
# Bornes : chaînes
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("schema", "field", "limit"),
    [
        (LanguageCreate, "code", 8),
        (LanguageCreate, "label", 50),
        (VenueCreate, "name", 120),
        (VenueCreate, "city", 80),
        (VenueUpdate, "name", 120),
        (VenueUpdate, "city", 80),
        (CardCopyCreate, "language_code", 8),
        (DeckCardCreate, "language_code", 8),
        (BundleDeposit, "language_code", 8),
        (DeckCreate, "name", 120),
        (DeckCreate, "archetype", 120),
        (DeckUpdate, "name", 120),
        (DeckUpdate, "archetype", 120),
        (PlayerCreate, "name", 80),
        (PlayerUpdate, "name", 80),
        (TournamentCreate, "name", 120),
        (TournamentUpdate, "name", 120),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_string_maximum_length(schema, field, limit):
    base = MINIMAL_CREATE.get(schema, {})
    schema.model_validate({**base, field: "x" * limit})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: "x" * (limit + 1)})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "string_too_long"


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        (LanguageCreate, "code"),
        (LanguageCreate, "label"),
        (VenueCreate, "name"),
        (VenueUpdate, "name"),
        (CardCopyCreate, "language_code"),
        (DeckCardCreate, "language_code"),
        (BundleDeposit, "language_code"),
        (DeckCreate, "name"),
        (DeckUpdate, "name"),
        (PlayerCreate, "name"),
        (PlayerUpdate, "name"),
        (TournamentCreate, "name"),
        (TournamentUpdate, "name"),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_identifying_strings_cannot_be_empty(schema, field):
    base = MINIMAL_CREATE.get(schema, {})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: ""})
    assert excinfo.value.errors()[0]["type"] == "string_too_short"


BLANKS = ["   ", "\t", "\n", "   "]
"""Quatre façons d'écrire « rien » : espaces, tabulation, saut de ligne,
espace insécable (celui que produit un copier-coller depuis une page web)."""

BLANK_REFUSED = [
    (LanguageCreate, "label", 50),
    (VenueCreate, "name", 120),
    (VenueUpdate, "name", 120),
    (DeckCreate, "name", 120),
    (DeckUpdate, "name", 120),
    (PlayerCreate, "name", 80),
    (PlayerUpdate, "name", 80),
    (TournamentCreate, "name", 120),
    (TournamentUpdate, "name", 120),
]


@pytest.mark.parametrize(
    ("schema", "field", "limit"),
    BLANK_REFUSED,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
@pytest.mark.parametrize("blank", BLANKS)
def test_a_name_made_only_of_spaces_is_refused(schema, field, limit, blank):
    """Un nom d'espaces passait `min_length=1` : le deck devenait introuvable.

    Rogné d'abord, mesuré ensuite (cf. `RequiredText`) : une saisie blanche est
    donc vide, et vide est refusé — là où l'on attend un nom affichable.
    """
    base = MINIMAL_CREATE.get(schema, {})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: blank})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "string_too_short"


@pytest.mark.parametrize(
    ("schema", "field", "limit"),
    BLANK_REFUSED,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_a_name_keeps_its_inner_spaces_but_loses_its_edges(schema, field, limit):
    """« Ventrue Grinder » entre avec ses bords rognés, pas son milieu."""
    base = MINIMAL_CREATE.get(schema, {})
    parsed = schema.model_validate({**base, field: "  Ventrue Grinder \n"})
    assert getattr(parsed, field) == "Ventrue Grinder"


@pytest.mark.parametrize(
    ("schema", "field", "limit"),
    BLANK_REFUSED,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_trimming_does_not_move_the_length_ceiling(schema, field, limit):
    """Le plafond se mesure après rognage, et ne bouge pas d'un caractère.

    Contre-épreuve du piège inverse : des espaces de bord ne doivent pas servir
    à faire passer un nom trop long, ni un nom à la limite exacte à échouer.
    """
    base = MINIMAL_CREATE.get(schema, {})
    at_limit = schema.model_validate({**base, field: f"  {'x' * limit}  "})
    assert getattr(at_limit, field) == "x" * limit

    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: f"  {'x' * (limit + 1)}  "})
    assert excinfo.value.errors()[0]["type"] == "string_too_long"


# Tout endroit du contrat où un code de langue entre, plafonné à 8 caractères.
LANGUAGE_CODE_FIELDS = [
    (LanguageCreate, "code"),
    (CardCopyCreate, "language_code"),
    (DeckCardCreate, "language_code"),
    (BundleDeposit, "language_code"),
]


@pytest.mark.parametrize(
    ("schema", "field"),
    LANGUAGE_CODE_FIELDS,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
@pytest.mark.parametrize("blank", BLANKS)
def test_a_language_code_made_only_of_blanks_is_refused(schema, field, blank):
    """Une carte a toujours une langue d'impression : un code blanc n'en est pas.

    Sans rognage, `"  "` passait la validation puis échouait bien plus loin, en
    404 « langue inconnue » — une saisie vide déguisée en ressource absente.
    """
    base = MINIMAL_CREATE.get(schema, {})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: blank})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "string_too_short"


@pytest.mark.parametrize(
    ("schema", "field"),
    LANGUAGE_CODE_FIELDS,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_a_language_code_loses_its_surrounding_blanks(schema, field):
    """« EN » copié-collé avec ses espaces reste « EN », pas « ␣␣EN␣␣ »."""
    base = MINIMAL_CREATE.get(schema, {})
    assert getattr(schema.model_validate({**base, field: "  EN  "}), field) == "EN"
    assert getattr(schema.model_validate({**base, field: "\tfr\n"}), field) == "fr"


@pytest.mark.parametrize(
    ("schema", "field"),
    LANGUAGE_CODE_FIELDS,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_the_language_code_ceiling_is_measured_after_trimming(schema, field):
    """Huit caractères après rognage : ni gagnés ni perdus par les bords."""
    base = MINIMAL_CREATE.get(schema, {})
    at_limit = schema.model_validate({**base, field: f"  {'x' * 8}  "})
    assert getattr(at_limit, field) == "x" * 8

    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: f"  {'x' * 9}  "})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "string_too_long"


def test_every_language_code_field_of_the_contract_is_covered():
    """Un champ de langue ajouté au contrat doit rejoindre la liste ci-dessus.

    Repéré par son nom (`code` sur `LanguageCreate`, `language_code` ailleurs)
    parmi tous les schémas d'écriture : le plafond de 8 caractères n'est pas un
    critère, c'est le fait d'être un code de langue qui l'est.
    """
    found = {
        (schema, name)
        for schema in all_write_schemas()
        for name in schema.model_fields
        if name == "language_code" or (name == "code" and schema is LanguageCreate)
    }
    assert found == set(LANGUAGE_CODE_FIELDS)


def test_optional_free_text_keeps_its_spaces():
    """Les champs libres facultatifs ne sont pas touchés.

    `archetype`, `notes`, `city` sont effaçables par `null` ; leur contenu est
    de la prose, pas un identifiant d'affichage. Les rogner serait une autre
    décision, à prendre pour de meilleures raisons que la symétrie.
    """
    deck = DeckCreate.model_validate({"name": "D", "archetype": "  Vote  "})
    assert deck.archetype == "  Vote  "
    assert VenueCreate.model_validate({"name": "V", "city": " Lyon "}).city == " Lyon "


UPDATE_TO_MODEL = {
    VenueUpdate: Venue,
    CardCopyUpdate: CardCopy,
    DeckUpdate: Deck,
    DeckCardUpdate: DeckCard,
    PlayerUpdate: Player,
    GameUpdate: Game,
    TournamentUpdate: Tournament,
}

NULL_ON_REQUIRED_COLUMN = [
    pytest.param(schema, field, id=f"{schema.__name__}.{field}")
    for schema, model in UPDATE_TO_MODEL.items()
    for field in schema.model_fields
    if field in model.__table__.c and not model.__table__.c[field].nullable
]


def test_the_null_on_required_column_matrix_is_not_empty():
    """Garde-fou : la découverte automatique des colonnes NOT NULL trouve bien."""
    assert len(NULL_ON_REQUIRED_COLUMN) >= 10


@pytest.mark.parametrize(("schema", "field"), NULL_ON_REQUIRED_COLUMN)
def test_update_refuses_explicit_null_on_a_not_null_column(schema, field):
    """`null` explicite = « efface la valeur » n'a de sens que pour une colonne
    nullable ; sur une colonne NOT NULL, il est refusé à l'entrée (422) plutôt
    que par la base (500). Ces champs restent facultatifs (`UNSET`)."""
    with pytest.raises(ValidationError):
        schema.model_validate({field: None})


# --------------------------------------------------------------------------
# Bornes : nombres
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("schema", "field", "lowest_valid", "highest_invalid"),
    [
        (CardCopyCreate, "quantity_owned", 0, -1),
        (CardCopyUpdate, "quantity_owned", 0, -1),
        (DeckCardCreate, "quantity", 1, 0),
        (GameCreate, "round_number", 1, 0),
        (BundleDeposit, "count", 1, 0),
        (DeckCardUpdate, "quantity", 1, 0),
        (DeckCardCreate, "proxy_quantity", 0, -1),
        (DeckCardUpdate, "proxy_quantity", 0, -1),
        (LanguageCreate, "sort_order", 0, -1),
        (ParticipationCreate, "seat", 1, 0),
        (ParticipationCreate, "victory_points", 0, -0.5),
        (GameUpdate, "round_number", 1, 0),
        (GameCreate, "player_count", 2, 1),
        (GameUpdate, "player_count", 2, 1),
        (TournamentCreate, "round_count", 1, 0),
        (TournamentUpdate, "round_count", 1, 0),
        (TournamentCreate, "my_ranking", 1, 0),
        (TournamentUpdate, "my_ranking", 1, 0),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_numeric_lower_bounds(schema, field, lowest_valid, highest_invalid):
    base = MINIMAL_CREATE.get(schema, {})
    schema.model_validate({**base, field: lowest_valid})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: highest_invalid})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "greater_than_equal"


UPPER_BOUNDED = [
    (LanguageCreate, "sort_order"),
    (CardCopyCreate, "card_id"),
    (CardCopyCreate, "card_set_id"),
    (CardCopyCreate, "quantity_owned"),
    (CardCopyUpdate, "quantity_owned"),
    (DeckCardCreate, "card_id"),
    (DeckCardCreate, "card_set_id"),
    (DeckCardCreate, "quantity"),
    (DeckCardUpdate, "quantity"),
    (DeckCardUpdate, "proxy_quantity"),
    (BundleDeposit, "count"),
    (GameCreate, "round_number"),
    (GameUpdate, "round_number"),
    (TournamentCreate, "round_count"),
    (TournamentCreate, "player_count"),
    (TournamentUpdate, "player_count"),
]


@pytest.mark.parametrize(
    ("schema", "field"),
    UPPER_BOUNDED,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_integers_are_capped_at_the_database_maximum(schema, field):
    """Un entier hors des bornes d'une colonne doit valoir 422, pas 500.

    Sans plafond, la valeur descend jusqu'au pilote SQLite, qui la refuse par
    une erreur d'exécution : le client reçoit alors une erreur serveur pour une
    saisie qui n'a jamais eu la moindre chance d'exister en base.
    """
    base = MINIMAL_CREATE.get(schema, {})
    schema.model_validate({**base, field: MAX_DB_INT})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: MAX_DB_INT + 1})
    assert error_locations(excinfo) == {(field,)}
    assert excinfo.value.errors()[0]["type"] == "less_than_equal"


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        (CardCopyCreate, "card_id"),
        (CardCopyCreate, "card_set_id"),
        (DeckCardCreate, "card_id"),
        (DeckCardCreate, "card_set_id"),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_identifiers_in_the_body_start_at_one(schema, field):
    base = MINIMAL_CREATE.get(schema, {})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**base, field: 0})
    assert error_locations(excinfo) == {(field,)}


def test_proxy_quantity_is_capped_too():
    """À part : le plafond doit rester sous la quantité, elle-même plafonnée."""
    line = {
        "card_id": 1,
        "language_code": "EN",
        "card_set_id": 1,
        "quantity": MAX_DB_INT,
    }
    DeckCardCreate.model_validate({**line, "proxy_quantity": MAX_DB_INT})
    with pytest.raises(ValidationError) as excinfo:
        DeckCardCreate.model_validate({**line, "proxy_quantity": MAX_DB_INT + 1})
    assert error_locations(excinfo) == {("proxy_quantity",)}


def test_max_db_int_is_the_signed_32_bit_ceiling():
    assert MAX_DB_INT == 2**31 - 1 == 2147483647


def test_victory_points_accept_half_points():
    """0,5 VP par survivant en fin de partie ou par retrait (§5)."""
    for value in (0, 0.5, 1, 2.5, 5):
        assert ParticipationCreate(**ME, victory_points=value).victory_points == value


@pytest.mark.parametrize("value", [0.25, 1.3, 2.75])
def test_victory_points_are_half_points_only(value):
    with pytest.raises(ValidationError) as excinfo:
        ParticipationCreate(**ME, victory_points=value)
    assert excinfo.value.errors()[0]["type"] == "multiple_of"


def test_table_size_is_capped_at_six():
    """Borne de saisie du Lot 7, pas règle VEKN : une table de tournoi compte
    4 ou 5 joueurs, l'outil en accepte de 2 à 6 et refuse une faute de frappe.
    Le plafond borne aussi les sièges et les VP d'une ligne."""
    assert MAX_TABLE_SIZE == 6
    game = {"played_at": PLAYED_AT, "participations": [ME]}
    assert GameCreate(**game, player_count=6).player_count == 6
    with pytest.raises(ValidationError):
        GameCreate(**game, player_count=7)
    with pytest.raises(ValidationError):
        GameUpdate(player_count=7)
    assert ParticipationCreate(**ME, seat=6, victory_points=6).seat == 6
    with pytest.raises(ValidationError):
        ParticipationCreate(**ME, seat=7)
    with pytest.raises(ValidationError):
        ParticipationCreate(**ME, victory_points=6.5)


# --------------------------------------------------------------------------
# Défauts
# --------------------------------------------------------------------------


def test_create_defaults():
    assert LanguageCreate(code="DE", label="Allemand").sort_order == 0
    copy = CardCopyCreate(card_id=1, language_code="EN", card_set_id=1)
    assert (copy.quantity_owned, copy.notes) == (0, None)
    deck = DeckCreate(name="D")
    assert deck.status is DeckStatus.DRAFT
    assert deck.proxy_allowed is False
    line = DeckCardCreate(card_id=1, language_code="EN", card_set_id=1, quantity=2)
    assert line.proxy_quantity == 0
    game = GameCreate(played_at=PLAYED_AT, player_count=4, participations=[ME])
    assert game.round_type is RoundType.CASUAL
    assert (game.venue, game.tournament) == (None, None)
    tournament = TournamentCreate(name="T", start_date=date(2026, 1, 1))
    assert tournament.deck_policy is DeckPolicy.MONO
    assert tournament.format is TournamentFormat.CONSTRUCTED
    assert tournament.event_tier is EventTier.STANDARD
    assert tournament.final_deck_rule is None


def test_create_defaults_match_the_model_defaults(db):
    """Le schéma et le modèle s'accordent sur les valeurs par défaut.

    Le discriminant s'ajoute à la charge utile : c'est le service qui le tire,
    le client ne le fournit jamais (cf. `DeckCreate`).
    """
    user_id = default_user_id(db)
    deck = Deck(
        user_id=user_id, discriminator="0001", **DeckCreate(name="D").model_dump()
    )
    db.add(deck)
    tournament = Tournament(
        user_id=user_id,
        **TournamentCreate(name="T", start_date=date(2026, 1, 1)).model_dump(
            exclude={"venue"}
        ),
    )
    db.add(tournament)
    db.flush()
    assert deck.status is DeckCreate(name="D").status
    assert (
        tournament.deck_policy
        is TournamentCreate(name="T", start_date=date(2026, 1, 1)).deck_policy
    )
    assert (
        tournament.format
        is TournamentCreate(name="T", start_date=date(2026, 1, 1)).format
    )
    assert (
        tournament.event_tier
        is TournamentCreate(name="T", start_date=date(2026, 1, 1)).event_tier
    )


# --------------------------------------------------------------------------
# Énumérations
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("schema", "field", "enum"),
    [
        (DeckCreate, "status", DeckStatus),
        (DeckUpdate, "status", DeckStatus),
        (GameCreate, "round_type", RoundType),
        (GameUpdate, "round_type", RoundType),
        (TournamentCreate, "deck_policy", DeckPolicy),
        (TournamentUpdate, "deck_policy", DeckPolicy),
        (TournamentCreate, "format", TournamentFormat),
        (TournamentUpdate, "format", TournamentFormat),
        (TournamentCreate, "event_tier", EventTier),
        (TournamentUpdate, "event_tier", EventTier),
        (TournamentCreate, "final_deck_rule", FinalDeckRule),
        (TournamentUpdate, "final_deck_rule", FinalDeckRule),
    ],
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_enum_fields_accept_every_value_and_refuse_others(schema, field, enum):
    base = MINIMAL_CREATE.get(schema, {})
    for member in enum:
        assert (
            getattr(schema.model_validate({**base, field: member.value}), field)
            is member
        )
    for bogus in ("bogus", "", member.name.upper() + "_"):
        with pytest.raises(ValidationError) as excinfo:
            schema.model_validate({**base, field: bogus})
        assert error_locations(excinfo) == {(field,)}
        assert excinfo.value.errors()[0]["type"] == "enum"


def test_enum_member_names_are_not_accepted_only_values():
    """Le contrat parle en valeurs (« active »), pas en noms de membre (« ACTIVE »)."""
    with pytest.raises(ValidationError):
        DeckCreate(name="D", status="ACTIVE")
    assert DeckCreate(name="D", status="active").status is DeckStatus.ACTIVE


def test_deck_list_state_has_exactly_three_values():
    """Filtre de liste à trois positions ; les supprimés n'y figurent jamais."""
    assert [state.value for state in DeckListState] == ["active", "archived", "all"]


# --------------------------------------------------------------------------
# Deck : discriminant tiré par le serveur, archivage par PATCH
# --------------------------------------------------------------------------


def test_the_client_never_supplies_a_discriminator():
    assert "discriminator" not in DeckCreate.model_fields
    assert "discriminator" not in DeckUpdate.model_fields
    with pytest.raises(ValidationError) as excinfo:
        DeckCreate.model_validate({"name": "D", "discriminator": "0042"})
    assert error_locations(excinfo) == {("discriminator",)}


def test_archiving_is_a_boolean_field_of_the_update():
    """« Archivé » n'est pas un statut : c'est une bascule, donc un booléen."""
    assert DeckUpdate.model_validate({"archived": True}).archived is True
    assert DeckUpdate.model_validate({"archived": False}).archived is False
    assert "archived" not in DeckUpdate.model_validate({}).model_fields_set
    assert "archived" not in DeckUpdate.model_fields["status"].annotation.__members__


def test_archived_refuses_an_explicit_null():
    """`null` voudrait dire « efface » : `archived_at` s'efface avec `false`."""
    with pytest.raises(ValidationError):
        DeckUpdate.model_validate({"archived": None})


def test_deck_status_is_reduced_to_draft_and_active():
    assert [status.value for status in DeckStatus] == ["draft", "active"]
    with pytest.raises(ValidationError):
        DeckCreate.model_validate({"name": "D", "status": "retired"})


def test_language_is_not_a_closed_enum_in_the_contract():
    """§11.2 : le code de langue est une chaîne libre (liste ouverte)."""
    for code in ("EN", "FR", "ES", "XX", "DE", "pt-BR"):
        copy = CardCopyCreate(card_id=1, language_code=code, card_set_id=1)
        assert copy.language_code == code


# --------------------------------------------------------------------------
# Lignes de decklist : proxy_quantity <= quantity
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "proxy_quantity"), [(1, 0), (1, 1), (3, 2), (3, 3)]
)
def test_deck_card_create_accepts_proxy_up_to_quantity(quantity, proxy_quantity):
    line = DeckCardCreate(
        card_id=1,
        language_code="FR",
        card_set_id=1,
        quantity=quantity,
        proxy_quantity=proxy_quantity,
    )
    assert (line.quantity, line.proxy_quantity) == (quantity, proxy_quantity)


@pytest.mark.parametrize("quantity", [1, 3])
def test_deck_card_create_rejects_proxy_above_quantity(quantity):
    with pytest.raises(ValidationError) as excinfo:
        DeckCardCreate(
            card_id=1,
            language_code="FR",
            card_set_id=1,
            quantity=quantity,
            proxy_quantity=quantity + 1,
        )
    message = excinfo.value.errors()[0]["msg"]
    assert "proxy_quantity" in message


@pytest.mark.parametrize(
    ("quantity", "proxy", "valid"),
    [
        (1, 0, True),
        (2, 2, True),
        (3, 1, True),
        (1, 2, False),
        (0, 0, False),
        (2, -1, False),
    ],
)
def test_deck_card_rules_agree_between_schema_and_database(db, quantity, proxy, valid):
    """Le schéma refuse exactement ce que le CHECK de `deck_card` refuse."""
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=0)
    deck = make_deck(db, proxy_allowed=True)

    try:
        DeckCardCreate(
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=quantity,
            proxy_quantity=proxy,
        )
        schema_accepts = True
    except ValidationError:
        schema_accepts = False

    db.add(
        DeckCard(
            deck_id=deck.id,
            user_id=deck.user_id,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=quantity,
            proxy_quantity=proxy,
        )
    )
    try:
        db.flush()
        database_accepts = True
    except IntegrityError:
        database_accepts = False

    assert schema_accepts == database_accepts == valid


# --------------------------------------------------------------------------
# Types et coercition
# --------------------------------------------------------------------------


def test_ids_reject_non_numeric_strings():
    with pytest.raises(ValidationError):
        CardCopyCreate(card_id="abc", language_code="EN", card_set_id=1)
    with pytest.raises(ValidationError):
        ParticipationCreate(player={"player_id": "abc"})


def test_played_at_is_parsed_from_iso_8601():
    game = GameCreate.model_validate(
        {"played_at": "2026-02-01T14:00:00Z", "player_count": 4, "participations": [ME]}
    )
    assert game.played_at == PLAYED_AT
    assert game.played_at.tzinfo is not None


def test_played_at_rejects_garbage():
    with pytest.raises(ValidationError):
        GameCreate.model_validate(
            {"played_at": "hier soir", "player_count": 4, "participations": [ME]}
        )


def test_dates_are_parsed_from_iso_8601():
    tournament = TournamentCreate.model_validate(
        {"name": "T", "start_date": "2026-02-01"}
    )
    assert tournament.start_date == date(2026, 2, 1)
    with pytest.raises(ValidationError):
        TournamentCreate.model_validate({"name": "T", "start_date": "01/02/2026"})


# --------------------------------------------------------------------------
# Partie saisie d'un bloc (participations imbriquées)
# --------------------------------------------------------------------------


def test_game_create_accepts_a_whole_table_in_one_payload():
    """Ma ligne, un adversaire connu, un adversaire créé hors ligne avec l'un de
    mes decks prêté (P4), désignés par référence."""
    game = GameCreate.model_validate(
        {
            "played_at": "2026-02-01T14:00:00Z",
            "player_count": 5,
            "round_type": "preliminary",
            "round_number": 1,
            "tournament": {"client_ref": "t-1"},
            "venue": {"venue_id": 3},
            "participations": [
                {
                    "player": {"me": True},
                    "deck": {"deck_id": 7},
                    "seat": 3,
                    "victory_points": 2.5,
                    "game_win": True,
                },
                {"player": {"player_id": 2}, "seat": 1},
                {"player": {"client_ref": "p-1"}, "deck": {"client_ref": "d-1"}},
            ],
        }
    )
    players = [line.player for line in game.participations]
    assert [(p.me, p.player_id, p.client_ref) for p in players] == [
        (True, None, None),
        (None, 2, None),
        (None, None, "p-1"),
    ]
    assert game.participations[0].victory_points == 2.5
    assert game.participations[2].deck.client_ref == "d-1"
    assert game.tournament.client_ref == "t-1"
    assert game.venue.venue_id == 3


def test_nested_participation_errors_are_located_in_the_payload():
    with pytest.raises(ValidationError) as excinfo:
        GameCreate.model_validate(
            {
                "played_at": "2026-02-01T14:00:00Z",
                "player_count": 4,
                "participations": [ME, {"player": {"player_id": 2}, "seat": 0}],
            }
        )
    assert error_locations(excinfo) == {("participations", 1, "seat")}


def test_nested_participation_rejects_unknown_fields():
    with pytest.raises(ValidationError) as excinfo:
        GameCreate.model_validate(
            {
                "played_at": "2026-02-01T14:00:00Z",
                "player_count": 4,
                "participations": [{**ME, "opponent_deck": "x"}],
            }
        )
    assert error_locations(excinfo) == {("participations", 0, "opponent_deck")}


@pytest.mark.parametrize("schema", [GameCreate, GameTableReplace])
def test_a_table_is_never_empty(schema):
    """Une partie contient toujours ma ligne (A2)."""
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**MINIMAL_CREATE[schema], "participations": []})
    assert error_locations(excinfo) == {("participations",)}


RULE_BREAKING_GAMES = [
    pytest.param({"participations": [ME, ME]}, id="deux-fois-moi"),
    pytest.param(
        {
            "participations": [
                {**ME, "seat": 1},
                {"player": {"player_id": 2}, "seat": 1},
            ]
        },
        id="meme-siege",
    ),
    pytest.param(
        {
            "player_count": 2,
            "participations": [
                ME,
                {"player": {"player_id": 2}},
                {"player": {"player_id": 3}},
            ],
        },
        id="plus-de-lignes-que-de-joueurs",
    ),
    pytest.param({"tournament": {"tournament_id": 1}}, id="amicale-en-tournoi"),
    pytest.param({"round_type": "final"}, id="finale-hors-tournoi"),
    pytest.param({"round_number": 1}, id="numero-hors-preliminaire"),
    pytest.param(
        {"participations": [{"player": {"player_id": 2}, "victory_points": 4}]},
        id="sans-moi-et-vp-adversaire",
    ),
]


@pytest.mark.parametrize("fields", RULE_BREAKING_GAMES)
def test_game_rules_are_left_to_the_service(fields):
    """Décision du 2026-10-29 : le schéma vérifie la forme, le service les
    règles (table, ronde, VP, GW). Par `/sync`, un refus du schéma ferait
    échouer le lot entier sans verdict ; au service, c'est le verdict `invalid`
    d'une seule opération. Les règles ont leurs tests dans
    `test_vtes_rules_play.py`."""
    GameCreate.model_validate({**MINIMAL_CREATE[GameCreate], **fields})


@pytest.mark.parametrize(
    "fields",
    [
        {"deck_policy": "multi", "event_tier": "grand_prix"},
        {"final_deck_rule": "free_choice"},
        {"player_count": 27, "my_ranking": 28},
        {"start_date": "2026-10-24", "end_date": "2026-10-23"},
    ],
)
def test_tournament_rules_are_left_to_the_service(fields):
    TournamentCreate.model_validate({**MINIMAL_CREATE[TournamentCreate], **fields})


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {
            "tournament": {"tournament_id": 1},
            "round_type": "preliminary",
            "round_number": 3,
        },
        {"tournament": {"client_ref": "t"}, "round_type": "final"},
    ],
)
def test_game_create_accepts_each_kind_of_round(fields):
    GameCreate.model_validate({**MINIMAL_CREATE[GameCreate], **fields})


@pytest.mark.parametrize("value", [0, MAX_DB_INT + 1])
def test_game_round_number_is_bounded(value):
    """Garantie reprise d'avant le Lot 7 : la borne vaut quel que soit le reste
    de la charge utile."""
    with pytest.raises(ValidationError) as excinfo:
        GameCreate.model_validate({**MINIMAL_CREATE[GameCreate], "round_number": value})
    assert error_locations(excinfo) == {("round_number",)}


@pytest.mark.parametrize("schema", [PlayerCreate, PlayerUpdate])
def test_is_me_cannot_be_written(schema):
    """Le « Moi » est créé par le serveur, jamais par l'API (A1)."""
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({"name": "Alice", "is_me": True})
    assert error_locations(excinfo) == {("is_me",)}
    assert excinfo.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        (GameUpdate, "venue"),
        (GameUpdate, "tournament"),
        (GameUpdate, "round_number"),
        (TournamentUpdate, "venue"),
        (TournamentUpdate, "final_deck_rule"),
    ],
)
def test_omitted_and_null_are_two_different_updates(schema, field):
    """Le service lit `model_fields_set` : « retirer le lieu » n'est pas « ne
    pas y toucher »."""
    assert schema.model_validate({}).model_fields_set == set()
    assert schema.model_validate({field: None}).model_fields_set == {field}


# --------------------------------------------------------------------------
# Cohérence des noms de champs avec les modèles ORM
# --------------------------------------------------------------------------

SCHEMA_TO_MODEL = [
    (LanguageCreate, Language, set()),
    (VenueCreate, Venue, set()),
    (VenueUpdate, Venue, set()),
    (CardCopyCreate, CardCopy, set()),
    (CardCopyUpdate, CardCopy, set()),
    (DeckCreate, Deck, set()),
    # `archived` n'est pas une colonne : le service le traduit en `archived_at`.
    (DeckUpdate, Deck, {"archived"}),
    # `acquired_quantity` n'est pas une colonne de la ligne : c'est un effet de
    # bord sur l'entrée de collection (Lot 4b).
    (DeckCardCreate, DeckCard, {"acquired_quantity"}),
    (DeckCardUpdate, DeckCard, {"acquired_quantity"}),
    (PlayerCreate, Player, set()),
    (PlayerUpdate, Player, set()),
    # Lot 7 : les écritures désignent joueur, deck, lieu et tournoi par une
    # référence (`app.schemas.refs`), que le service résout en identifiant ; le
    # champ porte le nom de la relation, pas celui de la colonne.
    (ParticipationCreate, Participation, {"player", "deck"}),
    (GameCreate, Game, {"participations", "venue", "tournament"}),
    (GameUpdate, Game, {"venue", "tournament"}),
    (TournamentCreate, Tournament, {"venue"}),
    (TournamentUpdate, Tournament, {"venue"}),
]


@pytest.mark.parametrize(
    ("schema", "model", "extra"),
    SCHEMA_TO_MODEL,
    ids=lambda v: v.__name__ if isinstance(v, type) else None,
)
def test_write_schema_fields_are_attributes_of_the_model(schema, model, extra):
    """Un champ renommé d'un seul côté ferait échouer `Model(**payload)` au Lot 2."""
    attributes = set(model.__mapper__.attrs.keys())
    assert set(schema.model_fields) - extra <= attributes


def test_string_limits_do_not_exceed_the_database_column_lengths():
    """Un champ accepté par le schéma ne doit pas dépasser la colonne cible."""
    pairs = [
        (LanguageCreate, "code", Language, "code"),
        (LanguageCreate, "label", Language, "label"),
        (VenueCreate, "name", Venue, "name"),
        (VenueCreate, "city", Venue, "city"),
        (CardCopyCreate, "language_code", CardCopy, "language_code"),
        (DeckCardCreate, "language_code", DeckCard, "language_code"),
        (DeckCreate, "name", Deck, "name"),
        (DeckCreate, "archetype", Deck, "archetype"),
        (PlayerCreate, "name", Player, "name"),
        (TournamentCreate, "name", Tournament, "name"),
    ]
    for schema, field, model, column in pairs:
        limits = [
            m.max_length
            for m in schema.model_fields[field].metadata
            if hasattr(m, "max_length")
        ]
        assert limits, f"{schema.__name__}.{field} sans max_length"
        assert limits[0] <= model.__table__.c[column].type.length, (
            f"{schema.__name__}.{field}"
        )


@pytest.mark.parametrize(
    ("field", "value", "valid"),
    [
        ("victory_points", 0, True),
        ("victory_points", 0.5, True),
        ("victory_points", -0.5, False),
        ("seat", 1, True),
        ("seat", 0, False),
    ],
)
def test_participation_bounds_agree_between_schema_and_database(
    db, field, value, valid
):
    """Valeur limite acceptée par le schéma = acceptée par la base, et inversement."""
    game = make_game(db)
    player = make_player(db, user_id=game.user_id)

    try:
        ParticipationCreate(player={"player_id": player.id}, **{field: value})
        schema_accepts = True
    except ValidationError:
        schema_accepts = False

    db.add(
        Participation(
            game_id=game.id, user_id=game.user_id, player_id=player.id, **{field: value}
        )
    )
    try:
        db.flush()
        database_accepts = True
    except IntegrityError:
        database_accepts = False

    assert schema_accepts == database_accepts == valid


def test_game_player_count_bound_agrees_between_schema_and_database(db):
    for count, valid in [(1, False), (2, True)]:
        schema_accepts = True
        try:
            GameCreate(played_at=PLAYED_AT, player_count=count, participations=[ME])
        except ValidationError:
            schema_accepts = False
        assert schema_accepts is valid
    make_game(db, player_count=2)
    with pytest.raises(IntegrityError):
        make_game(db, player_count=1)
