import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library ne nettoie pas automatiquement le DOM entre les tests avec
// vitest sauf en mode `globals: true` (non utilisé ici, imports explicites
// préférés). Sans ce nettoyage, plusieurs <App /> s'accumulent dans le DOM
// d'un test à l'autre et les requêtes par rôle (ex. getByRole("status"))
// échouent avec "multiple elements found".
afterEach(() => {
  cleanup();
});
