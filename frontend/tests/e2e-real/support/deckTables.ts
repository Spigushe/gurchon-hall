import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Api } from "./backend";
import {
  CARDS,
  cardInfo,
  cardSetOptionLabel,
  cardSets,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  type DeckRead,
} from "./app";

/**
 * Scénarios du deckbuilder éditable (lot Affichage des decks, D4 et E1),
 * partagés entre `real-backend` (390px) et `desktop-real-backend` (1440px) :
 * seules l'ouverture de l'application et du deck changent d'une largeur à
 * l'autre, le comportement des tableaux est le même.
 */
export interface DeckTablesWidth {
  openApp: (page: Page) => Promise<void>;
  /** Ouvre le deckbuilder du deck nommé, depuis la liste des decks. */
  openDeck: (page: Page, name: string) => Promise<void>;
}

const row = (page: Page, cardId: number): Locator =>
  page.locator(`[data-testid="deck-card"][data-card-id="${cardId}"]`);

const detailLine = (page: Page, cardId: number, cardSetLabel: string): Locator =>
  page
    .locator(`[data-testid="deck-card-line"][data-card-id="${cardId}"]`)
    .filter({ has: page.getByTestId("deck-card-set").getByText(cardSetLabel, { exact: true }) });

async function seed(api: Api, card: { id: number }, cardSetId: number, owned: number) {
  await api.post(
    "/stock",
    { card_id: card.id, language_code: "EN", card_set_id: cardSetId, quantity_owned: owned },
    201,
  );
}

/**
 * Hors ligne, les steppers d'un deck qui refuse les proxies : `+` prend au
 * stock identique jusqu'à l'épuiser puis se désactive (P3), `−` à 1 retire la
 * ligne (P4). Au retour du réseau, le serveur reflète les trois opérations.
 */
export async function steppersOfflineThenSync(
  width: DeckTablesWidth,
  { page, context, api }: { page: Page; context: BrowserContext; api: Api },
): Promise<void> {
  const awe = await cardInfo(api, CARDS.awe);
  const aura = await cardInfo(api, CARDS.aura);
  await seed(api, awe, awe.latest_card_set_id, 3);
  await seed(api, aura, aura.latest_card_set_id, 1);
  const deck = await api.post<{ id: number }>("/decks", { name: "Steppers e2e" }, 201);
  for (const card of [awe, aura]) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 1 },
      201,
    );
  }

  await width.openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await width.openDeck(page, "Steppers e2e");
  await expect(row(page, awe.id)).toHaveAttribute("data-quantity", "1");
  await context.setOffline(true);

  const plusAwe = row(page, awe.id).getByRole("button", { name: `Ajouter un exemplaire de ${CARDS.awe} (EN)` });
  for (const expected of ["2", "3"]) {
    await expect(plusAwe).toHaveAttribute("data-plus", "real");
    await plusAwe.click();
    await expect(row(page, awe.id)).toHaveAttribute("data-quantity", expected);
  }
  // Trois possédés, trois dans le deck, pas d'autre impression, pas de proxy :
  // le refus est connu d'avance, le `+` ne l'envoie pas.
  await expect(plusAwe).toBeDisabled();
  await expect(plusAwe).toHaveAttribute("title", /Plus d'exemplaire disponible/);

  // `−` à 1 retire la ligne, sans bouton « Retirer » à part.
  await row(page, aura.id).getByRole("button", { name: `Retirer ${CARDS.aura} (EN) du deck` }).click();
  await expect(row(page, aura.id)).toHaveCount(0);
  await expect(page.getByTestId("deck-tables-library-total")).toHaveText("3");
  await expectPending(page, 3);

  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);
  const served = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(served.cards.map((line) => [line.card_id, line.quantity])).toEqual([[awe.id, 3]]);
}

/**
 * Deux impressions de la même carte et langue (Lot 4) : une seule ligne
 * fusionnée, sans stepper mais avec l'icône qui renvoie au détail (P2). On
 * édite chaque impression depuis le détail ; quand le stock identique est
 * épuisé mais qu'une autre impression reste disponible, le `+` fait choisir
 * dans le détail au lieu de deviner (P3).
 */
export async function twoPrintingsFromDetail(
  width: DeckTablesWidth,
  { page, context, api }: { page: Page; context: BrowserContext; api: Api },
): Promise<void> {
  const awe = await cardInfo(api, CARDS.awe);
  const [firstSetId, secondSetId] = awe.card_set_ids;
  const setsById = new Map((await cardSets(api)).map((set) => [set.id, set]));
  const firstLabel = cardSetOptionLabel(setsById.get(firstSetId)!);
  const secondLabel = cardSetOptionLabel(setsById.get(secondSetId)!);
  await seed(api, awe, firstSetId, 2);
  await seed(api, awe, secondSetId, 1);
  const deck = await api.post<{ id: number }>("/decks", { name: "Impressions e2e" }, 201);
  for (const cardSetId of [firstSetId, secondSetId]) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: awe.id, language_code: "EN", card_set_id: cardSetId, quantity: 1 },
      201,
    );
  }

  await width.openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await width.openDeck(page, "Impressions e2e");
  await context.setOffline(true);

  const merged = row(page, awe.id);
  await expect(merged).toHaveAttribute("data-quantity", "2");
  await expect(merged).toHaveAttribute("data-lines", "2");
  await expect(merged.getByRole("button", { name: /Ajouter un exemplaire/ })).toHaveCount(0);
  await merged.getByTestId("deck-card-merged").click();
  await expect(page.getByTestId("deck-card-detail")).toBeVisible();

  // Une impression de plus dans la première extension, l'autre retirée.
  await detailLine(page, awe.id, firstLabel).getByRole("button", { name: /Ajouter un exemplaire/ }).click();
  await expect(detailLine(page, awe.id, firstLabel)).toHaveAttribute("data-quantity", "2");
  await detailLine(page, awe.id, secondLabel).getByRole("button", { name: `Retirer ${CARDS.awe} (EN) du deck`, exact: true }).click();
  await expect(detailLine(page, awe.id, secondLabel)).toHaveCount(0);
  await expect(merged).toHaveAttribute("data-lines", "1");

  // Le stock de la première extension est épuisé, la seconde a un exemplaire
  // libre : le `+` de la ligne ne devine pas, il fait choisir dans le détail.
  const plus = merged.getByRole("button", { name: `Ajouter un exemplaire de ${CARDS.awe} (EN)` });
  await expect(plus).toHaveAttribute("data-plus", "choose");
  await plus.click();
  const option = page
    .getByTestId("deck-card-stock-option")
    .and(page.locator(`[data-card-set-id="${secondSetId}"]`));
  await expect(option).toContainText("1 disponible");
  await option.click();
  await expect(detailLine(page, awe.id, secondLabel)).toHaveAttribute("data-quantity", "1");
  await expect(merged).toHaveAttribute("data-quantity", "3");
  await expectPending(page, 3);

  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);
  const served = await api.get<DeckRead>(`/decks/${deck.id}`);
  const byCardSet = new Map(served.cards.map((line) => [line.card_set_id, line.quantity]));
  expect(byCardSet).toEqual(
    new Map([
      [firstSetId, 2],
      [secondSetId, 1],
    ]),
  );
}
