import { ClockCountdown } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { plural } from "../../labels";
import { useLocalGames, useLocalTournaments, type LocalTournament } from "../../offline/vtes";
import { formatLocalDate } from "./gameFormat";
import { PlaySwitcher } from "./PlaySwitcher";

function TournamentItem({ tournament }: { tournament: LocalTournament }) {
  return (
    <li className="row" data-testid="tournament-item" data-tournament-key={tournament.key} data-pending={tournament.pending}>
      <span className="row__name">{tournament.name}</span>
      <span className="row__meta">
        {formatLocalDate(tournament.startDate)} · {tournament.deckPolicy === "mono" ? "mono-deck" : "multi-deck"}
      </span>
      {tournament.pending && (
        <span className="row__pending" data-testid="pending-badge">
          <ClockCountdown size={14} />
          En attente de synchronisation
        </span>
      )}
    </li>
  );
}

/**
 * Tournois, lecture seule (Lot 7, D1) : la liste locale ou l'état vide. L'écran complet
 * (création, classement, détail, finale) est celui de l'étape D2 ; il remplacera ce
 * composant. Le sélecteur « Parties | Tournois » est déjà posé.
 */
export function TournamentsPage() {
  const tournaments = useLocalTournaments();
  const games = useLocalGames();

  return (
    <div className="page page--games" data-testid="tournaments-page">
      <div>
        <h2 className="page-title">Parties</h2>
        <p className="page-meta">
          {tournaments ? plural(tournaments.length, "tournoi") : "…"} · lecture locale
        </p>
      </div>
      <div className="games-toolbar">
        <PlaySwitcher active="tournaments" gameCount={games?.length} tournamentCount={tournaments?.length} />
      </div>
      {tournaments === undefined ? (
        <LoadingState caption="Lecture des tournois — aucun appel réseau." />
      ) : tournaments.length === 0 ? (
        <div className="empty-state" data-testid="tournaments-empty">
          <h3 className="empty-state__title">Aucun tournoi</h3>
          <p className="empty-state__body">Créez le tournoi en arrivant : les rondes s'y rattachent ensuite.</p>
        </div>
      ) : (
        <ul className="list" data-testid="tournament-list">
          {tournaments.map((tournament) => (
            <TournamentItem key={tournament.key} tournament={tournament} />
          ))}
        </ul>
      )}
    </div>
  );
}
