"""Journaux de l'API : une ligne par requête, une ligne par lot `/sync` (Lot 12, A5).

Ce que le module écrit, et rien d'autre :

* `http.request` (journal `app.access`), une ligne par requête HTTP : méthode,
  **gabarit** de la route (`/decks/{deck_id}`, jamais le chemin brut ni la
  requête `q`), statut, durée en millisecondes, et l'identifiant du compte
  quand une session a été résolue ;
* `sync.batch` (journal `app.sync`), écrit par `app.services.sync` après le
  `COMMIT` d'un lot : taille, issues, refus par code et par type d'opération.

Jamais de corps, d'en-tête, d'adresse IP, d'adresse e-mail, de mot de passe ni
de jeton : un événement ne porte que les champs qu'on lui passe dans
`extra={"fields": {...}}`, et le formateur ne lit rien d'autre de
l'enregistrement. Une exception n'apparaît que par son type (`exc_type`) : le
message d'une `IntegrityError` cite les paramètres de la requête SQL.

Sortie standard, reprise par journald sous systemd (`journalctl -u
gurchon-api`). Deux réglages, lus une fois par `configure_logging` :

* `LOG_LEVEL` (`INFO` par défaut) : `DEBUG`, `INFO`, `WARNING`, `ERROR` ou
  `CRITICAL` ; toute autre valeur fait refuser le démarrage ;
* `LOG_FORMAT` (`json` par défaut) : `text` donne une ligne lisible, pour le
  développement (`scripts/run.ps1 dev` la pose).

Les journaux d'accès d'uvicorn doublent `http.request` : on les coupe au
lancement (`--no-access-log`), dans l'unité systemd comme dans les scripts de
développement.

Le gestionnaire est posé sur le journal `app` et laisse propager : sous
uvicorn, la racine n'a aucun gestionnaire, donc rien n'est écrit deux fois ;
sous pytest, `caplog` voit les enregistrements comme avant. Les avertissements
existants (`app.db.schema_check`) passent du même coup au même format.
"""

import json
import logging
import os
import sys
import time
from datetime import UTC, datetime

LOG_LEVEL_ENV = "LOG_LEVEL"
LOG_FORMAT_ENV = "LOG_FORMAT"
DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_LOG_FORMAT = "json"
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
LOG_FORMATS = ("json", "text")

APP_LOGGER = "app"
ACCESS_LOGGER = "app.access"
SYNC_LOGGER = "app.sync"

# Gabarit noté quand aucune route n'a répondu (404 du routeur, requête
# préliminaire CORS) : jamais le chemin brut, qui peut porter un identifiant.
UNMATCHED_ROUTE = "<aucune route>"

access_logger = logging.getLogger(ACCESS_LOGGER)

# Marque du gestionnaire posé par `configure_logging`, pour qu'un second appel
# (rechargement d'uvicorn, tests) le remplace au lieu d'en empiler un autre.
_HANDLER_MARK = "_gurchon_hall_handler"


class LoggingSettingsError(RuntimeError):
    """`LOG_LEVEL` ou `LOG_FORMAT` illisible : le démarrage est refusé."""


def _setting(name: str, default: str, allowed: tuple[str, ...]) -> str:
    raw = os.getenv(name, default).strip()
    value = raw.upper() if allowed is LOG_LEVELS else raw.lower()
    if value not in allowed:
        raise LoggingSettingsError(
            f"{name}={raw!r} n'est pas reconnu ; valeurs admises : "
            + ", ".join(allowed)
            + "."
        )
    return value


def _fields(record: logging.LogRecord) -> dict:
    fields = getattr(record, "fields", None)
    return dict(fields) if isinstance(fields, dict) else {}


def _exc_type(record: logging.LogRecord) -> str | None:
    if record.exc_info and record.exc_info[0] is not None:
        return record.exc_info[0].__name__
    return None


def _timestamp(record: logging.LogRecord) -> str:
    instant = datetime.fromtimestamp(record.created, tz=UTC)
    return instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """Une ligne JSON par enregistrement : horodatage UTC, niveau, journal,
    événement (le message), puis les champs passés en `extra["fields"]`."""

    def format(self, record: logging.LogRecord) -> str:
        line = {
            "ts": _timestamp(record),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
            **_fields(record),
        }
        exc_type = _exc_type(record)
        if exc_type is not None:
            line["exc_type"] = exc_type
        return json.dumps(line, ensure_ascii=False, separators=(",", ":"))


class TextFormatter(logging.Formatter):
    """Ligne lisible pour le développement : mêmes champs, en `clé=valeur`."""

    def format(self, record: logging.LogRecord) -> str:
        fields = _fields(record)
        exc_type = _exc_type(record)
        if exc_type is not None:
            fields["exc_type"] = exc_type
        pairs = " ".join(
            f"{key}={json.dumps(value, ensure_ascii=False, separators=(',', ':'))}"
            if isinstance(value, dict | list)
            else f"{key}={value}"
            for key, value in fields.items()
        )
        head = f"{_timestamp(record)} {record.levelname:<7} {record.name} "
        return (head + record.getMessage() + (" " + pairs if pairs else "")).rstrip()


class _StdoutHandler(logging.StreamHandler):
    """Écrit sur la sortie standard **du moment** : relue à chaque ligne, pour
    qu'une sortie remplacée après la configuration (capture de pytest) soit
    suivie."""

    def __init__(self) -> None:
        super().__init__(sys.stdout)

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stdout
        super().emit(record)


def configure_logging() -> None:
    """Pose le gestionnaire du journal `app` selon `LOG_LEVEL` et `LOG_FORMAT`.

    Idempotente : remplace le gestionnaire posé par un appel précédent.
    `LoggingSettingsError` sur une valeur inconnue, avant toute modification.
    """
    level = _setting(LOG_LEVEL_ENV, DEFAULT_LOG_LEVEL, LOG_LEVELS)
    log_format = _setting(LOG_FORMAT_ENV, DEFAULT_LOG_FORMAT, LOG_FORMATS)
    handler = _StdoutHandler()
    handler.setFormatter(JsonFormatter() if log_format == "json" else TextFormatter())
    setattr(handler, _HANDLER_MARK, True)
    logger = logging.getLogger(APP_LOGGER)
    for previous in [h for h in logger.handlers if getattr(h, _HANDLER_MARK, False)]:
        logger.removeHandler(previous)
    logger.addHandler(handler)
    logger.setLevel(level)


def _route_template(scope: dict) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else UNMATCHED_ROUTE


def _user_id(scope: dict) -> int | None:
    state = scope.get("state")
    if isinstance(state, dict):
        value = state.get("user_id")
        return value if isinstance(value, int) else None
    return None


class RequestLogMiddleware:
    """Middleware ASGI pur : mesure chaque requête et écrit `http.request`.

    Pas `BaseHTTPMiddleware`, qui relaierait le corps de la réponse en flux
    (cf. la compression, `app.main`). Posé en dernier, donc à l'extérieur des
    autres couches : il voit aussi les 403 d'origine, les 429 de slowapi et
    les réponses CORS. Le gabarit de route et le compte se lisent dans le
    `scope` après l'appel, que le routeur (`scope["route"]`) et la dépendance
    de session (`request.state.user_id`) ont complété en chemin. Une exception
    qui remonte est notée en 500 puis relancée, sans rien changer à sa
    gestion.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def send_and_note_status(message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_note_status)
        finally:
            fields = {
                "method": scope["method"],
                "route": _route_template(scope),
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            }
            user_id = _user_id(scope)
            if user_id is not None:
                fields["user_id"] = user_id
            level = logging.ERROR if status >= 500 else logging.INFO
            access_logger.log(level, "http.request", extra={"fields": fields})
