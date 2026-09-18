"""Tests de contrat OpenAPI (Lot 0).

Deux angles distincts, cf. CLAUDE.md §7 et §10 (contract-first) :

- la *forme* du schéma OpenAPI produit par l'application vivante (ce que le
  front peut attendre de `/health`) ;
- la *non-divergence* entre `contracts/openapi.json` (versionné) et ce même
  schéma vivant — le garde-fou qui empêche le contrat de dériver du code sans
  que personne ne le remarque.
"""

import subprocess
import sys
from pathlib import Path

from app.main import app

BACKEND_DIR = Path(__file__).resolve().parent.parent
EXPORT_SCRIPT = BACKEND_DIR / "scripts" / "export_openapi.py"


def test_openapi_exposes_health_with_expected_operation_id():
    schema = app.openapi()

    health_get = schema["paths"]["/health"]["get"]
    assert health_get["operationId"] == "getHealth"


def test_openapi_health_response_schema_matches_contract():
    schema = app.openapi()
    health_get = schema["paths"]["/health"]["get"]

    response_schema = health_get["responses"]["200"]["content"]["application/json"]["schema"]
    assert response_schema == {"$ref": "#/components/schemas/HealthResponse"}

    health_response = schema["components"]["schemas"]["HealthResponse"]
    assert health_response["required"] == ["status", "version"]
    assert health_response["properties"]["version"]["type"] == "string"
    assert (
        health_response["properties"]["status"]["$ref"]
        == "#/components/schemas/HealthStatus"
    )

    health_status = schema["components"]["schemas"]["HealthStatus"]
    assert health_status["enum"] == ["ok"]


def test_committed_contract_matches_app_openapi():
    """`contracts/openapi.json` ne doit jamais diverger du schéma de l'app.

    Réutilise le mode `--check` de `scripts/export_openapi.py` (source unique
    de la logique de comparaison, cf. contracts/README.md) plutôt que de la
    réimplémenter ici. Doit échouer explicitement si un schéma Pydantic ou une
    route change sans que le contrat versionné soit régénéré.
    """
    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--check"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, (
        "contracts/openapi.json est désynchronisé de l'application. "
        "Lancer `python scripts/export_openapi.py` pour le régénérer.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
