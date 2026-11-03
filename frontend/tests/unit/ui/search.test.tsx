import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseHash, hrefFor } from "../../../src/app/routes";
import { renderApp } from "./harness";

describe("route Chercher", () => {
  it("lit q et deck, ignore un deck mal formé et un q vide", () => {
    expect(parseHash("#/chercher")).toEqual({ name: "search" });
    expect(parseHash("#/chercher?q=elan%20vital&deck=id:4")).toEqual({
      name: "search",
      q: "elan vital",
      deck: "id:4",
    });
    expect(parseHash("#/chercher?q=%20&deck=nimporte")).toEqual({ name: "search" });
  });

  it("reconstruit l'adresse avec q et deck", () => {
    expect(hrefFor({ name: "search" })).toBe("#/chercher");
    expect(hrefFor({ name: "search", q: "a b", deck: "id:4" as never })).toBe("#/chercher?q=a+b&deck=id%3A4");
  });
});

describe("page Chercher", () => {
  it("cherche par nom dans le miroir local, hors ligne, et réécrit l'adresse sans hashchange", async () => {
    await renderApp({ online: false, hash: "#/chercher?q=elan", catalog: true });
    const input = screen.getByTestId("search-input");
    expect(input).toHaveValue("elan");
    const rows = await screen.findAllByTestId("search-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Élan vital");
    expect(rows[0]).toHaveTextContent("absente de la collection");
    expect(screen.getByTestId("search-count")).toHaveTextContent("1 carte");

    fireEvent.change(input, { target: { value: "theo" } });
    await waitFor(() => expect(screen.getByTestId("search-row")).toHaveTextContent("Theo Bell"));
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo"));
    expect(screen.getByTestId("search-page")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(await screen.findByTestId("search-no-result")).toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
  });

  it("n'affiche rien sous deux lettres", async () => {
    await renderApp({ online: false, hash: "#/chercher", catalog: true });
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "e" } });
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-no-result")).not.toBeInTheDocument();
  });

  it("signale le catalogue absent et désactive le champ", async () => {
    await renderApp({ online: false, hash: "#/chercher" });
    expect(await screen.findByTestId("search-empty-catalog")).toBeInTheDocument();
    expect(screen.getByTestId("search-input")).toBeDisabled();
    expect(screen.getByTestId("catalog-state")).toBeInTheDocument();
  });

  it("l'onglet Chercher est actif et mène à la page ; conserve le deck cible dans l'adresse", async () => {
    await renderApp({ online: false, catalog: true });
    fireEvent.click(screen.getByTestId("nav-search"));
    expect(await screen.findByTestId("search-page")).toBeInTheDocument();
    expect(screen.getByTestId("nav-search")).toHaveAttribute("aria-current", "page");
  });

  it("garde le paramètre deck lors de la réécriture", async () => {
    await renderApp({ online: false, hash: "#/chercher?deck=id:7", catalog: true });
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "theo" } });
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo&deck=id%3A7"));
  });
});
