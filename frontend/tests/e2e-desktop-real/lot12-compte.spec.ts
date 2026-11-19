import { test } from "../e2e-real/support/backend";
import {
  DESKTOP_NAV,
  exportDownloaded,
  passwordChangedOnAnotherDevice,
  sessionClosedFromAnotherDevice,
  updateInPromptMode,
} from "../e2e-real/support/lot12";

/**
 * Lot 12 à 1440 px, contre un vrai back : session fermée depuis un autre
 * appareil, mot de passe changé sur un autre appareil, export du compte, mise
 * à jour en mode `prompt`. Scénarios dans `tests/e2e-real/support/lot12.ts`, communs au
 * mobile (`tests/e2e-real/lot12-compte.spec.ts`).
 */

test("session fermée depuis un autre appareil : reconnexion nécessaire, file intacte, rejeu après reconnexion", async ({
  page,
  context,
  browser,
  api,
}) => {
  await sessionClosedFromAnotherDevice({ page, context, browser, api }, DESKTOP_NAV);
});

test("mot de passe changé sur un autre appareil : cet appareil-là reste connecté, le téléphone se reconnecte avec le nouveau", async ({
  page,
  browser,
  api,
}) => {
  await passwordChangedOnAnotherDevice({ page, browser, api }, DESKTOP_NAV);
});

test("export du compte téléchargé et lisible", async ({ page, api }) => {
  await exportDownloaded({ page, api }, DESKTOP_NAV);
});

test("mise à jour en mode prompt : proposée, bloquée par une saisie en attente, installée après le rejeu", async ({
  page,
  context,
  api,
}) => {
  await updateInPromptMode({ page, context, api }, DESKTOP_NAV);
});
