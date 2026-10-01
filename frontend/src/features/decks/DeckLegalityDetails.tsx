import type { LocalDeck } from "../../offline/vtes";
import type { LegalityOutcome } from "./useDeckLegality";

/**
 * Détail du verdict de légalité, sous les quatre chiffres compacts de
 * `DeckLegalitySummary` (en-tête du Deckbuilder bureau, Lot 5c étape 1).
 *
 * Composant de présentation pur : il ne lit rien lui-même. Le verdict
 * (`outcome`) et l'état du réseau viennent de `DeckLegalitySummary`, qui est
 * le seul à appeler `useDeckLegality` sur l'écran — une seule lecture
 * serveur, partagée avec le bouton « Recalculer » (`refreshToken`).
 *
 * Il reprend ce que `DeckLegalityPanel` affiche au mobile, avec les mêmes
 * `data-testid` : motifs en clair (`legality-issues`), noms des cartes bannies
 * et pas encore légales, alerte d'un deck actif devenu illégal
 * (`legality-active-illegal`), note brouillon, avertissement de version
 * (`legality-stale`), états indisponible (`legality-unavailable`) et erreur
 * (`legality-error`). Les effectifs et les groupes restent dans le résumé.
 */
export function DeckLegalityDetails({
  deck,
  online,
  outcome,
}: {
  deck: LocalDeck;
  online: boolean;
  outcome: LegalityOutcome | null;
}) {
  let body = null;
  if (deck.id === null) {
    body = (
      <p className="hint" data-testid="legality-unavailable">
        Verdict indisponible : ce deck n'existe pas encore côté serveur (création en attente de
        synchronisation).
      </p>
    );
  } else if (!online) {
    body = (
      <p className="hint" data-testid="legality-unavailable">
        Verdict indisponible hors ligne : il est calculé par le serveur. Il sera consultable au
        retour du réseau.
        {deck.status === "active" &&
          " Un deck actif peut devenir illégal (bannissement, sortie de légalité) : vérifiez-le dès que vous êtes en ligne."}
      </p>
    );
  } else if (outcome?.kind === "error") {
    body = (
      <p className="error-text" role="alert" data-testid="legality-error">
        Verdict indisponible : {outcome.message}.
      </p>
    );
  } else if (outcome?.kind === "ready") {
    const legality = outcome.legality;
    body = (
      <>
        {deck.status === "active" && !legality.is_legal && (
          <p className="error-text" role="alert" data-testid="legality-active-illegal">
            Ce deck est actif mais n'est plus légal. Corrigez-le ou repassez-le en brouillon.
          </p>
        )}
        {deck.status === "draft" && !legality.is_legal && (
          <p className="hint" data-testid="legality-draft-note">
            Un brouillon n'a pas à être légal : seule l'activation l'exige.
          </p>
        )}
        {legality.banned_cards.length > 0 && (
          <p className="hint" data-testid="legality-banned-names">
            Cartes bannies : {legality.banned_cards.map((card) => card.name).join(", ")}
          </p>
        )}
        {legality.not_yet_legal_cards.length > 0 && (
          <p className="hint" data-testid="legality-not-yet-legal-names">
            Pas encore légales : {legality.not_yet_legal_cards.map((card) => card.name).join(", ")}
          </p>
        )}
        {legality.issues.length > 0 && (
          <ul className="issues" data-testid="legality-issues">
            {legality.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="deck-legality-details" data-testid="legality-details">
      {deck.pending && deck.id !== null && online && (
        <p className="hint" data-testid="legality-stale">
          Des modifications de ce deck ne sont pas encore synchronisées : le verdict porte sur la
          version du serveur.
        </p>
      )}
      {body}
    </div>
  );
}
