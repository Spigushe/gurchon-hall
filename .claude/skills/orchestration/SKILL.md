---
name: orchestration
description: Découper une demande projet en tâches, les déléguer aux bons agents, séquencer les dépendances et revoir l'intégration entre couches. À utiliser par le chef d'orchestre pour piloter un lot sans écrire de code.
---

# Orchestration

## Quand
Toute demande qui touche plusieurs couches (contrat, back, front, PWA, tests, déploiement).

## Méthode
1. Lire `CLAUDE.md` (objectif, roadmap, agents, skills).
2. Découper la demande en tâches, dans l'ordre de la roadmap, en gardant la
   **priorité au pilote PWA**.
3. Ordonner selon les dépendances **contract-first** :
   `architecte-contrat` → `backend-fastapi` / `frontend-react` → `pwa-offline` → `qa-tests` → `devops-deploiement`.
4. Déléguer chaque tâche via `Task` à l'agent compétent, avec un objectif clair
   et les artefacts d'entrée (contrat, schémas, couche offline).
5. Suivre l'avancement avec `TodoWrite`.
6. Revoir l'intégration entre livrables avant de clore.

## Handoff (à transmettre d'un agent au suivant)
- Contrat OpenAPI à jour (architecte → back/front).
- Services de validation VtES (architecte → back/QA).
- Couche offline packagée (pwa → front/QA/devops).

## Revue d'intégration — checklist
- Contrat, back et front cohérents (client TS régénéré).
- Règles VtES testées ; règles « [à confirmer] » signalées, pas figées.
- Scénario offline de bout en bout vérifié par `qa-tests`.
- `CLAUDE.md` à jour (décisions, roadmap).

## Ne pas faire
Écrire du code d'implémentation, modifier le contrat/schéma/règles soi-même.
