"""Règles de comptage du score CRAP (`scripts/crap_report.py`, docs/qa-crap.md).

Les mêmes cas figurent côté front (`frontend/tests/unit/crapReport.test.ts`) :
les deux analyseurs doivent compter de la même façon.
"""

import ast
import importlib.util
import textwrap
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
_SPEC = importlib.util.spec_from_file_location(
    "crap_report", BACKEND_DIR / "scripts" / "crap_report.py"
)
crap_report = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(crap_report)


def _complexity(source: str) -> int:
    func = ast.parse(textwrap.dedent(source)).body[0]
    return crap_report.cyclomatic_complexity(func)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("def f():\n    return 1\n", 1),
        (
            """
            def f(x):
                if x > 0:
                    return 1
                elif x < 0:
                    return -1
                else:
                    return 0
            """,
            3,
        ),
        ("def f(a, b, c):\n    return a and b or c\n", 3),
        ("def f(a):\n    return 1 if a else 2\n", 2),
        # Décorateurs et valeurs par défaut sont hors du corps.
        ("@cache(a or b)\ndef f(x=c and d):\n    return x\n", 1),
        ("def f(xs):\n    return [x for x in xs if x if x > 1]\n", 4),
        (
            """
            def f(xs):
                for x in xs:
                    while x:
                        x -= 1
            """,
            3,
        ),
        (
            """
            def f():
                try:
                    pass
                except ValueError:
                    pass
                except KeyError:
                    pass
            """,
            3,
        ),
        (
            """
            def f(x):
                match x:
                    case 1:
                        return "un"
                    case 2:
                        return "deux"
                    case _:
                        return "autre"
            """,
            3,
        ),
        # Une fonction imbriquée est mesurée à part, une lambda reste comptée.
        (
            """
            def f(x):
                def g(y):
                    if y:
                        return y
                key = lambda v: v if v else 0
                return g, key
            """,
            2,
        ),
    ],
)
def test_cyclomatic_complexity(source: str, expected: int) -> None:
    assert _complexity(source) == expected


@pytest.mark.parametrize(
    ("complexity", "coverage", "expected"),
    [(1, 1.0, 1.0), (5, 0.0, 30.0), (5, 1.0, 5.0), (10, 0.5, 22.5), (31, 1.0, 31.0)],
)
def test_crap_score(complexity: int, coverage: float, expected: float) -> None:
    assert crap_report.crap_score(complexity, coverage) == pytest.approx(expected)


def test_score_file_counts_body_lines_only(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text(
        textwrap.dedent(
            """\
            def outer(x):
                \"\"\"Docstring.\"\"\"
                if x:
                    return 1

                def inner():
                    return 2

                return inner


            class Service:
                def method(self):
                    return 3
            """
        ),
        encoding="utf-8",
    )
    # Lignes d'instruction : 1 (def), 3, 4, 6 (def inner), 7, 9, 12 (class),
    # 13 (def), 14. Le module a été importé, les `def` sont donc exécutés.
    executed = {1, 3, 6, 9, 12, 13}
    missing = {4, 7, 14}

    scores = {
        s.key: s for s in crap_report.score_file(source, "m.py", executed, missing)
    }

    assert set(scores) == {"m.py::outer", "m.py::outer.inner", "m.py::Service.method"}
    outer = scores["m.py::outer"]
    # Corps de outer : 3, 4, 6, 9 ; la ligne 7 appartient à inner.
    assert (outer.covered, outer.statements, outer.complexity) == (3, 4, 2)
    # La ligne `def` exécutée à l'import ne compte pas comme couverture.
    assert scores["m.py::outer.inner"].coverage == 0.0
    assert scores["m.py::Service.method"].crap == 2.0


def test_score_file_disambiguates_redefinitions(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text(
        "class A:\n"
        "    @property\n"
        "    def v(self):\n"
        "        return 1\n"
        "    @v.setter\n"
        "    def v(self, value):\n"
        "        pass\n",
        encoding="utf-8",
    )
    keys = [s.key for s in crap_report.score_file(source, "m.py", set(), {4, 7})]
    assert keys == ["m.py::A.v", "m.py::A.v#2"]


def _score(key: str, complexity: int, coverage: float):
    statements = 100
    return crap_report.FunctionScore(
        key=key,
        path=key.split("::")[0],
        line=1,
        complexity=complexity,
        covered=round(coverage * statements),
        statements=statements,
    )


def test_compare_to_baseline() -> None:
    scores = [
        _score("a.py::nouvelle", 6, 0.0),  # 42, absente de la référence
        _score("a.py::en_hausse", 6, 0.0),  # 42, contre 35 retenu
        _score("a.py::stable", 6, 0.0),  # 42, comme retenu
        _score("a.py::en_baisse", 5, 1.0),  # 5, contre 40 retenu
        _score("a.py::sous_le_seuil", 5, 0.0),  # 30 : pas au-dessus
    ]
    baseline = {
        "a.py::en_hausse": 35.0,
        "a.py::stable": 42.0,
        "a.py::en_baisse": 40.0,
        "a.py::disparue": 50.0,
    }

    new, worse, improved = crap_report.compare_to_baseline(scores, baseline, 30)

    assert [s.key for s in new] == ["a.py::nouvelle"]
    assert [s.key for s in worse] == ["a.py::en_hausse"]
    assert improved == ["a.py::disparue", "a.py::en_baisse"]
