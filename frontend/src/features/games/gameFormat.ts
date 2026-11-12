import { findByKey, type GameRoundType, type LocalGame, type LocalPlayer, type ResourceKey } from "../../offline/vtes";

/**
 * Mise en forme des parties (Lot 7, D1). Fonctions pures : l'affichage se fait
 * toujours en heure locale (risque « fuseau de `played_at` » du plan).
 */

/**
 * Nom d'un adversaire d'une table. Une ligne sans joueur (Lot 8, P6) se dit
 * « Adversaire sans nom » ; un joueur absent du carnet local, « Joueur inconnu ».
 */
export function opponentName(players: readonly LocalPlayer[] | undefined, key: ResourceKey | null): string {
  if (key === null) return "Adversaire sans nom";
  return (players && findByKey(players, key)?.name) ?? "Joueur inconnu";
}

const NUMBER_WORDS: Record<number, string> = {
  1: "un",
  2: "deux",
  3: "trois",
  4: "quatre",
  5: "cinq",
  6: "six",
};

/** « quatre » pour 4 (les tables vont de 2 à 6) ; le chiffre au-delà. */
export function numberWord(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

/** « 2,5 » : les VP vont par demi-points, virgule française. */
export function formatVp(vp: number): string {
  return String(vp).replace(".", ",");
}

/** « 3 VP » (« 1 VP », « 2,5 VP »), ou `null` si rien n'est saisi. */
export function vpLabel(vp: number | null): string | null {
  return vp === null ? null : `${formatVp(vp)} VP`;
}

/** « finale », « ronde 2 », ou `null` pour une partie amicale. */
export function roundLabel(game: { roundType: GameRoundType; roundNumber: number | null }): string | null {
  if (game.roundType === "final") return "finale";
  if (game.roundNumber !== null) return `ronde ${game.roundNumber}`;
  return null;
}

function validDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Jour local `AAAA-MM-JJ`, clé de regroupement de la liste. */
export function dayKey(iso: string): string {
  const date = validDate(iso);
  if (!date) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** « Samedi 24 octobre ». */
export function dayHeading(iso: string): string {
  const date = validDate(iso);
  if (!date) return iso;
  const text = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « 16:35 ». */
export function timeOfDay(iso: string): string {
  const date = validDate(iso);
  if (!date) return iso;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** « 24/10 16:35 », la date de la première colonne du tableau bureau. */
export function shortDateTime(iso: string): string {
  const date = validDate(iso);
  if (!date) return iso;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${timeOfDay(iso)}`;
}

/** « Samedi 24/10/2026, 16:35 » : la date complète du détail. */
export function fullDateTime(iso: string): string {
  const date = validDate(iso);
  if (!date) return iso;
  const weekday = date.toLocaleDateString("fr-FR", { weekday: "long" });
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day}, ${timeOfDay(iso)}`;
}

/** Valeur d'un `<input type="datetime-local">` (heure locale, à la minute) pour un instant. */
export function toLocalInput(value: string | Date): string {
  const date = typeof value === "string" ? validDate(value) : value;
  if (!date) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Instant ISO (UTC, « …Z ») d'une valeur `datetime-local`, `null` si elle est vide ou illisible. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** « Aujourd'hui, 21:42 » ou « 24/10, 21:42 », pour le champ « Quand ». */
export function whenLabel(localValue: string, now: Date = new Date()): string {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return "Date à saisir";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayKey(date.toISOString()) === dayKey(now.toISOString())) return `Aujourd'hui, ${time}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${time}`;
}

/** Ma ligne d'une partie en un mot : « 3 VP », « 3 VP · GW ». */
export function resultText(game: Pick<LocalGame, "me">): string {
  const vp = vpLabel(game.me.victoryPoints);
  if (vp === null) return game.me.gameWin ? "GW" : "—";
  return game.me.gameWin ? `${vp} · GW` : vp;
}

/** « 24 oct. 2026 » pour une date locale `AAAA-MM-JJ` (tournois). */
export function formatLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
