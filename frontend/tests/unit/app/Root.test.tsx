import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "../../../src/app/Root";

const authGateMounted = vi.fn();
vi.mock("../../../src/features/auth/AuthGate.tsx", () => ({
  AuthGate: () => {
    authGateMounted();
    return <div data-testid="auth-gate" />;
  },
}));
vi.mock("../../../src/features/share/PublicDecklistPage", () => ({
  PublicDecklistPage: ({ hash }: { hash: string }) => <div data-testid="public-page">{hash}</div>,
}));

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => {
  authGateMounted.mockClear();
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("Root, aiguillage avant AuthGate", () => {
  it("monte AuthGate pour l'application normale", () => {
    window.location.hash = "#/decks";
    render(<Root reload={vi.fn()} />);
    expect(screen.getByTestId("auth-gate")).toBeTruthy();
    expect(screen.queryByTestId("public-page")).toBeNull();
  });

  it("monte AuthGate sans hash", () => {
    window.location.hash = "";
    render(<Root reload={vi.fn()} />);
    expect(screen.getByTestId("auth-gate")).toBeTruthy();
  });

  it("monte la page publique sans jamais monter AuthGate pour #/liste/", () => {
    window.location.hash = "#/liste/aB3x_9pQ";
    render(<Root reload={vi.fn()} />);
    expect(screen.getByTestId("public-page").textContent).toBe("#/liste/aB3x_9pQ");
    expect(authGateMounted).not.toHaveBeenCalled();
  });

  it("recharge en quittant la page publique, sans monter AuthGate", () => {
    window.location.hash = "#/liste/aB3x_9pQ";
    const reload = vi.fn();
    render(<Root reload={reload} />);
    goTo("#/decks");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(authGateMounted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("public-page")).toBeNull();
  });

  it("recharge en entrant dans la page publique depuis l'application", () => {
    window.location.hash = "#/decks";
    const reload = vi.fn();
    render(<Root reload={reload} />);
    goTo("#/liste/aB3x_9pQ");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("public-page")).toBeNull();
  });

  it("ne recharge pas entre deux hash de l'application", () => {
    window.location.hash = "#/decks";
    const reload = vi.fn();
    render(<Root reload={reload} />);
    goTo("#/collection");
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-gate")).toBeTruthy();
  });

  it("ne recharge pas entre deux listes publiques", () => {
    window.location.hash = "#/liste/aB3x_9pQ";
    const reload = vi.fn();
    render(<Root reload={reload} />);
    goTo("#/liste/Zz9_aaaa");
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByTestId("public-page").textContent).toBe("#/liste/Zz9_aaaa");
  });
});
