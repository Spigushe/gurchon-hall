import { expect, test } from "../e2e-real/support/backend";
import { expectCatalogDownloaded, expectPending, expectSynced, syncStatus } from "../e2e-real/support/app";
import type { PlayerRow, VenueRow } from "../e2e-real/support/play";
import { openAppDesktop } from "./support/nav";

/**
 * Lot 7, étape E : le Carnet (adversaires et lieux), contre le VRAI back, à 1440 px.
 *
 * Choix de la largeur : le bureau montre les deux colonnes à la fois et se pilote au clavier
 * (`Entrée` valide un renommage, `Échap` l'annule) ; le mobile n'en diffère que par le segmenté
 * et des icônes, sur les mêmes composants (couverts par `tests/unit/ui/tournaments.test.tsx`).
 *
 * Tout se fait hors ligne, puis part au retour du réseau : renommage (adversaire, « Moi », lieu),
 * doublon refusé (casse et accents ignorés, « Moi » compris), suppression refusée avec son motif
 * quand l'adversaire ou le lieu est utilisé, suppression confirmée sinon, « Moi » sans bouton de
 * suppression.
 */
test("Carnet : renommer, refus de doublon, suppression refusée si utilisé, « Moi » non supprimable", async ({
  page,
  context,
  api,
}) => {
  // Une partie amicale à laquelle Marc a joué, au Bar à Dés ; deux autres adversaires et deux lieux inutilisés.
  const marc = await api.post<{ id: number }>("/joueurs", { name: "Marc" }, 201);
  await api.post("/joueurs", { name: "Léa" }, 201);
  await api.post("/joueurs", { name: "Tom" }, 201);
  const bar = await api.post<{ id: number }>("/lieux", { name: "Le Bar à Dés" }, 201);
  await api.post("/lieux", { name: "Café Vide" }, 201);
  await api.post("/lieux", { name: "Chez Léo" }, 201);
  await api.post(
    "/parties",
    {
      played_at: new Date(Date.now() - 3_600_000).toISOString(),
      venue: { venue_id: bar.id },
      round_type: "casual",
      player_count: 4,
      participations: [{ player: { me: true } }, { player: { player_id: marc.id } }],
    },
    201,
  );
  const me = (await api.get<PlayerRow[]>("/joueurs")).find((player) => player.is_me) as PlayerRow;

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await context.setOffline(true);
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");

  await page.getByTestId("topnav-games").click();
  await page.getByTestId("notebook-open").click();
  await expect(page.getByTestId("notebook-page")).toBeVisible();
  await expect(page.getByTestId("notebook-columns")).toBeVisible(); // les deux colonnes, côte à côte
  await expect(page.getByTestId("notebook-players-title")).toContainText("Adversaires · 4");
  await expect(page.getByTestId("notebook-venues-title")).toContainText("Lieux · 3");

  const players = page.getByTestId("notebook-player-list");
  const venues = page.getByTestId("notebook-venue-list");
  const player = (name: string) => players.getByTestId("notebook-player").filter({ hasText: name });
  const venue = (name: string) => venues.getByTestId("notebook-venue").filter({ hasText: name });

  // « Moi » : en tête, étiqueté, renommable, jamais supprimable.
  const myRow = players.locator('[data-testid="notebook-player"][data-me="true"]');
  await expect(myRow).toHaveCount(1);
  await expect(players.getByTestId("notebook-player").first()).toHaveAttribute("data-me", "true");
  await expect(myRow.getByTestId("notebook-me-badge")).toBeVisible();
  await expect(myRow.getByTestId("notebook-player-rename-button")).toBeVisible();
  await expect(myRow.getByTestId("notebook-player-delete")).toHaveCount(0);
  await expect(player("Léa").getByTestId("notebook-player-delete")).toHaveCount(1);

  // L'usage vient du serveur : Marc est à une table, Léa et Tom à aucune.
  await expect(player("Marc").getByTestId("notebook-player-usage")).toContainText("1 table");
  await expect(player("Tom").getByTestId("notebook-player-usage")).toContainText("aucune table");

  // Doublon refusé : le nom de Marc, en capitales et sans accent ; le nom de « Moi » aussi.
  await player("Léa").getByTestId("notebook-player-rename-button").click();
  const input = players.getByTestId("notebook-player-rename-input");
  await input.fill("MARC");
  await input.press("Enter");
  await expect(players.getByTestId("notebook-player-rename-error")).toContainText("Un adversaire porte déjà ce nom.");
  await input.fill(me.name.toUpperCase());
  await input.press("Enter");
  await expect(players.getByTestId("notebook-player-rename-error")).toContainText("Un adversaire porte déjà ce nom.");
  await expectPending(page, 0); // rien n'est parti en file

  // `Échap` annule : le nom reste « Léa ».
  await input.press("Escape");
  await expect(players.getByTestId("notebook-player-rename")).toHaveCount(0);
  await expect(player("Léa")).toHaveCount(1);

  // Renommage valide, validé au clavier.
  await player("Léa").getByTestId("notebook-player-rename-button").click();
  await players.getByTestId("notebook-player-rename-input").fill("Léa Martin");
  await players.getByTestId("notebook-player-rename-input").press("Enter");
  await expect(player("Léa Martin")).toHaveCount(1);
  await expectPending(page, 1);

  // « Moi » se renomme aussi, par le bouton « OK ».
  await myRow.getByTestId("notebook-player-rename-button").click();
  await players.getByTestId("notebook-player-rename-input").fill("Martin");
  await players.getByTestId("notebook-player-rename-ok").click();
  await expect(players.locator('[data-me="true"]')).toContainText("Martin");
  await expect(players.locator('[data-me="true"]').getByTestId("notebook-me-badge")).toBeVisible();

  // Suppression refusée avec son motif : Marc est à une table, le Bar à Dés sert à une partie.
  await player("Marc").getByTestId("notebook-player-delete").click();
  await expect(players.getByTestId("notebook-player-refused")).toContainText("Marc figure à 1 table");
  await expect(players.getByTestId("notebook-player-confirmation")).toHaveCount(0);
  await venue("Le Bar à Dés").getByTestId("notebook-venue-delete").click();
  await expect(venues.getByTestId("notebook-venue-refused")).toContainText("Le Bar à Dés sert à 1 partie");
  await expect(venues.getByTestId("notebook-venue-confirmation")).toHaveCount(0);

  // Suppression d'un adversaire et d'un lieu inutilisés : deux temps, « Garder » puis confirmer.
  await player("Tom").getByTestId("notebook-player-delete").click();
  await expect(players.getByTestId("notebook-player-confirmation")).toBeVisible();
  await players.getByTestId("notebook-player-delete-keep").click();
  await expect(player("Tom")).toHaveCount(1);
  await player("Tom").getByTestId("notebook-player-delete").click();
  await players.getByTestId("notebook-player-delete-confirm").click();
  await expect(player("Tom")).toHaveCount(0);
  await venue("Café Vide").getByTestId("notebook-venue-delete").click();
  await venues.getByTestId("notebook-venue-delete-confirm").click();
  await expect(venue("Café Vide")).toHaveCount(0);

  // Renommer un lieu.
  await venue("Chez Léo").getByTestId("notebook-venue-rename-button").click();
  await venues.getByTestId("notebook-venue-rename-input").fill("Chez Léon");
  await venues.getByTestId("notebook-venue-rename-input").press("Enter");
  await expect(venue("Chez Léon")).toHaveCount(1);
  await expect(page.getByTestId("notebook-players-title")).toContainText("Adversaires · 3");
  await expect(page.getByTestId("notebook-venues-title")).toContainText("Lieux · 2");
  await expectPending(page, 5); // 2 renommages d'adversaire, 1 suppression d'adversaire, 1 suppression et 1 renommage de lieu

  // Le réseau revient : tout part, rien n'est refusé, le serveur voit le même carnet.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  const serverPlayers = await api.get<PlayerRow[]>("/joueurs");
  expect(serverPlayers.map((entry) => entry.name).sort()).toEqual(["Léa Martin", "Marc", "Martin"].sort());
  expect(serverPlayers.find((entry) => entry.is_me)?.name).toBe("Martin");
  const serverVenues = await api.get<VenueRow[]>("/lieux");
  expect(serverVenues.map((entry) => entry.name).sort()).toEqual(["Chez Léon", "Le Bar à Dés"].sort());

  // Le Carnet affiche toujours le même contenu après la synchronisation.
  await expect(page.getByTestId("notebook-players-title")).toContainText("Adversaires · 3");
  await expect(page.getByTestId("notebook-venues-title")).toContainText("Lieux · 2");
  await expect(player("Marc").getByTestId("notebook-player-usage")).toContainText("1 table");
});
