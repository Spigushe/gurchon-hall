"""Import rejouable du catalogue krcg (CLAUDE.md §11, décision 1).

Deux sources depuis le lot Chercher (P15, amendement de la décision 1) :

* krcg, les deux fichiers JSON qu'il publie (licence MIT), qui font tout le
  catalogue. L'`id` krcg est l'identifiant VEKN, clé naturelle de `card` ;
* `vteslibmeta.csv` du dépôt vtescsv, pour une seule donnée que krcg ne publie
  pas : l'exigence d'une carte de bibliothèque envers le vampire qui la joue
  (`card.library_requirement`, recopie brute). Jointure par identifiant VEKN.
  Le dépôt ne déclare aucune licence ; krcg en dérive déjà. Facultative pour
  l'import : sans elle (`library_meta=None`), la colonne n'est pas touchée.
  Une ligne dont l'identifiant est inconnu, qui vise une carte de crypte, ou
  dont le nom diverge de celui de krcg est signalée au rapport
  (`ImportReport.library_meta_issues`), sans faire échouer l'import ; la
  dernière est appliquée quand même, l'identifiant faisant foi. Une carte sans
  ligne dans le fichier n'a pas d'exigence.

La secte d'une carte de crypte, que krcg ne publie pas non plus, est dérivée de
son texte (`vtes_rules.crypt_sect`, P13) ; un vampire dont le texte ne commence
pas par une secte connue est signalé (`ImportReport.unknown_sect_cards`).

**Rejouable** : l'import est un *upsert* de bout en bout, à rejouer chaque fois
que krcg publie du nouveau (traductions, rééditions, cartes récentes).

* une carte connue est mise à jour, jamais dupliquée ; ses liens (types,
  disciplines) et ses impressions sont alignés sur la source ;
* les occurrences d'une impression sont réécrites en bloc ;
* les traductions sont fusionnées : le repli sur le nom anglais est celui de
  l'affichage, l'import ne supprime donc jamais une traduction déjà connue ;
* une carte absente de la source n'est **pas** supprimée — des exemplaires ou
  des decks peuvent la référencer ;
* tout est fait dans une seule transaction : un fichier corrompu ne laisse pas
  un catalogue à moitié importé.

La date d'entrée en légalité (`legal` de krcg) alimente `Card.legal_from`, mise à
jour au rejeu. La liste krcg paraît après la sortie commerciale : la règle
s'applique telle quelle (carte pas encore légale = deck illégal), et une carte
sans date est tenue pour légale.

Non importés par choix (§11) : `rulings`, `name_variants`, `variants`, `formats`.

La logique est pure vis-à-vis du réseau : `import_catalog` reçoit les données
déjà parsées (facile à tester contre un fixture) ; `fetch_krcg_sources` et
`fetch_library_meta` font le téléchargement, appelés par
`scripts/import_catalog.py`, et `parse_library_meta` lit le CSV.

**Identifiants stables au rejeu** (Lot 4, D2/D2a) : `card_set` et
`card_printing` sont désormais référencés par le stock (`CardCopy.card_set_id`,
FK composite vers `card_printing`). `_sync_card_sets` et `_sync_printings`
réutilisent donc toujours l'instance existante (clé `abbrev` pour l'extension,
`card_set_id` pour l'impression) plutôt que d'en recréer une : un rejeu ne
change ni l'un ni l'autre.

**Extension tampon** (D2b, D2c) : une carte publiée sans aucune impression
reçoit une impression sous une extension tampon (`card_set.is_placeholder`),
créée une seule fois pour tout le catalogue. `ImportReport.placeholder_cards`
liste ces cartes ; `scripts/import_catalog.py` les affiche en avertissement,
sans faire échouer l'import. Au rejeu, une fois l'impression réelle publiée
par la source, l'impression tampon est retirée si le stock ne la référence
pas, et gardée sinon — la carte apparaît alors dans
`ImportReport.reassign_cards` (« à réattribuer »). C'est la seule suppression
que l'import s'autorise, limitée à ce qu'il a lui-même fabriqué.
"""

import csv
import io
import json
import re
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardCopy,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    CardSet,
    CardTranslation,
    CardType,
    CardTypeLink,
    Clan,
    CostType,
    DeckCard,
    Discipline,
    DisciplineRequirement,
    Language,
    PrintOccurrence,
    Sect,
)
from app.services.vtes_rules import crypt_sect

KRCG_SOURCES: dict[str, str] = {
    "vtes.json": "https://static.krcg.org/data/v5/vtes.json",
    "expansions.json": "https://static.krcg.org/data/v5/expansions.json",
}

# Seconde source (lot Chercher, P15). Figée sur la branche `main` du dépôt
# officiel, comme krcg l'est sur `v5` : un changement de forme du fichier se
# voit à la lecture de l'en-tête (`parse_library_meta`), pas en silence.
LIBRARY_META_FILE = "vteslibmeta.csv"
LIBRARY_META_URL = (
    "https://raw.githubusercontent.com/GiottoVerducci/vtescsv/main/vteslibmeta.csv"
)
LIBRARY_META_HEADER = ("Id", "Name", "Requirement")

# krcg ne publie que les codes trois lettres des disciplines ; le nom complet
# est celui du règlement. Un code inconnu (discipline future) retombe sur le
# code en majuscules plutôt que de faire échouer l'import.
DISCIPLINE_NAMES: dict[str, str] = {
    "abo": "Abombwe",
    "ani": "Animalism",
    "aus": "Auspex",
    "cel": "Celerity",
    "chi": "Chimerstry",
    "dai": "Daimoinon",
    "def": "Defense",
    "dem": "Dementation",
    "dom": "Dominate",
    "fli": "Flight",
    "for": "Fortitude",
    "inn": "Innocence",
    "jud": "Judgment",
    "mal": "Maleficia",
    "mar": "Martyrdom",
    "mel": "Melpominee",
    "myt": "Mytherceria",
    "nec": "Necromancy",
    "obe": "Obeah",
    "obf": "Obfuscate",
    "obl": "Oblivion",
    "obt": "Obtenebration",
    "pot": "Potence",
    "pre": "Presence",
    "pro": "Protean",
    "qui": "Quietus",
    "red": "Redemption",
    "san": "Sanguinus",
    "ser": "Serpentis",
    "spi": "Spiritus",
    "str": "Striga",
    "tem": "Temporis",
    "tha": "Thaumaturgy",
    "thn": "Thanatosis",
    "val": "Valeren",
    "ven": "Vengeance",
    "vic": "Vicissitude",
    "vis": "Visceratika",
    "viz": "Visions",
}

# Extension tampon (Lot 4, décision D2b) : abréviation réservée, improbable
# côté krcg (les codes réels font deux à six caractères sans souligné).
PLACEHOLDER_CARD_SET_ABBREV = "_placeholder_"
PLACEHOLDER_CARD_SET_NAME = "Extension tampon (carte sans impression connue)"


@dataclass(frozen=True, slots=True)
class PlaceholderCard:
    """Une carte signalée par l'import (D2c, puis secte inconnue au lot
    Chercher) : identifiant VEKN et nom."""

    vekn_id: int
    name: str


@dataclass(frozen=True, slots=True)
class LibraryMetaRow:
    """Une ligne de `vteslibmeta.csv`, telle que lue (champs rognés)."""

    row_id: str
    name: str
    requirement: str


class LibraryMetaIssue:
    """Motifs d'un écart entre `vteslibmeta.csv` et le catalogue krcg."""

    UNKNOWN_ID = "unknown_id"
    """Identifiant inconnu du catalogue (ou illisible) : ligne ignorée."""
    CRYPT_CARD = "crypt_card"
    """La ligne vise une carte de crypte : ignorée, une exigence de
    bibliothèque n'a pas de sens pour elle."""
    NAME_MISMATCH = "name_mismatch"
    """Le nom diverge de celui de krcg : la ligne est appliquée, l'identifiant
    VEKN faisant foi, et signalée pour qu'on vérifie."""
    DUPLICATE_ID = "duplicate_id"
    """Second exemplaire d'un identifiant déjà lu : ignoré, le premier reste."""


@dataclass(frozen=True, slots=True)
class LibraryMetaReport:
    """Une ligne du CSV signalée par l'import, sans le faire échouer."""

    row_id: str
    name: str
    reason: str
    catalog_name: str | None = None


@dataclass
class ImportReport:
    """Ce que l'import a fait, pour l'affichage en ligne de commande."""

    cards_created: int = 0
    cards_updated: int = 0
    card_sets: int = 0
    bundles: int = 0
    translations: int = 0
    # D2c : cartes rangées sous l'extension tampon faute d'impression connue
    # dans la source, et cartes qui en gardent une bien qu'une impression
    # réelle soit désormais connue (le stock l'utilise encore : « à
    # réattribuer » côté utilisateur).
    placeholder_cards: list[PlaceholderCard] = field(default_factory=list)
    reassign_cards: list[PlaceholderCard] = field(default_factory=list)
    # Lot Chercher (P13) : cartes de crypte classées par secte, et vampires
    # dont le texte ne commence pas par une secte connue (secte laissée vide).
    crypt_sects: dict[str, int] = field(default_factory=dict)
    unknown_sect_cards: list[PlaceholderCard] = field(default_factory=list)
    # Lot Chercher (P15) : `None` quand `vteslibmeta.csv` n'a pas été fourni
    # (colonne laissée telle quelle), sinon le nombre de cartes qui ont reçu
    # une exigence ; et les lignes signalées.
    library_requirements: int | None = None
    library_meta_issues: list[LibraryMetaReport] = field(default_factory=list)

    @property
    def cards(self) -> int:
        return self.cards_created + self.cards_updated


def fetch_krcg_sources(
    urls: dict[str, str] = KRCG_SOURCES, timeout: float = 60.0
) -> tuple[list[dict], list[dict]]:
    """Télécharge `vtes.json` et `expansions.json`."""
    parsed: dict[str, Any] = {}
    for name, url in urls.items():
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310
            parsed[name] = json.load(response)
    return parsed["vtes.json"], parsed["expansions.json"]


def fetch_library_meta(url: str = LIBRARY_META_URL, timeout: float = 60.0) -> str:
    """Télécharge `vteslibmeta.csv` et le rend en texte (UTF-8, BOM retiré)."""
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310
        return response.read().decode("utf-8-sig")


def parse_library_meta(text: str) -> list[LibraryMetaRow]:
    """Lit `vteslibmeta.csv` : en-tête `"Id","Name","Requirement"` exigé.

    Un en-tête différent lève `ValueError` avant que l'import ne touche la
    base : le fichier est suivi sur une branche, pas sur une version, et un
    changement de forme doit se voir. Une ligne vide est sautée ; une ligne
    qui n'a pas trois champs aussi, sous un identifiant illisible, pour être
    signalée comme inconnue.
    """
    reader = csv.reader(io.StringIO(text.removeprefix("﻿")))
    header = tuple(next(reader, ()))
    if header != LIBRARY_META_HEADER:
        raise ValueError(
            f"{LIBRARY_META_FILE} : en-tête inattendu {header!r}, "
            f"{LIBRARY_META_HEADER!r} attendu."
        )
    return [_library_meta_row(fields) for fields in reader if any(fields)]


def _library_meta_row(fields: list[str]) -> LibraryMetaRow:
    if len(fields) != len(LIBRARY_META_HEADER):
        return LibraryMetaRow(row_id="", name=",".join(fields), requirement="")
    row_id, name, requirement = (value.strip() for value in fields)
    return LibraryMetaRow(row_id=row_id, name=name, requirement=requirement)


_VEKN_ID = re.compile(r"[0-9]{1,9}")
"""`[0-9]` et non `\\d`, qui couvre les chiffres Unicode ; neuf chiffres au
plus, donc sous `MAX_DB_INT`."""

_TRAILING_ARTICLE = re.compile(r"^(?P<rest>.+), The$")


def same_card_name(catalog_name: str, csv_name: str) -> bool:
    """Le nom de vtescsv désigne-t-il la carte de krcg ? vtescsv range
    l'article en fin de nom (« Embrace, The »), krcg le laisse en tête (« The
    Embrace ») : 18 cartes au 2026-11-03, qui ne sont pas des écarts."""
    match = _TRAILING_ARTICLE.match(csv_name)
    expected = f"The {match['rest']}" if match else csv_name
    return expected == catalog_name


def _date_or_none(value: str | None) -> date | None:
    """Date ISO complète, ou `None` : une date krcg partielle (« 2020-01 ») ou
    vide vaut « inconnue » et ne doit pas faire échouer tout l'import.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _text_or_none(value: str | None) -> str | None:
    return value or None


class _References:
    """Tables de référence ouvertes (clans, disciplines, types, langues).

    Chargées une fois, complétées à la demande : une valeur nouvelle chez krcg
    devient une ligne, pas une erreur.
    """

    def __init__(self, db: Session) -> None:
        self._db = db
        self.clans = {c.name: c for c in db.scalars(select(Clan))}
        self.disciplines = {d.abbrev: d for d in db.scalars(select(Discipline))}
        self.card_types = {t.name: t for t in db.scalars(select(CardType))}
        self.languages = {lang.code: lang for lang in db.scalars(select(Language))}
        self.sects = {s.name: s for s in db.scalars(select(Sect))}

    def sect(self, name: str) -> Sect:
        if name not in self.sects:
            self.sects[name] = Sect(name=name)
            self._db.add(self.sects[name])
        return self.sects[name]

    def clan(self, name: str) -> Clan:
        if name not in self.clans:
            self.clans[name] = Clan(name=name)
            self._db.add(self.clans[name])
        return self.clans[name]

    def discipline(self, code: str) -> Discipline:
        abbrev = code.lower()
        if abbrev not in self.disciplines:
            name = DISCIPLINE_NAMES.get(abbrev, code.upper())
            self.disciplines[abbrev] = Discipline(name=name, abbrev=abbrev)
            self._db.add(self.disciplines[abbrev])
        return self.disciplines[abbrev]

    def card_type(self, name: str) -> CardType:
        if name not in self.card_types:
            self.card_types[name] = CardType(name=name)
            self._db.add(self.card_types[name])
        return self.card_types[name]

    def language(self, code: str) -> Language:
        if code not in self.languages:
            self.languages[code] = Language(code=code, label=code, sort_order=50)
            self._db.add(self.languages[code])
        return self.languages[code]


def _sync_card_sets(
    db: Session, expansions: list[dict], report: ImportReport
) -> dict[str, CardSet]:
    """Extensions, clés sur `abbrev` (l'`id` krcg n'est pas unique, cf. §6)."""
    card_sets = {s.abbrev: s for s in db.scalars(select(CardSet))}
    for raw in expansions:
        card_set = card_sets.get(raw["code"])
        if card_set is None:
            card_set = card_sets[raw["code"]] = CardSet(abbrev=raw["code"])
            db.add(card_set)
        card_set.full_name = _text_or_none(raw.get("name"))
        card_set.release_date = _date_or_none(raw.get("release_date"))
        card_set.company = _text_or_none(raw.get("company"))
        report.card_sets += 1
    db.flush()
    return card_sets


def _card_set_for(
    code: str, card_sets: dict[str, CardSet], db: Session
) -> CardSet:
    """L'extension `code`, créée à la volée si `expansions.json` l'ignore.

    Comme pour les produits : on garde le lien plutôt que de perdre la carte ;
    les autres champs restent nuls (un rejeu les complétera si krcg les publie).
    """
    card_set = card_sets.get(code)
    if card_set is None:
        card_set = card_sets[code] = CardSet(abbrev=code)
        db.add(card_set)
        db.flush()
    return card_set


def _sync_bundles(
    db: Session,
    expansions: list[dict],
    card_sets: dict[str, CardSet],
    report: ImportReport,
) -> dict[tuple[int, str], Bundle]:
    """Produits, clés sur (extension, code) ; le code peut être vide."""
    bundles = {(b.card_set_id, b.code): b for b in db.scalars(select(Bundle))}
    for raw_set in expansions:
        card_set = card_sets[raw_set["code"]]
        for raw in raw_set.get("bundles", {}).values():
            key = (card_set.id, raw["code"])
            bundle = bundles.get(key)
            if bundle is None:
                bundle = bundles[key] = Bundle(card_set_id=card_set.id, code=key[1])
                db.add(bundle)
            bundle.name = _text_or_none(raw.get("name"))
            # `size >= 1` en base : un 0 déclaratif vaut « inconnu ».
            bundle.size = raw.get("size") or None
            bundle.release_date = _date_or_none(raw.get("release_date"))
            report.bundles += 1
    db.flush()
    return bundles


def _card_fields(raw: dict, refs: _References) -> dict[str, Any]:
    is_crypt = raw["kind"] == "Crypt"
    cost = raw.get("cost")
    requirement = raw.get("discipline_requirement") or {}
    return {
        "name": raw["printed_name"],
        "category": CardCategory.CRYPT if is_crypt else CardCategory.LIBRARY,
        "clan": refs.clan(raw["clan"]) if raw.get("clan") else None,
        "capacity": raw.get("capacity"),
        "group_code": raw.get("group"),
        "advanced": raw.get("advanced", False),
        "title": _text_or_none(raw.get("title")),
        # Une valeur « X » est textuelle : `cost_value` est une chaîne.
        "cost_type": CostType(cost["type"].lower()) if cost else None,
        "cost_value": str(cost["value"]) if cost else None,
        "burn_option": raw.get("burn_option", False),
        "trifle": raw.get("trifle", False),
        "clan_requirement": ", ".join(raw.get("clan_requirement") or []) or None,
        "path_requirement": ", ".join(raw.get("path_requirement") or []) or None,
        # « Mono » sans discipline = pas de prérequis : le modèle le veut nul.
        "discipline_requirement": (
            DisciplineRequirement(requirement["type"].lower())
            if requirement.get("disciplines")
            else None
        ),
        "path": _text_or_none(raw.get("path")),
        "card_text": _text_or_none(raw.get("text")),
        "flavor_text": _text_or_none(raw.get("flavor")),
        "artist": ", ".join(raw.get("artists") or []) or None,
        "banned_on": _date_or_none(raw.get("banned")),
        "legal_from": _date_or_none(raw.get("legal")),
        "image_url": _text_or_none(raw.get("url")),
    }


def _sync_links(card: Card, raw: dict, refs: _References) -> None:
    """Aligne types et disciplines de la carte sur la source."""
    wanted_types = {refs.card_type(name) for name in raw["types"]}
    kept = []
    for link in card.type_links:
        if link.card_type in wanted_types:
            wanted_types.discard(link.card_type)
            kept.append(link)
    kept.extend(CardTypeLink(card_type=card_type) for card_type in wanted_types)
    card.type_links = kept

    # Crypt : la casse du code porte le niveau (majuscules = supérieur).
    # Library : les disciplines requises, toujours en minuscules.
    if raw["kind"] == "Crypt":
        codes = raw.get("disciplines") or []
    else:
        codes = (raw.get("discipline_requirement") or {}).get("disciplines") or []
    wanted = {}
    for code in codes:
        wanted[refs.discipline(code)] = code.isupper()
    kept_disciplines = []
    for link in card.discipline_links:
        if link.discipline in wanted:
            link.superior = wanted.pop(link.discipline)
            kept_disciplines.append(link)
    kept_disciplines.extend(
        CardDisciplineLink(discipline=discipline, superior=superior)
        for discipline, superior in wanted.items()
    )
    card.discipline_links = kept_disciplines


def _sync_sect(card: Card, raw: dict, refs: _References, report: ImportReport) -> None:
    """Secte dérivée du texte pour une carte de crypte (P13), nulle sinon."""
    if raw["kind"] != "Crypt":
        card.sect = None
        return
    name = crypt_sect(raw.get("text"), imbued="Imbued" in raw["types"])
    if name is None:
        card.sect = None
        report.unknown_sect_cards.append(
            PlaceholderCard(vekn_id=card.vekn_id, name=card.name)
        )
        return
    card.sect = refs.sect(name)
    report.crypt_sects[name] = report.crypt_sects.get(name, 0) + 1


def _library_meta_verdict(
    row: LibraryMetaRow, cards: dict[int, Card], seen: set[int]
) -> tuple[Card | None, LibraryMetaReport | None]:
    """La carte que la ligne alimente (ou aucune), et l'écart à signaler."""
    vekn_id = int(row.row_id) if _VEKN_ID.fullmatch(row.row_id) else None
    card = cards.get(vekn_id) if vekn_id is not None else None
    if card is None:
        return None, _issue(row, LibraryMetaIssue.UNKNOWN_ID)
    if card.vekn_id in seen:
        return None, _issue(row, LibraryMetaIssue.DUPLICATE_ID, card)
    seen.add(card.vekn_id)
    if card.category is CardCategory.CRYPT:
        return None, _issue(row, LibraryMetaIssue.CRYPT_CARD, card)
    if not same_card_name(card.name, row.name):
        return card, _issue(row, LibraryMetaIssue.NAME_MISMATCH, card)
    return card, None


def _issue(
    row: LibraryMetaRow, reason: str, card: Card | None = None
) -> LibraryMetaReport:
    return LibraryMetaReport(
        row_id=row.row_id,
        name=row.name,
        reason=reason,
        catalog_name=card.name if card is not None else None,
    )


def _sync_library_requirements(
    cards: dict[int, Card], rows: list[LibraryMetaRow], report: ImportReport
) -> None:
    """Aligne `card.library_requirement` sur `vteslibmeta.csv` (P15).

    Toute carte du catalogue est revue : celle qu'une ligne retenue désigne
    reçoit sa valeur brute, les autres n'ont plus d'exigence. Un rejeu
    réécrit les mêmes valeurs, sans doublon possible (une colonne par carte).
    """
    wanted: dict[int, str | None] = {}
    seen: set[int] = set()
    for row in rows:
        card, issue = _library_meta_verdict(row, cards, seen)
        if issue is not None:
            report.library_meta_issues.append(issue)
        if card is not None:
            wanted[card.vekn_id] = row.requirement or None
    for card in cards.values():
        card.library_requirement = wanted.get(card.vekn_id)
    report.library_requirements = sum(1 for value in wanted.values() if value)


def _occurrences(
    raw_print: dict,
    card_set: CardSet,
    bundles: dict[tuple[int, str], Bundle],
    db: Session,
) -> list[CardPrintingOccurrence]:
    result = []
    for raw in raw_print["occurrences"]:
        kind = PrintOccurrence(raw["type"].lower())
        occurrence = CardPrintingOccurrence(occurrence_type=kind)
        if kind is PrintOccurrence.RARITY:
            occurrence.frequency = _text_or_none(raw.get("frequency"))
            occurrence.multiplier = raw.get("multiplier") or None
        elif kind is PrintOccurrence.PRECON:
            code = raw.get("bundle") or ""
            bundle = bundles.get((card_set.id, code))
            if bundle is None:
                # Précon cité mais absent de expansions.json : on garde le lien
                # plutôt que de perdre le contenu du produit.
                bundle = bundles[(card_set.id, code)] = Bundle(
                    card_set_id=card_set.id, code=code
                )
                db.add(bundle)
                db.flush()
            # Par la clé et non par la relation : `occurrence.bundle = ...` la
            # ferait entrer dans la session (backref) avant son impression.
            occurrence.bundle_id = bundle.id
            occurrence.copies = raw.get("copies") or None
        else:
            occurrence.released_on = _date_or_none(raw.get("date"))
        result.append(occurrence)
    return result


def _placeholder_card_set(db: Session, card_sets: dict[str, CardSet]) -> CardSet:
    """L'extension tampon (D2b), créée au besoin — une seule pour tout le
    catalogue, retrouvée par son marqueur plutôt que recréée à chaque import."""
    card_set = card_sets.get(PLACEHOLDER_CARD_SET_ABBREV)
    if card_set is not None:
        return card_set
    card_set = db.scalars(
        select(CardSet).where(CardSet.is_placeholder.is_(True))
    ).one_or_none()
    if card_set is None:
        card_set = CardSet(
            abbrev=PLACEHOLDER_CARD_SET_ABBREV,
            full_name=PLACEHOLDER_CARD_SET_NAME,
            is_placeholder=True,
        )
        db.add(card_set)
        db.flush()
    card_sets[PLACEHOLDER_CARD_SET_ABBREV] = card_set
    return card_set


def _sync_printings(
    db: Session,
    card: Card,
    raw: dict,
    card_sets: dict[str, CardSet],
    bundles: dict[tuple[int, str], Bundle],
    report: ImportReport,
) -> None:
    existing = {p.card_set_id: p for p in card.printings}
    kept = []
    for raw_print in raw["prints"]:
        card_set = _card_set_for(raw_print["set"]["code"], card_sets, db)
        printing = existing.get(card_set.id) or CardPrinting(card_set=card_set)
        printing.image_url = _text_or_none(raw_print.get("url"))
        printing.occurrences = _occurrences(raw_print, card_set, bundles, db)
        kept.append(printing)

    if kept:
        # Des impressions réelles existent. Une éventuelle impression tampon
        # posée par un import précédent (D2b) n'a alors plus lieu d'être — la
        # seule suppression que l'import s'autorise (§11), limitée à ce qu'il
        # a lui-même fabriqué — sauf si le stock la référence encore : dans ce
        # cas on la garde et on signale la carte « à réattribuer » (D2c).
        placeholder = next(
            (p for p in card.printings if p.card_set.is_placeholder and p not in kept),
            None,
        )
        if placeholder is not None:
            # Depuis le Lot 4b (piste A1,
            # `docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md`),
            # une ligne de deck peut référencer une impression sans
            # passer par une entrée de collection (ligne tout-proxy, `card_copy`
            # absente) : la compter aussi, sinon l'import supprimerait une
            # impression tampon encore utilisée par un deck et échouerait par
            # `IntegrityError`.
            still_used_copies = db.scalar(
                select(func.count())
                .select_from(CardCopy)
                .where(
                    CardCopy.card_id == card.id,
                    CardCopy.card_set_id == placeholder.card_set_id,
                )
            )
            still_used_deck_cards = db.scalar(
                select(func.count())
                .select_from(DeckCard)
                .where(
                    DeckCard.card_id == card.id,
                    DeckCard.card_set_id == placeholder.card_set_id,
                )
            )
            still_used = still_used_copies + still_used_deck_cards
            if still_used:
                kept.append(placeholder)
                report.reassign_cards.append(
                    PlaceholderCard(vekn_id=card.vekn_id, name=card.name)
                )
            # sinon : ne pas la rajouter à `kept` suffit à la faire disparaître
            # à l'affectation `card.printings = kept` ci-dessous (delete-orphan).
    else:
        # Aucune impression connue de la source (D2b) : extension tampon,
        # créée au besoin, avec une impression tampon pour cette carte.
        placeholder_set = _placeholder_card_set(db, card_sets)
        placeholder = existing.get(placeholder_set.id) or CardPrinting(
            card_set=placeholder_set
        )
        placeholder.occurrences = []
        kept.append(placeholder)
        report.placeholder_cards.append(
            PlaceholderCard(vekn_id=card.vekn_id, name=card.name)
        )

    card.printings = kept


def _sync_translations(
    card: Card, raw: dict, refs: _References, report: ImportReport
) -> None:
    existing = {t.language_code: t for t in card.translations}
    for lang, raw_tr in (raw.get("i18n") or {}).items():
        code = lang.upper()
        refs.language(code)
        translation = existing.get(code)
        if translation is None:
            translation = CardTranslation(language_code=code)
            card.translations.append(translation)
        translation.name = raw_tr["name"]
        translation.card_text = _text_or_none(raw_tr.get("text"))
        translation.flavor_text = _text_or_none(raw_tr.get("flavor"))
        translation.image_url = _text_or_none(raw_tr.get("url"))
        report.translations += 1


def import_catalog(
    db: Session,
    vtes: list[dict],
    expansions: list[dict],
    library_meta: list[LibraryMetaRow] | None = None,
) -> ImportReport:
    """Importe (ou met à jour) le catalogue, en une seule transaction.

    `library_meta` : lignes de `vteslibmeta.csv` (`parse_library_meta`). Sans
    elles, les exigences déjà en base ne sont pas touchées : un import krcg
    seul ne les efface pas.
    """
    report = ImportReport()
    try:
        refs = _References(db)
        card_sets = _sync_card_sets(db, expansions, report)
        bundles = _sync_bundles(db, expansions, card_sets, report)

        existing = {
            card.vekn_id: card
            for card in db.scalars(
                select(Card).options(
                    selectinload(Card.type_links).selectinload(CardTypeLink.card_type),
                    selectinload(Card.discipline_links).selectinload(
                        CardDisciplineLink.discipline
                    ),
                    # Les occurrences aussi, sinon un rejeu les charge une
                    # impression à la fois (elles sont réécrites en bloc).
                    selectinload(Card.printings).selectinload(
                        CardPrinting.occurrences
                    ),
                    selectinload(Card.translations),
                )
            )
        }
        for raw in vtes:
            card = existing.get(raw["id"])
            created = card is None
            if created:
                card = existing[raw["id"]] = Card(vekn_id=raw["id"])
            for field, value in _card_fields(raw, refs).items():
                setattr(card, field, value)
            if created:
                # Ajoutée une fois ses colonnes obligatoires renseignées : un
                # flush automatique ne doit jamais voir une carte sans nom.
                db.add(card)
                report.cards_created += 1
            else:
                report.cards_updated += 1
            _sync_sect(card, raw, refs, report)
            _sync_links(card, raw, refs)
            _sync_printings(db, card, raw, card_sets, bundles, report)
            _sync_translations(card, raw, refs, report)
        if library_meta is not None:
            _sync_library_requirements(existing, library_meta, report)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return report
