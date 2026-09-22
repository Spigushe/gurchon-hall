import type { OfflineCoreDb } from "./db";
import type { OperationEnvelope, SettledEntry } from "./types";

/**
 * Opérations tranchées en attente de rafraîchissement (table `settled`).
 *
 * Protocole d'un rafraîchissement des miroirs :
 *
 * 1. avant de lire le serveur, relever `lastSettledSeq` (le curseur) ;
 * 2. lire, puis remplacer le miroir **et** `pruneSettled(curseur)` dans la
 *    **même transaction**.
 *
 * Tout ce qui a été tranché avant le curseur est dans ce que le serveur a
 * rendu ; ce qui l'a été pendant la lecture porte un `seq` plus grand et reste,
 * la lecture ayant pu passer avant. Un rafraîchissement qui échoue n'efface rien.
 */

/** Dernier `seq` attribué (0 si la table est vide). */
export async function lastSettledSeq(db: OfflineCoreDb): Promise<number> {
  return (await db.settled.orderBy("seq").last())?.seq ?? 0;
}

/** Opérations tranchées, dans l'ordre où elles l'ont été. */
export async function readSettled<TOp extends OperationEnvelope = OperationEnvelope>(
  db: OfflineCoreDb,
): Promise<SettledEntry<TOp>[]> {
  return (await db.settled.orderBy("seq").toArray()) as SettledEntry<TOp>[];
}

/**
 * Efface les opérations tranchées jusqu'au curseur, éventuellement celles d'un
 * seul domaine (`types`) : chaque miroir n'efface que ce qu'il reflète. À
 * appeler dans la transaction qui remplace le miroir (elle doit inclure `settled`).
 */
export async function pruneSettled(
  db: OfflineCoreDb,
  upToSeq: number,
  types: (type: string) => boolean = () => true,
): Promise<void> {
  if (upToSeq <= 0) return;
  await db.settled
    .where("seq")
    .belowOrEqual(upToSeq)
    .filter((entry) => types(entry.type))
    .delete();
}
