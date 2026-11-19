import { describe, expect, it } from "vitest";
import { appUpdateHints, appUpdateTitle } from "../../../../src/features/sync/appUpdateCopy";

// Lot 12, P5 et A11 : textes du bandeau « nouvelle version » (1b-72 à 1b-76).

const waiting = (pending: number, online = true) =>
  ({ kind: "waiting", pending, online, authRequired: false }) as const;
const ready = (rejected: number) => ({ kind: "ready", rejected, applying: false }) as const;

describe("appUpdateTitle", () => {
  it("file vide ou refus seulement : la version est disponible", () => {
    expect(appUpdateTitle(ready(0))).toBe("Une nouvelle version est disponible.");
    expect(appUpdateTitle(ready(2))).toBe("Une nouvelle version est disponible.");
  });

  it("saisies en attente : elle s'installera après leur envoi, au singulier comme au pluriel", () => {
    expect(appUpdateTitle(waiting(3))).toBe(
      "Nouvelle version prête. Elle s'installera une fois vos 3 saisies synchronisées.",
    );
    expect(appUpdateTitle(waiting(1))).toBe(
      "Nouvelle version prête. Elle s'installera une fois votre saisie synchronisée.",
    );
  });
});

describe("appUpdateHints", () => {
  it("rien à ajouter quand la file est vide", () => {
    expect(appUpdateHints(ready(0))).toEqual([]);
  });

  it("des refus ne bloquent pas, et sont dits conservés", () => {
    expect(appUpdateHints(ready(2))).toEqual(["2 saisies refusées restent à régler ; elles seront conservées."]);
    expect(appUpdateHints(ready(1))).toEqual(["1 saisie refusée reste à régler ; elle sera conservée."]);
  });

  it("en attente : où suivre l'envoi (A11), et hors ligne quand il reprendra", () => {
    expect(appUpdateHints(waiting(3))).toEqual(["L'envoi se suit dans Compte › Synchronisation."]);
    expect(appUpdateHints(waiting(3, false))).toEqual([
      "Hors ligne : l'envoi reprendra au retour du réseau.",
      "L'envoi se suit dans Compte › Synchronisation.",
    ]);
  });
});
