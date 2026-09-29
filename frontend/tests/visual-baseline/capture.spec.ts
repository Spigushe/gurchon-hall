import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "../e2e-real/support/backend";
import {
  CARDS,
  addDeckCard,
  addStock,
  createDeck,
  expectCatalogDownloaded,
  goToDecks,
  goToDecksList,
  goToStock,
  openApp,
} from "../e2e-real/support/app";
import { FRONTEND_DIR } from "../e2e-real/support/env";

/**
 * Captures de référence mobile (390×844), Lot 5bis étape 0. Pas une suite de
 * non-régression : aucune assertion sur le contenu des images, uniquement
 * `page.screenshot()`. Sert de repère visuel manuel pour le critère « aucune
 * régression mobile » de la fin de lot (`docs/lot5bis-plan-design.md`).
 *
 * Un seul test, un seul parcours, pour partager le catalogue téléchargé, la
 * carte en collection et le deck créé entre tous les écrans capturés — refaire
 * cette mise en place à chaque écran ralentirait sans rien apporter, puisque
 * rien n'est comparé automatiquement.
 */
const OUT_DIR = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot5bis-mobile-390x844");

test("capture les écrans principaux à 390×844", async ({ page, api }) => {
  // `api` n'est pas appelé directement : le demander comme fixture suffit à
  // faire démarrer le vrai back de test (base SQLite jetable, catalogue
  // importé), dont dépend tout le reste (`openApp`, `expectCatalogDownloaded`…).
  void api;
  mkdirSync(OUT_DIR, { recursive: true });
  // Cadre viewport (390×844), pas `fullPage: true` : la barre d'onglets basse est
  // en `position: fixed`, et une capture pleine page la fait réapparaître,
  // dupliquée, au milieu du contenu défilé (artefact connu des captures pleine
  // page avec éléments fixes). Un cadrage viewport reste fidèle à ce qu'un
  // utilisateur voit réellement à l'écran, quitte à ne pas montrer ce qui est
  // sous la ligne de flottaison.
  const shot = (name: string) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

  // 1. Atelier (accueil), catalogue téléchargé.
  await openApp(page);
  await expectCatalogDownloaded(page);
  await shot("01-atelier");

  // 2. Collection, une entrée possédée.
  await goToStock(page);
  await addStock(page, { search: CARDS.aura, card: CARDS.aura, quantity: 4, language: "EN" });
  await page.keyboard.press("Escape"); // referme la feuille « Ajouter à la collection »
  await shot("02-collection");

  // 3. Détail de deck, une ligne de composition (le formulaire reste ouvert
  // après l'ajout, cf. `addDeckCard` : Échap pour l'écran « propre »).
  await goToDecks(page);
  const key = await createDeck(page, "Capture Lot 5bis");
  await addDeckCard(page, { search: CARDS.aura, card: CARDS.aura, language: "EN", quantity: 4 });
  await page.keyboard.press("Escape");
  const deckPage = page.getByTestId("deck-page");
  await expect(deckPage).toHaveAttribute("data-deck-key", key);
  await shot("03-deck-detail");

  // 4. Liste des decks.
  await goToDecksList(page);
  await shot("04-decks");

  // 5. Synchronisation (tout tranché : file vide, en ligne).
  await page.goto("/#/synchronisation");
  await expect(page.getByTestId("sync-page")).toBeVisible();
  await shot("05-synchronisation");
});
