import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isInteractiveTarget,
  useKeyboardShortcuts,
  type ShortcutBinding,
} from "../../../src/components/useKeyboardShortcuts";

/** Frappe une touche simple (pas de modificateur) sur `document`. */
function press(key: string) {
  fireEvent.keyDown(document, { key });
}

function pressWithMod(key: string) {
  fireEvent.keyDown(document, { key, ctrlKey: true });
}

function Harness({ bindings, enabled }: { bindings: ShortcutBinding[]; enabled?: boolean }) {
  useKeyboardShortcuts(bindings, { enabled });
  return (
    <div>
      <input aria-label="champ de saisie" />
      <button type="button">bouton</button>
      <a href="#/x">lien</a>
      <div role="tab" tabIndex={0}>onglet</div>
      <p>texte</p>
    </div>
  );
}

describe("useKeyboardShortcuts", () => {
  it("déclenche un raccourci simple", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["n"], onTrigger }]} />);

    press("n");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("déclenche un chord `G` puis une seconde touche", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["g", "a"], onTrigger }]} />);

    press("g");
    expect(onTrigger).not.toHaveBeenCalled();
    press("a");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("ne déclenche rien sur `G` seul (pas de chord au premier niveau)", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["g", "a"], onTrigger }]} />);

    press("g");

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("distingue les seconds jetons d'un chord (`G A` vs `G C`)", () => {
    const onHome = vi.fn();
    const onStock = vi.fn();
    render(
      <Harness
        bindings={[
          { keys: ["g", "a"], onTrigger: onHome },
          { keys: ["g", "c"], onTrigger: onStock },
        ]}
      />,
    );

    press("g");
    press("c");

    expect(onHome).not.toHaveBeenCalled();
    expect(onStock).toHaveBeenCalledTimes(1);
  });

  it("expire la fenêtre d'attente du chord après le délai", () => {
    vi.useFakeTimers();
    try {
      const onTrigger = vi.fn();
      render(<Harness bindings={[{ keys: ["g", "a"], onTrigger }]} />);

      press("g");
      act(() => {
        vi.advanceTimersByTime(700);
      });
      press("a");

      expect(onTrigger).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reste inactif quand le focus est dans un champ de saisie", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["n"], onTrigger }]} />);

    const input = screen.getByLabelText("champ de saisie");
    input.focus();
    fireEvent.keyDown(input, { key: "n" });

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reste inactif pour un chord de navigation quand le focus est dans un champ de saisie", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["g", "a"], onTrigger }]} />);

    const input = screen.getByLabelText("champ de saisie");
    input.focus();
    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "a" });

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("garde actif un raccourci marqué `allowInEditableTarget` dans un champ de saisie", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["escape"], onTrigger, allowInEditableTarget: true }]} />);

    const input = screen.getByLabelText("champ de saisie");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si `enabled` est faux", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["n"], onTrigger }]} enabled={false} />);

    press("n");

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reconnaît `mod+enter` pour Ctrl/Cmd+Entrée", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["mod+enter"], onTrigger, allowInEditableTarget: true }]} />);

    pressWithMod("Enter");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("Échap sans binding enregistré ne casse rien", () => {
    render(<Harness bindings={[{ keys: ["g", "a"], onTrigger: vi.fn() }]} />);

    expect(() => press("Escape")).not.toThrow();
  });
});

describe("useKeyboardShortcuts : option `ignoreTarget` (Lot 5c, étape 7)", () => {
  it("par défaut, un raccourci agit et confisque la touche, y compris sur un bouton (comportement inchangé)", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["enter"], onTrigger }]} />);

    const notPrevented = fireEvent.keyDown(screen.getByRole("button", { name: "bouton" }), { key: "Enter" });

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false); // preventDefault a bien été appelé
  });

  it("ignore la frappe quand le prédicat rend vrai : ni onTrigger ni preventDefault", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["enter"], onTrigger, ignoreTarget: isInteractiveTarget }]} />);

    for (const target of [
      screen.getByRole("button", { name: "bouton" }),
      screen.getByRole("link", { name: "lien" }),
      screen.getByRole("tab", { name: "onglet" }),
      screen.getByLabelText("champ de saisie"),
    ]) {
      expect(fireEvent.keyDown(target, { key: "Enter" })).toBe(true); // la touche garde son effet natif
    }
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("agit encore sur le document et sur un texte non interactif", () => {
    const onTrigger = vi.fn();
    render(<Harness bindings={[{ keys: ["enter"], onTrigger, ignoreTarget: isInteractiveTarget }]} />);

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(screen.getByText("texte"), { key: "Enter" });

    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("isInteractiveTarget : un élément focalisé à la main l'est, pas un tabindex=-1", () => {
    const focusable = document.createElement("div");
    focusable.tabIndex = 0;
    const programmatic = document.createElement("main");
    programmatic.tabIndex = -1;
    expect(isInteractiveTarget(focusable)).toBe(true);
    expect(isInteractiveTarget(programmatic)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
    expect(isInteractiveTarget(document)).toBe(false);
  });
});
