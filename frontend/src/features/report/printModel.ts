import type { EventTier } from "../../offline/vtes";
import { DECK_ARCHETYPE_LABELS } from "../../offline/vtes";
import type { DeckTableRow } from "../decks/deckTablesModel";
import { seatPositions } from "../analysis/analysisModel";
import {
  finalLabel,
  preliminaryScore,
  rankingLabel,
  roundTitle,
  roundsPlayedLabel,
  scoreLabel,
  tournamentDates,
  versionDate,
  type ReportDeck,
  type ReportRound,
  type ReportSeat,
  type ReportSnapshot,
} from "./reportModel";

/**
 * La page imprimée du compte-rendu (handoff `docs/design-handoff/COMPTE-RENDU.md`,
 * trame A « Fiche »), en fonctions pures : ce que chaque bloc écrit. La mise en
 * page vit dans `ReportPrint.tsx` et `reportPrint.css`.
 */

export const PRINT_KICKER = "V:TES · Compte-rendu de tournoi · Gurchon Hall";

const TIER: Record<EventTier, string> = {
  standard: "Standard",
  national_championship: "Championnat national",
  grand_prix: "Grand Prix",
  continental_championship: "Championnat continental",
};

/** « ronde 2 », « rondes 1 et 3 », « rondes 1, 2 et 3 », « rondes 2 et 3, finale », « finale ». */
export function roundsList(numbers: readonly number[], final: boolean): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const listed =
    sorted.length === 0
      ? null
      : sorted.length === 1
        ? `ronde ${sorted[0]}`
        : `rondes ${sorted.slice(0, -1).join(", ")} et ${sorted.at(-1)}`;
  if (listed === null) return final ? "finale" : "";
  return final ? `${listed}, finale` : listed;
}

/** Les lignes de deck de l'en-tête : « Guns — Rush », et en multi-deck « · rondes 1 et 3 ». */
export function deckLines(snapshot: ReportSnapshot): string[] {
  const multi = snapshot.tournament.deck_policy === "multi";
  return snapshot.decks.map((deck) => {
    const title = deck.archetype ? `${deck.name} — ${DECK_ARCHETYPE_LABELS[deck.archetype]}` : deck.name;
    if (!multi) return title;
    const played = snapshot.rounds.filter((round) => round.seats.some((seat) => seat.is_me && seat.deck_id === deck.deck_id));
    const numbers = played.flatMap((round) => (round.round_type === "preliminary" && round.round_number !== null ? [round.round_number] : []));
    const where = roundsList(numbers, played.some((round) => round.round_type === "final"));
    return where ? `${title} · ${where}` : title;
  });
}

/** « Construit · mono-deck · 3R+F » ; « +F » quand une finale figure au compte-rendu. */
export function formatFact(snapshot: ReportSnapshot): string {
  const { tournament } = snapshot;
  const format = tournament.format === "draft" ? "Draft" : tournament.format === "constructed" ? "Construit" : "Autre format";
  const policy = tournament.deck_policy === "multi" ? "multi-deck" : "mono-deck";
  const preliminaries = snapshot.rounds.filter((round) => round.round_type === "preliminary").length;
  const count = tournament.round_count ?? preliminaries;
  const final = snapshot.rounds.some((round) => round.round_type === "final");
  const structure = count > 0 ? `${count}R${final ? "+F" : ""}` : final ? "F" : null;
  return [format, policy, structure].filter(Boolean).join(" · ");
}

export interface PrintFact {
  label: string;
  value: string;
}

/** La grille de faits de l'en-tête, dans l'ordre du handoff, ceux qui existent. */
export function headerFactsGrid(snapshot: ReportSnapshot, author: string | null): PrintFact[] {
  const { tournament } = snapshot;
  const multiDay = tournament.end_date !== null && tournament.end_date !== tournament.start_date;
  const venue = tournament.venue ? [tournament.venue.name, tournament.venue.city].filter(Boolean).join(", ") : "";
  const facts: Array<PrintFact | null> = [
    { label: multiDay ? "Dates" : "Date", value: tournamentDates(tournament.start_date, tournament.end_date) },
    venue ? { label: "Lieu", value: venue } : null,
    { label: "Niveau", value: TIER[tournament.event_tier] },
    { label: "Format", value: formatFact(snapshot) },
    tournament.player_count === null ? null : { label: "Participation", value: `${tournament.player_count} joueuses et joueurs` },
    tournament.deck_policy === "multi" && tournament.final_deck_rule
      ? { label: "Finale", value: tournament.final_deck_rule === "best_performing" ? "Au meilleur deck" : "Au choix libre" }
      : null,
    author ? { label: "Auteur", value: `@${author}` } : null,
  ];
  return facts.filter((fact): fact is PrintFact => fact !== null);
}

export interface ResultCell {
  label: string;
  big: string;
  small: string | null;
}

/** Les cases du résultat qui existent, tassées à gauche. */
export function resultCells(snapshot: ReportSnapshot): ResultCell[] {
  const { summary, tournament } = snapshot;
  const ranking = tournament.my_ranking === null ? null : rankingLabel(tournament.my_ranking, tournament.player_count);
  const final = finalLabel(summary);
  const cells: Array<ResultCell | null> = [
    ranking ? { label: "Classement", big: ranking, small: "classement final" } : null,
    summary.rounds_played > 0 ? { label: "Préliminaires", big: preliminaryScore(summary), small: roundsPlayedLabel(summary) } : null,
    final ? { label: "Finale", big: final, small: null } : null,
  ];
  return cells.filter((cell): cell is ResultCell => cell !== null);
}

/** Un paragraphe par bloc séparé d'une ligne vide ; les sauts simples restent (pre-line). */
export function noteParagraphs(notes: string | null): string[] {
  if (!notes) return [];
  return notes
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

/** La sous-ligne de tête de ronde : deck de la ronde en multi-deck, puis « Table à n ». */
export function roundSub(round: ReportRound, snapshot: ReportSnapshot): string | null {
  const me = round.seats.find((seat) => seat.is_me);
  const deck = snapshot.tournament.deck_policy === "multi" && me?.deck_id != null
    ? snapshot.decks.find((item) => item.deck_id === me.deck_id)?.name
    : null;
  const table = round.seats.length > 1 ? `Table à ${round.player_count}` : null;
  const parts = [deck, table].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export { roundTitle };

/** Mon score de la ronde, sans « pas de GW ». */
export function roundScore(round: ReportRound): string | null {
  const me = round.seats.find((seat) => seat.is_me);
  return me ? scoreLabel(me.victory_points, me.game_win) : null;
}

export interface PrintSeat {
  seat: ReportSeat;
  /** « 3 », ou « – » pour mon siège non saisi. */
  number: string;
  player: string;
  /** Deck adverse : « Ventrue · Vote · « Princes de Paris » » ; le mien : son nom. */
  deck: string | null;
  position: string | null;
  /** « Note sur Thomas · », « Note sur le siège 4 · », si une note est incluse. */
  noteLabel: string | null;
}

function opponentDeck(seat: ReportSeat): string | null {
  const parts = [
    seat.clan_name,
    seat.deck_archetype ? DECK_ARCHETYPE_LABELS[seat.deck_archetype] : null,
    seat.deck_name ? `« ${seat.deck_name} »` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Les lignes de la table : les sièges dans l'ordre ; ma ligne sans siège vient
 * en dernier, « – », avec « siège non saisi » et sans position.
 */
export function printSeats(round: ReportRound): PrintSeat[] {
  const me = round.seats.find((seat) => seat.is_me);
  const { prey, predator } = seatPositions(me?.seat ?? null, round.player_count);
  const position = (seat: ReportSeat) => {
    if (seat.is_me || seat.seat === null) return null;
    if (seat.seat === prey && seat.seat === predator) return "ma proie et mon prédateur";
    if (seat.seat === prey) return "ma proie";
    if (seat.seat === predator) return "mon prédateur";
    return null;
  };
  const rows = round.seats.map((seat): PrintSeat => {
    const named = seat.player_name ?? null;
    const noteFor = named ? `Note sur ${named} ·` : seat.seat !== null ? `Note sur le siège ${seat.seat} ·` : "Note ·";
    return {
      seat,
      number: seat.seat === null ? "–" : String(seat.seat),
      player: seat.is_me ? "Moi" : (named ?? "Joueur non nommé"),
      deck: seat.is_me
        ? [seat.deck_name, seat.seat === null ? "siège non saisi" : null].filter(Boolean).join(" · ") || null
        : opponentDeck(seat),
      position: position(seat),
      noteLabel: !seat.is_me && seat.notes ? noteFor : null,
    };
  });
  const mine = rows.filter((row) => row.seat.is_me && row.seat.seat === null);
  return [...rows.filter((row) => !mine.includes(row)), ...mine];
}

/** « groupe 6 », « groupes 5 et 6 », « groupes 4, 5 et 6 ». */
export function groupsText(rows: readonly DeckTableRow[]): string | null {
  const groups = [
    ...new Set(rows.flatMap((row) => (row.facts?.card.groupCode && /^\d+$/.test(row.facts.card.groupCode) ? [Number(row.facts.card.groupCode)] : []))),
  ].sort((a, b) => a - b);
  if (groups.length === 0) return null;
  if (groups.length === 1) return `groupe ${groups[0]}`;
  return `groupes ${groups.slice(0, -1).join(", ")} et ${groups.at(-1)}`;
}

const cards = (count: number) => `${count} ${count === 1 ? "carte" : "cartes"}`;

/** « Crypte 12 cartes · bibliothèque 80 cartes · Rush ». */
export function listSub(deck: ReportDeck, crypt: number, library: number): string {
  return [`Crypte ${cards(crypt)}`, `bibliothèque ${cards(library)}`, deck.archetype ? DECK_ARCHETYPE_LABELS[deck.archetype] : null]
    .filter(Boolean)
    .join(" · ");
}

export { cards as cardsLabel };

export type PrintState =
  | { kind: "version"; number: number; createdAt: string }
  | { kind: "older"; number: number; createdAt: string; latestNumber: number; latestCreatedAt: string }
  | { kind: "preview"; date: string };

/** Le pied de chaque page, sans « Page n / N », qui vient du compteur `@page`. */
export function footerText(tournamentName: string, state: PrintState, site: string): string {
  const version =
    state.kind === "preview"
      ? `aperçu non synchronisé du ${versionDate(state.date)}`
      : `version ${state.number} du ${versionDate(state.createdAt)}`;
  return `Compte-rendu de ${tournamentName} · ${version} · ${site}`;
}

/** Le bandeau de chaque page, pour un aperçu ou une version antérieure ; `null` sinon. */
export function bandText(state: PrintState): string | null {
  if (state.kind === "preview") {
    return "APERÇU, NON SYNCHRONISÉ · Cette version n'est pas encore enregistrée sur le serveur ; elle peut encore changer.";
  }
  if (state.kind === "older") {
    return `VERSION ${state.number} SUR ${state.latestNumber} · Une version plus récente existe : la version ${state.latestNumber} du ${versionDate(state.latestCreatedAt)}.`;
  }
  return null;
}

/** Une chaîne CSS : `\` et `"` échappés, sauts de ligne remplacés par une espace. */
export function cssString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
}

/** La règle `@page` du pied et, s'il y a lieu, du bandeau (handoff, « Pied de page »). */
export function pageRule(footer: string, band: string | null): string {
  const bottom = `@page { @bottom-left { content: ${cssString(footer)}; } }`;
  return band === null ? bottom : `${bottom}\n@page { margin-top: 24mm; @top-left { content: ${cssString(band)}; } }`;
}
