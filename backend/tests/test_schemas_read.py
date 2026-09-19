"""Schémas `*Read` : mapping `from_attributes` depuis des objets ORM.

Les schémas ne sont branchés à aucune route au Lot 1. Ces tests vérifient donc
ce que le Lot 2 supposera : qu'un objet SQLAlchemy chargé depuis la base se
convertit sans perte en schéma de lecture, relations imbriquées comprises, et
que les schémas restent alignés sur les colonnes du modèle.
"""

from datetime import date, datetime

import pytest
from pydantic import BaseModel, ValidationError

from app.models import (
    Card,
    CardCopy,
    CardSet,
    CardTranslation,
    CardType,
    Clan,
    Deck,
    DeckCard,
    Discipline,
    Game,
    Language,
    Participation,
    Player,
    Sect,
    Tournament,
    Venue,
)
from app.models.enums import (
    CardCategory,
    CostType,
    DeckPolicy,
    DeckStatus,
    PrintOccurrence,
    RoundType,
    TournamentFormat,
)
from app.schemas.base import ReadModel
from app.schemas.catalog import (
    BundleCardRead,
    BundleContentRead,
    CardDisciplineRead,
    CardPrintingRead,
    CardRead,
    CardSummary,
    CardTranslationRead,
)
from app.schemas.collection import (
    CardCopyRead,
    DeckCardRead,
    DeckDetailRead,
    DeckLegality,
    DeckRead,
)
from app.schemas.play import (
    GameDetailRead,
    GameRead,
    ParticipationRead,
    PlayerRead,
    TournamentDetailRead,
    TournamentRead,
)
from app.schemas.reference import (
    BundleRead,
    CardSetRead,
    CardTypeRead,
    ClanRead,
    DisciplineRead,
    LanguageRead,
    SectRead,
    VenueRead,
)
from tests.helpers import add_languages, make_card, make_copy, make_deck

# --------------------------------------------------------------------------
# Tables de référence
# --------------------------------------------------------------------------


def test_language_read(db, world):
    language = db.get(Language, "FR")
    assert LanguageRead.model_validate(language).model_dump() == {
        "code": "FR",
        "label": "Français",
        "sort_order": 2,
    }


def test_reference_reads(db, world):
    assert ClanRead.model_validate(world.clan).model_dump() == {
        "id": world.clan.id,
        "name": "Ventrue",
        "abbrev": "VEN",
    }
    assert DisciplineRead.model_validate(world.discipline).abbrev == "dom"
    assert SectRead.model_validate(world.sect).name == "Camarilla"
    assert CardTypeRead.model_validate(world.card_type).name == "Action"
    card_set = CardSetRead.model_validate(world.card_set)
    assert (card_set.abbrev, card_set.release_date, card_set.company) == (
        "FN",
        date(2001, 6, 11),
        "White Wolf",
    )
    venue = VenueRead.model_validate(world.venue)
    assert (venue.name, venue.city, venue.notes) == (
        "Club de test",
        "Nantes",
        "Le jeudi",
    )


def test_reference_optional_columns_map_to_none(db):
    clan, venue, card_set = (
        Clan(name="Sans abrév."),
        Venue(name="Lieu"),
        CardSet(abbrev="X"),
    )
    db.add_all([clan, venue, card_set])
    db.commit()
    assert ClanRead.model_validate(clan).abbrev is None
    assert VenueRead.model_validate(venue).city is None
    read = CardSetRead.model_validate(card_set)
    assert (read.full_name, read.release_date, read.company) == (None, None, None)


# --------------------------------------------------------------------------
# Catalogue
# --------------------------------------------------------------------------


def test_card_read_maps_scalar_columns(db, world):
    read = CardRead.model_validate(world.card)
    assert read.id == world.card.id
    assert read.vekn_id == world.card.vekn_id
    assert read.name == "Aabbt Kindred"
    assert read.category is CardCategory.CRYPT
    assert read.capacity == 4
    assert read.group_code == "2"
    assert read.advanced is False
    assert read.burn_option is False
    assert read.card_text == "Independent."
    assert read.image_url == "https://static.krcg.org/card/aabbtkindredg2.jpg"
    assert read.cost_type is None and read.cost_value is None
    assert read.trifle is False
    assert read.discipline_requirement is None
    assert read.banned_on is None


def test_card_read_maps_nested_relations(db, world):
    read = CardRead.model_validate(world.card)

    assert read.clan == ClanRead(id=world.clan.id, name="Ventrue", abbrev="VEN")
    assert read.sect is not None and read.sect.name == "Camarilla"
    assert [t.name for t in read.types] == ["Action"]

    assert len(read.discipline_links) == 1
    link = read.discipline_links[0]
    assert isinstance(link, CardDisciplineRead)
    assert link.discipline.abbrev == "dom"
    assert link.superior is True

    assert len(read.printings) == 1
    printing = read.printings[0]
    assert isinstance(printing, CardPrintingRead)
    assert printing.card_set.abbrev == "FN"
    assert printing.image_url is not None and printing.image_url.endswith(".jpg")

    by_type = {o.occurrence_type: o for o in printing.occurrences}
    assert set(by_type) == {PrintOccurrence.RARITY, PrintOccurrence.PRECON}

    precon = by_type[PrintOccurrence.PRECON]
    assert precon.bundle is not None and precon.bundle.code == "PS"
    assert precon.copies == 2 and precon.frequency is None

    booster = by_type[PrintOccurrence.RARITY]
    assert (booster.frequency, booster.multiplier) == ("U", 2.0)
    assert booster.bundle is None and booster.copies is None

    assert len(read.translations) == 1
    translation = read.translations[0]
    assert isinstance(translation, CardTranslationRead)
    assert (translation.language_code, translation.name) == ("FR", "Parenté Aabbt")
    assert translation.card_text == "Indépendant."
    assert translation.flavor_text == "Le sang des anciens."
    assert translation.image_url == "https://static.krcg.org/card/fr/aabbtkindredg2.jpg"


def test_card_read_json_dump_uses_enum_values(db, world):
    dumped = CardRead.model_validate(world.card).model_dump(mode="json")
    assert dumped["category"] == "crypt"
    assert dumped["discipline_links"][0]["discipline"]["name"] == "Dominate"


def test_card_read_of_a_bare_library_card_uses_empty_collections(db):
    card = make_card(
        db,
        "Blood Rage",
        CardCategory.LIBRARY,
        cost_type=CostType.BLOOD,
        cost_value="X",
        burn_option=True,
        trifle=True,
    )
    db.commit()
    read = CardRead.model_validate(card)
    assert read.category is CardCategory.LIBRARY
    assert (read.cost_type, read.cost_value) == (CostType.BLOOD, "X")
    assert read.burn_option is True and read.trifle is True
    assert read.clan is None and read.sect is None
    assert read.types == [] and read.discipline_links == []
    assert read.printings == [] and read.translations == []


def test_bundle_read_maps_the_product(db, world):
    read = BundleRead.model_validate(world.bundle)
    assert (read.code, read.name, read.size) == ("PS", "Followers of Set", 89)
    assert read.card_set_id == world.card_set.id


def test_bundle_content_lists_cards_and_copies(db, world):
    """La forme que le Lot 2 servira pour « contenu d'un produit ».

    Le service assemble les lignes depuis les occurrences de type précon du
    produit ; on vérifie ici que le schéma accepte ce que ce parcours produit,
    carte comprise.
    """
    lines = [
        BundleCardRead(
            card=CardSummary.model_validate(o.printing.card),
            copies=o.copies,
        )
        for o in world.bundle.card_occurrences
        if o.occurrence_type is PrintOccurrence.PRECON
    ]
    content = BundleContentRead(
        **BundleRead.model_validate(world.bundle).model_dump(), cards=lines
    )

    assert [(line.card.name, line.copies) for line in content.cards] == [
        ("Aabbt Kindred", 2)
    ]
    # Une ligne de contenu a tout ce qu'il faut pour alimenter le stock : il
    # n'y manque que la langue de l'exemplaire acheté.
    assert content.cards[0].card.id == world.card.id


def test_bundle_content_refuses_a_line_without_copies():
    with pytest.raises(ValidationError):
        BundleCardRead(
            card=CardSummary(id=1, vekn_id=1, name="X", category=CardCategory.LIBRARY),
            copies=0,
        )


def test_card_summary_is_a_strict_subset_of_card_read(db, world):
    assert set(CardSummary.model_fields) < set(CardRead.model_fields)
    assert issubclass(CardRead, CardSummary)
    summary = CardSummary.model_validate(world.card)
    assert summary.model_dump() == {
        key: value
        for key, value in CardRead.model_validate(world.card).model_dump().items()
        if key in CardSummary.model_fields
    }


def test_card_summary_of_a_card_without_clan(db):
    card = make_card(db, "Sans clan", CardCategory.LIBRARY)
    db.commit()
    assert CardSummary.model_validate(card).clan is None


def test_translation_read_from_orm(db, world):
    translation = db.get(CardTranslation, (world.card.id, "FR"))
    read = CardTranslationRead.model_validate(translation)
    assert read.language_code == "FR"


# --------------------------------------------------------------------------
# Collection et decks
# --------------------------------------------------------------------------


def test_card_copy_read_with_nested_card(db, world):
    read = CardCopyRead.model_validate(world.copy_en)
    assert (read.card_id, read.language_code) == (world.card.id, "EN")
    assert (read.quantity_owned, read.proxy_allowed) == (4, False)
    assert read.card is not None and read.card.name == "Aabbt Kindred"


def test_card_copy_read_of_a_proxy_only_entry(db, world):
    """0 possédé + proxy autorisé se lit tel quel (§11.2)."""
    read = CardCopyRead.model_validate(world.copy_fr)
    assert (read.language_code, read.quantity_owned, read.proxy_allowed) == (
        "FR",
        0,
        True,
    )


def test_deck_read_maps_columns_and_timestamps(db, world):
    read = DeckRead.model_validate(world.deck)
    assert read.name == "Ventrue Grinder"
    assert read.status is DeckStatus.ACTIVE
    assert read.created_on == date(2026, 1, 15)
    assert read.archetype == "Vote"
    assert read.notes is None
    assert isinstance(read.created_at, datetime)
    assert isinstance(read.updated_at, datetime)


def test_deck_read_does_not_carry_the_composition(db, world):
    assert "cards" not in DeckRead.model_fields
    assert "cards" in DeckDetailRead.model_fields


def test_deck_detail_read_maps_lines_with_their_card(db, world):
    read = DeckDetailRead.model_validate(world.deck)
    assert len(read.cards) == 1
    line = read.cards[0]
    assert isinstance(line, DeckCardRead)
    assert (line.card_id, line.language_code) == (world.card.id, "EN")
    assert (line.quantity, line.proxy_quantity) == (4, 0)
    assert line.card is not None and line.card.name == "Aabbt Kindred"


def test_deck_detail_read_keeps_one_line_per_language(db, world):
    """Le contrat expose la même carte en deux langues comme deux lignes."""
    db.add(
        DeckCard(
            deck_id=world.deck.id,
            card_id=world.card.id,
            language_code="FR",
            quantity=2,
            proxy_quantity=2,
        )
    )
    db.commit()
    db.refresh(world.deck)

    read = DeckDetailRead.model_validate(world.deck)
    by_language = {line.language_code: line for line in read.cards}
    assert set(by_language) == {"EN", "FR"}
    assert by_language["FR"].proxy_quantity == 2


def test_empty_deck_detail_has_no_cards(db):
    add_languages(db)
    deck = make_deck(db, "Vide")
    db.commit()
    assert DeckDetailRead.model_validate(deck).cards == []


def test_deck_legality_is_a_plain_output_schema():
    """`DeckLegality` porte les seuils pour que le front ne les redéfinisse pas."""
    read = DeckLegality.model_validate(
        {
            "deck_id": 1,
            "crypt_count": 11,
            "library_count": 58,
            "crypt_minimum": 12,
            "library_minimum": 60,
            "library_maximum": 90,
            "is_legal": False,
            "issues": ["crypt trop petite"],
        }
    )
    assert read.is_legal is False
    assert read.issues == ["crypt trop petite"]
    assert DeckLegality.model_validate(read.model_dump() | {"issues": []}).issues == []


# --------------------------------------------------------------------------
# Parties, tournois, participations
# --------------------------------------------------------------------------


def test_player_read(db, world):
    me = PlayerRead.model_validate(world.me)
    other = PlayerRead.model_validate(world.opponent)
    assert (me.name, me.is_me) == ("Moi", True)
    assert (other.name, other.is_me) == ("Adversaire", False)


def test_participation_read_of_my_result(db, world):
    read = ParticipationRead.model_validate(world.mine)
    assert read.game_id == world.game.id
    assert read.player_id == world.me.id
    assert read.deck_id == world.deck.id
    assert (read.seat, read.victory_points, read.game_win) == (3, 2.5, True)


def test_participation_read_of_an_adversary_is_mostly_empty(db, world):
    """§11.3 : deck, VP et GW d'un adversaire restent vides."""
    read = ParticipationRead.model_validate(world.theirs)
    assert read.seat == 1
    assert read.deck_id is None
    assert read.victory_points is None
    assert read.game_win is None


def test_game_read_maps_columns(db, world):
    read = GameRead.model_validate(world.game)
    assert read.played_at == datetime(2026, 2, 1, 14, 0)
    assert read.tournament_id == world.tournament.id
    assert read.venue_id == world.venue.id
    assert (read.round_number, read.round_type, read.player_count) == (
        1,
        RoundType.PRELIMINARY,
        5,
    )
    assert isinstance(read.created_at, datetime)


def test_game_detail_read_includes_the_whole_table(db, world):
    read = GameDetailRead.model_validate(world.game)
    assert sorted(p.player_id for p in read.participations) == sorted(
        [world.me.id, world.opponent.id]
    )
    assert all(isinstance(p, ParticipationRead) for p in read.participations)


def test_tournament_read_maps_columns(db, world):
    read = TournamentRead.model_validate(world.tournament)
    assert read.name == "Tournoi de test"
    assert read.start_date == date(2026, 2, 1)
    assert read.end_date is None
    assert read.deck_policy is DeckPolicy.MONO
    assert read.format is TournamentFormat.CONSTRUCTED
    assert (read.round_count, read.my_ranking) == (2, None)
    assert read.venue_id == world.venue.id


def test_tournament_detail_read_lists_its_games(db, world):
    read = TournamentDetailRead.model_validate(world.tournament)
    assert [g.id for g in read.games] == [world.game.id]
    assert isinstance(read.games[0], GameRead)


def test_tournament_json_dump_uses_enum_values(db, world):
    dumped = TournamentRead.model_validate(world.tournament).model_dump(mode="json")
    assert dumped["deck_policy"] == "mono"
    assert dumped["format"] == "constructed"
    assert dumped["start_date"] == "2026-02-01"


# --------------------------------------------------------------------------
# Propriétés communes des schémas de lecture
# --------------------------------------------------------------------------

READ_PAIRS = [
    pytest.param(Card, CardRead, set(), id="Card"),
    pytest.param(CardCopy, CardCopyRead, set(), id="CardCopy"),
    pytest.param(Deck, DeckRead, set(), id="Deck"),
    # `deck_id` est porté par le deck parent dans `DeckDetailRead.cards`.
    pytest.param(DeckCard, DeckCardRead, {"deck_id"}, id="DeckCard"),
    pytest.param(Player, PlayerRead, set(), id="Player"),
    pytest.param(Game, GameRead, set(), id="Game"),
    pytest.param(Tournament, TournamentRead, set(), id="Tournament"),
    pytest.param(Participation, ParticipationRead, set(), id="Participation"),
    pytest.param(Language, LanguageRead, set(), id="Language"),
    pytest.param(Clan, ClanRead, set(), id="Clan"),
    pytest.param(Discipline, DisciplineRead, set(), id="Discipline"),
    pytest.param(Sect, SectRead, set(), id="Sect"),
    pytest.param(CardType, CardTypeRead, set(), id="CardType"),
    pytest.param(CardSet, CardSetRead, set(), id="CardSet"),
    pytest.param(Venue, VenueRead, set(), id="Venue"),
    # `card_id` est porté par la carte parente dans `CardRead.translations`.
    pytest.param(
        CardTranslation, CardTranslationRead, {"card_id"}, id="CardTranslation"
    ),
]


@pytest.mark.parametrize(("model", "schema", "omitted"), READ_PAIRS)
def test_read_schema_exposes_every_column_of_its_model(model, schema, omitted):
    """Garde-fou de dérive : une colonne ajoutée au modèle doit être décidée.

    Une colonne `xxx_id` peut être remplacée par la relation imbriquée `xxx`
    (ex. `Card.clan_id` -> `CardRead.clan`). Toute autre absence doit figurer
    explicitement dans `omitted`.
    """
    fields = set(schema.model_fields)
    missing = {
        column.key
        for column in model.__table__.columns
        if column.key not in fields
        and not (column.key.endswith("_id") and column.key[: -len("_id")] in fields)
    }
    assert missing == omitted


@pytest.mark.parametrize(("model", "schema", "omitted"), READ_PAIRS)
def test_read_schema_has_no_field_unknown_to_the_model(model, schema, omitted):
    """Réciproque : chaque champ de lecture vient du modèle (colonne ou relation)."""
    attributes = set(model.__mapper__.attrs.keys())
    assert set(schema.model_fields) <= attributes


def test_every_read_schema_reads_from_attributes():
    import app.schemas.catalog as catalog
    import app.schemas.collection as collection
    import app.schemas.play as play
    import app.schemas.reference as reference

    for module in (catalog, collection, play, reference):
        for name, obj in vars(module).items():
            if name.endswith(("Read", "Summary")) and isinstance(obj, type):
                assert issubclass(obj, ReadModel), name
                assert obj.model_config["from_attributes"] is True, name


def test_read_schemas_ignore_orm_attributes_they_do_not_declare(db, world):
    """Contrairement aux schémas d'écriture, la lecture n'est pas `forbid`."""
    assert ReadModel.model_config.get("extra") != "forbid"
    dumped = PlayerRead.model_validate(world.me).model_dump()
    assert set(dumped) == {"id", "name", "is_me"}


def test_read_schema_fails_loudly_when_a_required_attribute_is_missing():
    class Incomplete:
        id = 1
        name = "sans is_me"

    with pytest.raises(ValidationError) as excinfo:
        PlayerRead.model_validate(Incomplete())
    assert excinfo.value.errors()[0]["loc"] == ("is_me",)


def test_read_schema_rejects_an_unflushed_object_with_unset_defaults():
    """Un objet jamais inséré n'a pas encore ses défauts (`advanced` = None).

    Les schémas de lecture sont faits pour des objets chargés depuis la base ;
    le service doit faire un `flush`/`refresh` avant de sérialiser une création.
    """
    card = Card(vekn_id=1, name="Neuve", category=CardCategory.CRYPT)
    with pytest.raises(ValidationError):
        CardSummary.model_validate(card)


def test_all_schemas_produce_a_json_schema():
    """Le Lot 2 les branchera à l'OpenAPI : aucune ne doit casser la génération."""
    import app.schemas.catalog as catalog
    import app.schemas.collection as collection
    import app.schemas.play as play
    import app.schemas.reference as reference

    checked = 0
    for module in (catalog, collection, play, reference):
        for obj in vars(module).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseModel)
                and obj.__module__ == module.__name__
            ):
                assert obj.model_json_schema()["type"] == "object"
                checked += 1
    assert checked >= 30


def test_read_of_copies_and_lines_survives_a_second_language(db):
    """Même carte, deux langues : deux `CardCopyRead` distincts, clé composite."""
    add_languages(db)
    card = make_card(db)
    make_copy(db, card, "EN", quantity_owned=1)
    make_copy(db, card, "FR", quantity_owned=2)
    db.commit()
    reads = [
        CardCopyRead.model_validate(copy)
        for copy in db.query(CardCopy).order_by(CardCopy.language_code)
    ]
    assert [(r.language_code, r.quantity_owned) for r in reads] == [
        ("EN", 1),
        ("FR", 2),
    ]
