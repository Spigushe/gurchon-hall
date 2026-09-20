"""Légalité d'un deck : fonctions pures de `app.services.vtes_rules`.

Règle (CLAUDE.md §5) : crypt ≥ 12 ; library entre 60 et 90, bornes incluses ;
crypt limitée à deux groupes adjacents ; aucune carte bannie et aucune carte pas
encore légale à la date d'évaluation.
"""

from datetime import date, timedelta

import pytest

from app.services.vtes_rules import (
    CRYPT_MINIMUM,
    LIBRARY_MAXIMUM,
    LIBRARY_MINIMUM,
    banned_cards,
    card_label,
    crypt_group,
    deck_is_legal,
    deck_issues,
    group_issues,
    not_yet_legal_cards,
)


def test_thresholds_match_the_documented_rule():
    assert (CRYPT_MINIMUM, LIBRARY_MINIMUM, LIBRARY_MAXIMUM) == (12, 60, 90)


@pytest.mark.parametrize(
    ("crypt", "library"),
    [(12, 60), (12, 90), (30, 75), (12, 61), (12, 89)],
)
def test_legal_decks(crypt, library):
    assert deck_is_legal(crypt, library)
    assert deck_issues(crypt, library) == []


@pytest.mark.parametrize(
    ("crypt", "library"),
    [(11, 60), (12, 59), (12, 91), (0, 0), (12, 0), (0, 75)],
)
def test_illegal_decks(crypt, library):
    assert not deck_is_legal(crypt, library)
    assert deck_issues(crypt, library)


def test_issues_name_each_broken_bound():
    issues = deck_issues(11, 59)
    assert len(issues) == 2
    assert "Crypt" in issues[0] and "11" in issues[0] and "12" in issues[0]
    assert "Library" in issues[1] and "59" in issues[1] and "60" in issues[1]


def test_oversized_library_is_reported_as_too_large():
    (issue,) = deck_issues(12, 91)
    assert "trop grande" in issue and "90" in issue


# --- Groupe d'une carte de crypt --------------------------------------------


@pytest.mark.parametrize(
    ("code", "expected"),
    [("G1", 1), ("G3", 3), ("G7", 7), ("G10", 10)],
)
def test_crypt_group_reads_the_number(code, expected):
    assert crypt_group(code) == expected


@pytest.mark.parametrize(
    "code",
    [None, "", "Any", "any", "G", "GX", "3", "g3", " G3", "G3 ", "G-1", "G2+G3"],
)
def test_crypt_group_is_neutral_for_any_absent_or_unexpected_values(code):
    assert crypt_group(code) is None


# --- Libellé d'une carte ----------------------------------------------------


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (("Theo Bell", "G2", False), "Theo Bell (G2)"),
        (("Theo Bell", "G2", True), "Theo Bell (G2, Adv)"),
        (("Theo Bell", "G6", False), "Theo Bell (G6)"),
        (("Villein", None, False), "Villein"),
        (("Villein",), "Villein"),
        (("Anarch Convert", "Any", False), "Anarch Convert"),
        (("Anarch Convert", "", False), "Anarch Convert"),
        # Sans groupe exploitable, la mention *advanced* tient seule.
        (("Carte", None, True), "Carte (Adv)"),
    ],
)
def test_card_label_names_what_distinguishes_a_card(args, expected):
    assert card_label(*args) == expected


def test_card_label_separates_the_three_theo_bell():
    """Le cas qui a motivé le libellé : trois cartes, un seul nom."""
    labels = {
        card_label("Theo Bell", "G2", False),
        card_label("Theo Bell", "G2", True),
        card_label("Theo Bell", "G6", False),
    }
    assert len(labels) == 3


# --- Groupes de la crypt ----------------------------------------------------


@pytest.mark.parametrize(
    "groups",
    [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [2, 1], [7, 6]],
)
def test_two_adjacent_groups_are_allowed(groups):
    assert group_issues(groups) == []


@pytest.mark.parametrize(
    "groups",
    [[1, 3], [2, 4], [1, 7], [3, 6], [1, 2, 3], [1, 3, 5], [2, 3, 4, 5]],
)
def test_non_adjacent_or_too_many_groups_are_refused(groups):
    (issue,) = group_issues(groups)
    assert "incompatibles" in issue
    for group in sorted(set(groups)):
        assert f"G{group}" in issue


@pytest.mark.parametrize("groups", [[], [4], [4, 4, 4], (), {5}])
def test_zero_or_one_distinct_group_is_always_allowed(groups):
    assert group_issues(groups) == []


def test_repeated_groups_count_once():
    assert group_issues([2, 2, 3, 3, 3]) == []
    assert group_issues([2, 2, 4, 4]) != []


def test_group_issue_lists_the_groups_in_order():
    (issue,) = group_issues([4, 2])
    assert "G2, G4" in issue


def test_any_is_neutral_once_mapped_through_crypt_group():
    """« Any » ne pèse dans aucun groupe : G2 + Any + G3 reste légal."""
    groups = [
        g for g in map(crypt_group, ["G2", "Any", "G3", None]) if g is not None
    ]
    assert groups == [2, 3]
    assert group_issues(groups) == []


# --- Cartes bannies ---------------------------------------------------------

DAY = date(2026, 6, 15)


def test_card_is_not_banned_the_day_before_its_ban():
    assert banned_cards([("Carte", DAY)], DAY - timedelta(days=1)) == []


def test_card_is_banned_on_the_very_day_of_its_ban():
    assert banned_cards([("Carte", DAY)], DAY) == ["Carte"]


def test_card_is_banned_the_day_after_and_later():
    assert banned_cards([("Carte", DAY)], DAY + timedelta(days=1)) == ["Carte"]
    assert banned_cards([("Carte", DAY)], DAY + timedelta(days=3650)) == ["Carte"]


def test_a_card_without_ban_date_is_never_banned():
    assert banned_cards([("Carte", None)], date(2999, 12, 31)) == []


def test_a_future_ban_date_is_not_yet_a_ban():
    assert banned_cards([("Carte", date(2100, 1, 1))], DAY) == []


def test_banned_cards_are_sorted_and_deduplicated():
    cards = [
        ("Zeta", date(2000, 1, 1)),
        ("Alpha", date(2000, 1, 1)),
        ("Zeta", date(2000, 1, 1)),
        ("Milieu", date(2000, 1, 1)),
    ]
    assert banned_cards(cards, DAY) == ["Alpha", "Milieu", "Zeta"]


def test_banned_cards_keeps_only_the_cards_banned_at_that_date():
    cards = [
        ("Libre", None),
        ("Ancienne", date(2010, 1, 1)),
        ("Future", date(2030, 1, 1)),
        ("Jour J", DAY),
    ]
    assert banned_cards(cards, DAY) == ["Ancienne", "Jour J"]


def test_banned_cards_accepts_a_generator_and_an_empty_input():
    assert banned_cards((c for c in [("A", date(2000, 1, 1))]), DAY) == ["A"]
    assert banned_cards([], DAY) == []


def test_banned_cards_keeps_the_labels_it_is_given():
    """Les libellés circulent tels quels : la règle ne reformate rien."""
    cards = [("Theo Bell (G2, Adv)", date(2000, 1, 1)), ("Theo Bell (G6)", None)]
    assert banned_cards(cards, DAY) == ["Theo Bell (G2, Adv)"]


# --- Cartes pas encore légales ----------------------------------------------


def test_card_is_not_yet_legal_the_day_before_it_becomes_legal():
    assert not_yet_legal_cards([("Carte", DAY)], DAY - timedelta(days=1)) == ["Carte"]


def test_card_is_legal_on_the_very_day_of_its_legality():
    assert not_yet_legal_cards([("Carte", DAY)], DAY) == []


def test_card_stays_legal_afterwards():
    assert not_yet_legal_cards([("Carte", DAY)], DAY + timedelta(days=3650)) == []


def test_a_card_without_legality_date_is_considered_legal():
    """La liste krcg paraît après la sortie : l'absence ne vaut pas interdiction."""
    assert not_yet_legal_cards([("Carte", None)], date(1990, 1, 1)) == []


def test_not_yet_legal_cards_are_sorted_and_deduplicated():
    cards = [
        ("Zeta", date(2030, 1, 1)),
        ("Alpha", date(2030, 1, 1)),
        ("Zeta", date(2030, 1, 1)),
        ("Legale", date(2000, 1, 1)),
    ]
    assert not_yet_legal_cards(cards, DAY) == ["Alpha", "Zeta"]


def test_not_yet_legal_cards_accepts_a_generator_and_an_empty_input():
    assert not_yet_legal_cards((c for c in [("A", date(2030, 1, 1))]), DAY) == ["A"]
    assert not_yet_legal_cards([], DAY) == []


def test_the_two_date_rules_are_symmetrical_around_the_day():
    """Même convention « à partir de », effets inverses le jour J."""
    assert banned_cards([("C", DAY)], DAY) == ["C"]
    assert not_yet_legal_cards([("C", DAY)], DAY) == []
    assert banned_cards([("C", DAY)], DAY - timedelta(days=1)) == []
    assert not_yet_legal_cards([("C", DAY)], DAY - timedelta(days=1)) == ["C"]


# --- deck_issues / deck_is_legal avec groupes et bannies --------------------


def test_deck_with_adjacent_groups_and_no_ban_is_legal():
    assert deck_is_legal(12, 60, crypt_groups=[2, 3], banned=[])
    assert deck_issues(12, 60, crypt_groups=[2, 3], banned=()) == []


def test_deck_with_non_adjacent_groups_is_illegal():
    assert not deck_is_legal(12, 60, crypt_groups=[2, 4])
    (issue,) = deck_issues(12, 60, crypt_groups=[2, 4])
    assert "G2, G4" in issue


def test_deck_with_a_banned_card_is_illegal():
    assert not deck_is_legal(12, 60, banned=["Carte"])
    (issue,) = deck_issues(12, 60, banned=["Carte"])
    assert "bannie" in issue and "Carte" in issue


def test_banned_issue_lists_the_cards_in_alphabetical_order():
    (issue,) = deck_issues(12, 60, banned=["Zeta", "Alpha"])
    assert "Alpha, Zeta" in issue


def test_deck_with_a_not_yet_legal_card_is_illegal():
    assert not deck_is_legal(12, 60, not_yet_legal=["Carte"])
    (issue,) = deck_issues(12, 60, not_yet_legal=["Carte"])
    assert "pas encore légale" in issue and "Carte" in issue


def test_not_yet_legal_issue_lists_the_cards_in_alphabetical_order():
    (issue,) = deck_issues(12, 60, not_yet_legal=["Zeta", "Alpha"])
    assert "Alpha, Zeta" in issue


def test_the_new_keywords_are_optional_and_keyword_only():
    assert deck_issues(12, 60) == deck_issues(
        12, 60, crypt_groups=(), banned=(), not_yet_legal=()
    )
    with pytest.raises(TypeError):
        deck_issues(12, 60, [2, 4])  # les groupes ne se passent pas en positionnel
    with pytest.raises(TypeError):
        deck_is_legal(12, 60, [2, 4])


def test_all_broken_rules_are_reported_in_the_documented_order():
    issues = deck_issues(
        5, 100, crypt_groups=[1, 3], banned=["Carte"], not_yet_legal=["Neuve"]
    )

    assert len(issues) == 5
    assert "Crypt trop petite" in issues[0]
    assert "incompatibles" in issues[1]
    assert "Library trop grande" in issues[2]
    assert "bannie" in issues[3]
    assert "pas encore légale" in issues[4]


def test_small_library_is_reported_between_groups_and_bans():
    issues = deck_issues(12, 10, crypt_groups=[1, 3], banned=["Carte"])

    assert [i.split()[0] for i in issues] == ["Groupes", "Library", "Carte(s)"]


@pytest.mark.parametrize(
    ("kwargs", "count"),
    [
        ({"crypt_groups": [1, 3]}, 1),
        ({"banned": ["A"]}, 1),
        ({"not_yet_legal": ["A"]}, 1),
        ({"crypt_groups": [1, 3], "banned": ["A"]}, 2),
        ({"banned": ["A"], "not_yet_legal": ["B"]}, 2),
    ],
)
def test_deck_is_legal_agrees_with_deck_issues(kwargs, count):
    assert len(deck_issues(12, 60, **kwargs)) == count
    assert deck_is_legal(12, 60, **kwargs) is False


def test_groups_and_bans_are_judged_even_when_sizes_are_fine():
    assert deck_is_legal(30, 90, crypt_groups=[6, 7]) is True
    assert deck_is_legal(30, 90, crypt_groups=[5, 7]) is False


# --- Audit : exhaustivité et cas limites ------------------------------------


def test_group_adjacency_is_exactly_a_difference_of_one():
    for first in range(1, 8):
        for second in range(1, 8):
            expected = abs(first - second) <= 1
            assert (group_issues([first, second]) == []) is expected, (first, second)


def test_size_bounds_match_the_rule_over_a_whole_range():
    for crypt in range(0, 31):
        for library in range(0, 121):
            expected = crypt >= 12 and 60 <= library <= 90
            assert deck_is_legal(crypt, library) is expected, (crypt, library)


def test_size_issues_carry_the_actual_count_and_the_bound():
    assert deck_issues(11, 60) == ["Crypt trop petite : 11 carte(s), 12 minimum."]
    assert deck_issues(12, 59) == ["Library trop petite : 59 carte(s), 60 minimum."]
    assert deck_issues(12, 91) == ["Library trop grande : 91 carte(s), 90 maximum."]


def test_dates_far_apart_do_not_confuse_the_comparisons():
    assert banned_cards([("C", date.min)], date.min) == ["C"]
    assert banned_cards([("C", date.max)], date.max) == ["C"]
    assert banned_cards([("C", date.max)], date.max - timedelta(days=1)) == []
    assert not_yet_legal_cards([("C", date.max)], date.max) == []
    assert not_yet_legal_cards([("C", date.max)], date.min) == ["C"]


def test_a_card_can_be_both_banned_and_not_yet_legal_at_inconsistent_dates():
    # Données incohérentes (bannie avant d'être légale) : les deux règles parlent.
    early_ban = [("C", DAY)]
    assert banned_cards(early_ban, DAY) == ["C"]
    assert not_yet_legal_cards([("C", DAY + timedelta(days=5))], DAY) == ["C"]


@pytest.mark.parametrize("code", ["G3\n", "G٣", "G３"])
def test_crypt_group_rejects_a_trailing_newline_and_non_ascii_digits(code):
    assert crypt_group(code) is None
