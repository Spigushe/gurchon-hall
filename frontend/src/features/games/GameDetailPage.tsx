import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { BackRow } from "../../components/Sheet";
import { useLocalGame, type GameKey } from "../../offline/vtes";
import { GameDetail } from "./GameDetail";

/** Détail d'une partie, adressé par sa clé stable (`ref:<uuid>` ou `id:<n>`). */
export function GameDetailPage({ gameKey }: { gameKey: GameKey }) {
  // `undefined` : pas encore lu ; `null` : introuvable.
  const game = useLocalGame(gameKey);

  if (game === undefined) {
    return (
      <div className="page" data-testid="game-loading">
        <LoadingState caption="Lecture de la partie — aucun appel réseau." />
      </div>
    );
  }
  if (game === null) {
    return (
      <div className="page" data-testid="game-not-found">
        <h2 className="not-found__title">Partie introuvable</h2>
        <p className="not-found__body">Elle a peut-être été supprimée depuis un autre appareil.</p>
        <p>
          <Link to={{ name: "games" }} className="btn-ghost">
            Retour aux parties →
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="page" data-testid="game-page">
      <BackRow label="Parties" onClick={() => navigate({ name: "games" })} data-testid="game-back" />
      <GameDetail game={game} onDeleted={() => navigate({ name: "games" })} />
    </div>
  );
}
