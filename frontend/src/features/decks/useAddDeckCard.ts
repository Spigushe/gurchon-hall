import { useMemo, useState } from "react";
import {
  useLocalDeckCards,
  type DeckCardInput,
  type LocalDeck,
  type LocalDeckCard,
} from "../../offline/vtes";
import { useAvailableStock } from "./useAvailableStock";

export const MAX_INT = 2_147_483_647;

/** Carte à ajouter : le hook ne sait rien de la façon dont elle a été choisie. */
export interface AddCardTarget {
  cardId: number;
  /** Extension de la dernière version de la carte (D2a), calculée par le serveur. */
  latestCardSetId: number;
}

export interface AddLineState {
  /** Copies ajoutées par ce geste (pas la quantité finale de la ligne). */
  copies: number;
  /** Dont déjà possédées, bornées entre 0 et `copies` (déjà tout si le deck refuse les proxies). */
  possessed: number;
  /** Exemplaires réels disponibles pour ce deck (autres decks déduits), `undefined` tant que non lu. */
  available: number | undefined;
  /** Ligne déjà présente dans le deck pour ce triplet, le cas échéant. */
  existing: Pick<LocalDeckCard, "quantity" | "proxyQuantity"> | undefined;
}

/**
 * Calcule l'état complet voulu de la ligne après ajout (`deck_card.upsert`
 * porte un état, pas un delta, §11 Lot 3) : quantité et proxies de la ligne
 * existante, plus ceux des copies ajoutées. L'acquisition couvre le manque
 * pour que **tous** les exemplaires réels de la ligne (anciens et nouveaux)
 * tiennent dans la collection, sans dépasser les exemplaires réels que
 * l'écriture ajoute (borne du serveur et de `saveDeckCard`).
 */
export function computeAddedLine(state: AddLineState): {
  quantity: number;
  proxyQuantity: number;
  acquiredQuantity: number;
} {
  const { copies, possessed, available, existing } = state;
  const quantityBefore = existing?.quantity ?? 0;
  const proxyBefore = existing?.proxyQuantity ?? 0;
  const realBefore = quantityBefore - proxyBefore;
  const shortfall = available === undefined ? 0 : Math.max(0, realBefore + possessed - available);
  return {
    quantity: quantityBefore + copies,
    proxyQuantity: proxyBefore + (copies - possessed),
    acquiredQuantity: Math.min(shortfall, possessed),
  };
}

/**
 * Logique d'ajout d'une ligne de deck, sans présentation : copies, compteur
 * « déjà possédées », proxies, stock disponible (`useAvailableStock`, même
 * comptabilité que le serveur), extension, et l'écriture à envoyer. Extraite
 * d'`AddDeckCardForm` (Lot Chercher, D1a) pour être réutilisée par une autre
 * surface ; elle prend la carte en entrée (`null` tant qu'aucune n'est choisie).
 *
 * Par défaut une copie ajoutée est un proxy : c'est à l'utilisateur de dire
 * combien sont réellement possédées (pas de suggestion automatique, pour éviter
 * toute course entre la lecture de la disponibilité et sa saisie).
 */
export function useAddDeckCard(deck: LocalDeck, card: AddCardTarget | null) {
  const deckLines = useLocalDeckCards(deck.key);
  const [languageCode, setLanguageCode] = useState("FR");
  const [cardSetId, setCardSetId] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  const [owned, setOwned] = useState(0);

  const effectiveCardSetId = cardSetId ?? card?.latestCardSetId ?? null;
  const available = useAvailableStock(card?.cardId ?? null, languageCode, effectiveCardSetId, deck.key);
  // D2a : tant que rien n'est possédé, l'extension ne se demande pas (dernière
  // version prise sans poser la question) ; sans autorisation de proxy, tout
  // est possédé, donc toujours demandée.
  const askExtension = card !== null && (deck.proxyAllowed ? owned > 0 : true);
  const possessed = deck.proxyAllowed ? Math.min(Math.max(owned, 0), copies) : copies;

  // Ligne déjà présente dans ce deck pour ce triplet exact : sert à l'affichage
  // (« dans le deck N ») et à l'état complet envoyé, l'ajout s'y additionnant.
  const existing = useMemo(() => {
    if (!card || effectiveCardSetId === null) return undefined;
    return deckLines?.find(
      (line) =>
        line.cardId === card.cardId &&
        line.languageCode === languageCode &&
        line.cardSetId === effectiveCardSetId,
    );
  }, [deckLines, card, languageCode, effectiveCardSetId]);
  const inDeck = existing?.quantity ?? 0;

  const line = computeAddedLine({ copies, possessed, available, existing });
  const proxyQuantity = copies - possessed;
  const acquired = line.acquiredQuantity;

  const changeCopies = (next: number) => {
    const clamped = Math.max(1, Math.min(next, MAX_INT));
    setCopies(clamped);
    setOwned((current) => Math.min(current, clamped));
  };

  /** Remet copies, possédées et extension à leur départ (nouvelle carte, ou ajout réussi). */
  const reset = () => {
    setCardSetId(null);
    setCopies(1);
    setOwned(0);
  };

  /** Motif de refus local, ou `null` si l'écriture peut partir. */
  const validationError = (): string | null => {
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_INT) {
      return "Le nombre de copies est un entier, 1 ou plus.";
    }
    if (effectiveCardSetId === null) return "Choisissez une extension.";
    if (line.quantity > MAX_INT) return "Le deck ne peut pas contenir autant d'exemplaires de cette carte.";
    return null;
  };

  /** Écriture à passer à `actions.saveDeckCard`, `null` sans carte ou sans extension. */
  const input = (): DeckCardInput | null => {
    if (!card || effectiveCardSetId === null) return null;
    return {
      cardId: card.cardId,
      languageCode,
      cardSetId: effectiveCardSetId,
      quantity: line.quantity,
      proxyQuantity: line.proxyQuantity,
      acquiredQuantity: line.acquiredQuantity,
    };
  };

  return {
    languageCode,
    setLanguageCode,
    cardSetId,
    setCardSetId,
    effectiveCardSetId,
    askExtension,
    copies,
    changeCopies,
    possessed,
    setOwned,
    proxyQuantity,
    acquired,
    available,
    inDeck,
    reset,
    validationError,
    input,
  };
}
