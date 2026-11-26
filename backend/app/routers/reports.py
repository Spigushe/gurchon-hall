"""Comptes-rendus de tournoi (lot Compte-rendu, `docs/lot-compte-rendu-plan.md`, A1).

Huit opérations. Couper une version et supprimer le compte-rendu passent par
`PATCH /tournois/{id}` et `tournament.update` (champ `report`), pas par ce
module : ce sont des saisies hors ligne, rangées dans la file.

Sous session, en ligne seulement (P7) :

* `GET /tournois/{id}/compte-rendu` — réglages, lien, versions ;
* `GET /tournois/{id}/compte-rendu/versions/{number}` — une version et son
  instantané ;
* `PATCH /tournois/{id}/compte-rendu` — versions antérieures visibles ou non
  par le lien (P9) ;
* `POST` et `DELETE /tournois/{id}/compte-rendu/lien` — créer le lien, le
  purger (P8) ;
* `GET /moi/comptes-rendus` — les comptes-rendus du compte (écran Compte).

Publiques, sans session ni cookie, ordre 422, 429, 404 comme
`GET /listes/{token}` :

* `GET /comptes-rendus/{token}` — la dernière version ;
* `GET /comptes-rendus/{token}/versions/{number}` — une version antérieure, si
  le propriétaire l'autorise. Jamais de paramètre de requête : aucune adresse
  ne porte `?v=<n>` (P9).
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, Response

from app.models.share import SHARE_TOKEN_LENGTH
from app.routers.common import (
    CONFLICT,
    FORBIDDEN_ORIGIN,
    NOT_FOUND,
    TOO_MANY_REQUESTS,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    PathId,
)
from app.schemas.report import (
    MyTournamentReportRead,
    PublicTournamentReportRead,
    TournamentReportRead,
    TournamentReportSettings,
    TournamentReportVersionRead,
)
from app.schemas.share import SHARE_TOKEN_PATTERN
from app.services import tournament_reports
from app.services.errors import NotFoundError
from app.services.rate_limit import limiter, report_rate_limit

router = APIRouter(tags=["comptes-rendus"])

ReportTokenPath = Annotated[
    str,
    Path(
        pattern=SHARE_TOKEN_PATTERN,
        min_length=SHARE_TOKEN_LENGTH,
        max_length=SHARE_TOKEN_LENGTH,
        description=(
            "Jeton du lien, huit caractères parmi les lettres des deux casses, les "
            "chiffres et `_`. La casse compte. Adresse publique du compte-rendu "
            "(`#/compte-rendu/<jeton>` côté client)."
        ),
    ),
]

_PUBLIC_HEADERS = {
    "Cache-Control": {
        "description": (
            "`public, max-age=60` : une purge prend effet en une minute au plus."
        ),
        "schema": {"type": "string"},
    },
    "X-Robots-Tag": {
        "description": "`noindex` : un compte-rendu ne s'indexe pas.",
        "schema": {"type": "string"},
    },
}


@router.get(
    "/tournois/{tournament_id}/compte-rendu",
    response_model=TournamentReportRead,
    operation_id="readTournamentReport",
    summary="Compte-rendu d'un tournoi",
    description=(
        "Réglages, lien et versions (sans leurs instantanés). 404 pour un tournoi "
        "inconnu ou d'un autre compte, et pour un tournoi sans compte-rendu."
    ),
    responses={**UNAUTHENTICATED, **NOT_FOUND},
)
def read_tournament_report(tournament_id: PathId, db: DbSession, user: CurrentUser):
    return tournament_reports.get_report(db, user.id, tournament_id)


@router.get(
    "/tournois/{tournament_id}/compte-rendu/versions/{number}",
    response_model=TournamentReportVersionRead,
    operation_id="readTournamentReportVersion",
    summary="Une version d'un compte-rendu",
    description=(
        "La version `number` et son instantané, figé par le serveur. Une version "
        "ne change jamais. 404 pour un numéro que le compte-rendu n'a pas."
    ),
    responses={**UNAUTHENTICATED, **NOT_FOUND},
)
def read_tournament_report_version(
    tournament_id: PathId, number: PathId, db: DbSession, user: CurrentUser
):
    return tournament_reports.get_version(db, user.id, tournament_id, number)


@router.patch(
    "/tournois/{tournament_id}/compte-rendu",
    response_model=TournamentReportRead,
    operation_id="updateTournamentReportSettings",
    summary="Réglages en ligne d'un compte-rendu",
    description=(
        "Dit si les versions antérieures se lisent par le lien public (P9). En "
        "ligne seulement. L'inclusion des notes sur les adversaires, elle, "
        "voyage avec la demande de mise à jour (`PATCH /tournois/{id}`, champ "
        "`report`)."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **NOT_FOUND, **CONFLICT},
)
def update_tournament_report_settings(
    tournament_id: PathId,
    payload: TournamentReportSettings,
    db: DbSession,
    user: CurrentUser,
):
    return tournament_reports.update_settings(db, user.id, tournament_id, payload)


@router.post(
    "/tournois/{tournament_id}/compte-rendu/lien",
    response_model=TournamentReportRead,
    operation_id="shareTournamentReport",
    summary="Crée le lien public d'un compte-rendu",
    description=(
        "Tire un jeton de huit caractères et rend le compte-rendu avec son "
        "`token` ; rend le lien existant s'il y en a déjà un. Le lien montre "
        "toujours la dernière version. 409 tant qu'aucune version n'est coupée."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **NOT_FOUND, **CONFLICT},
)
def share_tournament_report(tournament_id: PathId, db: DbSession, user: CurrentUser):
    return tournament_reports.create_link(db, user.id, tournament_id)


@router.delete(
    "/tournois/{tournament_id}/compte-rendu/lien",
    response_model=TournamentReportRead,
    operation_id="revokeTournamentReportLink",
    summary="Purge le lien public d'un compte-rendu",
    description=(
        "Seul moyen de révoquer le lien (P8) : il rend 404 à sa lecture publique, "
        "dans la minute (cache). Idempotente. Un nouveau partage tire un jeton "
        "neuf."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **NOT_FOUND, **CONFLICT},
)
def revoke_tournament_report_link(
    tournament_id: PathId, db: DbSession, user: CurrentUser
):
    return tournament_reports.revoke_link(db, user.id, tournament_id)


@router.get(
    "/moi/comptes-rendus",
    response_model=list[MyTournamentReportRead],
    operation_id="listMyTournamentReports",
    summary="Comptes-rendus du compte",
    description=(
        "Les comptes-rendus du compte, du tournoi le plus récent au plus ancien, "
        "avec leur lien et leur dernière version (écran Compte, « Partages »)."
    ),
    responses={**UNAUTHENTICATED},
)
def list_my_tournament_reports(db: DbSession, user: CurrentUser):
    return tournament_reports.list_my_reports(db, user.id)


def _public(response: Response, read):
    try:
        report = read()
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    response.headers["Cache-Control"] = "public, max-age=60"
    response.headers["X-Robots-Tag"] = "noindex"
    return report


_PUBLIC_DESCRIPTION = (
    "**Publique** : ni session ni cookie. Nom d'utilisateur de l'auteur, "
    "instantané de la version (noms des adversaires et decks joués compris, "
    "notes sur les adversaires seulement si l'auteur les inclut) et faits des "
    "cartes des listes jouées. 422 pour un jeton hors motif ; 429 au-delà de la "
    "limite de débit par adresse IP ; 404 « Compte-rendu introuvable. », le même "
    "pour un jeton inconnu ou purgé{extra}."
)


@router.get(
    "/comptes-rendus/{token}",
    response_model=PublicTournamentReportRead,
    operation_id="readPublicTournamentReport",
    summary="Lit un compte-rendu partagé (publique)",
    description=_PUBLIC_DESCRIPTION.format(extra=""),
    responses={
        200: {"description": "La dernière version.", "headers": _PUBLIC_HEADERS},
        **NOT_FOUND,
        **TOO_MANY_REQUESTS,
    },
)
@limiter.limit(report_rate_limit)
def read_public_tournament_report(
    request: Request, token: ReportTokenPath, db: DbSession, response: Response
):
    return _public(response, lambda: tournament_reports.read_public(db, token))


@router.get(
    "/comptes-rendus/{token}/versions/{number}",
    response_model=PublicTournamentReportRead,
    operation_id="readPublicTournamentReportVersion",
    summary="Lit une version d'un compte-rendu partagé (publique)",
    description=_PUBLIC_DESCRIPTION.format(
        extra=(
            ", et pour une version antérieure quand l'auteur ne les montre pas (P9)"
        )
    ),
    responses={
        200: {"description": "La version demandée.", "headers": _PUBLIC_HEADERS},
        **NOT_FOUND,
        **TOO_MANY_REQUESTS,
    },
)
@limiter.limit(report_rate_limit)
def read_public_tournament_report_version(
    request: Request,
    token: ReportTokenPath,
    number: PathId,
    db: DbSession,
    response: Response,
):
    return _public(
        response, lambda: tournament_reports.read_public(db, token, number)
    )
