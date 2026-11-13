import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Api } from "./backend";
import { CARDS, cardInfo, expectCatalogDownloaded, expectPending, expectSynced, type DeckRead } from "./app";
import { fillGame, goToGamesAt, openAppAt, submitGame, type GameRow } from "./play";

/**
 * Scénarios du Lot 8 (étape E, « Tests attendus »), contre le VRAI back et partagés entre
 * `real-backend` (390 px) et `desktop-real-backend` (1440 px) : seules l'ouverture d'un deck
 * et celle d'une partie changent d'une largeur à l'autre.
 */
export interface Lot8Width {
  desktop: boolean;
  /** Ouvre le deckbuilder du deck nommé, depuis la liste des decks. */
  openDeck: (page: Page, name: string) => Promise<void>;
}

interface Fixtures {
  page: Page;
  context: BrowserContext;
  api: Api;
}

const deckRow = (scope: Page | Locator, cardId: number): Locator =>
  scope.locator(`[data-testid="deck-card"][data-card-id="${cardId}"]`);

/** Ouvre le détail de l'unique partie de la liste : lien au mobile, ligne du maître/détail au bureau. */
async function openOnlyGame(page: Page, desktop: boolean): Promise<Locator> {
  await goToGamesAt(page, desktop);
  const item = page.getByTestId("game-item");
  await expect(item).toHaveCount(1);
  if (desktop) {
    await item.click();
    return page.getByTestId("games-detail");
  }
  await item.getByTestId("game-link").click();
  const detail = page.getByTestId("game-detail");
  await expect(detail).toBeVisible();
  return detail;
}

/**
 * P3 : une partie saisie hors ligne, puis le deck retouché hors ligne. Au rejeu, la file part
 * dans l'ordre de saisie : le serveur fige la liste d'avant la retouche, et la partie la montre
 * (« v1 », liste à deux exemplaires) alors que le deck vivant en a trois.
 */
export async function frozenListSurvivesAnOfflineEdit(width: Lot8Width, { page, context, api }: Fixtures): Promise<void> {
  const name = "Liste figée e2e";
  const awe = await cardInfo(api, CARDS.awe);
  const deck = await api.post<{ id: number }>("/decks", { name, proxy_allowed: true }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
    201,
  );

  await openAppAt(page, width.desktop);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await context.setOffline(true);

  // 1. La partie, hors ligne : sa liste sera figée à la synchronisation.
  await goToGamesAt(page, width.desktop);
  await page
    .getByTestId(width.desktop ? "games-new-desktop" : "game-add")
    .or(page.getByTestId("games-empty-create"))
    .first()
    .click();
  await fillGame(page, { deck: name, halfPoints: 2 });
  await submitGame(page);
  const pendingDetail = await openOnlyGame(page, width.desktop);
  await expect(pendingDetail.getByTestId("game-fact-version-note")).toHaveText("liste figée à la synchronisation");

  // 2. Le deck retouché ensuite, toujours hors ligne : un exemplaire de plus (un proxy).
  await width.openDeck(page, name);
  const row = deckRow(page, awe.id);
  await expect(row).toHaveAttribute("data-quantity", "2");
  const plus = row.getByRole("button", { name: `Ajouter un exemplaire de ${CARDS.awe} (EN)` });
  await expect(plus).toHaveAttribute("data-plus", "proxy");
  await plus.click();
  await expect(row).toHaveAttribute("data-quantity", "3");
  await expectPending(page, 2);

  // 3. Le rejeu : la partie passe avant la retouche, donc fige la liste à deux exemplaires.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);

  const games = await api.get<GameRow[]>("/parties");
  expect(games).toHaveLength(1);
  const served = await api.get<{ me: { deck_version_number: number | null } }>(`/parties/${games[0].id}`);
  expect(served.me.deck_version_number).toBe(1);
  const versions = await api.get<Array<{ number: number; cards: Array<{ card_id: number; quantity: number }> }>>(
    `/decks/${deck.id}/versions`,
  );
  expect(versions.map((version) => [version.number, version.cards.map((card) => [card.card_id, card.quantity])])).toEqual([
    [1, [[awe.id, 2]]],
  ]);
  const live = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(live.cards.map((line) => [line.card_id, line.quantity])).toEqual([[awe.id, 3]]);

  // 4. L'écran : la partie montre la v1 et sa liste, pas le deck vivant.
  const detail = await openOnlyGame(page, width.desktop);
  await expect(detail.getByTestId("game-fact-version")).toContainText("v1");
  // Une amicale figée n'a pas de note : « liste figée à la synchronisation » a disparu.
  await expect(detail.getByTestId("game-fact-version-note")).toHaveCount(0);
  await detail.getByTestId("game-fact-version-link").click();
  const versionPage = page.getByTestId("deck-version-page");
  await expect(versionPage.getByTestId("deck-version-title")).toContainText(`${name} · v1`);
  await expect(versionPage.getByTestId("deck-tables")).toHaveAttribute("data-editable", "false");
  await expect(versionPage.getByTestId("deck-tables-library-total")).toHaveText("2");
}

/** `[clé du groupe, nombre de parties]` des lignes d'un axe du bilan, au mobile comme au bureau. */
async function groupsOf(container: Locator): Promise<Array<[string, string]>> {
  await expect(container.locator("[data-group][data-games]").first()).toBeVisible();
  return container
    .locator("[data-group][data-games]")
    .evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-group") ?? "", row.getAttribute("data-games") ?? ""]));
}

const sorted = (groups: Array<[string, string]>) => [...groups].sort(([a], [b]) => a.localeCompare(b));

/**
 * P7, P8 : le bilan filtré sur un deck (`#/bilan?deck=…`, l'adresse de « Voir dans le bilan »),
 * lu hors ligne. Deux parties du deck et une d'un autre deck : le filtre ne garde que les deux
 * premières, et l'axe Position donne le deck de ma proie (siège suivant le mien) et celui de mon
 * prédateur (siège précédent), l'autre deck n'apparaissant nulle part.
 */
export async function bilanFilteredOnADeck(width: Lot8Width, { page, context, api }: Fixtures): Promise<void> {
  const banu = await api.post<{ id: number }>("/decks", { name: "Banu Princes" }, 201);
  const toreador = await api.post<{ id: number }>("/decks", { name: "Toreador Vote" }, 201);
  const player = async (name: string) => (await api.post<{ id: number }>("/joueurs", { name }, 201)).id;
  const [lea, marc, paul] = [await player("Léa"), await player("Marc"), await player("Paul")];
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const game = (deck: number, days: number, me: Record<string, unknown>, others: Array<Record<string, unknown>>) =>
    api.post(
      "/parties",
      {
        played_at: daysAgo(days),
        player_count: 5,
        participations: [{ player: { me: true }, deck: { deck_id: deck }, ...me }, ...others],
      },
      201,
    );
  // Siège 1 : proie au siège 2 (Léa, Bleed), prédateur au siège 5 (Marc, Wall).
  await game(banu.id, 3, { seat: 1, victory_points: 3, game_win: true }, [
    { player: { player_id: lea }, seat: 2, opponent_deck_archetype: "bleed" },
    { player: { player_id: marc }, seat: 5, opponent_deck_archetype: "wall" },
  ]);
  // Siège 3 : proie au siège 4 (Léa, Bleed), prédateur au siège 2 (Paul, Vote).
  await game(banu.id, 2, { seat: 3, victory_points: 1, game_win: false }, [
    { player: { player_id: lea }, seat: 4, opponent_deck_archetype: "bleed" },
    { player: { player_id: paul }, seat: 2, opponent_deck_archetype: "vote" },
  ]);
  // L'autre deck : rien de cette partie ne doit entrer dans le bilan filtré.
  await game(toreador.id, 1, { seat: 1, victory_points: 0, game_win: false }, [
    { player: { player_id: paul }, seat: 2, opponent_deck_archetype: "rush" },
    { player: { player_id: marc }, seat: 5, opponent_deck_archetype: "combo" },
  ]);

  await openAppAt(page, width.desktop);
  await expectSynced(page);
  // File vide ne veut pas dire miroir relu : on attend les trois parties avant de couper.
  await goToGamesAt(page, width.desktop);
  await expect(page.getByTestId("game-item")).toHaveCount(3);
  await context.setOffline(true);
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/bilan?deck=id:${banu.id}`);

  const bilan = page.getByTestId("bilan-page");
  await expect(bilan.getByTestId("bilan-summary-games")).toHaveText(/1 GW sur 2 parties/);
  await expect(bilan.getByTestId("bilan-summary-points")).toContainText("4 VP");
  expect(await bilan.textContent()).not.toContain("%");
  if (width.desktop) {
    await expect(bilan.getByTestId("bilan-filterbar").getByTestId("bilan-deck-option").and(page.locator(":checked"))).toHaveCount(1);
  } else {
    await expect(bilan.getByTestId("bilan-filter-summary")).toContainText("Banu Princes");
  }

  expect(await groupsOf(bilan.getByTestId("bilan-axis-deck"))).toEqual([[`id:${banu.id}`, "2"]]);

  // Onglets et segmentés cachent leur case : on clique l'étiquette, comme un doigt.
  const choose = async (testId: string) => {
    await bilan.locator("label", { has: page.getByTestId(testId) }).click();
    await expect(bilan.getByTestId(testId)).toBeChecked();
  };
  if (!width.desktop) await choose("bilan-axis-tab-position");
  const position = () => bilan.getByTestId("bilan-position-list");
  expect(await groupsOf(position())).toEqual([["bleed", "2"]]);
  await choose("bilan-position-predator");
  await expect(position().locator('[data-group="vote"]')).toHaveCount(1);
  expect(sorted(await groupsOf(position()))).toEqual([
    ["vote", "1"],
    ["wall", "1"],
  ]);
  await expect(bilan.locator('[data-group="rush"], [data-group="combo"]')).toHaveCount(0);
}
