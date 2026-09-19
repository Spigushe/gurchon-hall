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
from app.models.enums import DeckPolicy, DeckStatus, RoundType, TournamentFormat
from app.schemas.base import WriteModel
from app.schemas.collection import (
    CardCopyCreate,
    CardCopyUpdate,
    DeckCardCreate,
    DeckCardUpdate,
    DeckCreate,
    DeckUpdate,
)
from app.schemas.play import (
    GameCreate,
    GameUpdate,
    ParticipationCreate,
    ParticipationUpdate,
    PlayerCreate,
    PlayerUpdate,
    TournamentCreate,
    TournamentUpdate,
)
from app.schemas.reference import LanguageCreate, VenueCreate, VenueUpdate
from tests.helpers import (
    add_languages,
    make_card,
    make_copy,
    make_deck,
    make_game,
    make_player,
)

PLAYED_AT = datetime(2026, 2, 1, 14, 0, tzinfo=UTC)

# schéma de création -> charge utile minimale valide
MINIMAL_CREATE = {
    LanguageCreate: {"code": "DE", "label": "Allemand"},
    VenueCreate: {"name": "Club"},
    CardCopyCreate: {"card_id": 1, "language_code": "EN"},
    DeckCreate: {"name": "Grinder"},
    DeckCardCreate: {"card_id": 1, "language_code": "EN", "quantity": 1},
    PlayerCreate: {"name": "Alice"},
    ParticipationCreate: {"player_id": 1},
    GameCreate: {"played_at": PLAYED_AT, "player_count": 4},
    TournamentCreate: {"name": "Open", "start_date": date(2026, 2, 1)},
}

UPDATE_SCHEMAS = [
    VenueUpdate,
    CardCopyUpdate,
    DeckUpdate,
    DeckCardUpdate,
    PlayerUpdate,
    ParticipationUpdate,
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
        (ParticipationUpdate, "deck_id"),
        (ParticipationUpdate, "victory_points"),
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
        (CardCopyCreate, {"card_id", "language_code"}),
        (DeckCreate, {"name"}),
        (DeckCardCreate, {"card_id", "language_code", "quantity"}),
        (PlayerCreate, {"name"}),
        (ParticipationCreate, {"player_id"}),
        (GameCreate, {"played_at", "player_count"}),
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


UPDATE_TO_MODEL = {
    VenueUpdate: Venue,
    CardCopyUpdate: CardCopy,
    DeckUpdate: Deck,
    DeckCardUpdate: DeckCard,
    PlayerUpdate: Player,
    ParticipationUpdate: Participation,
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
        (DeckCardUpdate, "quantity", 1, 0),
        (DeckCardCreate, "proxy_quantity", 0, -1),
        (DeckCardUpdate, "proxy_quantity", 0, -1),
        (ParticipationCreate, "seat", 1, 0),
        (ParticipationUpdate, "seat", 1, 0),
        (ParticipationCreate, "victory_points", 0, -0.5),
        (ParticipationUpdate, "victory_points", 0, -0.5),
        (GameCreate, "round_number", 1, 0),
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


def test_victory_points_accept_half_points():
    """0,5 VP par survivant en fin de partie (§5)."""
    for value in (0.5, 1, 2.5, 5):
        assert (
            ParticipationCreate(player_id=1, victory_points=value).victory_points
            == value
        )


def test_no_upper_bound_on_victory_points_or_player_count():
    """Pas de plafond inventé : 4-5 joueurs est un standard, pas une règle."""
    assert GameCreate(played_at=PLAYED_AT, player_count=8).player_count == 8
    assert ParticipationCreate(player_id=1, victory_points=10).victory_points == 10


# --------------------------------------------------------------------------
# Défauts
# --------------------------------------------------------------------------


def test_create_defaults():
    assert LanguageCreate(code="DE", label="Allemand").sort_order == 0
    copy = CardCopyCreate(card_id=1, language_code="EN")
    assert (copy.quantity_owned, copy.proxy_allowed, copy.notes) == (0, False, None)
    deck = DeckCreate(name="D")
    assert deck.status is DeckStatus.DRAFT
    line = DeckCardCreate(card_id=1, language_code="EN", quantity=2)
    assert line.proxy_quantity == 0
    assert PlayerCreate(name="A").is_me is False
    game = GameCreate(played_at=PLAYED_AT, player_count=4)
    assert game.round_type is RoundType.CASUAL
    assert game.participations == []
    tournament = TournamentCreate(name="T", start_date=date(2026, 1, 1))
    assert tournament.deck_policy is DeckPolicy.MONO
    assert tournament.format is TournamentFormat.CONSTRUCTED


def test_create_defaults_match_the_model_defaults(db):
    """Le schéma et le modèle s'accordent sur les valeurs par défaut."""
    deck = Deck(**DeckCreate(name="D").model_dump())
    db.add(deck)
    tournament = Tournament(
        **TournamentCreate(name="T", start_date=date(2026, 1, 1)).model_dump()
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


def test_game_participations_default_is_not_shared_between_instances():
    first = GameCreate(played_at=PLAYED_AT, player_count=4)
    second = GameCreate(played_at=PLAYED_AT, player_count=4)
    first.participations.append(ParticipationCreate(player_id=1))
    assert second.participations == []


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


def test_language_is_not_a_closed_enum_in_the_contract():
    """§11.2 : le code de langue est une chaîne libre (liste ouverte)."""
    for code in ("EN", "FR", "ES", "XX", "DE", "pt-BR"):
        assert CardCopyCreate(card_id=1, language_code=code).language_code == code


# --------------------------------------------------------------------------
# Lignes de decklist : proxy_quantity <= quantity
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "proxy_quantity"), [(1, 0), (1, 1), (3, 2), (3, 3)]
)
def test_deck_card_create_accepts_proxy_up_to_quantity(quantity, proxy_quantity):
    line = DeckCardCreate(
        card_id=1, language_code="FR", quantity=quantity, proxy_quantity=proxy_quantity
    )
    assert (line.quantity, line.proxy_quantity) == (quantity, proxy_quantity)


@pytest.mark.parametrize("quantity", [1, 3])
def test_deck_card_create_rejects_proxy_above_quantity(quantity):
    with pytest.raises(ValidationError) as excinfo:
        DeckCardCreate(
            card_id=1,
            language_code="FR",
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
    make_copy(db, card, "EN", quantity_owned=0, proxy_allowed=True)
    deck = make_deck(db)

    try:
        DeckCardCreate(
            card_id=card.id, language_code="EN", quantity=quantity, proxy_quantity=proxy
        )
        schema_accepts = True
    except ValidationError:
        schema_accepts = False

    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
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
        CardCopyCreate(card_id="abc", language_code="EN")
    with pytest.raises(ValidationError):
        ParticipationCreate(player_id="abc")


def test_played_at_is_parsed_from_iso_8601():
    game = GameCreate.model_validate(
        {"played_at": "2026-02-01T14:00:00Z", "player_count": 4}
    )
    assert game.played_at == PLAYED_AT
    assert game.played_at.tzinfo is not None


def test_played_at_rejects_garbage():
    with pytest.raises(ValidationError):
        GameCreate.model_validate({"played_at": "hier soir", "player_count": 4})


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
    game = GameCreate.model_validate(
        {
            "played_at": "2026-02-01T14:00:00Z",
            "player_count": 5,
            "round_type": "preliminary",
            "participations": [
                {
                    "player_id": 1,
                    "deck_id": 7,
                    "seat": 3,
                    "victory_points": 2.5,
                    "game_win": True,
                },
                {"player_id": 2, "seat": 1},
                {"player_id": 3},
            ],
        }
    )
    assert [p.player_id for p in game.participations] == [1, 2, 3]
    assert game.participations[0].victory_points == 2.5
    assert game.participations[2].seat is None


def test_nested_participation_errors_are_located_in_the_payload():
    with pytest.raises(ValidationError) as excinfo:
        GameCreate.model_validate(
            {
                "played_at": "2026-02-01T14:00:00Z",
                "player_count": 4,
                "participations": [{"player_id": 1}, {"player_id": 2, "seat": 0}],
            }
        )
    assert error_locations(excinfo) == {("participations", 1, "seat")}


def test_nested_participation_rejects_unknown_fields():
    with pytest.raises(ValidationError) as excinfo:
        GameCreate.model_validate(
            {
                "played_at": "2026-02-01T14:00:00Z",
                "player_count": 4,
                "participations": [{"player_id": 1, "opponent_deck": "x"}],
            }
        )
    assert error_locations(excinfo) == {("participations", 0, "opponent_deck")}


def test_game_create_does_not_check_table_consistency():
    """Hors périmètre du schéma (Lot 2) : pas de contrôle nb de joueurs / sièges.

    Le contrat n'impose ici ni `len(participations) == player_count`, ni
    l'unicité des sièges ; ces règles, si elles existent, sont des règles de
    service. Le test consigne la frontière pour qu'elle soit réévaluée en Lot 2.
    """
    game = GameCreate(
        played_at=PLAYED_AT,
        player_count=5,
        participations=[ParticipationCreate(player_id=1, seat=1)],
    )
    assert len(game.participations) == 1


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
    (DeckUpdate, Deck, set()),
    (DeckCardCreate, DeckCard, set()),
    (DeckCardUpdate, DeckCard, set()),
    (PlayerCreate, Player, set()),
    (PlayerUpdate, Player, set()),
    (ParticipationCreate, Participation, set()),
    (ParticipationUpdate, Participation, set()),
    (GameCreate, Game, {"participations"}),
    (GameUpdate, Game, set()),
    (TournamentCreate, Tournament, set()),
    (TournamentUpdate, Tournament, set()),
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
    game, player = make_game(db), make_player(db)

    try:
        ParticipationCreate(player_id=player.id, **{field: value})
        schema_accepts = True
    except ValidationError:
        schema_accepts = False

    db.add(Participation(game_id=game.id, player_id=player.id, **{field: value}))
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
            GameCreate(played_at=PLAYED_AT, player_count=count)
        except ValidationError:
            schema_accepts = False
        assert schema_accepts is valid
    make_game(db, player_count=2)
    with pytest.raises(IntegrityError):
        make_game(db, player_count=1)
