import Dexie from "dexie";
import type { OperationEnvelope, OutboxEntry, RefBinding, SettledEntry } from "../core/types";
import { DEFAULT_DB_NAME, VtesOfflineDb } from "./db";

/**
 * Adoption de la base d'avant le Lot 6 (comptes), dont le nom ne portait
 * encore aucun compte : `docs/lot6-plan-comptes.md`, § P3 (« la base d'avant
 * le Lot 6 »). Toute base postérieure se nomme `gurchon-hall-offline-u<id>`
 * (`dbNameForAccount`, `account.ts`) ; celle-ci reste l'ancien nom par défaut
 * (`DEFAULT_DB_NAME`, `db.ts`), inchangé pour ne pas perdre la file des
 * appareils déjà installés.
 */
export const LEGACY_DB_NAME = DEFAULT_DB_NAME;

export interface LegacyAdoption {
  /** `false` : pas de base historique, ou sa file est vide (rien à proposer). */
  adopted: boolean;
  /** Nombre d'opérations recopiées (file d'attente, refusées comprises). */
  operations: number;
}

/**
 * Vérification seule, sans effet de bord : y a-t-il, sur cet appareil, une
 * base d'avant les comptes avec des opérations en attente ? Sert à décider si
 * l'étape D doit proposer la confirmation (« Des saisies faites avant les
 * comptes attendent sur cet appareil. Les rattacher à <nom> ? ») — cette
 * fonction ne l'affiche pas elle-même, et ne modifie rien.
 */
export async function hasPendingLegacyOperations(): Promise<boolean> {
  const exists = await Dexie.exists(LEGACY_DB_NAME);
  if (!exists) return false;
  const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
  try {
    return (await legacy.outbox.count()) > 0;
  } finally {
    legacy.close();
  }
}

/**
 * Recopie la file, `settled` et les correspondances `client_ref` de la base
 * historique (`gurchon-hall-offline`) dans la base du compte qui vient de se
 * connecter (`targetDbName`, cf. `dbNameForAccount`), **sans modification**
 * du contenu des opérations : mêmes `operation_id`, même corps, donc la même
 * empreinte d'idempotence qu'avant — un rejeu reste un rejeu. Seul le rang
 * local (`rank`, qui n'est pas envoyé au serveur) est décalé pour s'ajouter
 * à la suite de ce que la base cible contient déjà, sans retourner l'ordre de
 * saisie. Les miroirs ne sont **pas** recopiés : `runtime.refresh()` les
 * recharge depuis le serveur une fois connecté.
 *
 * Supprime l'ancienne base une fois la recopie faite. Ne demande aucune
 * confirmation : c'est le rôle de l'appelant (étape D), **avant** d'appeler
 * cette fonction. Rend `{ adopted: false, operations: 0 }` sans rien changer
 * si la base historique n'existe pas ou si sa file est vide.
 */
export async function adoptLegacyDatabase(targetDbName: string): Promise<LegacyAdoption> {
  const exists = await Dexie.exists(LEGACY_DB_NAME);
  if (!exists) return { adopted: false, operations: 0 };

  const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
  let outboxRows: OutboxEntry<OperationEnvelope>[];
  let settledRows: SettledEntry<OperationEnvelope>[];
  let refRows: RefBinding[];
  try {
    [outboxRows, settledRows, refRows] = await Promise.all([
      legacy.outbox.orderBy("rank").toArray(),
      legacy.settled.orderBy("seq").toArray(),
      legacy.refs.toArray(),
    ]);
  } finally {
    legacy.close();
  }

  if (outboxRows.length === 0) {
    // Rien en file : pas de proposition à faire. On n'efface pas l'ancienne
    // base de son propre chef (elle n'est jamais que lue ici) ; un appel
    // répété sans opération à adopter reste donc sans effet, idempotent.
    return { adopted: false, operations: 0 };
  }

  const target = new VtesOfflineDb(targetDbName);
  try {
    await target.transaction("rw", target.outbox, target.settled, target.refs, async () => {
      const lastRank = (await target.outbox.orderBy("rank").last())?.rank ?? 0;
      let rank = lastRank;
      for (const row of outboxRows) {
        rank += 1;
        await target.outbox.add({ ...row, rank });
      }
      for (const row of settledRows) {
        // `seq` est auto-incrémenté par Dexie : on laisse la base cible lui
        // en attribuer un nouveau plutôt que de forcer celui de l'ancienne
        // base, qui n'a aucune raison d'y être libre.
        const withoutSeq: SettledEntry<OperationEnvelope> = { ...row };
        delete withoutSeq.seq;
        await target.settled.add(withoutSeq);
      }
      for (const row of refRows) {
        await target.refs.put(row);
      }
    });
  } finally {
    target.close();
  }

  await Dexie.delete(LEGACY_DB_NAME);
  return { adopted: true, operations: outboxRows.length };
}
