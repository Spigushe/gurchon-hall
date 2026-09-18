---
name: ci-cd-deploiement
description: Pipeline monorepo — lint + tests + build pour back et front, HTTPS requis par la PWA, validation d'installabilité (par les critères réels, la catégorie Lighthouse PWA ayant été retirée), déploiement et préparation du portage vers barrins-project. À utiliser pour tout ce qui touche build, intégration continue et déploiement.
---

# CI/CD & déploiement

## Pipeline (à chaque changement)
1. **Lint** back et front.
2. **Tests** : pytest (back) + vitest et e2e Playwright, dont scénario offline
   (via `qa-tests`).
3. **Build** back et front.
Gate de merge : ces trois étapes vertes.

## Contraintes PWA
- **HTTPS obligatoire** en dehors de `localhost` : sans lui, pas de service
  worker ni d'installation.
- **Validation d'installabilité** : vérifier les critères réels — manifest valide
  (icônes requises, start_url, display), service worker enregistré, HTTPS. La
  catégorie **PWA de Lighthouse a été retirée en v12.0.0** ; ne pas s'appuyer sur
  un « score PWA ». Utiliser le panneau Application de Chrome DevTools et/ou un
  contrôle scripté des critères ci-dessus.

## Reproductibilité
- **Lockfiles** committés (`package-lock`/équivalent, `uv.lock`/`poetry.lock`…).
- Versions figées ; environnements/config documentés.

## Portage Barrin
Documenter comment transplanter la couche offline (SW + module outbox/sync) sur
barrins-project, et les points d'adaptation (contrat, HTTPS, config Vite).

## Ne pas faire
Concevoir la logique métier, les endpoints ou le service worker (tu builds et
déploies ; la conception revient aux agents de couche).
