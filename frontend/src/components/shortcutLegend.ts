/**
 * Registre des raccourcis montés, pour la légende `?` (Lot 12, P8, D2).
 *
 * La légende ne tient pas une liste écrite à la main : chaque appel de
 * `useKeyboardShortcuts` y publie les raccourcis qui portent un libellé
 * (`ShortcutBinding.legend`), tant que le composant est monté et l'appel
 * actif. La légende montre donc ce qui marche vraiment sur l'écran ouvert :
 * « Ajouter une ronde » n'y figure que si le tournoi en accepte une. Un
 * raccourci sans libellé (Échap d'une feuille, `↵` d'une confirmation) n'y
 * paraît pas ; la section « Dans une feuille » est fixe.
 *
 * Deux portées : `screen` (l'écran courant, par défaut) et `global`
 * (navigation, recherche, la légende elle-même, posés par `App`).
 */

import type { Route } from "../app/routes";

export type ShortcutScope = "screen" | "global";

/** Un raccourci tel qu'il est publié : son libellé et sa séquence de jetons. */
export interface LegendEntry {
  label: string;
  keys: string[];
}

export interface LegendRegistration {
  scope: ShortcutScope;
  entries: LegendEntry[];
}

/** Une ligne de la légende : un libellé, une ou plusieurs touches (`↑` `↓`). */
export interface LegendLine {
  label: string;
  keys: string[][];
}

export interface LegendSnapshot {
  screen: LegendLine[];
  global: LegendLine[];
}

const NAMED_KEYS: Record<string, string> = {
  enter: "↵",
  escape: "Échap",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  "mod+enter": "⌘↵",
  "-": "−",
};

/** Texte d'une touche : `"g"` → `G`, `"enter"` → `↵`, `"mod+enter"` → `⌘↵`. */
export function displayToken(token: string): string {
  const named = NAMED_KEYS[token];
  if (named !== undefined) return named;
  if (token.startsWith("mod+")) return `⌘${displayToken(token.slice(4))}`;
  return token.length === 1 ? token.toUpperCase() : token;
}

/** Texte d'une séquence : `["g", "a"]` → `G A`. */
export function displayKeys(keys: string[]): string {
  return keys.map(displayToken).join(" ");
}

/**
 * Fonction pure : les inscriptions, dans leur ordre, regroupées par portée ;
 * deux raccourcis de même libellé et de même portée forment une ligne à
 * plusieurs touches (`↑` puis `↓`), une même séquence n'étant comptée qu'une
 * fois.
 */
export function buildLegend(registrations: Iterable<LegendRegistration>): LegendSnapshot {
  const lines: Record<ShortcutScope, LegendLine[]> = { screen: [], global: [] };
  for (const registration of registrations) {
    const target = lines[registration.scope];
    for (const entry of registration.entries) {
      const sequence = displayKeys(entry.keys);
      const existing = target.find((line) => line.label === entry.label);
      if (!existing) target.push({ label: entry.label, keys: [entry.keys] });
      else if (!existing.keys.some((keys) => displayKeys(keys) === sequence)) existing.keys.push(entry.keys);
    }
  }
  return lines;
}

/**
 * Le registre, un module partagé par tous les appels du hook. Un appelant est
 * désigné par un objet stable (le sien) ; l'ordre est celui de sa première
 * inscription, que React donne enfant avant parent.
 */
class ShortcutLegendRegistry {
  private readonly registrations = new Map<object, LegendRegistration & { signature: string }>();
  private readonly order = new WeakMap<object, number>();
  private nextOrder = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: LegendSnapshot = { screen: [], global: [] };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LegendSnapshot => this.snapshot;

  /** Publie (ou retire, avec `null`) les raccourcis d'un appelant ; sans effet s'ils n'ont pas changé. */
  publish(owner: object, registration: LegendRegistration | null): void {
    const signature = registration === null || registration.entries.length === 0 ? "" : JSON.stringify(registration);
    const previous = this.registrations.get(owner);
    if ((previous?.signature ?? "") === signature) return;
    if (signature === "" || registration === null) {
      this.registrations.delete(owner);
    } else {
      if (!this.order.has(owner)) this.order.set(owner, this.nextOrder++);
      this.registrations.set(owner, { ...registration, signature });
    }
    this.emit();
  }

  private emit(): void {
    const ordered = [...this.registrations.entries()]
      .sort(([a], [b]) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0))
      .map(([, registration]) => registration);
    this.snapshot = buildLegend(ordered);
    for (const listener of this.listeners) listener();
  }
}

export const shortcutLegendRegistry = new ShortcutLegendRegistry();

const SCREEN_TITLES: Record<Route["name"], string> = {
  home: "Atelier",
  stock: "Collection",
  decks: "Decks",
  deck: "Deck",
  deckVersion: "Version jouée",
  compare: "Comparaison",
  games: "Parties",
  game: "Partie",
  tournaments: "Tournois",
  tournament: "Tournoi",
  bilan: "Bilan",
  notebook: "Carnet",
  sync: "Synchronisation",
  account: "Compte",
  search: "Chercher",
  "not-found": "Page introuvable",
};

/** Titre de la section « écran courant » de la légende. */
export function screenTitleOf(route: Route): string {
  return SCREEN_TITLES[route.name];
}
