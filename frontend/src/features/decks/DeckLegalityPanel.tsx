import { useState } from "react";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { useDeckLegality } from "./useDeckLegality";

/**
 * Verdict de légalité, en lecture seule (handoff Nocturne « Détail du deck »,
 * §4) : une règle verticale accent porte le statut, plus de badge ni de
 * panneau plein — l'accent *est* le marqueur.
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

  const refresh = (label: string) => (
    <button
      type="button"
      className="btn-text"
      onClick={() => setRefreshToken((token) => token + 1)}
      disabled={outcome === null}
      data-testid="legality-refresh"
    >
      {label}
    </button>
  );

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
    body = <p className="hint">Calcul du verdict…</p>;
  } else if (outcome.kind === "error") {
    body = (
      <p className="error-text" role="alert" data-testid="legality-error">
        Verdict indisponible : {outcome.message}.
      </p>
    );
  } else {
    const legality = outcome.legality;
    body = (
      <div data-testid="legality-verdict" data-legal={legality.is_legal}>
        <div className="accent-block">
          <p className="accent-block__title" data-testid="legality-badge">
            {legality.is_legal ? "Deck légal" : "Deck illégal"}
          </p>
          <p className="accent-block__detail">
            Verdict du serveur, {legality.evaluated_on} · {refresh("recalculer")}
          </p>
        </div>
        {deck.status === "active" && !legality.is_legal && (
          <p className="error-text" role="alert" data-testid="legality-active-illegal">
            Ce deck est actif mais n'est plus légal. Corrigez-le ou repassez-le en brouillon.
          </p>
        )}
        {deck.status === "draft" && !legality.is_legal && (
          <p className="hint">Un brouillon n'a pas à être légal : seule l'activation l'exige.</p>
        )}
        <ul className="facts">
          <li className="facts__row" data-testid="legality-crypt">
            <span className="facts__label">Crypte</span>
            <span className="facts__value">
              {legality.crypt_count} <span className="facts__limit">/ min {legality.crypt_minimum}</span>
            </span>
          </li>
          <li className="facts__row" data-testid="legality-library">
            <span className="facts__label">Bibliothèque</span>
            <span className="facts__value">
              {legality.library_count}{" "}
              <span className="facts__limit">
                / {legality.library_minimum}–{legality.library_maximum}
              </span>
            </span>
          </li>
          <li className="facts__row">
            <span className="facts__label">Groupes</span>
            <span className="facts__value">
              {legality.crypt_groups.length > 0 ? legality.crypt_groups.join(", ") : "aucun"}
            </span>
          </li>
          <li className="facts__row">
            <span className="facts__label">Cartes bannies</span>
            <span className="facts__value">
              {legality.banned_cards.length > 0
                ? legality.banned_cards.map((card) => card.name).join(", ")
                : "aucune"}
            </span>
          </li>
          {legality.not_yet_legal_cards.length > 0 && (
            <li className="facts__row">
              <span className="facts__label">Pas encore légales</span>
              <span className="facts__value">
                {legality.not_yet_legal_cards.map((card) => card.name).join(", ")}
              </span>
            </li>
          )}
        </ul>
        {legality.issues.length > 0 && (
          <ul className="issues" data-testid="legality-issues">
            {legality.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Légalité" data-testid="legality-panel">
      {deck.pending && deck.id !== null && online && (
        <p className="hint" data-testid="legality-stale">
          Des modifications de ce deck ne sont pas encore synchronisées : le verdict porte sur la
          version du serveur.
        </p>
      )}
      {body}
      {online && deck.id !== null && outcome?.kind !== "ready" && refresh("Recalculer le verdict")}
    </section>
  );
}
