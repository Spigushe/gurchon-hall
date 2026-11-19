import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { Route } from "../app/routes";
import { Kbd } from "./Kbd";
import { Sheet, SheetHeader } from "./Sheet";
import { displayKeys, screenTitleOf, shortcutLegendRegistry, type LegendLine } from "./shortcutLegend";
import { suspendShortcuts, useKeyboardShortcuts } from "./useKeyboardShortcuts";

/** Section fixe : les deux raccourcis communs à toutes les feuilles (`Sheet`). */
const SHEET_LINES: LegendLine[] = [
  { label: "Fermer", keys: [["escape"]] },
  { label: "Valider", keys: [["mod+enter"]] },
];

function LegendSection({
  title,
  lines,
  note,
  empty,
  testId,
}: {
  title: string;
  lines: LegendLine[];
  note?: string;
  empty?: string;
  testId: string;
}) {
  return (
    <section className="shortcuts-legend__section" data-testid={testId}>
      <h3 className="kicker shortcuts-legend__title">{title}</h3>
      {note && <p className="shortcuts-legend__note">{note}</p>}
      {lines.length === 0 ? (
        <p className="hint" data-testid={`${testId}-empty`}>
          {empty}
        </p>
      ) : (
        <ul className="shortcuts-legend__list">
          {lines.map((line) => (
            <li key={line.label} className="shortcuts-legend__row" data-testid="shortcuts-legend-row">
              <span>{line.label}</span>
              <span className="shortcuts-legend__keys">
                {line.keys.map((keys) => (
                  <Kbd key={displayKeys(keys)} hidden={false}>
                    {displayKeys(keys)}
                  </Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Légende des raccourcis (Lot 12, P8 ; handoff d44 à d46), au bureau : `?` ou
 * « Raccourcis » dans le menu du compte. D'abord l'écran courant, puis
 * « Partout », puis « Dans une feuille ». Les deux premières sections se
 * lisent dans le registre que tient `useKeyboardShortcuts` : elles disent ce
 * qui est monté et actif, pas une liste écrite à la main.
 *
 * Tant qu'elle est ouverte, les autres raccourcis sont suspendus (un `N`
 * n'ouvre pas « Nouveau deck » derrière elle) ; `Échap` et `?` la ferment.
 */
export function ShortcutsLegend({ route, onClose }: { route: Route; onClose: () => void }) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const legend = useSyncExternalStore(
    shortcutLegendRegistry.subscribe,
    shortcutLegendRegistry.getSnapshot,
    shortcutLegendRegistry.getSnapshot,
  );

  useEffect(() => suspendShortcuts(), []);
  useKeyboardShortcuts([{ keys: ["?"], onTrigger: onClose }], { ignoreSuspension: true });

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      className="shortcuts-legend"
      data-testid="shortcuts-legend"
    >
      <SheetHeader kicker="Clavier" title="Raccourcis" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <LegendSection
        title={screenTitleOf(route)}
        lines={legend.screen}
        empty="Cet écran n'a pas de raccourci propre."
        testId="shortcuts-legend-screen"
      />
      <LegendSection title="Partout" lines={legend.global} testId="shortcuts-legend-global" />
      <LegendSection
        title="Dans une feuille"
        lines={SHEET_LINES}
        note="Sur Mac, ⌘ ; ailleurs, Ctrl."
        testId="shortcuts-legend-sheet"
      />
    </Sheet>
  );
}
