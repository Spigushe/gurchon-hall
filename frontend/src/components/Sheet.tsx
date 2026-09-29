import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { Kbd } from "./Kbd";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

/**
 * Feuille plein écran ou écran poussé (mobile, Lot 5) ; à partir de 1024px,
 * le même composant devient le panneau latéral bureau (Lot 5bis, étape 3,
 * `docs/design-handoff-mobile/DESKTOP.md` § « Panneau latéral ») : la
 * disposition est entièrement tranchée par la media query dans `index.css`
 * (`.sheet` sous `@media (min-width: 1024px)`), pas par un second composant —
 * principe « un seul composant » du plan du Lot 5bis.
 *
 * Rendu par un portail (`createPortal`) directement sous `document.body`,
 * plutôt qu'à l'endroit où `<Sheet>` apparaît dans l'arbre React : c'est ce
 * qui permet de rendre le reste de l'application `inert` pendant que la
 * feuille est ouverte (voir `acquireBackgroundInert` ci-dessous) sans risquer
 * de rendre la feuille elle-même inerte au passage — les deux sous-arbres
 * (application, panneau) sont alors des frères sous `<body>`, pas l'un dans
 * l'autre. Purement structurel : la position `fixed` du panneau ne dépend pas
 * de son parent DOM, donc ce changement n'a aucun effet visuel mobile.
 *
 * Toujours `role="dialog"`, `aria-modal="true"`. Deux comportements
 * s'appliquent désormais aux deux largeurs, alors qu'ils ne visaient jusqu'ici
 * que le panneau bureau du handoff — **changement de comportement mobile
 * assumé** (Lot 5bis, étape 3 : « le focus piégé et le retour du focus
 * profiteraient aussi au mobile ») :
 *  - le focus est **piégé** dans la feuille (Tab/Shift+Tab ne quittent jamais
 *    son sous-arbre) ;
 *  - le focus **revient** à l'élément qui avait le focus au moment de
 *    l'ouverture (pas seulement au titre à l'ouverture, déjà fait).
 *
 * Un troisième comportement, lui, reste **propre au panneau bureau** (≥ 1024px) :
 * le reste de l'application devient `inert` (attribut HTML natif) et s'estompe
 * à 35 % (`.app-dimmed`, index.css) le temps que le panneau est ouvert. Étendre
 * `inert` au mobile a été tenté puis abandonné à cette étape : une feuille
 * `variant="pushed"` (Modifier une entrée, Verser un produit) laisse
 * délibérément la tab bar accessible en dessous, pour qu'on puisse changer
 * d'onglet sans fermer la feuille d'abord — plusieurs scénarios `e2e-real`
 * s'appuient dessus (ex. `addStock` puis `goToDecksList` sans Échap entre les
 * deux). Rendre la tab bar inerte cassait ce parcours (`nav-decks` devenait
 * incliquable, `<body> intercepts pointer events`). Le focus piégé et le
 * retour du focus, eux, n'ont aucun tel effet de bord (ils ne bloquent que la
 * touche Tab, jamais un clic), d'où leur activation aux deux largeurs alors
 * que l'inert reste conditionné à `isDesktopViewport()`.
 *
 * Échap reste géré **localement** par chaque instance de `Sheet`, comme au
 * Lot 5, plutôt que par un registre global dans `App.tsx` : chaque feuille
 * connaît déjà son `onClose` via les props, et `App.tsx` ne sait pas quelles
 * feuilles sont ouvertes. Ce qui change : l'écouteur `keydown` maison est
 * remplacé par un appel à `useKeyboardShortcuts` (le hook partagé de l'étape
 * 2), pour ne pas réinventer une seconde machine à raccourcis — et parce que
 * `⌘↵`/`Ctrl↵` (validation du panneau, `onPrimaryAction`) a exactement le
 * même besoin : actif même quand le focus est dans un champ de saisie
 * (`allowInEditableTarget`, prévu pour ça).
 */
export function Sheet({
  titleId,
  titleRef,
  onClose,
  onPrimaryAction,
  variant = "full",
  children,
  className = "",
  "data-testid": testId,
}: {
  titleId: string;
  titleRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /**
   * Action « primaire » du panneau (validation), déclenchée par `⌘↵` / `Ctrl↵`
   * (handoff bureau, § « Panneau latéral »). Optionnelle : un formulaire qui
   * n'a pas encore adopté ce mécanisme laisse le raccourci inactif plutôt que
   * de le simuler. Câblage réel laissé aux écrans concrets (Lot 5bis, étapes
   * 7, 9, 10) — voir `SheetFooter` ci-dessous pour le pied visuel assorti.
   */
  onPrimaryAction?: () => void;
  variant?: "full" | "pushed";
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [portalNode] = useState(() => {
    const node = document.createElement("div");
    node.setAttribute(PORTAL_MARKER_ATTR, "");
    return node;
  });

  // Un seul effet pour l'attache au DOM, l'« inert » du reste de l'app, le
  // focus initial et le retour du focus : les trois cleanups doivent
  // s'exécuter dans cet ordre précis à la fermeture (lever l'inert avant de
  // refocaliser le déclencheur, sinon `.focus()` sur un élément encore inerte
  // ne fait rien). Les regrouper dans un seul effet le garantit, alors que
  // des effets séparés s'exécuteraient dans un ordre qu'on ne contrôle pas
  // aussi précisément entre eux.
  useEffect(() => {
    document.body.appendChild(portalNode);
    const trigger = document.activeElement;
    const releaseInert = isDesktopViewport() ? acquireBackgroundInert() : noopRelease;
    titleRef.current?.focus();

    return () => {
      releaseInert();
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
      document.body.removeChild(portalNode);
    };
    // Ouverture/fermeture seulement : ni `titleRef` (stable, fourni par l'appelant)
    // ni une éventuelle identité changeante de `portalNode` ne doivent relancer ce cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalNode]);

  // Échap ferme toujours (y compris depuis un champ de saisie, comme avant) ;
  // ⌘↵/Ctrl↵ valide si le panneau connaît son action primaire. Les deux
  // restent actifs quel que soit l'endroit du panneau qui a le focus.
  useKeyboardShortcuts([
    { keys: ["escape"], onTrigger: () => onClose(), allowInEditableTarget: true },
    ...(onPrimaryAction
      ? [{ keys: ["mod+enter"], onTrigger: () => onPrimaryAction(), allowInEditableTarget: true }]
      : []),
  ]);

  // Focus piégé : Tab/Shift+Tab bouclent sur les éléments focalisables du
  // panneau, sans jamais rendre la main aux éléments (désormais inertes) qui
  // l'entourent.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      className={`sheet sheet--${variant} ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="sheet__inner">{children}</div>
    </div>,
    portalNode,
  );
}

/** Marque un conteneur de portail de `Sheet`, pour ne jamais se rendre lui-même inerte. */
const PORTAL_MARKER_ATTR = "data-sheet-portal";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Seuil bureau, identique à celui d'`index.css` (`@media (min-width: 1024px)`,
 * DESKTOP.md). Seul usage JS du seuil à ce jour : l'estompe/`inert` de fond ne
 * peut pas être purement du CSS puisque `inert` est un attribut posé côté
 * script (voir `acquireBackgroundInert`). Pas de réabonnement au
 * redimensionnement : la largeur est relue à l'ouverture de chaque feuille, ce
 * qui suffit tant qu'on ne redimensionne pas la fenêtre pendant qu'une feuille
 * bureau est déjà ouverte (cas non couvert par le handoff non plus).
 */
const DESKTOP_BREAKPOINT_PX = 1024;

function isDesktopViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= DESKTOP_BREAKPOINT_PX;
}

const noopRelease = () => {};

/**
 * Rend inerte (attribut HTML natif, pas un style) tout ce qui, sous `<body>`,
 * n'est pas un conteneur de portail de `Sheet` — donc le reste de
 * l'application, jamais une autre feuille déjà ouverte. Compte les appels
 * (plusieurs feuilles pourraient en théorie se chevaucher) : seul le premier
 * appel marque, seul le dernier retrait lève.
 *
 * **Bureau uniquement** (`isDesktopViewport()`, appelant) : en dessous de
 * 1024px, une feuille `variant="pushed"` (Modifier une entrée, Verser un
 * produit) laisse délibérément la tab bar accessible en dessous, pour changer
 * d'onglet sans fermer la feuille d'abord — comportement mobile existant,
 * exercé par plusieurs scénarios `e2e-real`. Rendre le fond inerte aussi sous
 * 1024px cassait ce parcours (voir le commentaire de `Sheet` ci-dessus).
 */
let openSheetCount = 0;
let hiddenSiblings: HTMLElement[] = [];

function acquireBackgroundInert(): () => void {
  openSheetCount += 1;
  if (openSheetCount === 1) {
    hiddenSiblings = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.hasAttribute(PORTAL_MARKER_ATTR),
    );
    for (const el of hiddenSiblings) {
      el.setAttribute("inert", "");
      el.classList.add("app-dimmed");
    }
  }
  return () => {
    openSheetCount -= 1;
    if (openSheetCount === 0) {
      for (const el of hiddenSiblings) {
        el.removeAttribute("inert");
        el.classList.remove("app-dimmed");
      }
      hiddenSiblings = [];
    }
  };
}

/** Ligne d'en-tête « kicker + titre + fermeture (X) », pour une feuille modale. */
export function SheetHeader({
  kicker,
  title,
  titleId,
  titleRef,
  onClose,
  closeLabel = "Fermer",
}: {
  kicker?: ReactNode;
  title: ReactNode;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="sheet__header-row">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title">
          {title}
        </h2>
      </div>
      {/* Kbd Échap visible seulement en panneau bureau (index.css, `.sheet__escape-kbd`) :
          sur mobile, rien n'indique un raccourci clavier vu l'absence de clavier
          physique habituel. Le bouton porte `aria-keyshortcuts` ; `Kbd` reste
          `aria-hidden` par défaut pour ne pas doubler l'annonce au lecteur d'écran. */}
      <div className="sheet__header-actions">
        <span className="sheet__escape-kbd">
          <Kbd>Échap</Kbd>
        </span>
        <button
          type="button"
          className="sheet__close"
          onClick={onClose}
          aria-label={closeLabel}
          aria-keyshortcuts="Escape"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

/**
 * Pied de panneau bureau (handoff « Panneau latéral ») : « Annuler » (bordure
 * divider) puis l'action primaire (accent outline, kbd `⌘↵`). Outillage posé
 * à l'étape 3 du Lot 5bis, pas encore consommé par un écran concret — les
 * feuilles existantes (Modifier une entrée, Nouveau deck, Verser un produit)
 * gardent leur pied actuel (`.sheet-form__footer`, un seul bouton) jusqu'à ce
 * que les étapes 7, 9 et 10 les réécrivent. `onPrimaryClick` reste distinct de
 * l'`onPrimaryAction` de `Sheet` (le raccourci clavier) : un écran qui adopte
 * ce pied doit passer la même fonction aux deux pour que le clic et `⌘↵`
 * déclenchent la même action.
 */
export function SheetFooter({
  onCancel,
  cancelLabel = "Annuler",
  primaryLabel,
  onPrimaryClick,
  primaryType = "submit",
  primaryDisabled = false,
  primaryTestId,
}: {
  onCancel: () => void;
  cancelLabel?: string;
  primaryLabel: ReactNode;
  onPrimaryClick?: () => void;
  primaryType?: "submit" | "button";
  primaryDisabled?: boolean;
  primaryTestId?: string;
}) {
  return (
    <div className="sheet__footer">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type={primaryType}
        className="btn btn-primary"
        onClick={onPrimaryClick}
        disabled={primaryDisabled}
        data-testid={primaryTestId}
        aria-keyshortcuts="Meta+Enter Control+Enter"
      >
        {primaryLabel}
        <span className="sheet__primary-kbd">
          <Kbd>⌘↵</Kbd>
        </span>
      </button>
    </div>
  );
}

/** Ligne de retour « ← Libellé », pour un écran poussé sans fermeture en croix. */
export function BackRow({
  label,
  onClick,
  "data-testid": testId,
}: {
  label: string;
  onClick: () => void;
  "data-testid"?: string;
}) {
  return (
    <button type="button" className="back-row" onClick={onClick} data-testid={testId}>
      <ArrowLeft size={20} />
      {label}
    </button>
  );
}
