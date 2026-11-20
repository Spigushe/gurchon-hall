import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCardOnlineCache } from "../../../src/features/catalog/useCardOnline";
import { renderApp, setOnline } from "./harness";

/**
 * Lot 13, D4 (P10) : l'art de l'extension dans la Collection. Aperçu au survol du tableau bureau et
 * feuille d'entrée aux deux largeurs montrent l'image de l'impression, lue en ligne ; pas d'image
 * dans la liste mobile ; hors ligne, la Collection garde son pictogramme.
 */

const IMAGE = (cardSetId: number) => `https://static.krcg.org/card/set/test/${cardSetId}.jpg`;

/** Fiche serveur de « Élan vital » (id 1) : une image par impression, 9 et 21. */
const elanVital = {
  id: 1,
  flavor_text: null,
  artist: null,
  printings: [
    { card_set: { id: 9 }, image_url: IMAGE(9), occurrences: [] },
    { card_set: { id: 21 }, image_url: IMAGE(21), occurrences: [] },
  ],
};

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

beforeEach(() => {
  clearCardOnlineCache();
  setViewportWidth(1024);
});
afterEach(() => setViewportWidth(1024));

/** Une entrée de collection d'« Élan vital » sous l'extension 9, et la seconde impression connue. */
async function seeded(options: { online: boolean }) {
  const app = await renderApp({ online: options.online, hash: "#/collection", catalog: true });
  app.ui.cards.set(1, elanVital);
  await app.runtime.db.cardSets.put({
    id: 21,
    abbrev: "NEW",
    fullName: "Extension récente",
    releaseDate: "2022-01-01",
    company: null,
    isPlaceholder: false,
  });
  const card = await app.runtime.db.cards.get(1);
  await app.runtime.db.cards.put({ ...card!, cardSetIds: [9, 21], latestCardSetId: 21, imageUrl: "https://static.krcg.org/generic/1.jpg" });
  await app.runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
  const entry = await screen.findByTestId("stock-entry");
  return { ...app, entry };
}

const cardRequests = (app: { ui: { requests: Array<{ path: string }> } }) =>
  app.ui.requests.filter((request) => request.path.startsWith("/cartes/"));

describe("aperçu au survol du tableau (bureau)", () => {
  it("montre l'image de l'impression de la ligne, lue à la demande", async () => {
    const app = await seeded({ online: true });
    const nameButton = within(app.entry).getByRole("button", { name: "Modifier Élan vital (FR)" });
    // Aucune fiche n'est lue tant qu'aucune ligne n'est survolée.
    expect(cardRequests(app)).toEqual([]);

    act(() => nameButton.focus());
    const preview = await within(app.entry).findByTestId("stock-table-preview");
    await waitFor(() => expect(within(preview).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", IMAGE(9)));
    expect(cardRequests(app)).toHaveLength(1);
  });

  it("prend l'image générique tant que la fiche n'est pas lue, puis hors ligne le pictogramme", async () => {
    const app = await seeded({ online: true });
    app.ui.cards.delete(1);
    const nameButton = within(app.entry).getByRole("button", { name: "Modifier Élan vital (FR)" });
    act(() => nameButton.focus());
    const preview = await within(app.entry).findByTestId("stock-table-preview");
    // Fiche introuvable : l'image générique du miroir prend le relais.
    await waitFor(() =>
      expect(within(preview).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", "https://static.krcg.org/generic/1.jpg"),
    );

    act(() => nameButton.blur());
    setOnline(false);
    act(() => nameButton.focus());
    const offline = await within(app.entry).findByTestId("stock-table-preview");
    expect(offline.querySelector("img")).toBeNull();
    expect(within(offline).getByRole("img", { name: "Élan vital" })).toBeInTheDocument();
  });
});

describe("feuille d'entrée", () => {
  it("bureau, modification : image de l'impression de l'entrée", async () => {
    const app = await seeded({ online: true });
    fireEvent.click(within(app.entry).getByRole("button", { name: "Modifier Élan vital (FR)" }));
    const form = await screen.findByTestId("stock-form");
    const image = await within(form).findByTestId("stock-form-image");
    await waitFor(() => expect(within(image).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", IMAGE(9)));
    expect(form.querySelector(".card-image--sm")).toBeInTheDocument();
    expect(within(image).queryByRole("button")).not.toBeInTheDocument(); // l'agrandissement est réservé au mobile
  });

  it("bureau, création : l'image suit le sélecteur d'extension", async () => {
    const app = await seeded({ online: true });
    fireEvent.click(await screen.findByTestId("stock-add"));
    const form = await screen.findByTestId("stock-form");
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    await within(form).findByTestId("stock-form-card");
    fireEvent.change(within(form).getByLabelText("Exemplaires possédés"), { target: { value: "2" } });

    const image = await within(form).findByTestId("stock-form-image");
    // Présélection sur la dernière version (21), puis le choix de l'extension 9.
    await waitFor(() => expect(within(image).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", IMAGE(21)));
    fireEvent.change(within(form).getByTestId("stock-form-card-set"), { target: { value: "9" } });
    await waitFor(() => expect(within(image).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", IMAGE(9)));
    expect(cardRequests(app).filter((request) => request.path === "/cartes/1")).toHaveLength(1);
  });

  it("mobile : image à toucher pour agrandir, absente hors ligne", async () => {
    setViewportWidth(390);
    const app = await seeded({ online: true });
    fireEvent.click(within(app.entry).getByRole("button", { name: "Modifier Élan vital (FR)" }));
    const form = await screen.findByTestId("stock-form");
    const frame = await within(form).findByTestId("stock-form-image");
    const image = within(frame).getByRole("button", { name: "Agrandir l'image de Élan vital" });
    expect(image).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(within(image).getByRole("img", { name: "Élan vital" })).toHaveAttribute("src", IMAGE(9)));
    fireEvent.click(image);
    expect(image).toHaveAttribute("aria-pressed", "true");
    expect(form.querySelector(".card-image--lg")).toBeInTheDocument();

    setOnline(false);
    await waitFor(() => expect(within(form).getByTestId("stock-form-image")).toBeEmptyDOMElement());
  });

  it("hors ligne, la feuille de création n'a pas d'image et n'appelle rien", async () => {
    const app = await seeded({ online: false });
    fireEvent.click(await screen.findByTestId("stock-add"));
    const form = await screen.findByTestId("stock-form");
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    const image = await within(form).findByTestId("stock-form-image");
    expect(image.querySelector("img")).toBeNull();
    expect(cardRequests(app)).toEqual([]);
  });
});

describe("liste mobile", () => {
  it("n'affiche aucune image et ne lit aucune fiche", async () => {
    setViewportWidth(390);
    const app = await seeded({ online: true });
    expect(app.entry.querySelector("img")).toBeNull();
    expect(screen.queryByTestId("stock-table-preview")).not.toBeInTheDocument();
    expect(cardRequests(app)).toEqual([]);
  });
});
