import type { ReactNode } from "react";

/**
 * Rendu visuel d'un raccourci clavier (« G A », « / », « ⌘↵ »…), handoff
 * bureau `docs/design-handoff/DESKTOP.md` (« Style kbd »). Purement
 * visuel à ce stade : l'écoute des touches est portée par
 * `useKeyboardShortcuts`, à venir à l'étape 2 du Lot 5bis.
 *
 * Masqué aux lecteurs d'écran par défaut (`aria-hidden`) : partout où ce
 * composant est utilisé jusqu'ici, l'élément porteur déclare déjà le même
 * raccourci via `aria-keyshortcuts`, et le lire deux fois serait redondant.
 * Un futur usage sans `aria-keyshortcuts` sur l'élément porteur devra passer
 * `hidden={false}`.
 */
export function Kbd({ children, hidden = true }: { children: ReactNode; hidden?: boolean }) {
  return (
    <kbd className="kbd" aria-hidden={hidden || undefined}>
      {children}
    </kbd>
  );
}
