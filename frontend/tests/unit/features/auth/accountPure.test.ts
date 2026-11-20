import { describe, expect, it } from "vitest";
import contract from "../../../../../contracts/openapi.json";
import { exportFileName } from "../../../../src/features/auth/accountApi";
import {
  closeOthersCopy,
  secondsLeft,
  syncRowMeta,
  unsyncedExportWarning,
  versionsLine,
} from "../../../../src/features/auth/accountModel";
import { deviceLabel, UNKNOWN_DEVICE } from "../../../../src/features/auth/deviceLabel";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordAcceptable,
  passwordRules,
} from "../../../../src/features/auth/passwordRules";
import {
  calendarDaysBetween,
  dayMonth,
  lastUsedPhrase,
  usedCell,
  usedLine,
} from "../../../../src/features/auth/sessionDates";

/**
 * Fonctions pures de l'écran Compte (Lot 12, D1 et D5) : règles du mot de
 * passe, libellé d'appareil, dates des sessions, copies de l'écran.
 */

describe("règles du nouveau mot de passe", () => {
  const schema = (contract as unknown as { components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> } })
    .components.schemas;
  const newPassword = schema.PasswordChange.properties.new_password;

  it("suivent les bornes et le motif que le contrat expose", () => {
    expect(newPassword.minLength).toBe(PASSWORD_MIN_LENGTH);
    expect(newPassword.maxLength).toBe(PASSWORD_MAX_LENGTH);
    // Le motif du contrat utilise des lookaheads : JavaScript les lit, Pydantic non (il
    // l'applique en Python). Chaque cas est jugé par le motif et par les règles du client.
    const pattern = new RegExp(String(newPassword.pattern), "u");
    for (const value of [
      "Nuit-de-Lyon7",
      "nuit-de-lyon7",
      "NUIT-DE-LYON7",
      "Nuit-de-Lyon-",
      "NuitdeLyon77a",
      "Nuit_de_Lyon7",
      "Nuit de Lyon7",
      "Ab1!",
      "Élan-vital-42",
    ]) {
      expect(passwordAcceptable(value), value).toBe(pattern.test(value));
    }
  });

  it("se cochent une à une, dans l'ordre affiché", () => {
    expect(passwordRules("").map((rule) => [rule.key, rule.met])).toEqual([
      ["length", false],
      ["lower", false],
      ["upper", false],
      ["digit", false],
      ["symbol", false],
    ]);
    expect(passwordRules("Nuit-de-Lyon7").every((rule) => rule.met)).toBe(true);
    expect(passwordRules("Nuit-de-Lyon7").map((rule) => rule.label)).toEqual([
      "De 12 à 128 caractères",
      "Une minuscule",
      "Une majuscule",
      "Un chiffre",
      "Un symbole",
    ]);
  });

  it("comptent les caractères comme le serveur, pas les unités UTF-16", () => {
    // Onze caractères dont un emoji (deux unités UTF-16) : trop court pour Python.
    const short = "Aa1-aaaaaa😀";
    expect(short.length).toBe(12);
    expect(passwordRules(short).find((rule) => rule.key === "length")?.met).toBe(false);
    expect(passwordAcceptable(`${"Aa1-".repeat(32)}x`)).toBe(false); // 129 caractères
    expect(passwordAcceptable("Aa1-".repeat(32))).toBe(true); // 128
  });

  it("ne comptent ni le tiret bas ni une espace comme un symbole", () => {
    expect(passwordAcceptable("Nuit_de_Lyon7")).toBe(false);
    expect(passwordAcceptable("Nuit de Lyon7")).toBe(false);
  });
});

describe("libellé d'appareil", () => {
  const cases: Array<[string | null, string]> = [
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome sur Android",
    ],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox sur Windows"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari sur iPhone",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      "Safari sur macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Edge sur Windows",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet sur Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      "Chrome sur iPhone",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
      "Firefox sur iPad",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
      "Opera sur Linux",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome sur ChromeOS",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36",
      "Chrome sur Linux",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Navigateur sur Linux"],
    ["Firefox/132.0", "Firefox"],
    ["testclient", UNKNOWN_DEVICE],
    ["python-httpx/0.28", UNKNOWN_DEVICE],
    ["   ", UNKNOWN_DEVICE],
    [null, UNKNOWN_DEVICE],
  ];

  it.each(cases)("%s → %s", (userAgent, expected) => {
    expect(deviceLabel(userAgent)).toBe(expected);
  });
});

describe("dates des sessions", () => {
  const now = new Date(2026, 10, 18, 10, 12);
  const at = (month: number, day: number, hour = 9) => new Date(2026, month, day, hour).toISOString();

  it("écrit le jour et le mois, sans année", () => {
    expect(dayMonth(at(10, 2))).toBe("2 novembre");
    expect(dayMonth(at(11, 2))).toBe("2 décembre");
  });

  it("compte en jours du calendrier local, pas en tranches de 24 heures", () => {
    expect(calendarDaysBetween(new Date(2026, 10, 17, 23, 59), new Date(2026, 10, 18, 0, 1))).toBe(1);
    expect(calendarDaysBetween(new Date(2026, 10, 18, 0, 1), new Date(2026, 10, 18, 23, 59))).toBe(0);
  });

  it("la session courante est utilisée aujourd'hui, quelle que soit la date notée", () => {
    const session = { created_at: at(10, 2), last_used_at: at(10, 2), expires_at: at(11, 2), current: true };
    expect(usedLine(session, now)).toBe("Utilisé aujourd'hui");
    expect(usedCell(session, now)).toBe("Aujourd'hui");
  });

  it("une autre session : aujourd'hui, hier, il y a N jours", () => {
    const base = { created_at: at(8, 20), expires_at: at(10, 29), current: false };
    expect(lastUsedPhrase({ ...base, last_used_at: at(10, 18, 8) }, now)).toBe("aujourd'hui");
    expect(lastUsedPhrase({ ...base, last_used_at: at(10, 17) }, now)).toBe("hier");
    expect(usedLine({ ...base, last_used_at: at(10, 15) }, now)).toBe("Utilisé il y a 3 jours");
    expect(usedCell({ ...base, last_used_at: at(10, 6) }, now)).toBe("Il y a 12 jours");
  });

  it("une session jamais renouvelée n'a jamais été revue, sauf ouverte le jour même", () => {
    const old = { created_at: at(10, 10), last_used_at: at(10, 10), expires_at: at(10, 24), current: false };
    expect(usedLine(old, now)).toBe("Jamais revu depuis");
    expect(usedCell(old, now)).toBe("Jamais revu depuis");
    const today = { ...old, created_at: at(10, 18, 8), last_used_at: at(10, 18, 8) };
    expect(usedLine(today, now)).toBe("Utilisé aujourd'hui");
  });
});

describe("copies de l'écran Compte", () => {
  it("compte à rebours d'un 429, arrondi au-dessus", () => {
    expect(secondsLeft(42_000, 0)).toBe(42);
    expect(secondsLeft(42_000, 41_001)).toBe(1);
    expect(secondsLeft(42_000, 42_000)).toBe(0);
    expect(secondsLeft(42_000, 50_000)).toBe(0);
  });

  it("confirmation de « Fermer toutes les autres sessions »", () => {
    expect(closeOthersCopy(3)).toEqual({
      short: "3 appareils seront déconnectés.",
      warning: "3 appareils seront déconnectés. Leurs saisies en attente partiront après reconnexion.",
      confirm: "Fermer les 3 sessions",
    });
    expect(closeOthersCopy(1).confirm).toBe("Fermer la session");
    expect(closeOthersCopy(1).short).toBe("1 appareil sera déconnecté.");
  });

  it("versions de la coquille et du serveur", () => {
    expect(versionsLine("1.1.0", "1.1.0")).toBe("Application 1.1.0 · Serveur 1.1.0");
    expect(versionsLine("1.0.0", "1.1.0")).toBe("Application 1.0.0 · Serveur 1.1.0");
    expect(versionsLine("1.1.0", null)).toBe("Application 1.1.0");
  });

  it("méta de la ligne Synchronisation (A11)", () => {
    expect(syncRowMeta({ online: true, pending: 0, rejected: 0 })).toBe("À jour");
    expect(syncRowMeta({ online: true, pending: 3, rejected: 0 })).toBe("3 en attente");
    expect(syncRowMeta({ online: true, pending: 0, rejected: 1 })).toBe("1 refusée");
    expect(syncRowMeta({ online: false, pending: 0, rejected: 0 })).toBe("hors ligne");
    expect(syncRowMeta({ online: false, pending: 2, rejected: 2 })).toBe("2 refusées · 2 en attente · hors ligne");
  });

  it("avertissement de l'export quand la file n'est pas vide (P3)", () => {
    expect(unsyncedExportWarning(0)).toBeNull();
    expect(unsyncedExportWarning(1)).toBe("1 saisie pas encore synchronisée n'y sera pas.");
    expect(unsyncedExportWarning(3)).toBe("3 saisies pas encore synchronisées n'y seront pas.");
  });

  it("nom du fichier exporté : celui du serveur, sinon le même gabarit au jour UTC", () => {
    const now = new Date(Date.UTC(2026, 10, 18, 23, 30));
    expect(exportFileName('attachment; filename="gurchon-hall-lea-v-2026-11-18.json"', "x", now)).toBe(
      "gurchon-hall-lea-v-2026-11-18.json",
    );
    expect(exportFileName(null, "lea-v", now)).toBe("gurchon-hall-lea-v-2026-11-18.json");
    expect(exportFileName("attachment", "lea-v", now)).toBe("gurchon-hall-lea-v-2026-11-18.json");
  });
});
