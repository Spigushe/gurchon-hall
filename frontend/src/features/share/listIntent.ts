import type { DecksIntent, SharedListRef } from "../../app/routes";

/**
 * Intention « Dupliquer » ou « Comparer » en cours (Lot 13, D5, A8, A9).
 *
 * L'adresse la porte (`#/decks?action=dupliquer&liste=<jeton>`), mais `DecksPage`
 * la retire de l'adresse dès qu'elle l'a lue (`consumeIntent`). Si la session
 * expire juste après, `AuthGate` démonte l'application pour montrer l'écran de
 * connexion, puis la remonte : sans autre trace, l'intention serait perdue. On
 * la garde donc ici, en mémoire du module (jamais stockée : un rechargement
 * repart de l'adresse), jusqu'à ce que la feuille se ferme.
 */
export type ListIntentKind = Extract<DecksIntent, "duplicate" | "compare">;

export interface ListIntent extends SharedListRef {
  kind: ListIntentKind;
}

let held: ListIntent | null = null;

export const peekListIntent = (): ListIntent | null => held;
export const holdListIntent = (intent: ListIntent): void => {
  held = intent;
};
export const releaseListIntent = (): void => {
  held = null;
};
