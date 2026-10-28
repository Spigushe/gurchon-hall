---
name: ci-cd-deploiement
description: Pipeline monorepo — lint + tests + build pour back et front, HTTPS requis par la PWA, validation d'installabilité (par les critères réels, la catégorie Lighthouse PWA ayant été retirée), déploiement et préparation du portage vers barrins-project. À utiliser pour tout ce qui touche build, intégration continue et déploiement.
---

# CI/CD & déploiement

## Pipeline (à chaque changement)
`.github/workflows/ci.yml`, sur push vers `main` et sur toute PR, deux jobs :
1. **backend** : `uv sync --extra dev`, `uv run ruff check .`, `uv run pytest`,
   puis `uv run python scripts/export_openapi.py --check`.
2. **frontend** (Node 22) : `npm ci`, `npm run lint`, build (`tsc -b && vite
   build`), `scripts/check-pwa-installability.mjs`, `npm run test`, puis
   `npm run test:e2e` (Playwright, dont les projets contre un vrai back).
Coûts Argon2 abaissés au niveau du workflow (`ARGON2_MEMORY_COST_KIB=8192`,
`ARGON2_TIME_COST=1`), jamais en production. Gate de merge : les deux jobs verts.
En local, le même enchaînement passe par `scripts/run.ps1 test` / `run.sh test`
et `build`.

## Contraintes PWA
- **HTTPS obligatoire** en dehors de `localhost` : sans lui, pas de service
  worker ni d'installation.
- **Validation d'installabilité** : vérifier les critères réels — manifest valide
  (icônes requises, start_url, display), service worker enregistré, HTTPS. La
  catégorie **PWA de Lighthouse a été retirée en v12.0.0** ; ne pas s'appuyer sur
  un « score PWA ». Utiliser le panneau Application de Chrome DevTools et/ou un
  contrôle scripté des critères ci-dessus.

## Reproductibilité
- **Lockfiles** committés : `backend/uv.lock`, `frontend/package-lock.json`.
  Dependabot suit `uv`, `npm` et `github-actions`.
- Versions figées ; variables d'environnement documentées dans
  `backend/.env.example` (le backend ne charge aucun `.env` tout seul).

## Déploiement
- Ordre de mise en service (Lot 6) et variables de production :
  `docs/deploiement.md`. Migrer, réclamer le compte historique par CLI, puis
  seulement ouvrir l'application.
- Le cookie de session `__Host-` exige HTTPS hors `localhost`, comme la PWA.
- Hébergement : Lot 11, playbook Ansible sur l'infrastructure de barrins-project.

## Portage Barrin
Documenter comment transplanter la couche offline (SW + module outbox/sync) sur
barrins-project, et les points d'adaptation (contrat, HTTPS, config Vite). Point
de départ : `frontend/src/offline/README.md`. Le portage est le Lot 10.

## Ne pas faire
Concevoir la logique métier, les endpoints ou le service worker (tu builds et
déploies ; la conception revient aux agents de couche).
