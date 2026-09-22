import "@testing-library/jest-dom/vitest";
// IndexedDB en mémoire pour les tests de la couche offline (Dexie). Importé ici,
// avant tout module applicatif : Dexie lit `indexedDB` au chargement.
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library ne nettoie pas automatiquement le DOM entre les tests avec
// vitest sauf en mode `globals: true` (non utilisé ici, imports explicites
// préférés). Sans ce nettoyage, plusieurs <App /> s'accumulent dans le DOM
// d'un test à l'autre et les requêtes par rôle (ex. getByRole("status"))
// échouent avec "multiple elements found".
// `waitFor` / `findBy*` rendent la main dès que la condition est vraie : ce délai
// n'allonge jamais un test qui passe, il évite seulement un faux échec quand la
// machine est chargée (défaut de Testing Library : 1 s). Un test qui attend un
// état qui ne vient pas échoue toujours, au bout de ces 5 s.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
