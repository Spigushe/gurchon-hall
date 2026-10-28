import Dexie from "dexie";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { AuthGate } from "../../../../src/features/auth/AuthGate";
import { dbNameForAccount, forgetActiveAccountId, readActiveAccountId } from "../../../../src/offline/vtes/account";
import { createAuthFakeServer } from "./authFakeServer";

/**
 * Couverture volontairement limitée à la transition « anonyme → authentifié »
 * côté coquille : `AuthGate` ouvre toujours le runtime offline avec le **vrai**
 * client d'API (`createVtesOffline` ne reçoit aucune option d'injection ici,
 * contrairement aux bancs d'essai de `tests/unit/ui/harness.tsx`), donc les
 * lectures qui suivent la connexion (`refresh()`) visent un serveur
 * injoignable en test et échouent sans bloquer ni faire planter — c'est tout
 * ce que ce test vérifie, pas le contenu de l'Atelier qui en résulte. La
 * couverture de bout en bout (reconnexion après 401, adoption de la base
 * historique, deux comptes successifs) revient à la suite e2e `real-backend`
 * (étape qa-tests du Lot 6).
 */
afterEach(async () => {
  cleanup();
  const id = readActiveAccountId();
  forgetActiveAccountId();
  if (id !== null) await Dexie.delete(dbNameForAccount(id));
});

describe("<AuthGate />", () => {
  it("affiche le mur de connexion sans compte actif sur l'appareil", async () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <AuthGate />
      </ApiClientContext.Provider>,
    );
    expect(await screen.findByTestId("auth-screen")).toHaveAttribute("data-mode", "gate");
  });

  it("ouvre l'application après une connexion réussie, et mémorise le compte actif", async () => {
    const server = createAuthFakeServer([
      { id: 321, email: "a@x.fr", username: "alice", password: "Sup3r$ecret!", role: "user" },
    ]);
    render(
      <ApiClientContext.Provider value={server.client}>
        <AuthGate />
      </ApiClientContext.Provider>,
    );
    await screen.findByTestId("auth-screen");

    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "a@x.fr" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "Sup3r$ecret!" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    // `App` lui-même (pas seulement l'`AuthScreen`) doit être monté : son
    // repère le plus stable est la navigation principale, présente dès le
    // premier rendu de la coquille, sans attendre le chunk de page (`App.tsx`).
    expect(
      await screen.findByRole("navigation", { name: "Navigation principale" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(readActiveAccountId()).toBe(321);
  });
});
