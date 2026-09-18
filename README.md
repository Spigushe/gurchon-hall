# gurchon-hall

Suivi de pratique *Vampire: The Eternal Struggle* (collection, decks, parties,
tournois), développé comme pilote pour dérisquer une PWA offline-first avant
de porter l'approche sur barrins-project.

Stack prévue : React + TypeScript (Vite) côté front, FastAPI + SQLAlchemy +
SQLite côté back, contrat OpenAPI partagé entre les deux, IndexedDB (Dexie)
pour le stockage hors-ligne.

Le détail complet — objectifs, modèle de données, contrat d'API, agents et
skills Claude Code, roadmap — est dans [CLAUDE.md](CLAUDE.md). Les conventions
de travail pour les agents sont dans [AGENTS.md](AGENTS.md).

## État actuel

Le dépôt est encore au stade de planification : aucun code n'est écrit. Le
premier chantier (Lot 0 dans CLAUDE.md) consiste à poser le squelette du
monorepo — FastAPI minimal, React + Vite, PWA installable.
