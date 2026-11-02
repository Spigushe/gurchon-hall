import {
  collectClientRefs,
  type OperationReferences,
  type ReferenceField,
  type RefBinding,
} from "../core";
import type { CreationOperationType, VtesOperationType } from "./types";

/**
 * Genres de ressources qu'une référence client peut désigner, et table des
 * champs où une opération les désigne.
 *
 * Les deux tables ci-dessous sont typées contre l'union générée des
 * opérations (clés = types d'opération du contrat), pas contre des chaînes
 * libres : un type ajouté au contrat sans entrée de création fait échouer `tsc`.
 *
 * **Chaîner des références de plusieurs genres dans un même lot.** Les
 * identifiants serveur se recouvrent d'un genre à l'autre (un joueur 12 et un
 * deck 12 coexistent). La table `refs` du cœur est indexée par la seule
 * référence, les UUID ne s'y recouvrant pas, mais tout ce qui l'inverse
 * (identifiant -> référence) doit filtrer par genre : `bindingsOfKind`. Le
 * genre est rangé dans la correspondance au moment du verdict
 * (`CREATION_BINDINGS`), jamais deviné ensuite.
 */

export type ReferenceKind = "deck" | "player" | "venue" | "tournament" | "game";

/**
 * Genre d'une correspondance. Absent = deck : les correspondances rangées
 * avant le Lot 7 n'ont pas de genre et ne désignent que des decks.
 */
export function kindOfBinding(binding: Pick<RefBinding, "kind">): ReferenceKind {
  return (binding.kind ?? "deck") as ReferenceKind;
}

/** Les correspondances d'un seul genre (à utiliser avant tout retournement id -> référence). */
export function bindingsOfKind(
  bindings: readonly RefBinding[],
  kind: ReferenceKind,
): RefBinding[] {
  return bindings.filter((binding) => kindOfBinding(binding) === kind);
}

/** Ce qu'une création lie : le genre de la ressource et le champ de `SyncResourceRef` qui porte son identifiant. */
export interface CreationBinding {
  kind: ReferenceKind;
  idField: "deck_id" | "player_id" | "venue_id" | "tournament_id" | "game_id";
}

/**
 * Création -> genre de la ressource créée, et champ de `SyncResourceRef` qui
 * porte son identifiant dans le verdict. `toVerdict` ne range pas de genre pour
 * un deck (absent = deck, pas de réécriture des correspondances existantes).
 *
 * Typée contre le contrat généré : la table doit couvrir **toutes** les
 * opérations `*.create` de l'union (`satisfies Record<…>`), si bien qu'une
 * création ajoutée au contrat sans entrée ici fait échouer `tsc`.
 */
const creationBindings = {
  "deck.create": { kind: "deck", idField: "deck_id" },
  "player.create": { kind: "player", idField: "player_id" },
  "venue.create": { kind: "venue", idField: "venue_id" },
  "tournament.create": { kind: "tournament", idField: "tournament_id" },
  "game.create": { kind: "game", idField: "game_id" },
} as const satisfies Record<CreationOperationType, CreationBinding>;

export const CREATION_BINDINGS: Readonly<Partial<Record<VtesOperationType, CreationBinding>>> =
  creationBindings;

const DECK: ReferenceField = { path: "deck", kind: "deck" };

// La table d'une partie (`data.participations` à la création, `table.participations`
// à la correction) désigne ses joueurs et les decks prêtés. `{"me": true}` n'est
// pas une référence client : le marcheur l'ignore.
const tableReferences = (root: string): ReferenceField[] => [
  { path: `${root}.participations[].player`, kind: "player" },
  { path: `${root}.participations[].deck`, kind: "deck" },
];

/**
 * Champs de référence de chaque type d'opération (les types sans référence sont
 * absents), clés typées contre l'union du contrat.
 */
export const REFERENCE_FIELDS: Readonly<Partial<Record<VtesOperationType, readonly ReferenceField[]>>> = {
  "deck.update": [DECK],
  "deck.delete": [DECK],
  "deck_card.upsert": [DECK],
  "deck_card.delete": [DECK],
  "player.update": [{ path: "player", kind: "player" }],
  "player.delete": [{ path: "player", kind: "player" }],
  "venue.update": [{ path: "venue", kind: "venue" }],
  "venue.delete": [{ path: "venue", kind: "venue" }],
  "tournament.create": [{ path: "data.venue", kind: "venue" }],
  "tournament.update": [
    { path: "tournament", kind: "tournament" },
    { path: "data.venue", kind: "venue" },
  ],
  "tournament.delete": [{ path: "tournament", kind: "tournament" }],
  "game.create": [
    { path: "data.venue", kind: "venue" },
    { path: "data.tournament", kind: "tournament" },
    ...tableReferences("data"),
  ],
  "game.update": [
    { path: "game", kind: "game" },
    { path: "data.venue", kind: "venue" },
    { path: "data.tournament", kind: "tournament" },
    ...tableReferences("table"),
  ],
  "game.delete": [{ path: "game", kind: "game" }],
};

/**
 * Ce qu'une opération crée et ce qu'elle désigne par référence client : ce que
 * `groupCascades` (`core/references.ts`) attend pour regrouper les refus en
 * cascade. Une désignation par identifiant serveur n'y figure pas.
 */
export function referencesOf(operation: { type: string; client_ref?: unknown }): OperationReferences {
  const creations: Readonly<Partial<Record<string, CreationBinding>>> = CREATION_BINDINGS;
  const fields: Readonly<Partial<Record<string, readonly ReferenceField[]>>> = REFERENCE_FIELDS;
  const creation = creations[operation.type];
  return {
    creates:
      creation && typeof operation.client_ref === "string"
        ? { kind: creation.kind, clientRef: operation.client_ref }
        : null,
    uses: collectClientRefs(operation, fields[operation.type] ?? []),
  };
}
