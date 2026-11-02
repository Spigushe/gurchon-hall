import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { BackRow } from "../../components/Sheet";
import { useLocalTournament, type ResourceKey } from "../../offline/vtes";
import { TournamentDetail } from "./TournamentDetail";

/** Détail d'un tournoi, adressé par sa clé stable (`ref:<uuid>` ou `id:<n>`). */
export function TournamentDetailPage({ tournamentKey }: { tournamentKey: ResourceKey }) {
  // `undefined` : pas encore lu ; `null` : introuvable.
  const tournament = useLocalTournament(tournamentKey);

  if (tournament === undefined) {
    return (
      <div className="page" data-testid="tournament-loading">
        <LoadingState caption="Lecture du tournoi — aucun appel réseau." />
      </div>
    );
  }
  if (tournament === null) {
    return (
      <div className="page" data-testid="tournament-not-found">
        <h2 className="not-found__title">Tournoi introuvable</h2>
        <p className="not-found__body">Il a peut-être été supprimé depuis un autre appareil.</p>
        <p>
          <Link to={{ name: "tournaments" }} className="btn-ghost">
            Retour aux tournois →
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="page" data-testid="tournament-page">
      <BackRow label="Tournois" onClick={() => navigate({ name: "tournaments" })} data-testid="tournament-back" />
      <TournamentDetail tournament={tournament} onDeleted={() => navigate({ name: "tournaments" })} />
    </div>
  );
}
