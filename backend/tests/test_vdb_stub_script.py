"""Lot 9 : `scripts/vdb_stub.py`, le dossier de la lecture simulée de VDB.

Le script range les réponses réelles de l'API de VDB sous l'identifiant
qu'elles portent, pour que la route `GET /vdb/decks/{id}` les serve sous
`VDB_STUB_DIR`, sans réseau ; l'état du deck des cas difficiles bascule entre
avant et après sa modification chez VDB, back en marche.
"""

import importlib.util
import json
from pathlib import Path

import pytest

from tests.auth_helpers import log_in, make_account

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "vdb_stub.py"
_spec = importlib.util.spec_from_file_location("vdb_stub", SCRIPT)
vdb_stub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vdb_stub)

EXPECTED_FILES = {
    "4fc0ee5e9.json",
    "31203cb9e.json",
    "12761.json",
    "SV5_PCaine.json",
}


def _cards(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["cards"]


def test_the_stub_holds_the_four_decks_under_their_ids(tmp_path):
    written = vdb_stub.prepare_stub(tmp_path / "stub")

    assert {target.name for _, target in written} == EXPECTED_FILES
    assert {path.name for path in (tmp_path / "stub").iterdir()} == EXPECTED_FILES
    assert [vdb_deck_id for vdb_deck_id, _ in written] == [
        "4fc0ee5e9",
        "12761",
        "SV5:PCaine",
        "31203cb9e",
    ]


def test_the_files_are_the_real_responses_untouched(tmp_path):
    vdb_stub.prepare_stub(tmp_path)
    fixtures = vdb_stub.FIXTURES_DIR
    assert (tmp_path / "4fc0ee5e9.json").read_bytes() == (
        fixtures / "ref-api.json"
    ).read_bytes()
    assert (tmp_path / "31203cb9e.json").read_bytes() == (
        fixtures / "maj-avant-api.json"
    ).read_bytes()


def test_before_is_the_difficult_deck(tmp_path):
    vdb_stub.prepare_stub(tmp_path, "avant")
    difficult = vdb_stub.FIXTURES_DIR / "difficile-api.json"
    assert _cards(tmp_path / "31203cb9e.json") == _cards(difficult)


def test_switching_state_rewrites_only_the_updated_deck(tmp_path):
    vdb_stub.prepare_stub(tmp_path, "avant")
    before = _cards(tmp_path / "31203cb9e.json")
    reference = (tmp_path / "4fc0ee5e9.json").read_bytes()

    vdb_stub.prepare_stub(tmp_path, "apres")

    assert _cards(tmp_path / "31203cb9e.json") != before
    assert (tmp_path / "4fc0ee5e9.json").read_bytes() == reference
    assert {path.name for path in tmp_path.iterdir()} == EXPECTED_FILES


def test_an_unknown_state_is_refused(tmp_path):
    with pytest.raises(ValueError):
        vdb_stub.prepare_stub(tmp_path, "pendant")
    assert list(tmp_path.iterdir()) == []


def test_a_fixture_the_route_would_refuse_fails_the_script(tmp_path):
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    for name in ("ref-api.json", "twda-api.json", "maj-avant-api.json"):
        (fixtures / name).write_bytes((vdb_stub.FIXTURES_DIR / name).read_bytes())
    (fixtures / "precon-api.json").write_text('{"deckid": "a/b"}', encoding="utf-8")

    with pytest.raises(Exception, match="inattendue"):
        vdb_stub.prepare_stub(tmp_path / "stub", fixtures_dir=fixtures)


def test_the_command_line_prints_the_variable(tmp_path, capsys):
    assert vdb_stub.main([str(tmp_path / "stub"), "--etat", "apres"]) == 0
    out = capsys.readouterr().out
    assert "SV5:PCaine -> " in out
    assert f"VDB_STUB_DIR={(tmp_path / 'stub').resolve()}" in out


@pytest.fixture
def me_api(api, db):
    make_account(db, email="stub@example.com", username="stub")
    db.commit()
    log_in(api, "stub@example.com")
    return api


def test_the_route_serves_the_stub_and_follows_the_switch(
    monkeypatch, me_api, tmp_path
):
    """Le parcours de la mise à jour, back en marche : avant, bascule, après."""
    monkeypatch.setenv("VDB_STUB_DIR", str(tmp_path))
    vdb_stub.prepare_stub(tmp_path, "avant")

    def cards() -> dict:
        response = me_api.get("/vdb/decks/31203cb9e")
        assert response.status_code == 200
        return {c["vekn_id"]: c["quantity"] for c in response.json()["cards"]}

    before = cards()
    vdb_stub.prepare_stub(tmp_path, "apres")
    after = cards()

    expected = {
        int(k): v
        for k, v in _cards(vdb_stub.FIXTURES_DIR / "maj-apres-api.json").items()
    }
    assert after == expected != before
    for vdb_deck_id in ("4fc0ee5e9", "12761", "SV5:PCaine"):
        assert me_api.get(f"/vdb/decks/{vdb_deck_id}").status_code == 200
    assert me_api.get("/vdb/decks/inconnu").status_code == 404
