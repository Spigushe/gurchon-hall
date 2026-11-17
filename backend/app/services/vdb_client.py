"""Lecture d'un deck chez VDB, par son identifiant (Lot 9, P3, A7).

VDB (`vdb.im`, `github.com/smeea/vdb`) sert un deck à
`https://vdb.im/api/deck/<id>`, sans connexion. Cette API **n'est pas
documentée** : tout ce que le projet en suppose tient dans ce module, seul
endroit à reprendre si elle change. La route `GET /vdb/decks/{vdb_deck_id}`
(`app.routers.vdb`) ne fait que traduire ses deux erreurs en 404 et 502.

C'est le premier appel sortant pendant une requête. Garde-fous :

- **adresse fixée** : hôte et chemin sont écrits ici, l'identifiant suit le
  motif fermé `VDB_DECK_ID_PATTERN` (revérifié ici, pas seulement par la
  route) et aucune redirection n'est suivie, si bien qu'aucun appel ne peut
  joindre une autre adresse ;
- **délai** de 10 s, **taille** de la réponse bornée avant la lecture du JSON ;
- **forme vérifiée** : une réponse qui n'a pas la forme relevée le 2026-11-13
  (fixtures `frontend/tests/fixtures/vdb/*-api.json`) est une réponse
  inattendue (`VdbUnavailableError`, 502), jamais relayée à moitié.

La lecture réseau est une fonction injectable (`VdbFetcher`) : les tests la
remplacent et **aucun test ne joint vdb.im**. Pour les e2e contre le vrai back,
`VDB_STUB_DIR` remplace l'appel par la lecture d'un fichier
`<VDB_STUB_DIR>/<id>.json` (`:` écrit `_` dans le nom de fichier) ; un fichier
absent vaut un deck inconnu. Réglage de test, jamais posé en production.

`urllib` plutôt que `httpx`, comme l'import du catalogue
(`services/catalog_import.py`) : `httpx` n'est qu'une dépendance de
développement.
"""

import http.client
import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.schemas.base import MAX_DB_INT
from app.schemas.vdb import VDB_DECK_ID_PATTERN, VdbDeckCardRead, VdbDeckRead

VDB_API_DECK_URL = "https://vdb.im/api/deck/"
"""Préfixe fixe de l'adresse lue ; l'identifiant s'y ajoute tel quel."""

VDB_TIMEOUT_SECONDS = 10.0

VDB_MAX_RESPONSE_BYTES = 256 * 1024
"""Taille au-delà de laquelle la réponse est refusée sans être analysée. Un
deck de 90 cartes pèse 1 à 2 Ko (relevé sur les fixtures) : la borne laisse
une marge de cent fois, et coupe court à une réponse démesurée."""

VDB_NOT_FOUND_STATUSES = frozenset({400, 404})
"""VDB répond 400 pour un identifiant qu'il ne connaît pas (vérifié en direct
le 2026-11-13) ; 404 est pris pour le même sens, au cas où il s'y mettrait."""

_DECK_ID_RE = re.compile(VDB_DECK_ID_PATTERN)
_VEKN_ID_RE = re.compile(r"^[1-9][0-9]{0,9}$")


class VdbDeckNotFoundError(Exception):
    """VDB ne connaît pas ce deck (404 de la route)."""


class VdbUnavailableError(Exception):
    """VDB est injoignable, a dépassé le délai ou a rendu une réponse
    inattendue (502 de la route). Le message, en français, dit lequel ; il
    ne cite jamais le corps reçu."""


@dataclass(frozen=True)
class VdbResponse:
    """Ce que la lecture réseau rend : le statut HTTP et le corps brut."""

    status: int
    body: bytes


VdbFetcher = Callable[[str], VdbResponse]
"""Lit l'API de VDB pour un identifiant déjà validé ; lève
`VdbUnavailableError` pour une panne de transport ou une réponse trop
grande."""


# --------------------------------------------------------------------------
# Lecture réseau
# --------------------------------------------------------------------------


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """Une redirection mènerait hors de l'adresse fixée : elle n'est pas
    suivie, et le 3xx remonte comme un statut inattendu."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_RefuseRedirects)


def _read_bounded(stream: Any, limit: int) -> bytes:
    body = stream.read(limit + 1)
    if len(body) > limit:
        raise VdbUnavailableError("VDB a rendu une réponse trop volumineuse.")
    return body


def fetch_from_vdb(
    vdb_deck_id: str,
    *,
    timeout: float = VDB_TIMEOUT_SECONDS,
    max_bytes: int = VDB_MAX_RESPONSE_BYTES,
) -> VdbResponse:
    """Lecture réelle chez VDB, par `urllib`, sans suivre de redirection."""
    request = urllib.request.Request(
        VDB_API_DECK_URL + vdb_deck_id, headers={"Accept": "application/json"}
    )
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return VdbResponse(response.status, _read_bounded(response, max_bytes))
    except urllib.error.HTTPError as error:
        # Le corps d'une erreur ne sert à rien : seul le statut compte.
        error.close()
        return VdbResponse(error.code, b"")
    except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
        raise VdbUnavailableError(
            "VDB est injoignable ou n'a pas répondu à temps."
        ) from error


def stub_file_name(vdb_deck_id: str) -> str:
    """Nom du fichier qui simule un deck sous `VDB_STUB_DIR` : `:` (interdit
    dans un nom de fichier Windows) s'y écrit `_`."""
    return vdb_deck_id.replace(":", "_") + ".json"


def make_stub_fetcher(directory: Path) -> VdbFetcher:
    """Lecture simulée pour les e2e : `<directory>/<id>.json` est la réponse
    de VDB, un fichier absent un deck inconnu (400, comme VDB)."""

    def fetch(vdb_deck_id: str) -> VdbResponse:
        path = directory / stub_file_name(vdb_deck_id)
        if not path.is_file():
            return VdbResponse(400, b"")
        return VdbResponse(200, path.read_bytes())

    return fetch


def default_fetcher() -> VdbFetcher:
    """La lecture réelle, ou la lecture simulée si `VDB_STUB_DIR` est posée
    (lue à chaque appel, comme les limites de débit)."""
    stub_dir = os.getenv("VDB_STUB_DIR")
    if stub_dir:
        return make_stub_fetcher(Path(stub_dir))
    return fetch_from_vdb


# --------------------------------------------------------------------------
# Forme de la réponse
# --------------------------------------------------------------------------


def _unexpected(what: str) -> VdbUnavailableError:
    return VdbUnavailableError(f"VDB a rendu une réponse inattendue ({what}).")


def _decode_object(body: bytes) -> Mapping[str, Any]:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise _unexpected("corps illisible") from error
    if not isinstance(payload, dict):
        raise _unexpected("pas un objet JSON")
    return payload


def _deck_id(payload: Mapping[str, Any]) -> str:
    value = payload.get("deckid")
    if not isinstance(value, str) or not _DECK_ID_RE.fullmatch(value):
        raise _unexpected("identifiant de deck")
    return value


def _name(payload: Mapping[str, Any]) -> str:
    value = payload.get("name")
    if not isinstance(value, str):
        raise _unexpected("nom du deck")
    return value


def _optional_text(payload: Mapping[str, Any], key: str) -> str | None:
    """Auteur ou description : absent, nul ou fait d'espaces vaut nul ; un
    texte est rendu tel quel, Markdown et sauts de ligne compris."""
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _unexpected(key)
    return value if value.strip() else None


def _vekn_id(key: Any) -> int:
    if not isinstance(key, str) or not _VEKN_ID_RE.fullmatch(key):
        raise _unexpected("identifiant de carte")
    value = int(key)
    if value > MAX_DB_INT:
        raise _unexpected("identifiant de carte")
    return value


def _quantity(value: Any) -> int:
    # `bool` est un `int` en Python : `true` n'est pas une quantité.
    if isinstance(value, bool) or not isinstance(value, int):
        raise _unexpected("quantité")
    if value < 0 or value > MAX_DB_INT:
        raise _unexpected("quantité hors bornes")
    return value


def _cards(payload: Mapping[str, Any]) -> list[VdbDeckCardRead]:
    """`cards` de VDB : un objet identifiant VEKN (en texte) → quantité,
    crypte et bibliothèque mêlées. Une quantité nulle est une carte retirée
    que VDB aurait laissée dans le dictionnaire : elle est omise, pas
    refusée. Un objet vide est un deck vide, permis."""
    raw = payload.get("cards")
    if not isinstance(raw, dict):
        raise _unexpected("liste des cartes")
    pairs = [(_vekn_id(key), _quantity(value)) for key, value in raw.items()]
    return [
        VdbDeckCardRead(vekn_id=vekn_id, quantity=quantity)
        for vekn_id, quantity in sorted(pairs)
        if quantity > 0
    ]


def parse_vdb_deck(body: bytes, *, fetched_at: datetime) -> VdbDeckRead:
    """Réduit une réponse de l'API de VDB aux champs communs aux trois genres
    de deck (d'utilisateur, de la TWDA, précon). Les autres champs
    (`tags`, `timestamp`, `creation_date`, `isNonEditable`…) sont ignorés,
    quelle que soit leur forme."""
    payload = _decode_object(body)
    return VdbDeckRead(
        vdb_deck_id=_deck_id(payload),
        name=_name(payload),
        author=_optional_text(payload, "author"),
        description=_optional_text(payload, "description"),
        cards=_cards(payload),
        fetched_at=fetched_at,
    )


# --------------------------------------------------------------------------
# Point d'entrée
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def read_vdb_deck(
    vdb_deck_id: str,
    *,
    fetch: VdbFetcher | None = None,
    now: Callable[[], datetime] = _now,
) -> VdbDeckRead:
    """Lit le deck `vdb_deck_id` chez VDB.

    Lève `VdbDeckNotFoundError` si VDB ne le connaît pas, `VdbUnavailableError`
    pour toute autre issue qu'un 200 bien formé. Un identifiant hors motif
    lève `ValueError` sans appel sortant : la route l'a déjà refusé en 422,
    ce contrôle est un second filet pour tout autre appelant.
    """
    if not _DECK_ID_RE.fullmatch(vdb_deck_id):
        raise ValueError("Identifiant de deck VDB hors motif.")
    response = (fetch or default_fetcher())(vdb_deck_id)
    if response.status in VDB_NOT_FOUND_STATUSES:
        raise VdbDeckNotFoundError(vdb_deck_id)
    if response.status != 200:
        raise _unexpected(f"statut {response.status}")
    return parse_vdb_deck(response.body, fetched_at=now())
