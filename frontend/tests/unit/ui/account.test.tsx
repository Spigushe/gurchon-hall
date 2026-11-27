import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { readLocalAccount } from "../../../src/offline/vtes/account";
import { renderApp, setOnline, type UiServer } from "./harness";

/**
 * Écran Compte (Lot 12, D1) et accès à Synchronisation depuis lui (D5, A11),
 * aux deux largeurs, sur le serveur simulé des lectures en ligne.
 */

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

beforeEach(() => setViewportWidth(390));
afterEach(() => setViewportWidth(1024));

const ACCOUNT = { id: 1, email: "lea@example.org", username: "lea-v", role: "user" as const };

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

function session(id: number, current: boolean, userAgent: string | null) {
  const created = new Date(Date.now() - 10 * 86_400_000).toISOString();
  return {
    id,
    current,
    user_agent: userAgent,
    created_at: created,
    last_used_at: created,
    expires_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
  };
}

const threeSessions = (ui: UiServer) => {
  ui.account.sessions = [session(1, true, CHROME_ANDROID), session(2, false, FIREFOX_WINDOWS), session(3, false, null)];
};

async function openAccount(options: Parameters<typeof renderApp>[0] = {}) {
  const app = await renderApp({ hash: "#/compte", account: ACCOUNT, configure: threeSessions, ...options });
  await screen.findByTestId("account-page");
  return app;
}

describe("écran Compte : en-tête, sessions, versions", () => {
  it("montre le compte, les sessions (la courante en tête, sans bouton) et les deux versions", async () => {
    await openAccount();
    expect(await screen.findByTestId("account-email")).toHaveTextContent("lea@example.org");
    expect(screen.getByTestId("account-username")).toHaveTextContent("lea-v");
    expect(screen.queryByTestId("account-role")).not.toBeInTheDocument();

    const rows = await screen.findAllByTestId("account-session");
    expect(rows.map((row) => within(row).getByTestId("account-session-device").textContent)).toEqual([
      "Chrome sur Android",
      "Firefox sur Windows",
      "Appareil inconnu",
    ]);
    expect(within(rows[0]).getByTestId("account-session-current")).toHaveTextContent("Cet appareil");
    expect(within(rows[0]).queryByTestId("account-session-close")).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId("account-session-close")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Jamais revu depuis");
    expect(screen.getByTestId("account-sessions-count")).toHaveTextContent("3");

    await waitFor(() => expect(screen.getByTestId("account-versions")).toHaveTextContent("Application 0.0.0-test · Serveur 9.9.9"));
  });

  it("un compte admin porte l'étiquette « Administrateur »", async () => {
    await openAccount({ account: { ...ACCOUNT, role: "admin" } });
    expect(await screen.findByTestId("account-role")).toHaveTextContent("Administrateur");
  });

  it("le nom de la barre mène au compte, surligné sur cet écran, sans onglet actif", async () => {
    await renderApp({ hash: "#/collection", account: ACCOUNT, configure: threeSessions });
    const link = await screen.findByTestId("account-menu-link");
    expect(link).not.toHaveAttribute("aria-current");
    fireEvent.click(link);
    await screen.findByTestId("account-page");
    expect(screen.getByTestId("account-menu-link")).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('.tabbar [aria-current="page"]')).toBeNull();
  });

  it("fermer une session la retire sans confirmation, et le dit", async () => {
    const app = await openAccount();
    const rows = await screen.findAllByTestId("account-session");
    fireEvent.click(within(rows[1]).getByTestId("account-session-close"));

    expect(await screen.findByTestId("account-sessions-feedback")).toHaveTextContent("Session fermée : Firefox sur Windows.");
    expect(screen.getAllByTestId("account-session")).toHaveLength(2);
    expect(screen.getByTestId("account-sessions-count")).toHaveTextContent("2");
    expect(app.ui.requests).toContainEqual({ method: "DELETE", path: "/moi/sessions/2", search: "" });
  });

  it("une session déjà fermée ailleurs (404) disparaît aussi, avec un autre message", async () => {
    await openAccount({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("DELETE /moi/sessions/2", { status: 404, body: { detail: "Session 2 introuvable." } });
      },
    });
    const rows = await screen.findAllByTestId("account-session");
    fireEvent.click(within(rows[1]).getByTestId("account-session-close"));
    expect(await screen.findByTestId("account-sessions-feedback")).toHaveTextContent("Session déjà fermée : Firefox sur Windows.");
    expect(screen.getAllByTestId("account-session")).toHaveLength(2);
  });

  it("« Fermer toutes les autres sessions » confirme, puis ne laisse que cet appareil", async () => {
    const app = await openAccount();
    await screen.findAllByTestId("account-session");
    fireEvent.click(screen.getByTestId("account-sessions-close-others"));
    expect(screen.getByTestId("account-sessions-close-others-warning")).toHaveTextContent(
      "2 appareils seront déconnectés. Leurs saisies en attente partiront après reconnexion.",
    );
    expect(app.ui.requests.some((request) => request.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByTestId("account-sessions-close-others-cancel"));
    expect(screen.queryByTestId("account-sessions-close-others-warning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-sessions-close-others"));
    fireEvent.click(screen.getByTestId("account-sessions-close-others-confirm"));
    expect(await screen.findByTestId("account-sessions-alone")).toHaveTextContent("Aucune autre session ouverte.");
    expect(screen.getAllByTestId("account-session")).toHaveLength(1);
    expect(app.ui.requests).toContainEqual({ method: "DELETE", path: "/moi/sessions", search: "" });
  });

  it("hors ligne : sessions remplacées par un bloc, mot de passe, export et déconnexion désactivés", async () => {
    await openAccount({ online: false });
    expect(screen.getByTestId("account-sessions-offline")).toHaveTextContent("Liste indisponible hors ligne");
    expect(screen.getByTestId("account-password-open")).toBeDisabled();
    expect(screen.getByTestId("account-export")).toBeDisabled();
    expect(screen.getByTestId("account-page-logout")).toBeDisabled();
    expect(screen.getByTestId("account-page-offline-hint")).toHaveTextContent("Indisponible hors ligne.");
    // Pas de serveur : la version de l'API manque, celle de la coquille reste.
    expect(screen.getByTestId("account-versions")).toHaveTextContent(/^Application 0\.0\.0-test$/);
  });

  it("au retour du réseau, la liste des sessions se lit", async () => {
    await openAccount({ online: false });
    expect(screen.getByTestId("account-sessions-offline")).toBeInTheDocument();
    act(() => setOnline(true));
    expect(await screen.findAllByTestId("account-session")).toHaveLength(3);
  });

  it("une lecture des sessions refusée (401) dit de se reconnecter, et se relance", async () => {
    const app = await openAccount({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("GET /moi/sessions", { status: 401, body: { detail: "Session requise." } });
      },
    });
    expect(await screen.findByTestId("account-sessions-error")).toHaveTextContent("reconnectez-vous");
    app.ui.account.failures.clear();
    fireEvent.click(screen.getByTestId("account-sessions-retry"));
    expect(await screen.findAllByTestId("account-session")).toHaveLength(3);
  });

  it("bureau : deux colonnes, sessions en tableau", async () => {
    setViewportWidth(1440);
    await openAccount();
    const table = (await screen.findByTestId("account-sessions")).querySelector("table");
    expect(table).not.toBeNull();
    expect(within(table as HTMLTableElement).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Appareil",
      "Connecté le",
      "Utilisé",
      "Expire le",
      "Action",
    ]);
    expect(screen.getByTestId("account-sessions-close-others")).toHaveTextContent("Fermer toutes les autres sessions (2)");
  });
});

describe("écran Compte : mot de passe", () => {
  async function openSheet(options: Parameters<typeof renderApp>[0] = {}) {
    const app = await openAccount(options);
    fireEvent.click(screen.getByTestId("account-password-open"));
    await screen.findByTestId("change-password-sheet");
    return app;
  }

  function fill(current: string, next: string, confirmation = next) {
    fireEvent.change(screen.getByTestId("change-password-current"), { target: { value: current } });
    fireEvent.change(screen.getByTestId("change-password-new"), { target: { value: next } });
    fireEvent.change(screen.getByTestId("change-password-confirm"), { target: { value: confirmation } });
  }

  it("« Enregistrer » attend les règles et la confirmation", async () => {
    await openSheet();
    const submit = screen.getByTestId("change-password-submit");
    expect(submit).toBeDisabled();
    fill("ancien-Mot-2passe", "court");
    expect(screen.getByTestId("password-rule-length")).toHaveAttribute("data-met", "false");
    expect(submit).toBeDisabled();
    fill("ancien-Mot-2passe", "Nuit-de-Lyon7", "Nuit-de-Lyon8");
    expect(screen.getByTestId("change-password-mismatch")).toHaveTextContent("Les deux saisies ne correspondent pas.");
    expect(submit).toBeDisabled();
    fill("ancien-Mot-2passe", "Nuit-de-Lyon7");
    expect(screen.getByTestId("password-rule-symbol")).toHaveAttribute("data-met", "true");
    expect(submit).toBeEnabled();
  });

  it("un succès ferme la feuille, le dit, et relit les sessions", async () => {
    const app = await openSheet();
    fill("ancien-Mot-2passe", "Nuit-de-Lyon7");
    // Le serveur ferme les autres sessions (P2) : la relecture n'en montre plus qu'une.
    app.ui.account.sessions = app.ui.account.sessions.filter((item) => item.current);
    fireEvent.click(screen.getByTestId("change-password-submit"));

    expect(await screen.findByTestId("account-password-changed")).toHaveTextContent(
      "Mot de passe changé. Vos autres appareils devront se reconnecter.",
    );
    expect(screen.queryByTestId("change-password-sheet")).not.toBeInTheDocument();
    expect(app.ui.account.passwordBodies).toEqual([
      { current_password: "ancien-Mot-2passe", new_password: "Nuit-de-Lyon7" },
    ]);
    await waitFor(() => expect(screen.getAllByTestId("account-session")).toHaveLength(1));
  });

  it("un actuel faux (422) reste sous son champ, les autres saisies gardées", async () => {
    await openSheet({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("POST /moi/mot-de-passe", {
          status: 422,
          body: { detail: [{ loc: ["body", "current_password"], msg: "Mot de passe actuel incorrect.", type: "value_error" }] },
        });
      },
    });
    fill("mauvais", "Nuit-de-Lyon7");
    fireEvent.click(screen.getByTestId("change-password-submit"));
    expect(await screen.findByTestId("change-password-current-error")).toHaveTextContent("Mot de passe actuel incorrect.");
    expect(screen.getByTestId("change-password-new")).toHaveValue("Nuit-de-Lyon7");
    expect(screen.getByTestId("change-password-confirm")).toHaveValue("Nuit-de-Lyon7");
    // Retaper l'actuel efface le message.
    fireEvent.change(screen.getByTestId("change-password-current"), { target: { value: "autre" } });
    expect(screen.queryByTestId("change-password-current-error")).not.toBeInTheDocument();
  });

  it("trop d'essais (429) : compte à rebours, bouton retenu jusqu'à la fin", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await openSheet({
        configure: (ui) => {
          threeSessions(ui);
          ui.account.failures.set("POST /moi/mot-de-passe", {
            status: 429,
            body: { detail: "Trop de tentatives." },
            retryAfter: "2",
          });
        },
      });
      fill("ancien-Mot-2passe", "Nuit-de-Lyon7");
      fireEvent.click(screen.getByTestId("change-password-submit"));
      const alert = await screen.findByTestId("change-password-rate-limit");
      expect(alert).toHaveTextContent("Trop d'essais.");
      expect(alert).toHaveTextContent("Réessayez dans 2 secondes.");
      expect(screen.getByTestId("change-password-submit")).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.queryByTestId("change-password-rate-limit")).not.toBeInTheDocument();
      expect(screen.getByTestId("change-password-submit")).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un nouveau mot de passe refusé par le serveur montre son message", async () => {
    await openSheet({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("POST /moi/mot-de-passe", {
          status: 422,
          body: { detail: [{ loc: ["body", "new_password"], msg: "Mot de passe trop faible.", type: "value_error" }] },
        });
      },
    });
    fill("ancien-Mot-2passe", "Nuit-de-Lyon7");
    fireEvent.click(screen.getByTestId("change-password-submit"));
    expect(await screen.findByTestId("change-password-error")).toHaveTextContent("Mot de passe trop faible.");
  });

  it("serveur injoignable : un message, la feuille reste ouverte", async () => {
    await openSheet({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("POST /moi/mot-de-passe", "network");
      },
    });
    fill("ancien-Mot-2passe", "Nuit-de-Lyon7");
    fireEvent.click(screen.getByTestId("change-password-submit"));
    expect(await screen.findByTestId("change-password-error")).toHaveTextContent("Le serveur est injoignable");
    expect(screen.getByTestId("change-password-sheet")).toBeInTheDocument();
  });
});

describe("écran Compte : export", () => {
  it("télécharge le fichier sous le nom du serveur et le dit", async () => {
    const created: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return "blob:export";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openAccount({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.exportBody = { format_version: 1, account: { username: "lea-v" } };
        ui.account.exportFileName = "gurchon-hall-lea-v-2026-11-18.json";
      },
    });

    fireEvent.click(screen.getByTestId("account-export"));
    expect(await screen.findByTestId("account-export-done")).toHaveTextContent(
      "Fichier téléchargé : gurchon-hall-lea-v-2026-11-18.json",
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await created[0].text())).toEqual({ format_version: 1, account: { username: "lea-v" } });
  });

  it("prévient que les saisies en file n'y seront pas", async () => {
    const app = await openAccount({ online: false });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: 9, quantityOwned: 1 });
    expect(await screen.findByTestId("account-export-warning")).toHaveTextContent(
      "1 saisie pas encore synchronisée n'y sera pas.",
    );
  });

  it("un échec de l'export est dit sous le bouton", async () => {
    await openAccount({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("GET /moi/export", "network");
      },
    });
    fireEvent.click(screen.getByTestId("account-export"));
    expect(await screen.findByTestId("account-export-error")).toHaveTextContent("Le serveur est injoignable");
  });
});

describe("D5 : Synchronisation depuis le compte (A11)", () => {
  it("la ligne Synchronisation donne l'état de la file et ouvre l'écran, qui ramène au compte", async () => {
    const app = await openAccount({ online: false });
    expect(screen.getByTestId("account-sync-meta")).toHaveTextContent("hors ligne");
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: 9, quantityOwned: 1 });
    await waitFor(() => expect(screen.getByTestId("account-sync-meta")).toHaveTextContent("1 en attente · hors ligne"));

    fireEvent.click(screen.getByTestId("account-sync-row"));
    await screen.findByTestId("sync-page");
    fireEvent.click(screen.getByTestId("sync-back"));
    expect(await screen.findByTestId("account-page")).toBeInTheDocument();
  });

  it("bureau : quatre onglets, aucun surligné sur Synchronisation, et G S l'ouvre toujours", async () => {
    setViewportWidth(1440);
    await renderApp({ hash: "#/decks", account: ACCOUNT, configure: threeSessions });
    await screen.findByTestId("decks-page");
    const tabs = Array.from(document.querySelectorAll(".topbar__tab")).map((el) => el.getAttribute("data-testid"));
    expect(tabs).toEqual(["topnav-home", "topnav-stock", "topnav-decks", "topnav-games"]);

    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "s" });
    await screen.findByTestId("sync-page");
    expect(window.location.hash).toBe(hrefFor({ name: "sync" }));
    expect(document.querySelector('.topbar__nav [aria-current="page"]')).toBeNull();
  });

  it("bureau : l'état du réseau et le menu du compte sont dans la barre haute, un seul role=status", async () => {
    setViewportWidth(1440);
    await renderApp({ hash: "#/", account: ACCOUNT, configure: threeSessions });
    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(within(topbar).getByRole("status")).toHaveTextContent("En ligne");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(await within(topbar).findByTestId("account-menu-toggle"));
    fireEvent.click(screen.getByTestId("account-menu-account"));
    expect(await screen.findByTestId("account-page")).toBeInTheDocument();
    expect(within(topbar).getByTestId("account-menu-toggle")).toHaveAttribute("data-current", "true");
  });

  it("mobile : la tab bar ne surligne plus Atelier sur Synchronisation", async () => {
    await renderApp({ hash: "#/synchronisation" });
    await screen.findByTestId("sync-page");
    expect(screen.getByTestId("nav-home")).not.toHaveAttribute("aria-current");
  });
});

describe("écran Compte : nom à afficher dans les comptes-rendus", () => {
  it("envoie le nom rogné par PATCH /moi, puis met la copie locale à jour", async () => {
    const app = await openAccount();
    const input = await screen.findByTestId("account-display-name");
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue("");
    expect(screen.getByTestId("account-display-name-save")).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Spig  " } });
    fireEvent.click(screen.getByTestId("account-display-name-save"));
    expect(await screen.findByTestId("account-display-name-done")).toBeInTheDocument();
    expect(app.ui.account.profileBodies).toEqual([{ display_name: "Spig" }]);
    await waitFor(async () => expect((await readLocalAccount(app.runtime.db))?.display_name).toBe("Spig"));
    expect(screen.getByTestId("account-display-name")).toHaveValue("Spig");
  });

  it("vide, il s'efface : null est envoyé", async () => {
    const app = await openAccount({ account: { ...ACCOUNT, display_name: "Spig" } });
    const input = await screen.findByTestId("account-display-name");
    await waitFor(() => expect(input).toHaveValue("Spig"));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("account-display-name-save"));
    await screen.findByTestId("account-display-name-done");
    expect(app.ui.account.profileBodies).toEqual([{ display_name: null }]);
    await waitFor(async () => expect((await readLocalAccount(app.runtime.db))?.display_name).toBeNull());
  });

  it("hors ligne, le champ et le bouton sont désactivés, avec l'aide habituelle", async () => {
    await openAccount({ online: false });
    expect(await screen.findByTestId("account-display-name")).toBeDisabled();
    expect(screen.getByTestId("account-display-name-save")).toBeDisabled();
  });

  it("affiche sous le champ l'erreur du serveur", async () => {
    await openAccount({
      configure: (ui) => {
        threeSessions(ui);
        ui.account.failures.set("PATCH /moi", { status: 422, body: { detail: [{ loc: ["body", "display_name"], msg: "Caractère de contrôle refusé." }] } });
      },
    });
    const input = await screen.findByTestId("account-display-name");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Spig" } });
    fireEvent.click(screen.getByTestId("account-display-name-save"));
    expect(await screen.findByTestId("account-display-name-error")).toHaveTextContent("Caractère de contrôle refusé.");
  });
});
