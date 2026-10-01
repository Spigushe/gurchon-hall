import { useEffect, useRef } from "react";

/**
 * Raccourcis clavier globaux (handoff bureau `docs/design-handoff/DESKTOP.md`,
 * section « Style kbd ») : `G` puis `A/C/D/S` navigue, `?` ouvre l'aide, `Échap` ferme un
 * panneau, `⌘↵`/`Ctrl↵` valide un panneau, `/`, `N`, `V` sont des raccourcis simples.
 *
 * Ce module fournit la mécanique générique (table déclarative + machine à séquences),
 * pas la liste des raccourcis eux-mêmes : `App.tsx` (étape 2 du Lot 5bis,
 * `docs/lot5bis-plan-design.md`) n'y enregistre pour l'instant que la navigation `G`
 * puis `A/C/D/S`, seule cible déjà livrée. Les étapes suivantes (panneau latéral, picker
 * du Deckbuilder avec `↑↓`/`+ −`/`↵`) réutiliseront `useKeyboardShortcuts` avec leurs
 * propres tables, montées et démontées avec le composant concerné plutôt que centralisées
 * ici — d'où une API pensée pour plusieurs appels indépendants (un global dans `App.tsx`,
 * d'autres locaux à un panneau ou un picker) plutôt qu'un registre unique.
 */

/**
 * Jeton d'une frappe, comparable aux `keys` déclarées par un binding : une lettre en
 * minuscule (`"a"`), une touche nommée en minuscule (`"escape"`, `"enter"`), un symbole
 * tel quel (`"?"`, `"/"`), ou une combinaison avec modificateur (`"mod+enter"` pour
 * `⌘↵` autant que `Ctrl↵` — les deux systèmes d'exploitation visés par le handoff sont
 * traités comme un seul modificateur logique, `mod`).
 */
export type ShortcutToken = string;

export interface ShortcutBinding {
  /**
   * Séquence de jetons à taper à la suite. Une entrée seule (`["escape"]`) est un
   * raccourci simple ; plusieurs (`["g", "a"]`) forment un chord clavier : la première
   * touche ouvre une fenêtre d'attente courte (`chordTimeoutMs`) pendant laquelle la
   * suivante est attendue, sans effet visible tant que la séquence n'est pas complète.
   */
  keys: ShortcutToken[];
  onTrigger: (event: KeyboardEvent) => void;
  /**
   * Reste actif même quand le focus est dans un champ de saisie (input, textarea,
   * select, `contenteditable`). Réservé aux raccourcis « globaux par nature » du handoff
   * (`Échap`, `⌘↵`/`Ctrl↵`) : tout le reste doit rester inerte pour ne pas interférer
   * avec la frappe normale. Faux par défaut.
   */
  allowInEditableTarget?: boolean;
  /**
   * Prédicat d'ignorance, évalué sur la cible de la frappe : s'il rend vrai, le binding
   * n'est pas candidat — ni `preventDefault`, ni `onTrigger`, et le comportement natif de
   * la touche (une `Entrée` sur un bouton, par exemple) reste intact. Absent par défaut :
   * le comportement des bindings existants ne change pas. Voir `isInteractiveTarget`.
   */
  ignoreTarget?: (target: EventTarget | null) => boolean;
}

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
].join(",");

/**
 * Vrai quand la cible est (ou se trouve dans) un contrôle interactif : bouton, lien,
 * champ, `<select>`, onglet, ou tout élément rendu focalisable à la main. À passer comme
 * `ignoreTarget` à un raccourci qui ne doit pas voler la touche à ces contrôles (`Entrée`).
 * Une cible qui n'est pas un élément (`document`) ou le `body` n'en est pas un.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

const DEFAULT_CHORD_TIMEOUT_MS = 600;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** Normalise une frappe en jeton comparable aux `keys` d'un binding, ou `null` à ignorer. */
function tokenFor(event: KeyboardEvent): ShortcutToken | null {
  const { key } = event;
  // Une touche de modification seule n'est jamais un jeton : on attend la touche
  // qu'elle accompagne (le `keydown` de `Control` seul ne doit rien déclencher).
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return null;
  const base = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  if (event.metaKey || event.ctrlKey) return `mod+${base}`;
  return base;
}

function startsWith(longer: ShortcutToken[], prefix: ShortcutToken[]): boolean {
  if (prefix.length > longer.length) return false;
  return prefix.every((token, index) => longer[index] === token);
}

function sameSequence(a: ShortcutToken[], b: ShortcutToken[]): boolean {
  return a.length === b.length && startsWith(a, b);
}

/**
 * Écoute les raccourcis clavier `bindings` sur tout le document tant que le composant
 * appelant est monté et `enabled` vrai. Plusieurs appels (un par composant) coexistent
 * sans se marcher dessus : chacun a sa propre machine à séquences et son propre
 * écouteur, filtré indépendamment par le contexte de frappe (§ `allowInEditableTarget`).
 *
 * N'est **pas** conditionné à la largeur de fenêtre : un raccourci sans clavier physique
 * ne se déclenche jamais (aucun `keydown` global en usage tactile normal), et un clavier
 * Bluetooth relié à une tablette ou un téléphone sous 1024px doit pouvoir naviguer comme
 * au bureau — le handoff ne le mentionne pas explicitement, mais rien n'oblige à le lui
 * interdire, et conditionner l'écoute à la largeur ajouterait un état à resynchroniser
 * sans bénéfice mesurable.
 */
export function useKeyboardShortcuts(
  bindings: ShortcutBinding[],
  options: { enabled?: boolean; chordTimeoutMs?: number } = {},
): void {
  const { enabled = true, chordTimeoutMs = DEFAULT_CHORD_TIMEOUT_MS } = options;
  // Ref plutôt que dépendance d'effet : `bindings` est recréé à chaque rendu chez la
  // plupart des appelants (tableau inline), et reposer l'écouteur à chaque rendu casserait
  // une séquence `G` en cours (le nettoyage de l'effet précédent purge la fenêtre d'attente).
  // L'affectation se fait dans un effet (jamais pendant le rendu, cf. règle
  // `react-hooks/refs`) ; sans tableau de dépendances, il se rejoue après chaque rendu.
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;

    let pending: ShortcutToken[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      pending = [];
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const armTimeout = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(clearPending, chordTimeoutMs);
    };

    /** Cherche une correspondance exacte ou un préfixe pour `candidate`, filtré par contexte. */
    const match = (candidate: ShortcutToken[], editable: boolean, target: EventTarget | null) => {
      const eligible = (binding: ShortcutBinding) =>
        (!editable || binding.allowInEditableTarget === true) && !binding.ignoreTarget?.(target);
      const exact = bindingsRef.current.find((b) => eligible(b) && sameSequence(b.keys, candidate));
      if (exact) return { kind: "exact" as const, binding: exact };
      const isPrefix = bindingsRef.current.some(
        (b) => eligible(b) && b.keys.length > candidate.length && startsWith(b.keys, candidate),
      );
      if (isPrefix) return { kind: "prefix" as const };
      return { kind: "none" as const };
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const token = tokenFor(event);
      if (token === null) return;
      const editable = isEditableTarget(event.target);

      const candidate = [...pending, token];
      const result = match(candidate, editable, event.target);

      if (result.kind === "exact") {
        event.preventDefault();
        clearPending();
        result.binding.onTrigger(event);
        return;
      }
      if (result.kind === "prefix") {
        pending = candidate;
        armTimeout();
        return;
      }

      // La séquence en cours ne se poursuit pas : elle peut néanmoins amorcer une
      // nouvelle séquence à elle seule (ex. un `G` tapé juste après un chord avorté).
      clearPending();
      if (candidate.length === 1) return; // déjà tenté ci-dessus avec pending vide
      const solo = match([token], editable, event.target);
      if (solo.kind === "exact") {
        event.preventDefault();
        solo.binding.onTrigger(event);
      } else if (solo.kind === "prefix") {
        pending = [token];
        armTimeout();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [enabled, chordTimeoutMs]);
}
