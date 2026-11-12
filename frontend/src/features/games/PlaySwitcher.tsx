import { Link } from "../../app/Link";

/**
 * Sélecteur « Parties | Tournois | Bilan » (P2 du Lot 7, P10 du Lot 8). Il change de **route** (`#/parties` ↔
 * `#/tournois`), pas un simple état : on peut rouvrir l'un ou l'autre par son adresse.
 * Segmenté pleine largeur au mobile, onglets soulignés avec compteurs au bureau : la
 * même balise, c'est la feuille de style qui tranche (`.play-switch`).
 */
export function PlaySwitcher({
  active,
  gameCount,
  tournamentCount,
}: {
  active: "games" | "tournaments" | "bilan";
  gameCount?: number;
  tournamentCount?: number;
}) {
  return (
    <nav aria-label="Parties, tournois et bilan" className="play-switch" data-testid="play-switch">
      <Link
        to={{ name: "games" }}
        current={active === "games"}
        className="play-switch__item"
        data-testid="play-switch-games"
      >
        Parties
        {gameCount !== undefined && <span className="play-switch__count"> · {gameCount}</span>}
      </Link>
      <Link
        to={{ name: "tournaments" }}
        current={active === "tournaments"}
        className="play-switch__item"
        data-testid="play-switch-tournaments"
      >
        Tournois
        {tournamentCount !== undefined && <span className="play-switch__count"> · {tournamentCount}</span>}
      </Link>
      <Link
        to={{ name: "bilan" }}
        current={active === "bilan"}
        className="play-switch__item"
        data-testid="play-switch-bilan"
      >
        Bilan
      </Link>
    </nav>
  );
}
