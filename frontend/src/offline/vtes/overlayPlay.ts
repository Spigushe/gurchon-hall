import { foldText } from "../core/foldText";
import type { RefBinding } from "../core/types";
import type { GameRow, PlayerRow, TournamentRow, VenueRow } from "./db";
import { certainGameWin, tournamentSummary, type RoundResult } from "./playRules";
import { bindingsOfKind } from "./references";
import type {
  DeckArchetype,
  DeckKey,
  DeckPolicy,
  EventTier,
  FinalDeckRule,
  PlayOperation,
  ResourceKey,
  RoundType,
  TournamentFormat,
} from "./types";

/**
 * Projection de la pratique de jeu (Lot 7) : joueurs, lieux, tournois, parties.
 *
 * Même principe que pour les decks (`overlay.ts`) : miroir du serveur, plus les
 * opérations tranchées dont le miroir n'est pas à jour, plus la file. Une
 * ressource créée hors ligne apparaît sous la clé `ref:<uuid>`, qui ne change
 * pas quand le serveur lui donne un identifiant.
 *
 * **Trois précautions propres à ce domaine.**
 *
 * 1. *Upsert par nom.* Le serveur lie la `client_ref` d'un `player.create` ou
 *    d'un `venue.create` au joueur ou au lieu **existant** de même nom (casse et
 *    accents ignorés). Deux références peuvent donc désigner la même ressource :
 *    la projection ne crée pas de doublon, elle ajoute la référence aux
 *    `aliases` de la ressource existante. Une ressource porte une clé
 *    canonique (`key`) et toutes les clés qui la désignent (`aliases`) ;
 *    `findByKey` retrouve par l'une ou l'autre, ce qui garde une sélection de
 *    l'UI valable à travers le verdict.
 * 2. *Table connue ou non.* Une partie du miroir peut avoir `table === null` ;
 *    une partie saisie hors ligne porte sa table dans l'opération.
 * 3. *Bilan provisoire.* Le bilan d'un tournoi vient du serveur. Dès qu'une
 *    écriture de partie touche un tournoi, il est recalculé localement ; il est
 *    marqué provisoire (`summaryProvisional`) tant que l'écriture est en file.
 *    Les decks admis en finale, eux, ne se recalculent pas : ils restent ceux du
 *    dernier rafraîchissement.
 *
 * Les compteurs du serveur (`gameCount` d'un joueur ou d'un lieu,
 * `tournamentCount`) sont repris tels quels : ils ne suivent pas la file.
 *
 * **Versions jouées (Lot 8).** Le serveur seul fige une liste ; la surcouche ne
 * fabrique jamais de version. Pour une écriture en file, elle applique les
 * règles du serveur à ce qu'elle sait déjà (précisions pour B1 de
 * `docs/lot8-plan-analyse.md`) : la version du tournoi pour ce deck s'il en a
 * une, sinon celle que la partie avait déjà pour ce deck, sinon rien. « Rien »
 * (`deckVersionId === null` sur une ligne qui a un deck) se lit « liste figée à
 * la synchronisation ». Un regel en file efface la version des decks regelés,
 * sur cette partie et, dans un tournoi, sur toutes ses parties qui jouent ces
 * decks ; la ligne du tournoi pour ces decks disparaît jusqu'au rejeu.
 */

/** Ce que toute ressource de la surcouche porte. */
export interface LocalResource {
  /** Clé canonique : `ref:<uuid>` pour une ressource créée hors ligne, `id:<n>` sinon. */
  key: ResourceKey;
  /** Identifiant serveur ; `null` tant qu'une création hors ligne n'est pas synchronisée. */
  id: number | null;
  /** Référence client de la création hors ligne (la première liée), sinon `null`. */
  clientRef: string | null;
  /** Toutes les clés qui désignent cette ressource (`id:<n>`, chaque `ref:<uuid>` liée). */
  aliases: ResourceKey[];
  /** Une opération en file touche cette ressource. */
  pending: boolean;
}

export interface LocalPlayer extends LocalResource {
  name: string;
  isMe: boolean;
  gameCount: number;
}

export interface LocalVenue extends LocalResource {
  name: string;
  city: string | null;
  notes: string | null;
  gameCount: number;
  tournamentCount: number;
}

export interface LocalTournamentSummary {
  preliminaryGameWins: number;
  preliminaryVictoryPoints: number;
  roundsPlayed: number;
  finalVictoryPoints: number | null;
  finalGameWin: boolean | null;
}

/** Version d'un deck dans un tournoi, et la partie qui l'a figée (Lot 8, A9). */
export interface LocalTournamentDeckVersion {
  deckKey: DeckKey;
  deckVersionId: number;
  deckVersionNumber: number;
  /** Partie à laquelle la liste est rattachée, par sa clé de surcouche. */
  frozenByGameKey: ResourceKey;
}

export interface LocalTournament extends LocalResource {
  name: string;
  /** Date locale `AAAA-MM-JJ`. */
  startDate: string;
  endDate: string | null;
  venueKey: ResourceKey | null;
  deckPolicy: DeckPolicy;
  format: TournamentFormat;
  eventTier: EventTier;
  finalDeckRule: FinalDeckRule | null;
  roundCount: number | null;
  playerCount: number | null;
  myRanking: number | null;
  notes: string | null;
  /** Mon bilan : celui du serveur, ou recalculé localement quand une partie du tournoi a bougé. */
  summary: LocalTournamentSummary;
  /** Le bilan inclut une écriture de partie pas encore synchronisée. */
  summaryProvisional: boolean;
  /**
   * Decks admis en finale (A11) au dernier rafraîchissement ; `null` quand rien
   * n'est contrôlable ou que le tournoi est saisi hors ligne. Jamais recalculé.
   */
  admissibleFinalDecks: DeckKey[] | null;
  /**
   * Version de chaque deck joué dans le tournoi (Lot 8, A9), au dernier
   * rafraîchissement, par deck croissant ; vide pour un tournoi saisi hors
   * ligne. Un regel en file en retire les decks regelés.
   */
  deckVersions: LocalTournamentDeckVersion[];
}

/** La version figée d'un deck joué ; les deux champs sont nuls ensemble. */
export interface PlayedVersion {
  /** `null` sans deck, ou tant que le serveur n'a pas figé la liste (écriture en file). */
  deckVersionId: number | null;
  deckVersionNumber: number | null;
}

/** Une ligne de la table d'une partie. */
export interface LocalTableLine extends PlayedVersion {
  /** Joueur de la ligne ; `null` pour un adversaire non nommé (Lot 8, P6). */
  playerKey: ResourceKey | null;
  isMe: boolean;
  deckKey: DeckKey | null;
  seat: number | null;
  /** Renseignés sur ma seule ligne (A13). */
  victoryPoints: number | null;
  gameWin: boolean | null;
  /** Deck d'un adversaire qui ne joue pas un de mes decks (Lot 8, P5). */
  opponentDeckName: string | null;
  opponentDeckArchetype: DeckArchetype | null;
  opponentClanId: number | null;
  notes: string | null;
}

export interface LocalGameMe extends PlayedVersion {
  deckKey: DeckKey | null;
  seat: number | null;
  victoryPoints: number | null;
  gameWin: boolean | null;
}

export interface LocalGame extends LocalResource {
  /** Instant ISO 8601 (UTC « …Z » du serveur, ou avec le fuseau de la saisie). */
  playedAt: string;
  venueKey: ResourceKey | null;
  tournamentKey: ResourceKey | null;
  tournamentName: string | null;
  roundNumber: number | null;
  roundType: RoundType;
  playerCount: number;
  me: LocalGameMe;
  notes: string | null;
  /**
   * La table complète, ou `null` si elle est inconnue sur cet appareil : on
   * n'édite alors pas la table (la remplacer d'un bloc effacerait les adversaires).
   */
  table: LocalTableLine[] | null;
}

export interface PlayProjection {
  players: LocalPlayer[];
  venues: LocalVenue[];
  tournaments: LocalTournament[];
  games: LocalGame[];
}

/** Retrouve une ressource par sa clé canonique ou par l'un de ses alias. */
export function findByKey<T extends LocalResource>(
  items: readonly T[],
  key: ResourceKey,
): T | undefined {
  return items.find((item) => item.key === key || item.aliases.includes(key));
}

/** Les décks, vus de la surcouche des decks (`overlay.ts`). */
export interface DeckLookup {
  keyOfId(id: number): DeckKey | undefined;
  resolve(ref: { deck_id?: number | null; client_ref?: string | null }): DeckKey | undefined;
}

/**
 * Registre d'un genre de ressource : les ressources par clé canonique, et les
 * tables de passage identifiant -> clé et référence -> clé.
 */
class Registry<T extends LocalResource> {
  readonly items = new Map<ResourceKey, T>();
  private readonly keyById = new Map<number, ResourceKey>();
  private readonly keyByRef = new Map<string, ResourceKey>();
  private readonly idByRef = new Map<string, number>();
  private readonly refsById = new Map<number, string[]>();

  constructor(bindings: readonly RefBinding[]) {
    // Le premier lié (plus ancien, puis ordre alphabétique) donne la clé canonique.
    const ordered = [...bindings].sort(
      (a, b) => a.boundAt.localeCompare(b.boundAt) || a.ref.localeCompare(b.ref),
    );
    for (const binding of ordered) {
      this.idByRef.set(binding.ref, binding.id);
      const refs = this.refsById.get(binding.id) ?? [];
      refs.push(binding.ref);
      this.refsById.set(binding.id, refs);
    }
  }

  seed<R extends { id: number }>(rows: readonly R[], build: (row: R, base: LocalResource) => T) {
    for (const row of rows) {
      const refs = this.refsById.get(row.id) ?? [];
      const idKey: ResourceKey = `id:${row.id}`;
      const key: ResourceKey = refs.length > 0 ? `ref:${refs[0]}` : idKey;
      const aliases = [idKey, ...refs.map((ref): ResourceKey => `ref:${ref}`)].filter(
        (alias) => alias !== key,
      );
      this.add(build(row, { key, id: row.id, clientRef: refs[0] ?? null, aliases, pending: false }));
      for (const ref of refs) this.keyByRef.set(ref, key);
    }
  }

  add(entity: T) {
    this.items.set(entity.key, entity);
    if (entity.id !== null) this.keyById.set(entity.id, entity.key);
    if (entity.clientRef !== null) this.keyByRef.set(entity.clientRef, entity.key);
  }

  /** Ajoute `ref` aux désignations d'une ressource qui existe déjà (upsert par nom). */
  alias(ref: string, key: ResourceKey) {
    this.keyByRef.set(ref, key);
    const entity = this.items.get(key);
    const alias: ResourceKey = `ref:${ref}`;
    if (entity && entity.key !== alias && !entity.aliases.includes(alias)) entity.aliases.push(alias);
  }

  /** La référence est déjà représentée (liée à une ressource du miroir, ou créée plus haut dans la file). */
  knows(ref: string): boolean {
    return this.keyByRef.has(ref);
  }

  boundId(ref: string): number | null {
    return this.idByRef.get(ref) ?? null;
  }

  keyOfId(id: number): ResourceKey | undefined {
    return this.keyById.get(id);
  }

  resolve(id: number | null | undefined, clientRef: string | null | undefined): ResourceKey | undefined {
    if (id != null) return this.keyById.get(id);
    if (clientRef != null) {
      const direct = this.keyByRef.get(clientRef);
      if (direct) return direct;
      const bound = this.idByRef.get(clientRef);
      return bound === undefined ? undefined : this.keyById.get(bound);
    }
    return undefined;
  }

  /** Clé pour une désignation que le miroir ne connaît pas (ressource supprimée, création refusée). */
  fallback(id: number | null | undefined, clientRef: string | null | undefined): ResourceKey {
    return id != null ? `id:${id}` : `ref:${clientRef}`;
  }
}

const NO_SUMMARY: LocalTournamentSummary = {
  preliminaryGameWins: 0,
  preliminaryVictoryPoints: 0,
  roundsPlayed: 0,
  finalVictoryPoints: null,
  finalGameWin: null,
};

const NO_VERSION: PlayedVersion = { deckVersionId: null, deckVersionNumber: null };

const NO_ME: LocalGameMe = {
  deckKey: null,
  seat: null,
  victoryPoints: null,
  gameWin: null,
  ...NO_VERSION,
};

/** Version d'une ligne du miroir ; une ligne écrite avant la version 7 de la base n'en a pas. */
const versionOfRow = (row: { deckVersionId?: number | null; deckVersionNumber?: number | null }): PlayedVersion => ({
  deckVersionId: row.deckVersionId ?? null,
  deckVersionNumber: row.deckVersionNumber ?? null,
});

export interface PlayInput {
  players: readonly PlayerRow[];
  venues: readonly VenueRow[];
  tournaments: readonly TournamentRow[];
  games: readonly GameRow[];
  refs: readonly RefBinding[];
}

export interface PlayProjector {
  apply(operation: PlayOperation, pending: boolean): void;
  finish(): PlayProjection;
}

/** Clé de « moi » quand le miroir des joueurs n'a pas encore été lu (la ligne reste marquée `isMe`). */
const UNKNOWN_ME_KEY: ResourceKey = "id:0";

/**
 * Prépare la projection : sème les registres du miroir, puis `apply` rejoue les
 * opérations (tranchées d'abord, puis la file, dans l'ordre) et `finish` rend
 * les listes, bilans recalculés compris.
 */
export function createPlayProjector(input: PlayInput, decks: DeckLookup): PlayProjector {
  const players = new Registry<LocalPlayer>(bindingsOfKind(input.refs, "player"));
  const venues = new Registry<LocalVenue>(bindingsOfKind(input.refs, "venue"));
  const tournaments = new Registry<LocalTournament>(
    bindingsOfKind(input.refs, "tournament"),
  );
  const games = new Registry<LocalGame>(bindingsOfKind(input.refs, "game"));

  players.seed(input.players, (row, base) => ({
    ...base,
    name: row.name,
    isMe: row.isMe,
    gameCount: row.gameCount,
  }));
  venues.seed(input.venues, (row, base) => ({
    ...base,
    name: row.name,
    city: row.city,
    notes: row.notes,
    gameCount: row.gameCount,
    tournamentCount: row.tournamentCount,
  }));

  const venueKeyOfId = (id: number | null): ResourceKey | null =>
    id === null ? null : (venues.keyOfId(id) ?? venues.fallback(id, null));
  const tournamentKeyOfId = (id: number | null): ResourceKey | null =>
    id === null ? null : (tournaments.keyOfId(id) ?? tournaments.fallback(id, null));
  const deckKeyOfId = (id: number | null): DeckKey | null =>
    id === null ? null : (decks.keyOfId(id) ?? `id:${id}`);

  tournaments.seed(input.tournaments, (row, base) => ({
    ...base,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    venueKey: venueKeyOfId(row.venueId),
    deckPolicy: row.deckPolicy,
    format: row.format,
    eventTier: row.eventTier,
    finalDeckRule: row.finalDeckRule,
    roundCount: row.roundCount,
    playerCount: row.playerCount,
    myRanking: row.myRanking,
    notes: row.notes,
    summary: { ...row.summary },
    summaryProvisional: false,
    admissibleFinalDecks:
      row.admissibleFinalDecks === null
        ? null
        : row.admissibleFinalDecks.map((id) => deckKeyOfId(id) as DeckKey),
    // La partie qui a figé est résolue à la fin (`finish`), une fois les parties semées.
    deckVersions: (row.deckVersions ?? []).map((version) => ({
      deckKey: deckKeyOfId(version.deckId) as DeckKey,
      deckVersionId: version.deckVersionId,
      deckVersionNumber: version.deckVersionNumber,
      frozenByGameKey: `id:${version.frozenByGameId}` as ResourceKey,
    })),
  }));

  const playerKeyOfId = (id: number | null): ResourceKey | null =>
    id === null ? null : (players.keyOfId(id) ?? players.fallback(id, null));

  games.seed(input.games, (row, base) => ({
    ...base,
    playedAt: row.playedAt,
    venueKey: venueKeyOfId(row.venueId),
    tournamentKey: tournamentKeyOfId(row.tournamentId),
    tournamentName: row.tournamentName,
    roundNumber: row.roundNumber,
    roundType: row.roundType,
    playerCount: row.playerCount,
    me: {
      deckKey: deckKeyOfId(row.me.deckId),
      seat: row.me.seat,
      victoryPoints: row.me.victoryPoints,
      gameWin: row.me.gameWin,
      ...versionOfRow(row.me),
    },
    notes: row.notes,
    table:
      row.table === null
        ? null
        : row.table.map((line) => ({
            playerKey: playerKeyOfId(line.playerId),
            isMe: line.isMe,
            deckKey: deckKeyOfId(line.deckId),
            seat: line.seat,
            victoryPoints: line.victoryPoints,
            gameWin: line.gameWin,
            opponentDeckName: line.opponentDeckName ?? null,
            opponentDeckArchetype: line.opponentDeckArchetype ?? null,
            opponentClanId: line.opponentClanId ?? null,
            notes: line.notes,
            ...versionOfRow(line),
          })),
  }));

  // Tournois dont le bilan est à recalculer, et parmi eux ceux qui incluent la file.
  const recompute = new Set<ResourceKey>();
  const provisional = new Set<ResourceKey>();
  const touch = (key: ResourceKey | null, pending: boolean) => {
    if (key === null) return;
    recompute.add(key);
    if (pending) provisional.add(key);
  };

  const venueRef = (ref: { venue_id?: number | null; client_ref?: string | null }) =>
    venues.resolve(ref.venue_id, ref.client_ref) ?? venues.fallback(ref.venue_id, ref.client_ref);
  const tournamentRef = (ref: { tournament_id?: number | null; client_ref?: string | null }) =>
    tournaments.resolve(ref.tournament_id, ref.client_ref) ??
    tournaments.fallback(ref.tournament_id, ref.client_ref);

  type ParticipantRef = { me?: true | null; player_id?: number | null; client_ref?: string | null };

  /** Clé du joueur d'une ligne ; `null` pour un adversaire non nommé (Lot 8, P6). */
  const participantKey = (player: ParticipantRef | null | undefined): ResourceKey | null => {
    if (!player) return null;
    if (player.me === true) {
      return [...players.items.values()].find((item) => item.isMe)?.key ?? UNKNOWN_ME_KEY;
    }
    return (
      players.resolve(player.player_id, player.client_ref) ??
      players.fallback(player.player_id, player.client_ref)
    );
  };

  /** Version qu'un deck prend dans une partie, d'après ce que la surcouche sait (cf. en-tête). */
  type VersionOf = (deckKey: DeckKey | null) => PlayedVersion;

  const tableOf = (
    playerCount: number,
    participations: ReadonlyArray<{
      player?: ParticipantRef | null;
      deck?: { deck_id?: number | null; client_ref?: string | null } | null;
      seat?: number | null;
      victory_points?: number | null;
      game_win?: boolean | null;
      opponent_deck_name?: string | null;
      opponent_deck_archetype?: DeckArchetype | null;
      opponent_clan_id?: number | null;
      notes?: string | null;
    }>,
    versionOf: VersionOf,
  ): LocalTableLine[] =>
    participations.map((line) => {
      const key = participantKey(line.player);
      const deck = line.deck;
      const deckKey: DeckKey | null = deck
        ? (decks.resolve(deck) ??
          (deck.deck_id != null ? (`id:${deck.deck_id}` as DeckKey) : (`ref:${deck.client_ref}` as DeckKey)))
        : null;
      return {
        playerKey: key,
        isMe: line.player?.me === true || (key !== null && players.items.get(key)?.isMe === true),
        deckKey,
        seat: line.seat ?? null,
        victoryPoints: line.victory_points ?? null,
        // Comme `resolved_game_win` du serveur : un GW omis ou nul vaut le GW
        // certain que les VP donnent, sinon reste nul.
        gameWin: line.game_win ?? certainGameWin(playerCount, line.victory_points),
        opponentDeckName: line.opponent_deck_name ?? null,
        opponentDeckArchetype: line.opponent_deck_archetype ?? null,
        opponentClanId: line.opponent_clan_id ?? null,
        notes: line.notes ?? null,
        ...versionOf(deckKey),
      };
    });

  const meOf = (table: readonly LocalTableLine[], previous: LocalGameMe = NO_ME): LocalGameMe => {
    const line = table.find((item) => item.isMe);
    return line
      ? {
          deckKey: line.deckKey,
          seat: line.seat,
          victoryPoints: line.victoryPoints,
          gameWin: line.gameWin,
          deckVersionId: line.deckVersionId,
          deckVersionNumber: line.deckVersionNumber,
        }
      : previous;
  };

  /** La version d'un deck dans un tournoi, au dernier rafraîchissement. */
  const tournamentVersion = (tournamentKey: ResourceKey | null, deckKey: DeckKey): PlayedVersion | undefined => {
    if (tournamentKey === null) return undefined;
    const found = tournaments.items.get(tournamentKey)?.deckVersions.find((item) => item.deckKey === deckKey);
    return found && { deckVersionId: found.deckVersionId, deckVersionNumber: found.deckVersionNumber };
  };

  /** La version qu'une partie a déjà pour ce deck (sa table, ou ma ligne en résumé). */
  const gameVersion = (game: LocalGame | undefined, deckKey: DeckKey): PlayedVersion | undefined => {
    if (!game) return undefined;
    const lines: PlayedVersion[] = [
      ...(game.table ?? []).filter((line) => line.deckKey === deckKey),
      ...(game.me.deckKey === deckKey ? [game.me] : []),
    ];
    const found = lines.find((line) => line.deckVersionId !== null);
    return found && { deckVersionId: found.deckVersionId, deckVersionNumber: found.deckVersionNumber };
  };

  /**
   * Règle du serveur, sur ce que la surcouche sait : la version du tournoi
   * prime, puis celle que la partie avait pour ce deck ; sinon la liste sera
   * figée au rejeu. Un deck regelé n'a plus de version connue.
   */
  const versionRule =
    (tournamentKey: ResourceKey | null, previous: LocalGame | undefined, refrozen: boolean): VersionOf =>
    (deckKey) => {
      if (deckKey === null || refrozen) return NO_VERSION;
      return tournamentVersion(tournamentKey, deckKey) ?? gameVersion(previous, deckKey) ?? NO_VERSION;
    };

  /** Réapplique une règle de version à une table déjà connue (partie qui change de tournoi, regel). */
  const reversioned = (table: readonly LocalTableLine[], versionOf: VersionOf): LocalTableLine[] =>
    table.map((line) => ({ ...line, ...versionOf(line.deckKey) }));

  /**
   * Regel en file dans un tournoi : la version de ces decks change pour toutes
   * les parties du tournoi qui les jouent, et la ligne du tournoi est retirée,
   * jusqu'au rejeu.
   */
  function forgetTournamentVersions(tournamentKey: ResourceKey | null, deckKeys: ReadonlySet<DeckKey>) {
    if (tournamentKey === null || deckKeys.size === 0) return;
    const tournament = tournaments.items.get(tournamentKey);
    if (tournament) {
      tournaments.items.set(tournamentKey, {
        ...tournament,
        deckVersions: tournament.deckVersions.filter((item) => !deckKeys.has(item.deckKey)),
      });
    }
    const clear = <T extends PlayedVersion & { deckKey: DeckKey | null }>(line: T): T =>
      line.deckKey !== null && deckKeys.has(line.deckKey) ? { ...line, ...NO_VERSION } : line;
    for (const game of games.items.values()) {
      if (game.tournamentKey !== tournamentKey) continue;
      games.items.set(game.key, { ...game, me: clear(game.me), table: game.table && game.table.map(clear) });
    }
  }

  const sameName = (a: string, b: string) => foldText(a.trim()) === foldText(b.trim());

  function applyPlayer(operation: Extract<PlayOperation, { type: `player.${string}` }>, pending: boolean) {
    switch (operation.type) {
      case "player.create": {
        const ref = operation.client_ref;
        if (players.knows(ref)) return; // déjà représentée : le miroir fait foi
        const name = operation.data.name;
        const existing = [...players.items.values()].find((player) => sameName(player.name, name));
        if (existing) {
          // Upsert par nom : le serveur lie cette référence à la ressource existante.
          // Le « Moi » est exclu côté serveur (conflit) : rien à projeter.
          if (!existing.isMe) players.alias(ref, existing.key);
          return;
        }
        const id = players.boundId(ref);
        players.add({
          key: `ref:${ref}`,
          id,
          clientRef: ref,
          aliases: id === null ? [] : [`id:${id}`],
          pending,
          name,
          isMe: false,
          gameCount: 0,
        });
        return;
      }
      case "player.update": {
        const key = players.resolve(operation.player.player_id, operation.player.client_ref);
        const player = key && players.items.get(key);
        if (!player) return;
        players.items.set(player.key, {
          ...player,
          name: operation.data.name ?? player.name,
          pending: player.pending || pending,
        });
        return;
      }
      case "player.delete": {
        const key = players.resolve(operation.player.player_id, operation.player.client_ref);
        if (key) players.items.delete(key);
        return;
      }
    }
  }

  function applyVenue(operation: Extract<PlayOperation, { type: `venue.${string}` }>, pending: boolean) {
    switch (operation.type) {
      case "venue.create": {
        const ref = operation.client_ref;
        if (venues.knows(ref)) return;
        const { name, city, notes } = operation.data;
        const existing = [...venues.items.values()].find((venue) => sameName(venue.name, name));
        if (existing) {
          // Upsert par nom : le lieu existant garde sa ville et ses notes.
          venues.alias(ref, existing.key);
          return;
        }
        const id = venues.boundId(ref);
        venues.add({
          key: `ref:${ref}`,
          id,
          clientRef: ref,
          aliases: id === null ? [] : [`id:${id}`],
          pending,
          name,
          city: city ?? null,
          notes: notes ?? null,
          gameCount: 0,
          tournamentCount: 0,
        });
        return;
      }
      case "venue.update": {
        const key = venues.resolve(operation.venue.venue_id, operation.venue.client_ref);
        const venue = key && venues.items.get(key);
        if (!venue) return;
        const data = operation.data;
        venues.items.set(venue.key, {
          ...venue,
          name: data.name ?? venue.name,
          city: data.city !== undefined ? data.city : venue.city,
          notes: data.notes !== undefined ? data.notes : venue.notes,
          pending: venue.pending || pending,
        });
        return;
      }
      case "venue.delete": {
        const key = venues.resolve(operation.venue.venue_id, operation.venue.client_ref);
        if (key) venues.items.delete(key);
        return;
      }
    }
  }

  /** Lieu d'une mise à jour : absent, on garde ; `null`, on retire ; sinon la nouvelle référence. */
  function updatedVenueKey(venue: Parameters<typeof venueRef>[0] | null | undefined, current: ResourceKey | null) {
    if (venue === undefined) return current;
    return venue ? venueRef(venue) : null;
  }

  function createTournament(
    operation: Extract<PlayOperation, { type: "tournament.create" }>,
    pending: boolean,
  ) {
    const ref = operation.client_ref;
    if (tournaments.knows(ref)) return;
    const data = operation.data;
    const id = tournaments.boundId(ref);
    tournaments.add({
      key: `ref:${ref}`,
      id,
      clientRef: ref,
      aliases: id === null ? [] : [`id:${id}`],
      pending,
      name: data.name,
      startDate: data.start_date,
      endDate: data.end_date ?? null,
      venueKey: data.venue ? venueRef(data.venue) : null,
      deckPolicy: data.deck_policy ?? "mono",
      format: data.format ?? "constructed",
      eventTier: data.event_tier ?? "standard",
      finalDeckRule: data.final_deck_rule ?? null,
      roundCount: data.round_count ?? null,
      playerCount: data.player_count ?? null,
      myRanking: data.my_ranking ?? null,
      notes: data.notes ?? null,
      summary: { ...NO_SUMMARY },
      summaryProvisional: false,
      admissibleFinalDecks: null,
      deckVersions: [],
    });
  }

  function updateTournament(
    operation: Extract<PlayOperation, { type: "tournament.update" }>,
    pending: boolean,
  ) {
    const key = tournaments.resolve(
      operation.tournament.tournament_id,
      operation.tournament.client_ref,
    );
    const tournament = key && tournaments.items.get(key);
    if (!tournament) return;
    const data = operation.data;
    tournaments.items.set(tournament.key, {
      ...tournament,
      name: data.name ?? tournament.name,
      startDate: data.start_date ?? tournament.startDate,
      endDate: data.end_date !== undefined ? data.end_date : tournament.endDate,
      venueKey: updatedVenueKey(data.venue, tournament.venueKey),
      deckPolicy: data.deck_policy ?? tournament.deckPolicy,
      format: data.format ?? tournament.format,
      eventTier: data.event_tier ?? tournament.eventTier,
      finalDeckRule:
        data.final_deck_rule !== undefined ? data.final_deck_rule : tournament.finalDeckRule,
      roundCount: data.round_count !== undefined ? data.round_count : tournament.roundCount,
      playerCount: data.player_count !== undefined ? data.player_count : tournament.playerCount,
      myRanking: data.my_ranking !== undefined ? data.my_ranking : tournament.myRanking,
      notes: data.notes !== undefined ? data.notes : tournament.notes,
      pending: tournament.pending || pending,
    });
  }

  function applyTournament(
    operation: Extract<PlayOperation, { type: `tournament.${string}` }>,
    pending: boolean,
  ) {
    switch (operation.type) {
      case "tournament.create":
        return createTournament(operation, pending);
      case "tournament.update":
        return updateTournament(operation, pending);
      case "tournament.delete": {
        const key = tournaments.resolve(
          operation.tournament.tournament_id,
          operation.tournament.client_ref,
        );
        if (key) tournaments.items.delete(key);
        return;
      }
    }
  }

  function createGame(operation: Extract<PlayOperation, { type: "game.create" }>, pending: boolean) {
    const ref = operation.client_ref;
    if (games.knows(ref)) return; // le miroir a déjà cette partie et fait foi
    const data = operation.data;
    const tournamentKey = data.tournament ? tournamentRef(data.tournament) : null;
    const table = tableOf(data.player_count, data.participations, versionRule(tournamentKey, undefined, false));
    const id = games.boundId(ref);
    games.add({
      key: `ref:${ref}`,
      id,
      clientRef: ref,
      aliases: id === null ? [] : [`id:${id}`],
      pending,
      playedAt: data.played_at,
      venueKey: data.venue ? venueRef(data.venue) : null,
      tournamentKey,
      tournamentName: null,
      roundNumber: data.round_number ?? null,
      roundType: data.round_type ?? "casual",
      playerCount: data.player_count,
      me: meOf(table),
      notes: data.notes ?? null,
      table,
    });
    touch(tournamentKey, pending);
  }

  function updateGame(operation: Extract<PlayOperation, { type: "game.update" }>, pending: boolean) {
    const key = games.resolve(operation.game.game_id, operation.game.client_ref);
    const game = key && games.items.get(key);
    if (!game) return;
    const data = operation.data ?? {};
    const tournamentKey = updatedTournamentKey(data.tournament, game.tournamentKey);
    const refreeze = data.refreeze_decklists === true;
    // Comme le service (B1) : les versions ne bougent que si la table est
    // remplacée, si le tournoi change ou si un regel est demandé.
    const versionOf = versionRule(tournamentKey, game, refreeze);
    const reassign = refreeze || tournamentKey !== game.tournamentKey;
    const table = operation.table
      ? tableOf(data.player_count ?? game.playerCount, operation.table.participations, versionOf)
      : game.table && reassign
        ? reversioned(game.table, versionOf)
        : game.table;
    const me = nextMe(game, table, operation.table !== undefined || reassign, versionOf);
    if (refreeze) forgetTournamentVersions(tournamentKey, playedDecks(table, me));
    games.items.set(game.key, {
      ...game,
      playedAt: data.played_at ?? game.playedAt,
      venueKey: updatedVenueKey(data.venue, game.venueKey),
      tournamentKey,
      roundNumber: data.round_number !== undefined ? data.round_number : game.roundNumber,
      roundType: data.round_type ?? game.roundType,
      playerCount: data.player_count ?? game.playerCount,
      notes: data.notes !== undefined ? data.notes : game.notes,
      table,
      me,
      pending: game.pending || pending,
    });
    touch(game.tournamentKey, pending);
    touch(tournamentKey, pending);
  }

  /**
   * Ma ligne après une mise à jour : reprise de la table quand elle est connue
   * et que la table ou les versions ont bougé, sinon le résumé, dont seule la
   * version change quand il le faut (table inconnue sur cet appareil).
   */
  function nextMe(
    game: LocalGame,
    table: readonly LocalTableLine[] | null,
    changed: boolean,
    versionOf: VersionOf,
  ): LocalGameMe {
    if (!changed) return game.me;
    if (table) return meOf(table, game.me);
    return { ...game.me, ...versionOf(game.me.deckKey) };
  }

  /** Les decks joués à une table (prêts compris) et sur ma ligne. */
  function playedDecks(table: readonly LocalTableLine[] | null, me: LocalGameMe): Set<DeckKey> {
    const keys = new Set<DeckKey>();
    for (const line of [...(table ?? []), me]) if (line.deckKey !== null) keys.add(line.deckKey);
    return keys;
  }

  /** Tournoi d'une mise à jour de partie, sur le modèle de `updatedVenueKey`. */
  function updatedTournamentKey(
    tournament: Parameters<typeof tournamentRef>[0] | null | undefined,
    current: ResourceKey | null,
  ) {
    if (tournament === undefined) return current;
    return tournament ? tournamentRef(tournament) : null;
  }

  function applyGame(operation: Extract<PlayOperation, { type: `game.${string}` }>, pending: boolean) {
    switch (operation.type) {
      case "game.create":
        return createGame(operation, pending);
      case "game.update":
        return updateGame(operation, pending);
      case "game.delete": {
        const key = games.resolve(operation.game.game_id, operation.game.client_ref);
        const game = key && games.items.get(key);
        if (!game) return;
        games.items.delete(game.key);
        touch(game.tournamentKey, pending);
        return;
      }
    }
  }

  return {
    apply(operation, pending) {
      switch (operation.type) {
        case "player.create":
        case "player.update":
        case "player.delete":
          return applyPlayer(operation, pending);
        case "venue.create":
        case "venue.update":
        case "venue.delete":
          return applyVenue(operation, pending);
        case "tournament.create":
        case "tournament.update":
        case "tournament.delete":
          return applyTournament(operation, pending);
        case "game.create":
        case "game.update":
        case "game.delete":
          return applyGame(operation, pending);
      }
    },

    finish() {
      const allGames = [...games.items.values()];
      for (const key of recompute) {
        const tournament = tournaments.items.get(key);
        if (!tournament) continue;
        const own = allGames.filter((game) => game.tournamentKey === key);
        const result = (game: LocalGame): RoundResult => ({
          deckId: null,
          victoryPoints: game.me.victoryPoints,
          gameWin: game.me.gameWin,
        });
        tournaments.items.set(key, {
          ...tournament,
          summary: tournamentSummary(
            own.filter((game) => game.roundType === "preliminary").map(result),
            own.filter((game) => game.roundType === "final").map(result)[0] ?? null,
          ),
          summaryProvisional: provisional.has(key),
        });
      }
      // La partie qui a figé la liste d'un tournoi, par sa clé de surcouche.
      for (const tournament of tournaments.items.values()) {
        if (tournament.deckVersions.length === 0) continue;
        tournaments.items.set(tournament.key, {
          ...tournament,
          deckVersions: tournament.deckVersions.map((item) => ({
            ...item,
            frozenByGameKey: games.keyOfId(Number(item.frozenByGameKey.slice(3))) ?? item.frozenByGameKey,
          })),
        });
      }
      const allTournaments = [...tournaments.items.values()];
      return {
        players: [...players.items.values()],
        venues: [...venues.items.values()],
        tournaments: allTournaments,
        games: allGames.map((game) => {
          const tournament =
            game.tournamentKey === null ? undefined : findByKey(allTournaments, game.tournamentKey);
          // Sans tournoi, pas de nom ; un tournoi introuvable localement garde le
          // nom que le serveur avait rendu.
          if (game.tournamentKey === null) return { ...game, tournamentName: null };
          return tournament ? { ...game, tournamentName: tournament.name } : game;
        }),
      };
    },
  };
}
