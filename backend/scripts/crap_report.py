"""Calcule le score CRAP de chaque fonction de `app/` et le compare à la référence.

CRAP (Change Risk Anti-Patterns, Savoia et Evans, repris par Robert C. Martin)
croise la complexité cyclomatique d'une fonction et sa couverture par les tests :

    CRAP(f) = comp(f)² × (1 − cov(f))³ + comp(f)

Une fonction simple et testée vaut à peu près sa complexité ; une fonction
complexe et non testée explose. Au-delà de 30, la fonction est dite « crappy ».
Règles de comptage et politique de la référence : `docs/qa-crap.md`.

Usage (depuis `backend/`) :

    uv run coverage run -m pytest            # produit .coverage
    uv run coverage json                     # produit coverage.json
    uv run python scripts/crap_report.py     # rapport + contrôle de la référence
    uv run python scripts/crap_report.py --update-baseline

Code de sortie : 1 si une fonction dépasse le seuil sans figurer dans la
référence, ou si une fonction de la référence a vu son score monter ; 0 sinon.
"""

import argparse
import ast
import json
import sys
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_BASELINE = REPO_ROOT / "docs" / "qa-baselines" / "crap" / "backend.json"
DEFAULT_THRESHOLD = 30.0

FunctionNode = ast.FunctionDef | ast.AsyncFunctionDef
ScopeNode = FunctionNode | ast.ClassDef


@dataclass
class FunctionScore:
    key: str
    path: str
    line: int
    complexity: int
    covered: int
    statements: int

    @property
    def coverage(self) -> float:
        # Une fonction sans instruction mesurable (corps réduit à une
        # docstring) n'a rien à couvrir.
        return 1.0 if self.statements == 0 else self.covered / self.statements

    @property
    def crap(self) -> float:
        return round(crap_score(self.complexity, self.coverage), 1)


def crap_score(complexity: int, coverage: float) -> float:
    return complexity**2 * (1 - coverage) ** 3 + complexity


def cyclomatic_complexity(func: FunctionNode) -> int:
    """McCabe : 1 + un point par décision, sans descendre dans les fonctions
    et classes imbriquées (elles sont mesurées à part). Les lambdas restent
    comptées dans la fonction qui les contient. Seul le corps est parcouru :
    décorateurs et valeurs par défaut ne comptent pas, comme côté front."""
    complexity = 1
    stack: list[ast.AST] = list(func.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if isinstance(
            node,
            (ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler),
        ):
            complexity += 1
        elif isinstance(node, ast.BoolOp):
            complexity += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            complexity += 1 + len(node.ifs)
        elif isinstance(node, ast.match_case):
            # Le cas joker (`case _:`) est la branche « sinon », pas une décision.
            is_wildcard = (
                isinstance(node.pattern, ast.MatchAs) and node.pattern.pattern is None
            )
            if not is_wildcard or node.guard is not None:
                complexity += 1
        stack.extend(ast.iter_child_nodes(node))
    return complexity


def _body_lines(node: ScopeNode) -> range:
    """Lignes du corps, sans la ligne `def` ni les décorateurs : coverage.py
    marque la définition comme exécutée dès l'import du module, ce qui
    gonflerait la couverture d'une fonction jamais appelée."""
    return range(node.body[0].lineno, (node.end_lineno or node.lineno) + 1)


def _iter_functions(tree: ast.Module):
    """Rend (nom qualifié, nœud, lignes des portées imbriquées) pour chaque
    fonction du module, méthodes et fonctions imbriquées comprises."""

    def visit(node: ast.AST, prefix: str):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{prefix}{child.name}"
                yield name, child, _nested_lines(child)
                yield from visit(child, f"{name}.")
            elif isinstance(child, ast.ClassDef):
                yield from visit(child, f"{prefix}{child.name}.")
            else:
                yield from visit(child, prefix)

    yield from visit(tree, "")


def _nested_lines(func: FunctionNode) -> set[int]:
    lines: set[int] = set()
    stack: list[ast.AST] = list(ast.iter_child_nodes(func))
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            # La ligne `def` imbriquée s'exécute dans la fonction parente : elle
            # lui reste comptée, seul le corps part avec la fonction imbriquée.
            lines.update(_body_lines(node))
            continue
        stack.extend(ast.iter_child_nodes(node))
    return lines


def score_file(path: Path, rel_path: str, executed: set[int], missing: set[int]):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    seen: dict[str, int] = {}
    for name, func, nested in _iter_functions(tree):
        # Deux définitions du même nom (propriété et son setter, surcharge
        # conditionnelle) restent distinctes dans la référence.
        seen[name] = seen.get(name, 0) + 1
        key_name = name if seen[name] == 1 else f"{name}#{seen[name]}"
        own = set(_body_lines(func)) - nested
        covered = len(own & executed)
        statements = covered + len(own & missing)
        yield FunctionScore(
            key=f"{rel_path}::{key_name}",
            path=rel_path,
            line=func.lineno,
            complexity=cyclomatic_complexity(func),
            covered=covered,
            statements=statements,
        )


def collect_scores(source_dir: Path, coverage_path: Path) -> list[FunctionScore]:
    report = json.loads(coverage_path.read_text(encoding="utf-8"))
    files = {
        Path(name).resolve(): data for name, data in report.get("files", {}).items()
    }
    scores: list[FunctionScore] = []
    for path in sorted(source_dir.rglob("*.py")):
        rel_path = path.relative_to(BACKEND_DIR).as_posix()
        data = files.get(path.resolve())
        # Un module jamais importé par les tests est absent du rapport : toutes
        # ses lignes sont tenues pour non couvertes (l'analyse AST les retrouve).
        if data is None:
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            executed, missing = set(), set(range(1, line_count + 1))
        else:
            executed = set(data["executed_lines"])
            missing = set(data["missing_lines"])
        scores.extend(score_file(path, rel_path, executed, missing))
    return scores


def load_baseline(path: Path) -> dict[str, float]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))["functions"]


def compare_to_baseline(
    scores: list[FunctionScore], baseline: dict[str, float], threshold: float
) -> tuple[list[FunctionScore], list[FunctionScore], list[str]]:
    """Règle de la référence : au-dessus du seuil, une fonction absente de la
    référence (nouvelle) ou dont le score a monté (en hausse) fait échouer ;
    une entrée qui a baissé ou disparu invite à resserrer la référence."""
    above = [s for s in scores if s.crap > threshold]
    new = [s for s in above if s.key not in baseline]
    worse = [s for s in above if s.key in baseline and s.crap > baseline[s.key]]
    current = {s.key: s.crap for s in scores}
    improved = sorted(
        key for key, value in baseline.items() if current.get(key, 0.0) < value
    )
    return new, worse, improved


def write_baseline(path: Path, scores: list[FunctionScore], threshold: float) -> None:
    offenders = {s.key: s.crap for s in scores if s.crap > threshold}
    payload = {
        # 30 plutôt que 30.0, comme la référence du front.
        "threshold": int(threshold) if threshold.is_integer() else threshold,
        "functions": dict(sorted(offenders.items())),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def _row(s: FunctionScore) -> str:
    return (
        f"{s.crap:>8.1f}  {s.complexity:>4}  {s.coverage:>6.0%}  "
        f"{s.path}:{s.line}  {s.key.split('::', 1)[1]}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--coverage", type=Path, default=BACKEND_DIR / "coverage.json")
    parser.add_argument("--source", type=Path, default=BACKEND_DIR / "app")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument(
        "--top", type=int, default=15, help="nombre de pires fonctions affichées"
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="réécrit la référence (fonctions au-dessus du seuil), sans contrôle",
    )
    parser.add_argument(
        "--json", type=Path, help="écrit aussi tous les scores dans ce fichier"
    )
    args = parser.parse_args()

    if not args.coverage.exists():
        print(
            f"{args.coverage} introuvable : lancer `uv run coverage run -m pytest` "
            "puis `uv run coverage json`.",
            file=sys.stderr,
        )
        return 1

    scores = collect_scores(args.source.resolve(), args.coverage)
    scores.sort(key=lambda s: (-s.crap, s.key))

    if args.json:
        args.json.write_text(
            json.dumps(
                [
                    {
                        "function": s.key,
                        "line": s.line,
                        "complexity": s.complexity,
                        "coverage": round(s.coverage, 4),
                        "crap": s.crap,
                    }
                    for s in scores
                ],
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )

    if args.update_baseline:
        write_baseline(args.baseline, scores, args.threshold)
        count = sum(1 for s in scores if s.crap > args.threshold)
        print(
            f"Référence réécrite : {args.baseline} "
            f"({count} fonctions au-dessus de {args.threshold:g})."
        )
        return 0

    above = [s for s in scores if s.crap > args.threshold]
    print(
        f"CRAP backend : {len(scores)} fonctions, {len(above)} au-dessus de "
        f"{args.threshold:g}, pire {scores[0].crap if scores else 0:.1f}."
    )
    print(f"\n{'CRAP':>8}  {'comp':>4}  {'couv.':>6}  fonction")
    for s in scores[: args.top]:
        print(_row(s))

    baseline = load_baseline(args.baseline)
    new, worse, improved = compare_to_baseline(scores, baseline, args.threshold)
    current = {s.key: s.crap for s in scores}

    if improved:
        print(
            f"\n{len(improved)} entrée(s) de la référence ont baissé ou disparu : "
            "resserrer la référence (--update-baseline)."
        )
        for key in improved:
            print(f"  {key} : {baseline[key]:.1f} -> {current.get(key, 0.0):.1f}")

    if new or worse:
        print(f"\nÉCHEC : régression CRAP (seuil {args.threshold:g}).", file=sys.stderr)
        for s in new:
            print(f"  nouvelle : {_row(s)}", file=sys.stderr)
        for s in worse:
            print(
                f"  en hausse ({baseline[s.key]:.1f} avant) : {_row(s)}",
                file=sys.stderr,
            )
        return 1

    print("\nAucune régression CRAP par rapport à la référence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
