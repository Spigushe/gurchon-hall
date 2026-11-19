/**
 * Nouvelle version de la coquille en attente (Lot 12, A6).
 *
 * Le service worker est en mode `prompt` : une version installée attend que
 * l'utilisateur la prenne. `registerServiceWorker` la signale par `offer`, avec
 * la fonction qui l'installe ; l'interface la lit par `useAppUpdate`
 * (`offline/react/`), qui la croise avec l'état de la file. Rien ici ne connaît
 * le service worker ni le domaine : le store se teste sans navigateur et se
 * reprend tel quel dans un autre projet.
 *
 * « Plus tard » (`dismiss`) ne vaut que pour cette page : le store vit en
 * mémoire, un rechargement ou un nouveau démarrage le remet à zéro, et la
 * version qui attend se représente.
 */
export interface AppUpdateSnapshot {
  /** Une nouvelle version est installée et attend d'être prise. */
  available: boolean;
  /** « Plus tard » : masqué jusqu'au prochain démarrage. */
  dismissed: boolean;
  /** L'installation est lancée ; la page va se recharger. */
  applying: boolean;
}

const INITIAL: AppUpdateSnapshot = { available: false, dismissed: false, applying: false };

export class AppUpdateStore {
  private snapshot: AppUpdateSnapshot = INITIAL;
  private install: (() => Promise<void>) | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppUpdateSnapshot => this.snapshot;

  /** Une nouvelle version attend ; `install` l'active et recharge la page. */
  offer(install: () => Promise<void>): void {
    this.install = install;
    this.set({ available: true });
  }

  /** « Plus tard ». */
  dismiss(): void {
    this.set({ dismissed: true });
  }

  /**
   * Installe la version qui attend. Sans version offerte, ou installation déjà
   * lancée, ne fait rien. Un échec rend le bandeau à son état d'avant, pour
   * qu'on puisse réessayer, et remonte à l'appelant.
   */
  async apply(): Promise<void> {
    if (!this.install || this.snapshot.applying) return;
    this.set({ applying: true });
    try {
      await this.install();
    } catch (error) {
      this.set({ applying: false });
      throw error;
    }
  }

  private set(patch: Partial<AppUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Le store de l'application, que `registerServiceWorker` alimente. */
export const appUpdateStore = new AppUpdateStore();
