import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { VtesOfflineDb } from "../../../src/offline/vtes/db";
import {
  dbNameForAccount,
  forgetActiveAccountId,
  readActiveAccountId,
  readLocalAccount,
  rememberActiveAccountId,
  saveLocalAccount,
  type LocalAccount,
} from "../../../src/offline/vtes/account";
import { freshDbName } from "./helpers";

/**
 * Lot 6 (comptes) : une base IndexedDB par compte (`dbNameForAccount`), et une
 * copie locale non secrète du dernier `GET /moi` pour savoir qui est connecté
 * hors ligne, sans jeton ni empreinte (cf. README.md, « Multi-compte »).
 */
describe("dbNameForAccount", () => {
  it("dérive un nom de base stable à partir de l'identifiant de compte", () => {
    expect(dbNameForAccount(1)).toBe("gurchon-hall-offline-u1");
    expect(dbNameForAccount(42)).toBe("gurchon-hall-offline-u42");
  });

  it("donne des noms distincts pour deux comptes distincts", () => {
    expect(dbNameForAccount(1)).not.toBe(dbNameForAccount(2));
  });
});

describe("identité locale du compte, dans la base du compte", () => {
  it("rend null tant que rien n'a été écrit (base neuve)", async () => {
    const db = new VtesOfflineDb(freshDbName("account"));
    try {
      expect(await readLocalAccount(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("écrit puis relit l'identité, sans jeton ni empreinte", async () => {
    const db = new VtesOfflineDb(freshDbName("account"));
    try {
      const account: LocalAccount = { id: 1, email: "a@x.fr", username: "a", role: "user" };
      await saveLocalAccount(db, account);
      expect(await readLocalAccount(db)).toEqual(account);
      // Rien d'autre que ces quatre champs n'est exposé par LocalAccount :
      // pas de place pour un jeton, le type ne le permettrait pas.
      expect(Object.keys(account)).toEqual(["id", "email", "username", "role"]);
    } finally {
      db.close();
    }
  });

  it("la dernière écriture remplace la précédente (changement de rôle, par exemple)", async () => {
    const db = new VtesOfflineDb(freshDbName("account"));
    try {
      await saveLocalAccount(db, { id: 1, email: "a@x.fr", username: "a", role: "user" });
      await saveLocalAccount(db, { id: 1, email: "a@x.fr", username: "a", role: "admin" });
      expect(await readLocalAccount(db)).toMatchObject({ role: "admin" });
    } finally {
      db.close();
    }
  });
});

describe("pointeur du compte actif (hors de toute base IndexedDB)", () => {
  afterEach(() => {
    forgetActiveAccountId();
  });

  it("ne mémorise rien par défaut", () => {
    expect(readActiveAccountId()).toBeNull();
  });

  it("mémorise, relit, puis oublie un identifiant de compte", () => {
    rememberActiveAccountId(7);
    expect(readActiveAccountId()).toBe(7);
    forgetActiveAccountId();
    expect(readActiveAccountId()).toBeNull();
  });

  it("ignore une valeur corrompue ou hors domaine (pas 0, pas négative, pas texte)", () => {
    window.localStorage.setItem("gurchon-hall:active-account-id", "pas-un-nombre");
    expect(readActiveAccountId()).toBeNull();
    window.localStorage.setItem("gurchon-hall:active-account-id", "0");
    expect(readActiveAccountId()).toBeNull();
    window.localStorage.setItem("gurchon-hall:active-account-id", "-3");
    expect(readActiveAccountId()).toBeNull();
  });

  it("change de compte sans résidu de l'ancien", () => {
    rememberActiveAccountId(1);
    rememberActiveAccountId(2);
    expect(readActiveAccountId()).toBe(2);
  });
});
