import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardImage } from "../../../src/components/CardImage";
import { OfflineProvider, type OfflineRuntime } from "../../../src/offline/react";
import type { SyncStatus } from "../../../src/offline/core/syncEngine";

/**
 * Banc d'essai minimal : un `OfflineRuntime` factice, juste assez pour que
 * `useConnectivity()` (lu via `useSyncStatus()`, qui s'appuie sur
 * `useSyncExternalStore`) ait un statut stable à lire. `CardImage` ne
 * consomme rien d'autre de la couche offline. Le statut est un objet unique,
 * réutilisé par `getStatus`, plutôt que reconstruit à chaque appel : c'est ce
 * que `useSyncExternalStore` exige (un `getSnapshot` qui ne change pas de
 * référence tant que rien n'a changé), sans quoi React boucle indéfiniment.
 */
function makeRuntime(online: boolean): OfflineRuntime {
  const status: SyncStatus = {
    online,
    running: false,
    pending: 0,
    sending: 0,
    rejected: 0,
    lastError: null,
    lastSuccessAt: null,
    nextRetryAt: null,
  };
  return {
    db: {} as OfflineRuntime["db"],
    outbox: {} as OfflineRuntime["outbox"],
    engine: {
      subscribe: () => () => {},
      getStatus: () => status,
    } as unknown as OfflineRuntime["engine"],
    start() {},
    stop() {},
  };
}

function renderWithConnectivity(node: React.ReactElement, online: boolean) {
  return render(<OfflineProvider runtime={makeRuntime(online)}>{node}</OfflineProvider>);
}

describe("<CardImage />", () => {
  it("affiche l'image avec l'alt fourni quand une URL est connue et le réseau disponible", () => {
    renderWithConnectivity(
      <CardImage src="https://static.krcg.org/card/elanvital.jpg" alt="Élan vital" data-testid="ci" />,
      true,
    );

    const img = screen.getByRole("img", { name: "Élan vital" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://static.krcg.org/card/elanvital.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("sans URL, affiche un repli neutre plutôt qu'une image cassée, avec le même nom accessible", () => {
    renderWithConnectivity(<CardImage src={null} alt="Théo Bell" data-testid="ci" />, true);

    const fallback = screen.getByRole("img", { name: "Théo Bell" });
    expect(fallback.tagName).not.toBe("IMG");
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("bascule sur le repli si le chargement échoue (404, réseau)", () => {
    renderWithConnectivity(
      <CardImage src="https://static.krcg.org/card/inconnue.jpg" alt="Carte inconnue" data-testid="ci" />,
      true,
    );

    const img = screen.getByRole("img", { name: "Carte inconnue" });
    expect(img.tagName).toBe("IMG");

    fireEvent.error(img);

    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Carte inconnue" })).toBeInTheDocument();
  });

  it("hors ligne, masque l'aperçu même si une URL est connue (pas de chargement voué à échouer)", () => {
    renderWithConnectivity(
      <CardImage src="https://static.krcg.org/card/elanvital.jpg" alt="Élan vital" data-testid="ci" />,
      false,
    );

    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Élan vital" })).toBeInTheDocument();
  });

  it("porte la classe de taille attendue par index.css (sm par défaut, lg en variante)", () => {
    const runtime = makeRuntime(true);
    const { rerender } = render(
      <OfflineProvider runtime={runtime}>
        <CardImage src={null} alt="Carte" data-testid="ci" />
      </OfflineProvider>,
    );
    expect(screen.getByTestId("ci")).toHaveClass("card-image", "card-image--sm");

    rerender(
      <OfflineProvider runtime={runtime}>
        <CardImage src={null} alt="Carte" size="lg" data-testid="ci" />
      </OfflineProvider>,
    );
    expect(screen.getByTestId("ci")).toHaveClass("card-image", "card-image--lg");
  });

  it("une nouvelle URL redonne sa chance à l'image (l'échec précédent ne colle pas à un autre src)", () => {
    const runtime = makeRuntime(true);
    const { rerender } = render(
      <OfflineProvider runtime={runtime}>
        <CardImage src="https://static.krcg.org/card/a.jpg" alt="Carte A" data-testid="ci" />
      </OfflineProvider>,
    );
    fireEvent.error(screen.getByRole("img", { name: "Carte A" }));
    expect(document.querySelector("img")).not.toBeInTheDocument();

    rerender(
      <OfflineProvider runtime={runtime}>
        <CardImage src="https://static.krcg.org/card/b.jpg" alt="Carte B" data-testid="ci" />
      </OfflineProvider>,
    );

    expect(screen.getByRole("img", { name: "Carte B" }).tagName).toBe("IMG");
  });
});
