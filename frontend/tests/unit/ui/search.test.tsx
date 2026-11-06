import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCardOnlineCache } from "../../../src/features/catalog/useCardOnline";
import { parseHash, hrefFor } from "../../../src/app/routes";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { SEARCH_CATALOG } from "../offline/fixtures/searchCases";
import { library } from "../offline/fixtures/syntheticCatalog";
import { flushEffects, renderApp, setOnline } from "./harness";

/**
 * Page Chercher (lot Chercher, D1b puis D1c) : recherche sur le miroir local,
 * filtres, tri et fiche, au mobile (390 px) et au bureau (1440 px). La largeur
 * est posée à la main : jsdom vaut 1024 px par défaut, soit le bureau.
 */

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

/** Le catalogue synthétique d'E1, plus une entrée de collection et un deck qui joue Theo Bell. */
function seededServer(): FakeServer {
  const server = createFakeServer();
  server.state.catalog = SEARCH_CATALOG;
  server.state.stock.set("1|EN|9", { card_id: 1, language_code: "EN", card_set_id: 9, quantity_owned: 3, notes: null });
  server.state.decks.push({ id: 4, name: "Brujah Rush", discriminator: "0004", client_ref: null, proxy_allowed: true, archived_at: null });
  server.state.deckCards.push({ deck_id: 4, card_id: 1, language_code: "EN", card_set_id: 9, quantity: 2, proxy_quantity: 0 });
  return server;
}

/** Miroirs remplis en ligne (le rafraîchissement ne part pas hors ligne), puis coupure, sauf `stayOnline`. */
async function renderSeeded(hash: string, server = seededServer(), stayOnline = false) {
  const app = await renderApp({ online: true, hash, catalog: true, server });
  await act(async () => {
    await app.runtime.refresh();
  });
  if (!stayOnline) setOnline(false);
  return app;
}

/** Fiche serveur réduite à ce que lit la lecture à la demande (D3). */
const onlineCard = (id: number) => ({
  id,
  flavor_text: "Le temps des princes.",
  artist: "Jane Doe",
  printings: [{ card_set: { id: 9 }, image_url: `https://static.krcg.org/card/set/test/${id}.jpg`, occurrences: [] }],
});

const rowNames = () => screen.getAllByTestId("search-row").map((row) => row.getAttribute("data-card-id"));

beforeEach(() => {
  setViewportWidth(390);
  clearCardOnlineCache();
});
afterEach(() => setViewportWidth(1024));

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

describe("page Chercher, mobile", () => {
  it("cherche par nom dans le miroir local, hors ligne, et réécrit l'adresse sans hashchange", async () => {
    await renderApp({ online: false, hash: "#/chercher?q=elan", catalog: true });
    const input = screen.getByTestId("search-input");
    expect(input).toHaveValue("elan");
    const rows = await screen.findAllByTestId("search-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Élan vital");
    expect(within(rows[0]).queryByTestId("search-row-owned")).not.toBeInTheDocument();
    expect(screen.getByTestId("search-count")).toHaveTextContent("1 résultat");

    fireEvent.change(input, { target: { value: "theo" } });
    await waitFor(() => expect(screen.getByTestId("search-row")).toHaveTextContent("Theo Bell"));
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo"));

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(await screen.findByTestId("search-no-result")).toHaveTextContent("Aucune carte ne correspond");
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("search-clear"));
    expect(input).toHaveValue("");
    expect(await screen.findAllByTestId("search-row")).toHaveLength(3);
  });

  it("signale le catalogue absent et désactive le champ", async () => {
    await renderApp({ online: false, hash: "#/chercher" });
    expect(await screen.findByTestId("search-empty-catalog")).toBeInTheDocument();
    expect(screen.getByTestId("search-input")).toBeDisabled();
    expect(screen.getByTestId("catalog-state")).toBeInTheDocument();
  });

  it("l'onglet Chercher est actif et mène à la page", async () => {
    await renderApp({ online: false, catalog: true });
    fireEvent.click(screen.getByTestId("nav-search"));
    expect(await screen.findByTestId("search-page")).toBeInTheDocument();
    expect(screen.getByTestId("nav-search")).toHaveAttribute("aria-current", "page");
  });

  it("garde un deck connu dans l'adresse, avec son bandeau et « pas dans ce deck » ; oublie un deck inconnu", async () => {
    const app = await renderSeeded("#/chercher?deck=id:4");
    expect(await screen.findByTestId("search-deck-banner")).toHaveTextContent("Brujah Rush");
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "theo" } });
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo&deck=id%3A4"));
    // Theo Bell est dans le deck : « pas dans ce deck » l'écarte.
    expect(await screen.findByTestId("search-no-result")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("search-deck-clear"));
    expect(await screen.findByTestId("search-row")).toHaveTextContent("Theo Bell");
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo"));
    app.unmount();

    await renderSeeded("#/chercher?q=theo&deck=id:77");
    await screen.findByTestId("search-row");
    await waitFor(() => expect(window.location.hash).toBe("#/chercher?q=theo"));
    expect(screen.queryByTestId("search-deck-banner")).not.toBeInTheDocument();
  });

  it("met les correspondances par le nom devant celles par le texte, sauf sous un tri choisi", async () => {
    await renderSeeded("#/chercher?q=sabbat");
    await screen.findAllByTestId("search-row");
    // « Sabbat Bishop » par son nom ; « Lasombra Cardinal » par son texte seul, rangé après
    // alors que son nom vient avant dans l'ordre alphabétique.
    expect(screen.getByTestId("search-count")).toHaveTextContent("1 par le nom · 1 par le texte");
    expect(rowNames()).toEqual(["3", "8"]);
    fireEvent.change(screen.getByTestId("search-sort"), { target: { value: "nameDesc" } });
    await waitFor(() => expect(screen.getByTestId("search-count")).toHaveTextContent(/^2 résultats$/));
    expect(rowNames()).toEqual(["3", "8"]);
  });

  it("filtre en crypte : la feuille de filtres, une discipline supérieure, un clan, le compteur", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-category-crypt"));
    await waitFor(() => expect(rowNames().every((id) => Number(id) <= 10)).toBe(true));

    fireEvent.click(screen.getByTestId("search-filters-open"));
    const sheet = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(sheet).getByTestId("search-filter-cryptDisciplines-open"));
    const grid = within(sheet).getByTestId("search-filter-crypt-disciplines");
    const tha = within(grid).getByRole("button", { name: /Thaumaturgy/ });
    fireEvent.click(tha);
    fireEvent.click(tha);
    expect(tha).toHaveAttribute("data-level", "superior");
    await waitFor(() => expect(within(sheet).getByTestId("search-filters-done")).toHaveTextContent("Voir 1 résultat"));

    fireEvent.click(within(sheet).getByTestId("search-filter-back"));
    expect(within(sheet).getByTestId("search-filter-cryptDisciplines-open")).toHaveTextContent("Thaumaturgy sup.");
    fireEvent.click(within(sheet).getByTestId("search-filters-done"));
    await waitFor(() => expect(rowNames()).toEqual(["2"]));
    expect(screen.getByTestId("search-filters-count")).toHaveTextContent("1 filtre");

    // Sous « Toutes », les filtres de crypte ne s'appliquent plus, mais restent dans l'état.
    fireEvent.click(screen.getByTestId("search-category-all"));
    await waitFor(() => expect(rowNames().length).toBeGreaterThan(1));
    fireEvent.click(screen.getByTestId("search-category-crypt"));
    await waitFor(() => expect(rowNames()).toEqual(["2"]));
  });

  it("filtre en bibliothèque : disciplines en mode SEULEMENT, puis « non requise », puis réinitialiser", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-category-library"));
    fireEvent.click(screen.getByTestId("search-filters-open"));
    const sheet = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(sheet).getByTestId("search-filter-libraryDisciplines-open"));
    const mode = within(sheet).getByTestId("search-filter-library-disciplines-mode");
    fireEvent.click(mode); // ET
    fireEvent.click(mode); // NON
    fireEvent.click(mode); // SEULEMENT
    expect(mode).toHaveAttribute("data-mode", "only");
    expect(sheet).toHaveTextContent("Jouable avec les seules disciplines cochées");
    const grid = within(sheet).getByTestId("search-filter-library-disciplines");
    fireEvent.click(within(grid).getByRole("button", { name: /Dominate/ }));
    fireEvent.click(within(grid).getByRole("button", { name: /Obfuscate/ }));
    fireEvent.click(within(sheet).getByTestId("search-filters-done"));
    // SEULEMENT {dom, obf} : World's a Canvas (au choix), la combinée dom+obf, les mono. Pas dom+pot.
    await waitFor(() => expect(rowNames().sort()).toEqual(["101", "102", "104", "105"]));

    fireEvent.click(screen.getByTestId("search-filters-open"));
    const again = await screen.findByTestId("search-filters-sheet");
    expect(within(again).getByTestId("search-filter-libraryDisciplines-open")).toHaveTextContent("SEULEMENT");
    fireEvent.click(within(again).getByTestId("search-filters-reset"));
    await waitFor(() => expect(within(again).getByTestId("search-filters-done")).toHaveTextContent(/Voir \d{2} résultats/));
  });

  it("une puce de clan s'annonce une fois : l'icône qui précède le nom est décorative", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-category-crypt"));
    fireEvent.click(screen.getByTestId("search-filters-open"));
    const sheet = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(sheet).getByTestId("search-filter-cryptClans-open"));
    const chips = within(sheet).getByTestId("search-filter-crypt-clans");
    expect(within(chips).getByRole("checkbox", { name: "Ventrue" })).toBeInTheDocument();
    expect(within(chips).queryByRole("img", { name: "Ventrue" })).not.toBeInTheDocument();
    // La méta d'une ligne de résultat aussi : « Ventrue · … », sans second « Ventrue ».
    fireEvent.click(within(sheet).getByTestId("search-filters-done"));
    const row = screen.getAllByTestId("search-row").find((item) => item.getAttribute("data-card-id") === "5")!;
    expect(within(row).queryByRole("img", { name: "Ventrue" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button").textContent).toContain("Ventrue");
  });

  it("titre requis Primogen : Emboldened Councilor, lue telle que la rend GET /cartes sur la base de développement", async () => {
    // Exigence brute `primogen` de vteslibmeta.csv, lue par le serveur en Primogen et Camarilla
    // (relevé du 2026-11-06 sur une copie de backend/vtes.db, carte 4199).
    const server = seededServer();
    server.state.catalog = [
      ...SEARCH_CATALOG,
      library({
        id: 4199,
        name: "Emboldened Councilor",
        types: ["Reaction"],
        libraryRequirement: "primogen",
        requiredSects: ["Camarilla"],
        requiredTitles: ["Primogen"],
        text: "Requires a primogen.\n[REACTION] +1 intercept.\n[REACTION] Only usable by a locked primogen. This primogen unlocks and attempts to block.",
      }),
    ];
    await renderSeeded("#/chercher", server);
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-category-library"));
    fireEvent.click(screen.getByTestId("search-filters-open"));
    const sheet = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(sheet).getByTestId("search-filter-libraryTitles-open"));
    fireEvent.click(within(within(sheet).getByTestId("search-filter-library-titles")).getByLabelText("Primogen"));
    fireEvent.click(within(sheet).getByTestId("search-filters-done"));
    await waitFor(() => expect(rowNames()).toEqual(["4199"]));
    expect(screen.getByTestId("search-row")).toHaveTextContent("Emboldened Councilor");
  });

  it("filtres communs : texte en ligne NON, possédée, légalité", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-filters-open"));
    const sheet = await screen.findByTestId("search-filters-sheet");

    fireEvent.click(within(sheet).getByTestId("search-filter-owned-open"));
    fireEvent.click(within(within(sheet).getByTestId("search-filter-owned")).getByLabelText("possédée"));
    await waitFor(() => expect(within(sheet).getByTestId("search-filters-done")).toHaveTextContent("Voir 1 résultat"));
    fireEvent.click(within(sheet).getByTestId("search-filter-clear"));

    fireEvent.click(within(sheet).getByTestId("search-filter-back"));
    fireEvent.click(within(sheet).getByTestId("search-filter-legality-open"));
    fireEvent.click(within(within(sheet).getByTestId("search-filter-legality")).getByLabelText("bannie"));
    fireEvent.click(within(sheet).getByTestId("search-filters-done"));
    await waitFor(() => expect(rowNames().sort()).toEqual(["113", "115"]));
    expect(screen.getAllByTestId("search-row-legality")[0]).toHaveTextContent("Bannie");

    fireEvent.click(screen.getByTestId("search-filters-open"));
    const third = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(third).getByTestId("search-filter-text-open"));
    fireEvent.click(within(third).getByTestId("search-text-add"));
    fireEvent.change(within(third).getByTestId("search-text-line-input"), { target: { value: "keeps" } });
    fireEvent.click(within(third).getByTestId("search-text-line-mode"));
    fireEvent.click(within(third).getByTestId("search-filters-done"));
    await waitFor(() => expect(rowNames()).toEqual(["113"]));
  });

  it("ouvre la fiche en demi-feuille, l'étend, montre exemplaires, decks et impressions", async () => {
    await renderSeeded("#/chercher?q=theo");
    const row = await screen.findByTestId("search-row");
    expect(within(row).getByTestId("search-row-owned")).toHaveTextContent("3 en collection");
    fireEvent.click(within(row).getByRole("button"));
    const sheet = await screen.findByTestId("search-detail-sheet");
    expect(within(sheet).getByTestId("search-detail")).toHaveTextContent("Theo Bell");
    expect(await within(sheet).findByTestId("search-detail-owned")).toHaveTextContent("EN");
    expect(within(sheet).getByTestId("search-detail-owned")).toHaveTextContent("×3");
    expect(within(sheet).getByTestId("search-detail-decks")).toHaveTextContent("Brujah Rush×2");
    expect(within(sheet).queryByTestId("search-detail-printings")).not.toBeInTheDocument();
    // Les icônes du texte et des disciplines ont un nom accessible.
    expect(within(sheet).getAllByRole("img", { name: "Celerity supérieure" }).length).toBeGreaterThan(0);

    fireEvent.click(within(sheet).getByTestId("search-detail-expand"));
    expect(within(sheet).getByTestId("search-detail-expand")).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByTestId("search-detail-printings")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId("search-detail-close"));
    await waitFor(() => expect(screen.queryByTestId("search-detail-sheet")).not.toBeInTheDocument());
  });

  it("fiche d'une carte de bibliothèque : type, disciplines au choix, exigence, coût, texte avec icônes", async () => {
    await renderSeeded("#/chercher?q=canvas");
    fireEvent.click(within(await screen.findByTestId("search-row")).getByRole("button"));
    const sheet = await screen.findByTestId("search-detail-sheet");
    fireEvent.click(within(sheet).getByTestId("search-detail-expand"));
    const detail = within(sheet).getByTestId("search-detail");
    expect(detail).toHaveTextContent("Action Modifier");
    expect(detail).toHaveTextContent("Dominate / Obfuscate / Vicissitude");
    expect(detail).toHaveTextContent("Coût aucun");
    expect(detail).toHaveTextContent("Légalitélégale");
    expect(await within(sheet).findByTestId("search-detail-owned")).toHaveTextContent("Aucun exemplaire");

    fireEvent.click(within(sheet).getByTestId("search-detail-close"));
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "prince political" } });
    await waitFor(() => expect(screen.getByTestId("search-row")).toHaveTextContent("Prince Political Action"));
    fireEvent.click(within(screen.getByTestId("search-row")).getByRole("button"));
    const second = await screen.findByTestId("search-detail-sheet");
    fireEvent.click(within(second).getByTestId("search-detail-expand"));
    expect(within(second).getByTestId("search-detail")).toHaveTextContent("Requiert");
  });

  it("affiche les résultats par tranches de 50", async () => {
    const server = seededServer();
    server.state.catalog = Array.from({ length: 120 }, (_, i) => ({ ...SEARCH_CATALOG[12], id: 500 + i, name: `Carte ${String(i).padStart(3, "0")}` }));
    await renderSeeded("#/chercher", server);
    await screen.findAllByTestId("search-row");
    expect(screen.getAllByTestId("search-row")).toHaveLength(50);
    fireEvent.click(screen.getByTestId("search-more"));
    expect(screen.getAllByTestId("search-row")).toHaveLength(100);
    fireEvent.click(screen.getByTestId("search-more"));
    expect(screen.getAllByTestId("search-row")).toHaveLength(120);
    expect(screen.queryByTestId("search-more")).not.toBeInTheDocument();
  });

  it("catalogue sans détails (ancien serveur) : recherche par le nom seulement, filtres désactivés", async () => {
    const server = seededServer();
    server.state.legacyCatalog = true;
    await renderSeeded("#/chercher?q=cancel", server);
    expect(await screen.findByTestId("search-outdated")).toHaveTextContent("Recherche dans le nom seulement");
    expect(screen.getByTestId("search-filters-open")).toBeDisabled();
    // La relecture automatique (P11) est partie en ligne et n'a rien changé ; hors ligne, le bouton attend le réseau.
    expect(await screen.findByTestId("search-outdated-update")).toBeDisabled();
    expect(await screen.findByTestId("search-no-result")).toBeInTheDocument(); // « cancel » n'est que dans un texte
    expect(screen.getByTestId("search-meta")).toHaveTextContent("noms");
  });
});

describe("page Chercher, bureau", () => {
  beforeEach(() => setViewportWidth(1440));

  it("tableau, tri au clic d'en-tête, ↑↓ et fiche toujours visible, F vers les filtres", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    expect(screen.getByTestId("search-detail-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("search-category-crypt"));
    await waitFor(() => expect(rowNames().every((id) => Number(id) <= 10)).toBe(true));

    fireEvent.click(screen.getByTestId("search-sort-capacity"));
    await waitFor(() => expect(screen.getByTestId("search-sort-capacity").closest("th")).toHaveAttribute("aria-sort", "ascending"));
    const capacities = () => screen.getAllByTestId("search-row").map((row) => Number(row.children[3].textContent));
    expect(capacities()).toEqual([...capacities()].sort((a, b) => a - b));
    fireEvent.click(screen.getByTestId("search-sort-capacity"));
    await waitFor(() => expect(screen.getByTestId("search-sort-capacity").closest("th")).toHaveAttribute("aria-sort", "descending"));

    await flushEffects();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    const first = screen.getAllByTestId("search-row")[0];
    await waitFor(() => expect(first).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTestId("search-detail")).toHaveAttribute("data-card-id", first.getAttribute("data-card-id"));
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getAllByTestId("search-row")[1]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(document.activeElement).toHaveTextContent(screen.getByTestId("search-detail").querySelector("h2")!.textContent!);

    fireEvent.keyDown(document.body, { key: "f" });
    expect(document.activeElement).toBe(screen.getByTestId("search-filters-column"));
  });

  it("colonne de filtres : clan en mode NON, compteur, réinitialiser", async () => {
    await renderSeeded("#/chercher");
    await screen.findAllByTestId("search-row");
    fireEvent.click(screen.getByTestId("search-category-crypt"));
    const column = screen.getByTestId("search-filters-column");
    fireEvent.click(within(column).getByTestId("search-filter-cryptClans-open"));
    fireEvent.click(within(column).getByRole("checkbox", { name: "Ventrue" }));
    await waitFor(() => expect(rowNames().sort()).toEqual(["10", "5", "9"]));
    fireEvent.click(within(column).getByTestId("search-filter-crypt-clans-mode")); // ET
    fireEvent.click(within(column).getByTestId("search-filter-crypt-clans-mode")); // NON
    await waitFor(() => expect(rowNames()).not.toContain("5"));
    expect(within(column).getByTestId("search-filters-count")).toHaveTextContent("1");
    fireEvent.click(within(column).getByTestId("search-filters-reset"));
    await waitFor(() => expect(rowNames()).toContain("5"));
  });

  it("deck cible : colonne Deck et quantité jouée", async () => {
    await renderSeeded("#/chercher?q=theo&deck=id:4");
    await screen.findByTestId("search-deck-banner");
    const column = screen.getByTestId("search-filters-column");
    fireEvent.click(within(column).getByTestId("search-filter-deck-open"));
    fireEvent.click(within(within(column).getByTestId("search-filter-deck-state")).getByLabelText("dans ce deck"));
    const row = await screen.findByTestId("search-row");
    expect(row.lastElementChild).toHaveTextContent("2");
  });
});

const lastOperation = async (app: Awaited<ReturnType<typeof renderSeeded>>) => {
  const ops = (await app.runtime.outbox.list()).map((entry) => entry.operation);
  return ops[ops.length - 1];
};

describe("feuille d'ajout (D2), mobile", () => {
  it("au deck ciblé : copies en proxy, ligne teintée et maintenue malgré « pas dans ce deck », annonce", async () => {
    const app = await renderSeeded("#/chercher?q=mono%20dominate&deck=id:4");
    const row = await screen.findByTestId("search-row");
    fireEvent.click(within(row).getByRole("button"));
    fireEvent.click(within(await screen.findByTestId("search-detail-sheet")).getByTestId("search-detail-add"));
    const sheet = await screen.findByTestId("search-add-sheet");
    expect(within(sheet).getByTestId("search-add-target-deck")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(within(sheet).getByTestId("search-add-deck")).toHaveValue("id:4"));
    fireEvent.click(within(within(sheet).getByTestId("search-add-copies")).getByRole("button", { name: /Ajouter/ }));
    expect(await within(sheet).findByTestId("search-add-effect")).toHaveTextContent("2 en proxy");
    expect(within(sheet).getByTestId("search-add-possessed")).toHaveTextContent("0 disponible au stock");
    fireEvent.click(within(sheet).getByTestId("search-add-submit"));

    await waitFor(() => expect(screen.queryByTestId("search-add-sheet")).not.toBeInTheDocument());
    expect(await lastOperation(app)).toMatchObject({
      type: "deck_card.upsert",
      data: { card_id: 104, quantity: 2, proxy_quantity: 2 },
    });
    // La carte est maintenant dans le deck : « pas dans ce deck » l'écarterait, elle reste à sa place.
    const held = await screen.findByTestId("search-row-confirmed");
    expect(held).toHaveTextContent("+2 à l'instant");
    await waitFor(() => expect(screen.getByTestId("search-row")).toHaveTextContent("dans ce deck ×2"));
    await waitFor(() => expect(screen.getByTestId("search-add-feedback")).toHaveTextContent("Mono Dominate : +2 au deck Brujah Rush."));
    // Le prochain changement de filtre la retire.
    fireEvent.click(screen.getByTestId("search-category-library"));
    expect(await screen.findByTestId("search-no-result")).toBeInTheDocument();
  });

  it("à la collection : la quantité s'ajoute à l'entrée existante", async () => {
    const app = await renderSeeded("#/chercher?q=theo");
    fireEvent.click(within(await screen.findByTestId("search-row")).getByRole("button"));
    fireEvent.click(within(await screen.findByTestId("search-detail-sheet")).getByTestId("search-detail-add"));
    const sheet = await screen.findByTestId("search-add-sheet");
    // Sans deck ciblé, la collection d'abord ; langue et extension de l'entrée la mieux fournie.
    expect(within(sheet).getByTestId("search-add-target-collection")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(within(sheet).getByTestId("search-add-effect")).toHaveTextContent("Vous en aurez 4 en anglais (TEST)"));
    fireEvent.click(within(sheet).getByTestId("search-add-submit"));
    await waitFor(() => expect(screen.queryByTestId("search-add-sheet")).not.toBeInTheDocument());
    expect(await lastOperation(app)).toMatchObject({ type: "stock.upsert", data: { card_id: 1, language_code: "EN", card_set_id: 9, quantity_owned: 4 } });
  });

  it("les deux : un achat qui remplace les proxies de la ligne", async () => {
    const server = seededServer();
    server.state.deckCards[0].proxy_quantity = 1;
    const app = await renderSeeded("#/chercher?q=theo&deck=id:4", server);
    // Theo Bell est dans le deck ciblé : on lève le filtre « pas dans ce deck ».
    fireEvent.click(screen.getByTestId("search-filters-open"));
    const filters = await screen.findByTestId("search-filters-sheet");
    fireEvent.click(within(filters).getByTestId("search-filter-deck-open"));
    fireEvent.click(within(within(filters).getByTestId("search-filter-deck-state")).getByLabelText("indifférent"));
    fireEvent.click(within(filters).getByTestId("search-filters-done"));

    fireEvent.click(within(await screen.findByTestId("search-row")).getByRole("button"));
    fireEvent.click(within(await screen.findByTestId("search-detail-sheet")).getByTestId("search-detail-add"));
    const sheet = await screen.findByTestId("search-add-sheet");
    await within(sheet).findByTestId("search-add-effect");
    fireEvent.click(within(sheet).getByTestId("search-add-target-both"));
    await waitFor(() => expect(within(sheet).getByTestId("search-add-effect")).toHaveTextContent("1 exemplaire remplace 1 proxy"));
    expect(within(sheet).getByTestId("search-add-effect")).toHaveTextContent("Collection : 3 → 4 · deck : 2 → 2, aucun proxy");
    fireEvent.click(within(sheet).getByTestId("search-add-submit"));
    await waitFor(() => expect(screen.queryByTestId("search-add-sheet")).not.toBeInTheDocument());
    expect(await lastOperation(app)).toMatchObject({
      type: "deck_card.upsert",
      data: { card_id: 1, quantity: 2, proxy_quantity: 0, acquired_quantity: 1 },
    });
  });

  it("deck sans proxies : le refus local s'affiche et bloque l'envoi", async () => {
    const server = seededServer();
    server.state.decks[0].proxy_allowed = false;
    const app = await renderSeeded("#/chercher?q=mono%20dominate&deck=id:4", server);
    fireEvent.click(within(await screen.findByTestId("search-row")).getByRole("button"));
    fireEvent.click(within(await screen.findByTestId("search-detail-sheet")).getByTestId("search-detail-add"));
    const sheet = await screen.findByTestId("search-add-sheet");
    expect(await within(sheet).findByTestId("search-add-error")).toHaveTextContent("Ce deck n'autorise pas les proxies : il manque 1 exemplaire au stock.");
    expect(within(sheet).queryByTestId("search-add-possessed")).not.toBeInTheDocument();
    expect(within(sheet).getByTestId("search-add-submit")).toBeDisabled();
    expect(await app.runtime.outbox.list()).toEqual([]);
  });
});

describe("feuille d'ajout (D2), bureau", () => {
  beforeEach(() => setViewportWidth(1440));

  it("N ouvre le panneau pour la carte choisie, ⌘↵ valide", async () => {
    const app = await renderSeeded("#/chercher?q=majesty");
    await screen.findByTestId("search-row");
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await screen.findByTestId("search-detail");
    fireEvent.keyDown(document.body, { key: "n" });
    const sheet = await screen.findByTestId("search-add-sheet");
    expect(await within(sheet).findByTestId("search-add-effect")).toHaveTextContent("Vous en aurez 1");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter", metaKey: true });
    await waitFor(() => expect(screen.queryByTestId("search-add-sheet")).not.toBeInTheDocument());
    expect(await lastOperation(app)).toMatchObject({ type: "stock.upsert", data: { card_id: 118, quantity_owned: 1 } });
    expect(await screen.findByTestId("search-row-confirmed")).toHaveTextContent("+1 à l'instant");
  });
});

describe("champ global, `/`, images et lien depuis un deck (D3), bureau", () => {
  beforeEach(() => setViewportWidth(1440));

  it("le champ global ouvre Chercher avec le texte ; sur Chercher, il désigne le champ de la page", async () => {
    await renderSeeded("#/");
    const field = screen.getByTestId("topbar-search");
    expect(field).toHaveAttribute("placeholder", "Chercher une carte (catalogue)");
    fireEvent.change(field, { target: { value: "theo" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByTestId("search-page")).toBeInTheDocument();
    expect(screen.getByTestId("search-input")).toHaveValue("theo");
    expect(await screen.findByTestId("search-row")).toHaveTextContent("Theo Bell");
    const here = screen.getByTestId("topbar-search");
    expect(here.tagName).toBe("BUTTON");
    expect(here).toHaveTextContent("sur cette page");
    fireEvent.click(here);
    expect(document.activeElement).toBe(screen.getByTestId("search-input"));
  });

  it("`/` focalise le champ global ailleurs, celui de la page sur Chercher ; inerte dans un champ et sous une feuille", async () => {
    await renderSeeded("#/collection");
    await screen.findByTestId("stock-page");
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("topbar-search"));
    // Dans un champ, `/` s'écrit : le focus ne bouge pas.
    const event = fireEvent.keyDown(document.activeElement!, { key: "/" });
    expect(event).toBe(true);

    window.location.hash = "#/chercher";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findAllByTestId("search-row");
    (document.activeElement as HTMLElement).blur();
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("search-input"));

    // Sous une feuille ouverte, `/` ne fait rien.
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await screen.findByTestId("search-detail");
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "n" });
    await screen.findByTestId("search-add-sheet");
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(screen.getByTestId("search-input"));
  });

  it("sur le deckbuilder, `/` reste au picker ; le lien « avec filtres » mène à Chercher pour ce deck", async () => {
    await renderSeeded("#/decks/id:4");
    const picker = await screen.findByTestId("deck-builder-picker");
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(within(picker).getByLabelText("Rechercher une carte"));
    expect(within(picker).getByTestId("search-from-deck")).toHaveAttribute("href", "#/chercher?deck=id%3A4");
  });

  it("en ligne, la fiche lit ambiance et artiste à la demande ; hors ligne, l'image dit qu'elle manque", async () => {
    const app = await renderSeeded("#/chercher?q=theo", seededServer(), true);
    app.ui.cards.set(1, onlineCard(1));
    await screen.findByTestId("search-row");
    await flushEffects();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(await screen.findByTestId("search-detail-flavor")).toHaveTextContent("Le temps des princes. — Jane Doe");
    expect(app.ui.requests.filter((request) => request.path === "/cartes/1")).toHaveLength(1);

    setOnline(false);
    await waitFor(() =>
      expect(within(screen.getByTestId("search-detail-image")).getByRole("img", { name: /Image indisponible hors ligne/ })).toBeInTheDocument(),
    );
  });
});

describe("images et lien depuis un deck (D3), mobile", () => {
  it("le détail d'un deck propose Chercher pour ce deck, sauf archivé", async () => {
    const app = await renderSeeded("#/decks/id:4");
    expect(await screen.findByTestId("search-from-deck")).toHaveAttribute("href", "#/chercher?deck=id%3A4");
    app.unmount();
    const server = seededServer();
    server.state.decks[0].archived_at = "2026-10-01T10:00:00Z";
    await renderSeeded("#/decks/id:4", server);
    await screen.findByTestId("deck-edit");
    expect(screen.queryByTestId("search-from-deck")).not.toBeInTheDocument();
  });

  it("le picker montre l'image de l'impression choisie en ligne, l'agrandit au toucher, et rien hors ligne", async () => {
    const app = await renderSeeded("#/decks/id:4", seededServer(), true);
    app.ui.cards.set(118, onlineCard(118));
    fireEvent.click(await screen.findByTestId("deck-card-add"));
    const form = await screen.findByTestId("deck-card-form-sheet");
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "majesty" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    const image = await within(form).findByTestId("deck-card-form-image");
    await waitFor(() => expect(within(image).getByRole("img", { name: "Majesty" })).toHaveAttribute("src", "https://static.krcg.org/card/set/test/118.jpg"));
    fireEvent.click(image);
    expect(image).toHaveAttribute("aria-pressed", "true");
    expect(form.querySelector(".card-image--lg")).toBeInTheDocument();

    setOnline(false);
    await waitFor(() => expect(within(form).queryByTestId("deck-card-form-image")).not.toBeInTheDocument());
  });
});
