import { useState } from "react";
import { plural } from "../../labels";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { useDeckLegality } from "./useDeckLegality";

/**
 * Verdict de légalité, en lecture seule.
 *
 * Il vient du serveur et n'existe donc qu'en ligne, pour un deck déjà connu de
 * lui. Le serveur ne bloque jamais la construction (un brouillon est incomplet
 * par nature) : la légalité ne gate que le passage à « actif ». Un deck actif
 * peut ensuite devenir illégal sans que rien ne le signale d'office (§11) :
 * c'est ici qu'on l'affiche.
 */
export function DeckLegalityPanel({ deck }: { deck: LocalDeck }) {
  const online = useConnectivity();
  const [refreshToken, setRefreshToken] = useState(0);
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", refreshToken);

  let body;
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
  } else if (outcome === null) {
    body = <p>Calcul du verdict…</p>;
  } else if (outcome.kind === "error") {
    body = (
      <p className="error" role="alert" data-testid="legality-error">
        Verdict indisponible : {outcome.message}.
      </p>
    );
  } else {
    const legality = outcome.legality;
    body = (
      <div data-testid="legality-verdict" data-legal={legality.is_legal}>
        <p>
          <span
            className={`badge ${legality.is_legal ? "badge--ok" : "badge--ko"}`}
            data-testid="legality-badge"
          >
            {legality.is_legal ? "Deck légal" : "Deck illégal"}
          </span>{" "}
          <small className="hint">verdict du {legality.evaluated_on}</small>
        </p>
        {deck.status === "active" && !legality.is_legal && (
          <p className="error" role="alert" data-testid="legality-active-illegal">
            Ce deck est actif mais n'est plus légal. Corrigez-le ou repassez-le en brouillon.
          </p>
        )}
        {deck.status === "draft" && !legality.is_legal && (
          <p className="hint">Un brouillon n'a pas à être légal : seule l'activation l'exige.</p>
        )}
        <ul className="facts">
          <li data-testid="legality-crypt">
            Crypte : {legality.crypt_count} (minimum {legality.crypt_minimum})
          </li>
          <li data-testid="legality-library">
            Bibliothèque : {legality.library_count} (entre {legality.library_minimum} et{" "}
            {legality.library_maximum})
          </li>
          <li>
            Groupes de la crypte :{" "}
            {legality.crypt_groups.length > 0 ? legality.crypt_groups.join(", ") : "aucun"}
          </li>
        </ul>
        {legality.issues.length > 0 && (
          <ul className="issues" data-testid="legality-issues">
            {legality.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {legality.banned_cards.length > 0 && (
          <p>
            {plural(legality.banned_cards.length, "carte bannie", "cartes bannies")} :{" "}
            {legality.banned_cards.map((card) => card.name).join(", ")}
          </p>
        )}
        {legality.not_yet_legal_cards.length > 0 && (
          <p>
            {plural(legality.not_yet_legal_cards.length, "carte pas encore légale", "cartes pas encore légales")}{" "}
            : {legality.not_yet_legal_cards.map((card) => card.name).join(", ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="legality-title" data-testid="legality-panel">
      <h2 id="legality-title" className="panel__title panel__title--small">
        Légalité
      </h2>
      {deck.pending && deck.id !== null && online && (
        <p className="hint" data-testid="legality-stale">
          Des modifications de ce deck ne sont pas encore synchronisées : le verdict porte sur la
          version du serveur.
        </p>
      )}
      {body}
      {online && deck.id !== null && (
        <button
          type="button"
          onClick={() => setRefreshToken((token) => token + 1)}
          disabled={outcome === null}
          data-testid="legality-refresh"
        >
          Recalculer le verdict
        </button>
      )}
    </section>
  );
}
