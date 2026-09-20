"""Import rejouable du catalogue krcg (CLAUDE.md §11, décision 1).

Source unique : les deux fichiers JSON publiés par krcg (licence MIT). L'`id`
krcg est l'identifiant VEKN, clé naturelle de `card`.

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
La sect n'est pas fournie par krcg (`Card.sect_id` reste nul).

La logique est pure vis-à-vis du réseau : `import_catalog` reçoit les données
déjà parsées (facile à tester contre un fixture) ; `fetch_krcg_sources` fait le
téléchargement, appelé par `scripts/import_catalog.py`.
"""

import json
import urllib.request
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    CardSet,
    CardTranslation,
    CardType,
    CardTypeLink,
    Clan,
    CostType,
    Discipline,
    DisciplineRequirement,
    Language,
    PrintOccurrence,
)

KRCG_SOURCES: dict[str, str] = {
    "vtes.json": "https://static.krcg.org/data/v5/vtes.json",
    "expansions.json": "https://static.krcg.org/data/v5/expansions.json",
}

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


@dataclass
class ImportReport:
    """Ce que l'import a fait, pour l'affichage en ligne de commande."""

    cards_created: int = 0
    cards_updated: int = 0
    card_sets: int = 0
    bundles: int = 0
    translations: int = 0

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


def _sync_printings(
    card: Card,
    raw: dict,
    card_sets: dict[str, CardSet],
    bundles: dict[tuple[int, str], Bundle],
    db: Session,
) -> None:
    existing = {p.card_set_id: p for p in card.printings}
    kept = []
    for raw_print in raw["prints"]:
        card_set = _card_set_for(raw_print["set"]["code"], card_sets, db)
        printing = existing.get(card_set.id) or CardPrinting(card_set=card_set)
        printing.image_url = _text_or_none(raw_print.get("url"))
        printing.occurrences = _occurrences(raw_print, card_set, bundles, db)
        kept.append(printing)
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
    db: Session, vtes: list[dict], expansions: list[dict]
) -> ImportReport:
    """Importe (ou met à jour) le catalogue, en une seule transaction."""
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
            _sync_links(card, raw, refs)
            _sync_printings(card, raw, card_sets, bundles, db)
            _sync_translations(card, raw, refs, report)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return report
