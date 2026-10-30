import { toDeckRef, type DeckPolicy, type EventTier, type FinalDeckRule, type VtesOperation } from "../../offline/vtes";

/**
 * Corrections des opérations de la pratique de jeu refusées (Lot 7).
 *
 * Logique pure, sans React : `fieldsOf` dit quels champs une opération porte (et
 * donc lesquels proposer), `initialDraft` en tire un brouillon de formulaire,
 * `applyDraft` rend l'opération corrigée. La couche offline en fait une
 * **nouvelle** opération sous une nouvelle clé (`Outbox.reissue`) ; ici on ne
 * modifie jamais l'original.
 *
 * Refus que ces corrections visent :
 * - `invalid` d'une table, de ronde ou de score (siège au-delà de la table,
 *   numéro de ronde, VP au-delà de ce que la table distribue, GW contredit) :
 *   ronde, nombre de joueurs, siège, VP, GW ;
 * - `invalid` du passage en mono-deck sans `final_deck_rule: null` : la
 *   correction l'ajoute (et un passage en mono l'envoie toujours) ;
 * - `invalid` d'un multi-deck à un niveau qui l'interdit : politique, niveau ;
 * - `conflict` de mono-deck ou de deck de finale : mon deck de la ligne ;
 * - `conflict` d'un nom déjà pris (joueur, lieu, tournoi) : le nom.
 */

type Participation = {
  player: { me?: true | null; player_id?: number | null; client_ref?: string | null };
  deck?: { deck_id?: number | null; client_ref?: string | null } | null;
  seat?: number | null;
  victory_points?: number | null;
  game_win?: boolean | null;
  notes?: string | null;
};

export interface PlayCorrectionFields {
  name: boolean;
  city: boolean;
  roundNumber: boolean;
  playerCount: boolean;
  /** Ma ligne de table : siège, VP, GW, deck. */
  meLine: boolean;
  policy: boolean;
  finalRule: boolean;
  tier: boolean;
  roundCount: boolean;
  tournamentPlayerCount: boolean;
  ranking: boolean;
}

export interface PlayDraft {
  name: string;
  city: string;
  roundNumber: string;
  playerCount: number;
  seat: string;
  victoryPoints: string;
  gameWin: "" | "yes" | "no";
  /** `""` aucun deck, `"keep"` celui de l'opération, sinon une clé de deck (`id:3`, `ref:…`). */
  deckKey: string;
  /**
   * Politique de deck de l'opération ; `""` quand elle ne la porte pas (on ne
   * suppose rien du tournoi).
   */
  policy: "" | DeckPolicy;
  finalRule: "" | FinalDeckRule;
  tier: EventTier;
  roundCount: string;
  tournamentPlayerCount: string;
  ranking: string;
}

const NO_FIELDS: PlayCorrectionFields = {
  name: false,
  city: false,
  roundNumber: false,
  playerCount: false,
  meLine: false,
  policy: false,
  finalRule: false,
  tier: false,
  roundCount: false,
  tournamentPlayerCount: false,
  ranking: false,
};

/** Les lignes de table que l'opération porte (création : `data`, correction : `table`). */
export function participationsOf(operation: VtesOperation): Participation[] | null {
  if (operation.type === "game.create") return operation.data.participations;
  if (operation.type === "game.update") return operation.table?.participations ?? null;
  return null;
}

const meIndex = (participations: readonly Participation[] | null) =>
  participations ? participations.findIndex((line) => line.player.me === true) : -1;

/** Les champs à proposer pour corriger `operation` ; tout à `false` si elle ne se corrige pas ici. */
export function fieldsOf(operation: VtesOperation): PlayCorrectionFields {
  switch (operation.type) {
    case "player.create":
      return { ...NO_FIELDS, name: true };
    case "player.update":
      return { ...NO_FIELDS, name: operation.data.name !== undefined };
    case "venue.create":
      return { ...NO_FIELDS, name: true, city: true };
    case "venue.update":
      return {
        ...NO_FIELDS,
        name: operation.data.name !== undefined,
        city: operation.data.city !== undefined,
      };
    case "tournament.create":
    case "tournament.update": {
      const data = operation.data;
      const isCreate = operation.type === "tournament.create";
      return {
        ...NO_FIELDS,
        name: isCreate || data.name !== undefined,
        policy: isCreate || data.deck_policy !== undefined,
        finalRule: isCreate || data.final_deck_rule !== undefined || data.deck_policy !== undefined,
        tier: isCreate || data.event_tier !== undefined,
        roundCount: isCreate || data.round_count !== undefined,
        tournamentPlayerCount: isCreate || data.player_count !== undefined,
        ranking: isCreate || data.my_ranking !== undefined,
      };
    }
    case "game.create":
      return {
        ...NO_FIELDS,
        roundNumber: (operation.data.round_type ?? "casual") === "preliminary",
        playerCount: true,
        meLine: meIndex(operation.data.participations) >= 0,
      };
    case "game.update":
      return {
        ...NO_FIELDS,
        roundNumber: operation.data?.round_number !== undefined,
        playerCount: operation.data?.player_count !== undefined,
        meLine: meIndex(participationsOf(operation)) >= 0,
      };
    default:
      return NO_FIELDS;
  }
}

/** Vrai si au moins un champ est proposé. */
export function isPlayCorrectable(operation: VtesOperation): boolean {
  return Object.values(fieldsOf(operation)).some(Boolean);
}

const text = (value: number | null | undefined) => (value == null ? "" : String(value));

export function initialDraft(operation: VtesOperation): PlayDraft {
  const draft: PlayDraft = {
    name: "",
    city: "",
    roundNumber: "",
    playerCount: 4,
    seat: "",
    victoryPoints: "",
    gameWin: "",
    deckKey: "",
    policy: "",
    finalRule: "",
    tier: "standard",
    roundCount: "",
    tournamentPlayerCount: "",
    ranking: "",
  };
  switch (operation.type) {
    case "player.create":
    case "player.update":
      draft.name = operation.data.name ?? "";
      break;
    case "venue.create":
    case "venue.update":
      draft.name = operation.data.name ?? "";
      draft.city = operation.data.city ?? "";
      break;
    case "tournament.create":
    case "tournament.update": {
      const data = operation.data;
      draft.name = data.name ?? "";
      // Une mise à jour qui ne porte pas la politique ne la suppose pas : le
      // tournoi peut être dans l'un ou l'autre état, l'opération n'y touche pas.
      draft.policy = data.deck_policy ?? (operation.type === "tournament.create" ? "mono" : "");
      draft.finalRule = data.final_deck_rule ?? "";
      draft.tier = data.event_tier ?? "standard";
      draft.roundCount = text(data.round_count);
      draft.tournamentPlayerCount = text(data.player_count);
      draft.ranking = text(data.my_ranking);
      break;
    }
    case "game.create":
    case "game.update": {
      const data: { round_number?: number | null; player_count?: number } | undefined = operation.data;
      draft.roundNumber = text(data?.round_number);
      draft.playerCount = data?.player_count ?? 4;
      const lines = participationsOf(operation);
      const index = meIndex(lines);
      if (lines && index >= 0) {
        const me = lines[index];
        draft.seat = text(me.seat);
        draft.victoryPoints = text(me.victory_points);
        draft.gameWin = me.game_win == null ? "" : me.game_win ? "yes" : "no";
        draft.deckKey = me.deck ? "keep" : "";
      }
      break;
    }
    default:
      break;
  }
  return draft;
}

export type DraftResult = { operation: VtesOperation } | { error: string };

/** Nombre saisi : vide vaut `null`, sinon un nombre fini. */
function parseNumber(raw: string, label: string): { value: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return { error: `${label} : indiquez un nombre.` };
  return { value };
}

/** Retire les clés dont la valeur est `undefined` (jamais dans une charge utile). */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Applique le brouillon à l'opération ; ne touche qu'aux champs que `fieldsOf` propose. */
export function applyDraft(operation: VtesOperation, draft: PlayDraft): DraftResult {
  const fields = fieldsOf(operation);
  const round = parseNumber(draft.roundNumber, "Numéro de ronde");
  const seat = parseNumber(draft.seat, "Siège");
  const vp = parseNumber(draft.victoryPoints, "Victory Points");
  const roundCount = parseNumber(draft.roundCount, "Nombre de rondes");
  const players = parseNumber(draft.tournamentPlayerCount, "Nombre de joueurs");
  const ranking = parseNumber(draft.ranking, "Classement");
  for (const parsed of [round, seat, vp, roundCount, players, ranking]) {
    if ("error" in parsed) return { error: parsed.error };
  }
  const value = (parsed: ReturnType<typeof parseNumber>) => ("value" in parsed ? parsed.value : null);

  const name = draft.name.trim();
  if (fields.name && name === "") return { error: "Le nom est obligatoire." };

  const correctMe = (lines: readonly Participation[]): Participation[] =>
    lines.map((line) => {
      if (line.player.me !== true) return line;
      const seatValue = value(seat);
      const vpValue = value(vp);
      return compact({
        ...line,
        seat: seatValue ?? undefined,
        victory_points: vpValue ?? undefined,
        game_win: draft.gameWin === "" ? undefined : draft.gameWin === "yes",
        deck:
          draft.deckKey === "keep"
            ? line.deck
            : draft.deckKey === ""
              ? undefined
              : toDeckRef(draft.deckKey as `id:${number}` | `ref:${string}`),
      });
    });

  switch (operation.type) {
    case "player.create":
      return { operation: { ...operation, data: { ...operation.data, name } } };
    case "player.update":
      return {
        operation: {
          ...operation,
          data: fields.name ? { ...operation.data, name } : operation.data,
        },
      };
    case "venue.create":
    case "venue.update": {
      const data = { ...operation.data };
      if (fields.name) data.name = name;
      if (fields.city) data.city = draft.city.trim() === "" ? null : draft.city.trim();
      return { operation: { ...operation, data } as VtesOperation };
    }
    case "tournament.create":
    case "tournament.update": {
      const data = { ...operation.data };
      if (fields.name) data.name = name;
      if (fields.policy && draft.policy !== "") data.deck_policy = draft.policy;
      if (fields.tier) data.event_tier = draft.tier;
      if (fields.roundCount) {
        const next = value(roundCount);
        if (next !== null || data.round_count !== undefined) data.round_count = next;
      }
      if (fields.tournamentPlayerCount) {
        const next = value(players);
        if (next !== null || data.player_count !== undefined) data.player_count = next;
      }
      if (fields.ranking) {
        const next = value(ranking);
        if (next !== null || data.my_ranking !== undefined) data.my_ranking = next;
      }
      // La règle de finale n'a de sens qu'en multi-deck : un passage en mono
      // l'efface toujours dans la même opération. Seule la politique que
      // l'opération porte compte : celle du tournoi connu n'efface rien.
      if (fields.policy && draft.policy === "mono") {
        data.final_deck_rule = null;
      } else if (fields.finalRule) {
        data.final_deck_rule = draft.finalRule === "" ? null : draft.finalRule;
      }
      return { operation: { ...operation, data } as VtesOperation };
    }
    case "game.create": {
      const data = { ...operation.data, player_count: draft.playerCount };
      if (fields.roundNumber) data.round_number = value(round);
      if (fields.meLine) data.participations = correctMe(operation.data.participations);
      return { operation: { ...operation, data } };
    }
    case "game.update": {
      const data = operation.data ? { ...operation.data } : undefined;
      if (data && fields.playerCount) data.player_count = draft.playerCount;
      if (data && fields.roundNumber) data.round_number = value(round);
      const table =
        operation.table && fields.meLine
          ? { ...operation.table, participations: correctMe(operation.table.participations) }
          : operation.table;
      return {
        operation: {
          ...operation,
          ...(data ? { data } : {}),
          ...(table === undefined ? {} : { table }),
        },
      };
    }
    default:
      return { error: "Cette opération ne se corrige pas ici." };
  }
}

/** Passage en mono sans `final_deck_rule: null` : la correction est automatique. */
export function missesFinalRuleReset(operation: VtesOperation): boolean {
  return (
    operation.type === "tournament.update" &&
    operation.data.deck_policy === "mono" &&
    operation.data.final_deck_rule === undefined
  );
}
