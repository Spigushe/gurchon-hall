"""Score et tournoi : fonctions pures de `app.services.vtes_rules` (Lot 7).

Règles (CLAUDE.md §5, relues dans les règles de tournoi de la VEKN) : VP par
demi-points, au plus la taille de la table ; GW à 2 VP au moins, à toute table,
certain au-delà de la moitié des VP de la table ; multi-deck interdit à trois
niveaux de championnat ; deck de finale selon la règle annoncée ; classement
final borné. On ne suit que ses propres VP et GW (P7).
"""

import json
from datetime import date
from pathlib import Path

import pytest

from app.models.enums import DeckPolicy, EventTier, FinalDeckRule, RoundType
from app.services.vtes_rules import (
    FINAL_TABLE_SIZE,
    GAME_WIN_MINIMUM_VP,
    MULTI_DECK_FORBIDDEN_TIERS,
    VP_STEP,
    RoundResult,
    TableLine,
    TournamentTally,
    admissible_final_decks,
    certain_game_win,
    date_range_issues,
    final_deck_issues,
    final_deck_rule_issues,
    game_win_issues,
    mono_deck_issues,
    multi_deck_tier_issues,
    ranking_issues,
    resolved_game_win,
    round_issues,
    table_issues,
    tournament_summary,
    vp_issues,
)

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "certain_game_win_cases.json").read_text(
        encoding="utf-8"
    )
)["cases"]


def test_constants_match_the_vekn_rules():
    assert (GAME_WIN_MINIMUM_VP, VP_STEP, FINAL_TABLE_SIZE) == (2.0, 0.5, 5)
    assert MULTI_DECK_FORBIDDEN_TIERS == set(EventTier) - {EventTier.STANDARD}


# --------------------------------------------------------------------------
# VP (A5)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("player_count", "vp"),
    [(5, None), (5, 0), (5, 0.5), (5, 2.5), (5, 5), (4, 4), (2, 2)],
)
def test_plausible_victory_points(player_count, vp):
    assert vp_issues(player_count, vp) == []


def test_victory_points_above_the_table_size_are_refused():
    (issue,) = vp_issues(4, 4.5)
    assert issue == "4,5 VP à une table de 4 joueurs : 4 au plus."


@pytest.mark.parametrize("vp", [0.25, 1.3, 2.75])
def test_victory_points_come_in_half_points(vp):
    (issue,) = vp_issues(5, vp)
    assert "demi-points" in issue


def test_negative_victory_points_are_refused():
    assert any("négatifs" in issue for issue in vp_issues(5, -0.5))


def test_victory_point_anomalies_add_up():
    assert len(vp_issues(5, -0.25)) == 2
    assert vp_issues(2, 2) == []
    assert len(vp_issues(2, 2.5)) == 1


# --------------------------------------------------------------------------
# Game Win (A4)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "case", CASES, ids=lambda c: f"{c['player_count']}j-{c['vp']}VP"
)
def test_certain_game_win_follows_the_shared_case_table(case):
    """Même table que le test TypeScript de `certainGameWin` (A14)."""
    assert certain_game_win(case["player_count"], case["vp"]) is case["expected"]


def test_the_shared_table_covers_the_edges_named_by_the_plan():
    seen = {(c["player_count"], c["vp"]): c["expected"] for c in CASES}
    assert seen[(4, 2.5)] is True  # plus de la moitié à quatre
    assert seen[(5, 3)] is True  # plus de la moitié à cinq
    assert seen[(5, 2)] is None  # 2 VP à cinq : laissé à la déclaration
    assert seen[(4, 2)] is None  # la moitié tout juste ne suffit pas


def test_a_certain_game_win_leaves_no_one_able_to_catch_up():
    """Invariant indépendant de la table de cas : si le GW est certain, les VP
    restants de la table ne peuvent pas égaler les miens."""
    for case in CASES:
        if certain_game_win(case["player_count"], case["vp"]):
            assert case["vp"] > case["player_count"] - case["vp"]


def test_certain_game_win_threshold_is_a_parameter():
    assert certain_game_win(5, 3, minimum=3.5) is None
    assert certain_game_win(2, 1.5, minimum=1.5) is True


def test_game_win_below_two_victory_points_is_refused():
    (issue,) = game_win_issues(5, 1.5, True)
    assert issue == "Game Win avec 1,5 VP : il en faut au moins 2."


def test_game_win_without_victory_points_is_refused():
    (issue,) = game_win_issues(5, None, True)
    assert "sans VP saisis" in issue


def test_a_certain_game_win_cannot_be_declared_absent():
    (issue,) = game_win_issues(5, 3, False)
    assert issue == (
        "3 VP à une table de 5 joueurs : seul en tête avec au moins 2 VP, le "
        "Game Win est acquis."
    )
    (issue,) = game_win_issues(4, 2.5, False)
    assert issue.startswith("2,5 VP à une table de 4 joueurs")


def test_half_the_table_is_not_enough_to_impose_the_game_win():
    assert game_win_issues(4, 2, False) == []
    assert game_win_issues(4, 2, True) == []
    assert game_win_issues(5, 2.5, False) == []


@pytest.mark.parametrize(
    ("player_count", "vp", "declared"),
    [
        (5, 2, True),  # 2 VP à cinq : la déclaration fait foi
        (5, 2, False),
        (5, 2.5, False),
        (5, 3, True),
        (5, 1.5, False),
        (5, None, None),
        (5, 3, None),  # vide : le service le pose
        (5, 0, False),
    ],
)
def test_declarations_that_nothing_contradicts(player_count, vp, declared):
    assert game_win_issues(player_count, vp, declared) == []


@pytest.mark.parametrize(
    ("player_count", "vp", "declared", "expected"),
    [
        (5, 3, None, True),  # certain : posé
        (5, 2, None, None),  # incertain : laissé vide
        (5, 2, True, True),
        (5, 2.5, False, False),
        (4, 2.5, None, True),
    ],
)
def test_resolved_game_win(player_count, vp, declared, expected):
    assert resolved_game_win(player_count, vp, declared) is expected


# --------------------------------------------------------------------------
# Rondes (A6)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("round_type", "in_tournament", "round_number", "round_count"),
    [
        (RoundType.CASUAL, False, None, None),
        (RoundType.PRELIMINARY, True, 1, None),
        (RoundType.PRELIMINARY, True, 3, 3),
        (RoundType.FINAL, True, None, 3),
    ],
)
def test_consistent_rounds(round_type, in_tournament, round_number, round_count):
    assert round_issues(round_type, in_tournament, round_number, round_count) == []


@pytest.mark.parametrize(
    ("round_type", "in_tournament", "round_number", "round_count", "message"),
    [
        (RoundType.CASUAL, True, None, None, "pas une partie amicale"),
        (RoundType.PRELIMINARY, False, 1, None, "appartient à un tournoi"),
        (RoundType.FINAL, False, None, None, "appartient à un tournoi"),
        (RoundType.PRELIMINARY, True, None, None, "porte son numéro"),
        (RoundType.FINAL, True, 4, None, "Seule une ronde préliminaire"),
        (RoundType.CASUAL, False, 2, None, "Seule une ronde préliminaire"),
        (RoundType.PRELIMINARY, True, 4, 3, "Ronde 4 d'un tournoi en 3 ronde(s)."),
    ],
)
def test_inconsistent_rounds(
    round_type, in_tournament, round_number, round_count, message
):
    issues = round_issues(round_type, in_tournament, round_number, round_count)
    assert any(message in issue for issue in issues), issues


# --------------------------------------------------------------------------
# Mono-deck (A7) et multi-deck (A11)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "deck_ids", [[], [None], [7], [7, 7, None, 7], [None, None]]
)
def test_mono_deck_with_a_single_deck(deck_ids):
    assert mono_deck_issues(deck_ids) == []


def test_mono_deck_with_two_decks_names_them():
    (issue,) = mono_deck_issues([7, None, 9], {7: "Banu Princes", 9: "Malkavien"})
    assert issue == (
        "Tournoi mono-deck joué avec plusieurs decks : Banu Princes, Malkavien."
    )


def test_mono_deck_message_falls_back_on_the_identifier():
    (issue,) = mono_deck_issues([7, 9])
    assert "deck 7, deck 9" in issue


@pytest.mark.parametrize("tier", sorted(MULTI_DECK_FORBIDDEN_TIERS))
def test_multi_deck_is_forbidden_at_championship_tiers(tier):
    assert multi_deck_tier_issues(DeckPolicy.MULTI, tier)
    assert multi_deck_tier_issues(DeckPolicy.MONO, tier) == []


def test_multi_deck_is_allowed_at_a_standard_event():
    assert multi_deck_tier_issues(DeckPolicy.MULTI, EventTier.STANDARD) == []


@pytest.mark.parametrize("rule", list(FinalDeckRule))
def test_a_final_deck_rule_only_makes_sense_in_multi_deck(rule):
    assert final_deck_rule_issues(DeckPolicy.MONO, rule)
    assert final_deck_rule_issues(DeckPolicy.MULTI, rule) == []


@pytest.mark.parametrize("policy", list(DeckPolicy))
def test_an_unknown_final_deck_rule_is_always_allowed(policy):
    assert final_deck_rule_issues(policy, None) == []


# --------------------------------------------------------------------------
# Deck de finale (A11)
# --------------------------------------------------------------------------


def r(deck_id, vp=None, gw=None):
    return RoundResult(deck_id=deck_id, victory_points=vp, game_win=gw)


def test_nothing_is_checkable_without_a_rule():
    assert admissible_final_decks(None, [r(1, 3, True)]) is None


def test_nothing_is_checkable_without_a_preliminary_played_with_a_deck():
    rule = FinalDeckRule.BEST_PERFORMING
    assert admissible_final_decks(rule, []) is None
    assert admissible_final_decks(rule, [r(None, 4, True)]) is None


def test_free_choice_admits_every_deck_of_the_preliminaries():
    rounds = [r(1, 0), r(2, 3, True), r(1, 1)]
    assert admissible_final_decks(FinalDeckRule.FREE_CHOICE, rounds) == {1, 2}


def test_free_choice_with_a_round_without_deck_is_not_checkable():
    """La ronde sans deck a pu être jouée avec le deck de la finale : refuser
    serait plus strict que le règlement (revue de l'étape A2)."""
    rounds = [r(None, 2), r(2, 1)]
    assert admissible_final_decks(FinalDeckRule.FREE_CHOICE, rounds) is None
    assert final_deck_issues(FinalDeckRule.FREE_CHOICE, rounds, 1) == []


def test_best_deck_is_decided_by_game_wins_first():
    rounds = [r(1, 3.5), r(2, 2, True)]
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, rounds) == {2}


def test_best_deck_is_decided_by_victory_points_next():
    rounds = [r(1, 2, True), r(2, 3, True), r(3, 1.5)]
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, rounds) == {2}


def test_a_tie_on_game_wins_and_victory_points_admits_both_decks():
    """Sans TP, troisième critère du règlement, l'égalité n'est pas tranchée."""
    rounds = [r(1, 3, True), r(2, 3, True), r(3, 1)]
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, rounds) == {1, 2}


def test_best_deck_is_judged_on_a_single_round_not_a_sum():
    """« Meilleure ronde », pas meilleur total : deux rondes moyennes avec le
    deck 1 ne battent pas une bonne ronde avec le deck 2 (3.1.5a)."""
    rounds = [r(1, 2, True), r(1, 2, True), r(2, 3, True)]
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, rounds) == {2}


def test_a_round_whose_victory_points_are_missing_may_be_the_best():
    """Des VP non saisis ne valent pas 0 : la ronde peut être la meilleure,
    son deck est admis."""
    rounds = [r(1), r(2, 0.5)]
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, rounds) == {1, 2}
    assert admissible_final_decks(FinalDeckRule.BEST_PERFORMING, [r(1), r(2)]) == {
        1,
        2,
    }


def test_a_deckless_round_that_could_be_the_best_makes_it_uncheckable():
    rule = FinalDeckRule.BEST_PERFORMING
    # Ronde 1 : 3 VP et GW, deck non saisi ; ronde 2 : deck B, 1 VP.
    assert admissible_final_decks(rule, [r(None, 3, True), r(2, 1)]) is None
    assert final_deck_issues(rule, [r(None, 3, True), r(2, 1)], 1) == []
    # À égalité avec la meilleure ronde connue : son deck aurait été admis.
    assert admissible_final_decks(rule, [r(None, 2, True), r(2, 2, True)]) is None
    # VP manquants : elle peut tout aussi bien être la meilleure.
    assert admissible_final_decks(rule, [r(None), r(2, 3, True)]) is None


def test_a_deckless_round_below_the_best_does_not_matter():
    rule = FinalDeckRule.BEST_PERFORMING
    rounds = [r(None, 1), r(1, 3, True), r(2, 2)]
    assert admissible_final_decks(rule, rounds) == {1}
    (issue,) = final_deck_issues(rule, rounds, 2)
    assert "meilleur deck des préliminaires : deck 1" in issue


def test_a_final_with_the_best_deck_passes():
    rounds = [r(1, 3, True), r(2, 1)]
    assert final_deck_issues(FinalDeckRule.BEST_PERFORMING, rounds, 1) == []


def test_a_final_with_either_tied_deck_passes():
    rounds = [r(1, 3, True), r(2, 3, True)]
    for final_deck in (1, 2):
        assert (
            final_deck_issues(FinalDeckRule.BEST_PERFORMING, rounds, final_deck)
            == []
        )


def test_a_final_with_another_deck_names_the_expected_one():
    rounds = [r(1, 3, True), r(2, 1)]
    (issue,) = final_deck_issues(
        FinalDeckRule.BEST_PERFORMING, rounds, 2, {1: "Banu Princes", 2: "Malkavien"}
    )
    assert issue == (
        "Finale jouée avec Malkavien ; meilleur deck des préliminaires : "
        "Banu Princes."
    )


def test_a_free_choice_final_with_an_unplayed_deck_is_refused():
    (issue,) = final_deck_issues(FinalDeckRule.FREE_CHOICE, [r(1), r(2)], 3)
    assert issue == (
        "Finale jouée avec deck 3, qui n'a joué aucune préliminaire ; "
        "deck(s) admis : deck 1, deck 2."
    )


@pytest.mark.parametrize(
    ("rule", "rounds", "final_deck"),
    [
        (FinalDeckRule.BEST_PERFORMING, [r(1, 3, True)], None),
        (None, [r(1, 3, True)], 2),
        (FinalDeckRule.BEST_PERFORMING, [r(None, 3, True)], 2),
        (FinalDeckRule.FREE_CHOICE, [r(None), r(1)], 2),
    ],
)
def test_an_uncheckable_final_is_not_refused(rule, rounds, final_deck):
    assert final_deck_issues(rule, rounds, final_deck) == []


# --------------------------------------------------------------------------
# Classement final (A12)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ranking", "player_count", "played_final", "final_gw"),
    [
        (None, 27, True, True),
        (3, 27, False, None),
        (27, 27, False, None),
        (12, None, False, None),
        (1, 27, True, True),  # finale gagnée avec GW
        (1, 27, True, False),  # finale gagnée sans GW (1,5 VP seul en tête)
        (2, 27, True, False),  # finale perdue
        (5, 27, True, None),
        (6, 27, False, None),  # sans finale
    ],
)
def test_plausible_rankings(ranking, player_count, played_final, final_gw):
    assert ranking_issues(ranking, player_count, played_final, final_gw) == []


def test_ranking_beyond_the_player_count():
    (issue,) = ranking_issues(28, 27, False, None)
    assert issue == "Classé 28e d'un tournoi de 27 joueurs."


def test_a_finalist_ranks_between_one_and_five():
    (issue,) = ranking_issues(6, 27, True, False)
    assert "entre 1 et 5" in issue


def test_a_game_win_in_the_final_means_first_place():
    (issue,) = ranking_issues(2, 27, True, True)
    assert "donne la victoire" in issue
    (issue,) = ranking_issues(5, 27, True, True)
    assert "donne la victoire" in issue


def test_ranking_anomalies_add_up():
    assert len(ranking_issues(6, 27, True, True)) == 2
    assert len(ranking_issues(28, 27, True, True)) == 3


# --------------------------------------------------------------------------
# Table (A2, A5) et dates
# --------------------------------------------------------------------------


def line(player_id, is_me=False, seat=None):
    return TableLine(player_id=player_id, is_me=is_me, seat=seat)


@pytest.mark.parametrize(
    "lines",
    [
        [line(1, True)],
        [line(1, True, 3), line(2, seat=1), line(3)],
        [line(1, True, 5), line(2), line(3), line(4), line(5, seat=4)],
    ],
)
def test_tables_that_hold_together(lines):
    assert table_issues(5, lines) == []


@pytest.mark.parametrize(
    ("lines", "message"),
    [
        ([line(2)], "ne contient pas ma participation"),
        ([line(1, True), line(1, True)], "plusieurs fois ma participation"),
        ([line(1, True), line(2), line(2)], "même joueur"),
        ([line(1, True, 2), line(2, seat=2)], "même siège"),
        (
            [line(1, True), line(2), line(3), line(4), line(5)],
            "5 lignes pour une table de 4 joueurs.",
        ),
        ([line(1, True, 5)], "Siège au-delà de la table"),
    ],
)
def test_tables_that_do_not(lines, message):
    issues = table_issues(4, lines)
    assert any(message in issue for issue in issues), issues


def test_a_me_designated_twice_is_caught_once_resolved():
    """`{"me": true}` et l'identifiant du « Moi » désignent le même joueur :
    le doublon n'apparaît qu'après résolution, d'où ce contrôle au service."""
    issues = table_issues(4, [line(1, True), line(1, True)])
    assert "La table contient plusieurs fois ma participation." in issues
    assert "La table désigne plusieurs fois le même joueur." in issues


def test_a_tournament_does_not_end_before_it_starts():
    assert date_range_issues(date(2026, 10, 24), None) == []
    assert date_range_issues(date(2026, 10, 24), date(2026, 10, 24)) == []
    (issue,) = date_range_issues(date(2026, 10, 24), date(2026, 10, 23))
    assert issue == "Fin du tournoi (23/10/2026) avant son début (24/10/2026)."


# --------------------------------------------------------------------------
# Bilan (A12)
# --------------------------------------------------------------------------


def test_summary_of_a_tournament_with_a_final():
    tally = tournament_summary(
        [r(1, 3, True), r(2, 1.5, False), r(1, 3, True)], r(1, 2.5, True)
    )
    assert tally == TournamentTally(
        preliminary_game_wins=2,
        preliminary_victory_points=7.5,
        rounds_played=3,
        final_victory_points=2.5,
        final_game_win=True,
    )


def test_summary_without_a_final_leaves_the_final_empty():
    tally = tournament_summary([r(1, 2, None)], None)
    assert (tally.final_victory_points, tally.final_game_win) == (None, None)
    assert (tally.preliminary_game_wins, tally.rounds_played) == (0, 1)


def test_summary_counts_missing_results_as_nothing():
    tally = tournament_summary([r(None), r(None, 1)], r(None))
    assert tally.preliminary_victory_points == 1
    assert (tally.final_victory_points, tally.final_game_win) == (0, False)


def test_summary_of_an_empty_tournament():
    assert tournament_summary([], None) == TournamentTally(0, 0, 0, None, None)
