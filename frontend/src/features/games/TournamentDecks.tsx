import { Link } from "../../app/Link";
import { useConnectivity } from "../../offline/react";
import { findByKey, type DeckKey, type LocalGame, type LocalTournament } from "../../offline/vtes";
import { frozenAtLabel, roundsPlayedLabel, versionLegalityTag } from "./tournamentDecksModel";
import { useVersionLegality } from "./useVersionLegality";

/**
 * Pastille « Légal le 24 octobre » (P11) : élément à part, qu'on retire sans
 * toucher au reste du bloc. Lue en ligne, à la date de début du tournoi.
 */
function VersionLegalityTag({ deckId, number, on }: { deckId: number; number: number; on: string }) {
  const online = useConnectivity();
  const outcome = useVersionLegality(deckId, number, on, online);
  const { kind, label, detail } = versionLegalityTag(on, online, outcome);
  return (
    <span
      className={`legality-tag legality-tag--${kind} tournament-decks__legality`}
      data-testid="tournament-deck-legality"
      data-legal={kind === "unknown" ? undefined : kind === "legal"}
      title={detail ?? undefined}
    >
      {label}
    </span>
  );
}

/**
 * « Decks joués » du détail d'un tournoi (Lot 8, écran 6 ; 1b-54, d32) : la
 * version de chaque deck dans le tournoi (A9), la partie qui l'a figée, les
 * rondes jouées avec, la légalité de la liste à la date du tournoi (P11) et le
 * lien vers sa liste.
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
              <VersionLegalityTag deckId={entry.deckId} number={entry.deckVersionNumber} on={tournament.startDate} />
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
