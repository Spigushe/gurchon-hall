import type { components } from "../../api-client/schema.d.ts";
import type { VtesOfflineDb } from "./db";

type Schemas = components["schemas"];

/**
 * Copie locale, non secrète, du dernier `GET /moi` reçu (Lot 6, § P3 de
 * `docs/lot6-plan-comptes.md` : « qui est connecté ? »). Jamais de jeton ni
 * d'empreinte : le cookie de session est `HttpOnly`, ce client ne le lit
 * jamais et n'en a pas besoin pour savoir qui est connecté hors ligne.
 */
export type LocalAccount = Pick<Schemas["UserRead"], "id" | "email" | "username" | "role">;

/** Nom de la base IndexedDB d'un compte : un compte, une base (P3, Lot 6). */
export function dbNameForAccount(userId: number): string {
  return `gurchon-hall-offline-u${userId}`;
}

const ACCOUNT_META_KEY = "account";

/**
 * Mémorise l'identité connue dans la base **de ce compte**, pour l'afficher
 * hors ligne sans dépendre du réseau. À appeler après chaque réponse
 * `UserRead` (inscription, connexion, `GET /moi`) une fois la base du bon
 * compte ouverte.
 */
export async function saveLocalAccount(db: VtesOfflineDb, account: LocalAccount): Promise<void> {
  await db.meta.put({ key: ACCOUNT_META_KEY, value: account });
}

/**
 * Relit l'identité mémorisée dans cette base, ou `null` si elle n'y a jamais
 * été écrite (base neuve, jamais connectée depuis cet appareil).
 */
export async function readLocalAccount(db: VtesOfflineDb): Promise<LocalAccount | null> {
  const row = await db.meta.get(ACCOUNT_META_KEY);
  return (row?.value as LocalAccount | undefined) ?? null;
}

const ACTIVE_ACCOUNT_STORAGE_KEY = "gurchon-hall:active-account-id";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Navigation privée très restrictive, ou environnement sans `window` :
    // tant pis pour la reprise automatique au prochain démarrage.
    return null;
  }
}

/**
 * Pointeur, **hors de toute base IndexedDB**, vers le compte actif sur cet
 * appareil. Sert uniquement à choisir **quel** `dbName` ouvrir au prochain
 * démarrage, avant d'avoir pu lire quoi que ce soit dans une base : la copie
 * complète de `GET /moi` (`LocalAccount`) vit, elle, *dans* la base de ce
 * compte (`saveLocalAccount`) — ce pointeur-ci ne fait que désigner laquelle
 * ouvrir, le problème de l'œuf et de la poule que `dbName` pose à l'ouverture
 * de la base.
 *
 * Choix non dicté mot pour mot par `docs/lot6-plan-comptes.md` (qui place la
 * copie de `/moi` « dans la base locale », sans trancher comment retrouver
 * cette base avant de l'avoir ouverte) : stocké en `localStorage`, lu de
 * façon synchrone, jamais envoyé au serveur. Un identifiant de compte n'est
 * pas secret (CLAUDE.md § 11, Lot 6 : les identifiants séquentiels sont déjà
 * un oracle mineur accepté). Voir `README.md`, section « Multi-compte ».
 */
export function rememberActiveAccountId(userId: number): void {
  storage()?.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, String(userId));
}

/** Compte actif mémorisé, ou `null` (jamais connecté, ou oublié depuis). */
export function readActiveAccountId(): number | null {
  const raw = storage()?.getItem(ACTIVE_ACCOUNT_STORAGE_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Oublie le compte actif (déconnexion). N'efface aucune base IndexedDB : voir `purge`. */
export function forgetActiveAccountId(): void {
  storage()?.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
}
