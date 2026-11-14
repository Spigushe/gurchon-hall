import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/**
 * Remplaçant de `virtual:pwa-register` sous vitest (alias de `vitest.config.ts`).
 *
 * Le module virtuel n'existe que sous le plugin PWA de Vite, absent de la config
 * de test : sans cet alias, `registerServiceWorker.ts` ne se transforme pas, et
 * la couverture v8 l'écartait (« Failed to parse … Excluding it from
 * coverage »), si bien que le score CRAP ne le mesurait pas. Les options reçues
 * sont gardées pour que les tests rejouent les rappels.
 */
export const registered: RegisterSWOptions[] = [];

export function registerSW(options: RegisterSWOptions = {}): (reloadPage?: boolean) => Promise<void> {
  registered.push(options);
  return async () => {};
}
