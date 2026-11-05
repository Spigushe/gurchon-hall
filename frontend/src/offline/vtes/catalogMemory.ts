import { liveQuery, type Subscription } from "dexie";
import { buildSearchCatalog, type SearchCatalog } from "./cardSearch";
import type { VtesOfflineDb } from "./db";

/**
 * Le catalogue joint et indexé, en mémoire (lot Chercher, « Lecture et
 * filtrage »). Il se lit une fois, `cards` et `cardDetails` dans une seule
 * transaction, puis Chercher le filtre en mémoire : aucune frappe ne parcourt
 * la base. Ce qui coûte (désérialiser 4 000 lignes, joindre, indexer) n'arrive
 * qu'au premier abonné et à chaque changement de l'un des deux magasins
 * (`refreshCatalog`, montée de la base, autre onglet : `liveQuery` de Dexie
 * observe les deux tables, y compris d'un onglet à l'autre).
 *
 * Un par base de compte, porté par le runtime : `close()` le jette, à la
 * fermeture de la base et à la purge de la déconnexion. La lecture n'est
 * lancée qu'au premier abonné et reste active ensuite (le cache survit au
 * changement de page) jusqu'à `close()`.
 */
export class CatalogMemory {
  private value: SearchCatalog | undefined;
  private subscription: Subscription | null = null;
  private readonly listeners = new Set<() => void>();
  private closed = false;
  /** Nombre de lectures complètes faites (tests : aucune lecture par frappe). */
  loads = 0;

  constructor(private readonly db: VtesOfflineDb) {}

  /** Le dernier catalogue lu, `undefined` avant la première lecture. */
  snapshot(): SearchCatalog | undefined {
    return this.value;
  }

  /** S'abonne aux changements ; démarre la lecture au premier abonné. Rend le désabonnement. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Le catalogue courant, ou le prochain lu s'il n'y en a pas encore. */
  load(): Promise<SearchCatalog> {
    if (this.value) return Promise.resolve(this.value);
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (!this.value) return;
        unsubscribe();
        resolve(this.value);
      });
    });
  }

  close(): void {
    this.closed = true;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.value = undefined;
    this.listeners.clear();
  }

  private start(): void {
    if (this.subscription || this.closed) return;
    const db = this.db;
    this.subscription = liveQuery(() =>
      db.transaction("r", db.cards, db.cardDetails, async () => {
        const [cards, details] = await Promise.all([db.cards.toArray(), db.cardDetails.toArray()]);
        return buildSearchCatalog(cards, details);
      }),
    ).subscribe({
      next: (catalog) => {
        if (this.closed) return;
        this.loads += 1;
        this.value = catalog;
        for (const listener of [...this.listeners]) listener();
      },
      // Base fermée ou supprimée : on garde le dernier catalogue lu, sans bruit.
      error: () => {},
    });
  }
}
