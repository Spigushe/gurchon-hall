import { Link } from "../../app/Link";
import { findByKey, type DeckKey, type LocalGame, type LocalTournament } from "../../offline/vtes";
import { frozenAtLabel, roundsPlayedLabel } from "./tournamentDecksModel";

/**
 * « Decks joués » du détail d'un tournoi (Lot 8, écran 6 ; 1b-54, d32) : la
 * version de chaque deck dans le tournoi (A9), la partie qui l'a figée, les
 * rondes jouées avec, et le lien vers sa liste. La légalité à la date du
 * tournoi (P11) viendra se poser à côté, en élément à part, avec B3.
 */
export function TournamentDecks({
  tournament,
  games,
  deckName,
  dense,
}: {
  tournament: LocalTournament;
  games: readonly LocalGame[];
  deckName: (key: DeckKey) => string | null;
  dense: boolean;
}) {
  if (tournament.deckVersions.length === 0) return null;
  return (
    <section className={dense ? "tournament-decks tournament-decks--dense" : "tournament-decks"} data-testid="tournament-decks">
      <p className="kicker">Decks joués</p>
      <ul className="tournament-decks__list">
        {tournament.deckVersions.map((entry) => {
          const played = games.filter((game) => game.me.deckKey === entry.deckKey);
          const sub = [frozenAtLabel(findByKey(games, entry.frozenByGameKey)), roundsPlayedLabel(played)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={entry.deckKey} className="tournament-decks__item" data-testid="tournament-deck" data-deck-key={entry.deckKey}>
              <span className="tournament-decks__main">
                <span className="tournament-decks__name">
                  {deckName(entry.deckKey) ?? "Deck"} · v{entry.deckVersionNumber}
                </span>
                {sub && (
                  <span className="tournament-decks__sub" data-testid="tournament-deck-frozen">
                    {sub}
                  </span>
                )}
              </span>
              <Link
                to={{ name: "deckVersion", key: entry.deckKey, number: entry.deckVersionNumber }}
                className="bilan-version__link"
                data-testid="tournament-deck-version-link"
              >
                Voir la liste
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
