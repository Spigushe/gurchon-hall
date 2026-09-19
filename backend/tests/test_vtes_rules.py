"""Légalité d'un deck : fonctions pures de `app.services.vtes_rules`.

Règle (CLAUDE.md §5) : crypt ≥ 12 ; library entre 60 et 90, bornes incluses.
"""

import pytest

from app.services.vtes_rules import (
    CRYPT_MINIMUM,
    LIBRARY_MAXIMUM,
    LIBRARY_MINIMUM,
    deck_is_legal,
    deck_issues,
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
