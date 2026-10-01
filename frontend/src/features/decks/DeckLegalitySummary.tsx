import { useMemo } from "react";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck, LocalDeckCard } from "../../offline/vtes";
import { useCardCategoriesById } from "./useCardCategories";
import { useDeckLegality } from "./useDeckLegality";

/**
 * Verdict de légalité + quatre chiffres (crypte, bibliothèque, groupes,
 * cartes bannies), factorisés pour être partagés par l'aperçu maître/détail
 * des Decks (Lot 5bis, étape 6, `docs/design-handoff/DESKTOP.md`
 * « d04 ») et par le futur en-tête du Deckbuilder (étape 11) : les deux
 * écrans doivent afficher le même verdict, lu en ligne
 * (`GET /decks/{id}/legalite`, `useDeckLegality`), avec le même repli hors
 * ligne que `DeckLegalityPanel` (indisponible tant que le deck n'existe pas
 * côté serveur, tant qu'on est hors ligne, ou en cas d'erreur).
 *
 * Écart volontaire avec `DeckLegalityPanel` : celui-ci reste la vue complète
 * (issues, cartes pas encore légales, recalcul manuel) de l'écran plein
 * deck ; ce composant est la version compacte à quatre chiffres du handoff
 * bureau, pas un remplacement.
 *
 * Crypte et bibliothèque restent lisibles hors ligne, contrairement au reste
 * du verdict : plutôt que d'attendre le serveur, ces deux chiffres retombent
 * sur un compte purement local (la composition du deck, `lines`, croisée avec
 * la catégorie du miroir catalogue via `useCardCategoriesById`) tant que le
 * verdict serveur n'a pas répondu. Groupes et cartes bannies n'ont pas
 * d'équivalent local : « indisponible » sans verdict, comme le reste de
 * `DeckLegalityPanel`.
 *
 * `refreshToken` (Lot 5bis, étape 11) relance la lecture du verdict sans
 * dupliquer `useDeckLegality` : par défaut à 0 (comportement inchangé pour
 * `DecksPage.tsx`, qui ne le passe pas), l'en-tête du Deckbuilder bureau
 * possède son propre état local et l'incrémente depuis son bouton
 * « Recalculer » (kbd `R`).
 */
export function DeckLegalitySummary({
  deck,
  lines,
  refreshToken = 0,
}: {
  deck: LocalDeck;
  lines: LocalDeckCard[] | undefined;
  refreshToken?: number;
}) {
  const online = useConnectivity();
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", refreshToken);

  const cardIds = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const categories = useCardCategoriesById(cardIds);
  const localCounts = useMemo(() => {
    if (lines === undefined || categories === undefined) return null;
    let crypt = 0;
    let library = 0;
    for (const line of lines) {
      const category = categories.get(line.cardId);
      if (category === "crypt") crypt += line.quantity;
      else if (category === "library") library += line.quantity;
    }
    return { crypt, library };
  }, [lines, categories]);

  const ready = outcome?.kind === "ready" ? outcome.legality : null;

  let title: string;
  let detail: string;
  let legal: boolean | undefined;
  if (deck.id === null) {
    title = "Verdict en attente";
    detail = "Création pas encore synchronisée.";
  } else if (!online) {
    title = "Verdict indisponible";
    detail = "Hors ligne : les comptes ci-dessous restent locaux, le verdict reviendra au retour du réseau.";
  } else if (outcome === null) {
    title = "Calcul du verdict…";
    detail = "";
  } else if (outcome.kind === "error") {
    title = "Verdict indisponible";
    detail = outcome.message;
  } else {
    title = ready!.is_legal ? "Deck légal" : "Deck illégal";
    detail = `Verdict du serveur, ${ready!.evaluated_on}`;
    legal = ready!.is_legal;
  }

  const cryptValue = ready ? String(ready.crypt_count) : localCounts ? String(localCounts.crypt) : "…";
  const libraryValue = ready ? String(ready.library_count) : localCounts ? String(localCounts.library) : "…";
  const groupsValue = ready
    ? ready.crypt_groups.length > 0
      ? ready.crypt_groups.join(", ")
      : "aucun"
    : "indisponible";
  const bannedValue = ready ? String(ready.banned_cards.length) : "indisponible";

  return (
    <div data-testid="deck-summary" data-legal={legal}>
      <div className="accent-block">
        <p className="accent-block__title" data-testid="deck-summary-verdict">
          {title}
        </p>
        {detail && <p className="accent-block__detail">{detail}</p>}
      </div>
      <ul className="facts">
        <li className="facts__row" data-testid="deck-summary-crypt">
          <span className="facts__label">Crypte</span>
          <span className="facts__value">{cryptValue}</span>
        </li>
        <li className="facts__row" data-testid="deck-summary-library">
          <span className="facts__label">Bibliothèque</span>
          <span className="facts__value">{libraryValue}</span>
        </li>
        <li className="facts__row" data-testid="deck-summary-groups">
          <span className="facts__label">Groupes</span>
          <span className="facts__value">{groupsValue}</span>
        </li>
        <li className="facts__row" data-testid="deck-summary-banned">
          <span className="facts__label">Cartes bannies</span>
          <span className="facts__value">{bannedValue}</span>
        </li>
      </ul>
    </div>
  );
}
