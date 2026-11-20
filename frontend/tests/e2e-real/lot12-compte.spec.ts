import { test } from "./support/backend";
import {
  MOBILE_NAV,
  exportDownloaded,
  passwordChangedOnAnotherDevice,
  sessionClosedFromAnotherDevice,
  updateInPromptMode,
} from "./support/lot12";

/**
 * Lot 12 à 390 px, contre un vrai back : session fermée depuis un autre
 * appareil, mot de passe changé sur un autre appareil, export du compte, mise
 * à jour en mode `prompt`. Scénarios dans `support/lot12.ts`, communs au
 * bureau (`tests/e2e-desktop-real/lot12-compte.spec.ts`).
 */

test("session fermée depuis un autre appareil : reconnexion nécessaire, file intacte, rejeu après reconnexion", async ({
  page,
  context,
  browser,
  api,
}) => {
  await sessionClosedFromAnotherDevice({ page, context, browser, api }, MOBILE_NAV);
});

test("mot de passe changé sur un autre appareil : cet appareil-là reste connecté, le téléphone se reconnecte avec le nouveau", async ({
  page,
  browser,
  api,
}) => {
  await passwordChangedOnAnotherDevice({ page, browser, api }, MOBILE_NAV);
});

test("export du compte téléchargé et lisible", async ({ page, api }) => {
  await exportDownloaded({ page, api }, MOBILE_NAV);
});

test("mise à jour en mode prompt : proposée, bloquée par une saisie en attente, installée après le rejeu", async ({
  page,
  context,
  api,
}) => {
  await updateInPromptMode({ page, context, api }, MOBILE_NAV);
});
