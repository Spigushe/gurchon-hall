import { useState } from "react";
import { formatDate, plural } from "../../labels";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { useDeckLegality } from "./useDeckLegality";

/**
 * Verdict de légalité, en lecture seule (Lot 7, handoff écran 4 point 3).
 *
 * Il vient du serveur et n'existe donc qu'en ligne, pour un deck déjà connu de
 * lui. Le serveur ne bloque jamais la construction (un brouillon est incomplet
 * par nature) : la légalité ne gate que le passage à « actif ». Un deck actif
 * peut ensuite devenir illégal sans que rien ne le signale d'office (§11) :
 * c'est ici qu'on l'affiche.
 *
 * Habillage Nocturne : pas de badge de couleur, pas de panneau rempli — le
 * liseré accent à gauche du titre *est* le marqueur de statut (légal ou non),
 * et le texte porte la nuance (avertissement pour un deck actif devenu
 * illégal). Aucune des valeurs ci-dessous n'est recalculée ici : tout vient de
 * `useDeckLegality`, qui lit `GET /decks/{id}/legalite`.
 */
export function DeckLegalityPanel({ deck }: { deck: LocalDeck }) {
  const online = useConnectivity();
  const [refreshToken, setRefreshToken] = useState(0);
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", refreshToken);
  const canRefresh = online && deck.id !== null;

  const refresh = canRefresh ? (
    <button
      type="button"
      className="legality-refresh"
      onClick={() => setRefreshToken((token) => token + 1)}
      disabled={outcome === null}
      data-testid="legality-refresh"
    >
      recalculer
    </button>
  ) : null;

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
    body = <p className="hint">Calcul du verdict… {refresh}</p>;
  } else if (outcome.kind === "error") {
    body = (
      <p className="error" role="alert" data-testid="legality-error">
        Verdict indisponible : {outcome.message}. {refresh}
      </p>
    );
  } else {
    const legality = outcome.legality;
    body = (
      <div data-testid="legality-verdict" data-legal={legality.is_legal}>
        <div className="legality-verdict">
          <p className="legality-verdict__title" data-testid="legality-badge">
            {legality.is_legal ? "Deck légal" : "Deck illégal"}
          </p>
          <p className="legality-verdict__meta">
            Verdict du serveur, {formatDate(legality.evaluated_on)} · {refresh}
          </p>
          {deck.status === "active" && !legality.is_legal && (
            <p className="legality-verdict__warning" role="alert" data-testid="legality-active-illegal">
              Actif mais plus légal : corrigez-le ou repassez-le en brouillon.
            </p>
          )}
          {deck.status === "draft" && !legality.is_legal && (
            <p className="hint">Un brouillon n'a pas à être légal : seule l'activation l'exige.</p>
          )}
        </div>
        <ul className="fact-list">
          <li className="fact-row" data-testid="legality-crypt">
            <span className="fact-row__label">Crypte</span>
            <span className="fact-row__value">
              {legality.crypt_count}{" "}
              <span className="fact-row__limit">/ min {legality.crypt_minimum}</span>
            </span>
          </li>
          <li className="fact-row" data-testid="legality-library">
            <span className="fact-row__label">Bibliothèque</span>
            <span className="fact-row__value">
              {legality.library_count}{" "}
              <span className="fact-row__limit">
                / {legality.library_minimum}–{legality.library_maximum}
              </span>
            </span>
          </li>
          <li className="fact-row">
            <span className="fact-row__label">Groupes</span>
            <span className="fact-row__value">
              {legality.crypt_groups.length > 0 ? legality.crypt_groups.join(", ") : "aucun"}
            </span>
          </li>
          <li className="fact-row">
            <span className="fact-row__label">
              {plural(legality.banned_cards.length, "Carte bannie", "Cartes bannies")}
            </span>
            <span className="fact-row__value">
              {legality.banned_cards.length > 0
                ? legality.banned_cards.map((card) => card.name).join(", ")
                : "aucune"}
            </span>
          </li>
          {legality.not_yet_legal_cards.length > 0 && (
            <li className="fact-row">
              <span className="fact-row__label">
                {plural(
                  legality.not_yet_legal_cards.length,
                  "Carte pas encore légale",
                  "Cartes pas encore légales",
                )}
              </span>
              <span className="fact-row__value">
                {legality.not_yet_legal_cards.map((card) => card.name).join(", ")}
              </span>
            </li>
          )}
        </ul>
        {legality.issues.length > 0 && (
          <ul className="issue-list" data-testid="legality-issues">
            {legality.issues.map((issue) => (
              <li key={issue} className="issue-list__item">
                {issue}
              </li>
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
    </section>
  );
}
