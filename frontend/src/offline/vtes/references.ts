import {
  collectClientRefs,
  type OperationReferences,
  type ReferenceField,
  type RefBinding,
} from "../core";

/**
 * Genres de ressources qu'une référence client peut désigner, et table des
 * champs où une opération les désigne.
 *
 * Tout ce fichier est écrit sur des chaînes (`type` d'opération, noms de
 * champs), pas sur les types générés du contrat : l'ajout des douze opérations
 * du Lot 7 se fait en C1b en complétant les deux tables ci-dessous, sans
 * toucher au reste.
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

/**
 * Création -> genre de la ressource créée, et champ de `SyncResourceRef` qui
 * porte son identifiant dans le verdict (les quatre champs du Lot 7 sont au
 * contrat depuis A2). `toVerdict` ne range pas de genre pour un deck (absent =
 * deck, pas de réécriture des correspondances existantes).
 *
 * Les clés sont des chaînes : cette table est complète dès C1a, bien que les
 * types `player.create`… n'entrent dans `AnySyncOperation` qu'à l'étape B3.
 * C1b n'a qu'à les typer (`satisfies`) contre le contrat généré.
 */
export const CREATION_BINDINGS: Readonly<
  Record<string, { kind: ReferenceKind; idField: string }>
> = {
  "deck.create": { kind: "deck", idField: "deck_id" },
  "player.create": { kind: "player", idField: "player_id" },
  "venue.create": { kind: "venue", idField: "venue_id" },
  "tournament.create": { kind: "tournament", idField: "tournament_id" },
  "game.create": { kind: "game", idField: "game_id" },
};

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
 * absents). Même remarque : écrite en chaînes, complète dès C1a.
 */
export const REFERENCE_FIELDS: Readonly<Record<string, readonly ReferenceField[]>> = {
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
  const creation = CREATION_BINDINGS[operation.type];
  return {
    creates:
      creation && typeof operation.client_ref === "string"
        ? { kind: creation.kind, clientRef: operation.client_ref }
        : null,
    uses: collectClientRefs(operation, REFERENCE_FIELDS[operation.type] ?? []),
  };
}
