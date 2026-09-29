import { useRef, useState, type RefObject } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackRow, Sheet, SheetFooter, SheetHeader } from "../../../src/components/Sheet";

/**
 * `Sheet` relit `window.innerWidth` à l'ouverture (pas de media query pour
 * l'`inert` de fond, propre au bureau, cf. `isDesktopViewport` dans le
 * composant). jsdom vaut 1024 par défaut (bureau) : les tests qui veulent le
 * mobile le fixent explicitement, et le remettent après coup.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

/**
 * Banc d'essai minimal : un bouton déclencheur (focalisé avant ouverture, pour
 * vérifier le retour du focus) qui ouvre/ferme une `Sheet` à deux boutons
 * (pour vérifier le piège de focus sur plus d'un élément), plus un bloc
 * « arrière-plan » à côté, pour vérifier que `Sheet` le rend inerte.
 */
function Harness({
  onPrimaryAction,
  initiallyOpen = false,
}: {
  onPrimaryAction?: () => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <div data-testid="background-link">
        <a href="#ailleurs">Lien d'arrière-plan</a>
      </div>
      {open && (
        <Sheet
          titleId="t"
          titleRef={titleRef}
          onClose={() => setOpen(false)}
          onPrimaryAction={onPrimaryAction}
          data-testid="test-sheet"
        >
          <h2 id="t" ref={titleRef} tabIndex={-1}>
            Titre
          </h2>
          <button type="button" data-testid="first">
            Premier
          </button>
          <button type="button" data-testid="last">
            Dernier
          </button>
        </Sheet>
      )}
    </div>
  );
}

describe("<Sheet />", () => {
  it("porte role=dialog, aria-modal, et place le focus sur le titre à l'ouverture", () => {
    render(<Harness initiallyOpen />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Titre")).toHaveFocus();
  });

  it("Échap ferme la feuille, y compris depuis un champ de saisie", () => {
    render(<Harness initiallyOpen />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("piège le focus : Tab depuis le dernier élément revient au premier, Shift+Tab inverse", () => {
    render(<Harness initiallyOpen />);
    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");

    last.focus();
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("ne piège pas les autres touches (Tab seul en dehors du panneau reste sans effet ici)", () => {
    render(<Harness initiallyOpen />);
    const first = screen.getByTestId("first");
    first.focus();

    // Une touche qui n'est ni Tab ni Shift+Tab ne doit rien intercepter.
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(first).toHaveFocus();
  });

  it(
    "changement de comportement mobile assumé (Lot 5bis, étape 3) : retourne le focus à " +
      "l'élément déclencheur à la fermeture",
    () => {
      render(<Harness />);
      const trigger = screen.getByTestId("trigger");
      trigger.focus();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(trigger).not.toHaveFocus();

      fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );

  it("panneau bureau (≥ 1024px) : rend le reste de l'application inerte pendant l'ouverture, restauré à la fermeture", () => {
    setViewportWidth(1440);
    const { container } = render(<Harness initiallyOpen />);

    expect(container).toHaveAttribute("inert");
    expect(container).toHaveClass("app-dimmed");

    fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" });

    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveClass("app-dimmed");
  });

  it(
    "sous 1024px, le fond reste interactif (décision de l'étape 3) : une feuille " +
      "`pushed` laisse la tab bar cliquable sans qu'on la ferme d'abord",
    () => {
      setViewportWidth(390);
      const { container } = render(<Harness initiallyOpen />);

      expect(container).not.toHaveAttribute("inert");
      expect(container).not.toHaveClass("app-dimmed");
    },
  );

  it("ne rend jamais son propre contenu inerte (le panneau vit dans un conteneur de portail marqué)", () => {
    render(<Harness initiallyOpen />);

    const dialog = screen.getByRole("dialog");
    // Le conteneur de portail (parent direct sous <body>) porte le marqueur et
    // n'a donc jamais été inclus dans les éléments rendus inertes.
    expect(dialog.parentElement).toHaveAttribute("data-sheet-portal");
    expect(dialog.parentElement).not.toHaveAttribute("inert");
  });

  it("⌘Entrée déclenche `onPrimaryAction` quand il est fourni, y compris depuis un champ", () => {
    const onPrimaryAction = vi.fn();
    render(<Harness initiallyOpen onPrimaryAction={onPrimaryAction} />);

    fireEvent.keyDown(screen.getByTestId("first"), { key: "Enter", ctrlKey: true });

    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it("⌘Entrée sans `onPrimaryAction` ne fait rien (pas d'erreur)", () => {
    render(<Harness initiallyOpen />);

    expect(() =>
      fireEvent.keyDown(screen.getByTestId("first"), { key: "Enter", ctrlKey: true }),
    ).not.toThrow();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("variant pushed/full : le nom de classe attendu par index.css reste présent", () => {
    const titleRefA = { current: null } as RefObject<HTMLElement | null>;
    render(
      <Sheet titleId="a" titleRef={titleRefA} onClose={() => {}} variant="pushed" data-testid="pushed-sheet">
        <span>contenu</span>
      </Sheet>,
    );
    expect(screen.getByTestId("pushed-sheet")).toHaveClass("sheet", "sheet--pushed");
  });
});

describe("<SheetHeader />", () => {
  it("affiche le kbd Échap (masqué au lecteur d'écran) et le bouton de fermeture porte aria-keyshortcuts", () => {
    const onClose = vi.fn();
    const titleRef = { current: null } as RefObject<HTMLHeadingElement | null>;
    render(<SheetHeader title="Nouveau deck" titleId="h" titleRef={titleRef} onClose={onClose} />);

    const kbd = screen.getByText("Échap");
    expect(kbd.tagName.toLowerCase()).toBe("kbd");
    expect(kbd).toHaveAttribute("aria-hidden", "true");

    const closeButton = screen.getByRole("button", { name: "Fermer" });
    expect(closeButton).toHaveAttribute("aria-keyshortcuts", "Escape");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("<SheetFooter />", () => {
  it("affiche Annuler et l'action primaire avec son kbd ⌘↵, et déclenche les deux callbacks", () => {
    const onCancel = vi.fn();
    const onPrimaryClick = vi.fn();
    render(
      <SheetFooter
        onCancel={onCancel}
        primaryLabel="Enregistrer"
        onPrimaryClick={onPrimaryClick}
        primaryType="button"
        primaryTestId="footer-primary"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const primary = screen.getByTestId("footer-primary");
    expect(primary).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
    fireEvent.click(primary);
    expect(onPrimaryClick).toHaveBeenCalledTimes(1);
  });

  it("désactive l'action primaire via primaryDisabled", () => {
    render(
      <SheetFooter
        onCancel={() => {}}
        primaryLabel="Enregistrer"
        primaryDisabled
        primaryTestId="footer-primary"
      />,
    );

    expect(screen.getByTestId("footer-primary")).toBeDisabled();
  });
});

describe("<BackRow /> (inchangé)", () => {
  it("appelle onClick et affiche le libellé", () => {
    const onClick = vi.fn();
    render(<BackRow label="Collection" onClick={onClick} data-testid="back" />);

    fireEvent.click(screen.getByTestId("back"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });
});
