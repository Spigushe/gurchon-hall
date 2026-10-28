# AGENTS.md

This repository is the VtES tracking app and PWA pilot described in [CLAUDE.md](CLAUDE.md). Treat that file as the source of truth for project goals, architecture, and constraints.

## Priorities

- Keep the offline-first PWA objective as the first-class technical priority.
- Treat the VtES domain as a real use case, but not at the expense of reusable offline/sync patterns for Barrin.
- Prefer a contract-first workflow: API schema changes must be defined before implementation.

## Project structure

- [CLAUDE.md](CLAUDE.md) — authoritative project brief, roadmap, architecture, and rules.
- [README.md](README.md) — top-level project entry point.
- .claude/agents/ — specialized agent definitions for orchestration, backend, frontend, PWA, QA, and deployment.
- .claude/skills/ — reusable operational playbooks for the project.
- backend/ — FastAPI app, SQLAlchemy models, Alembic migrations, and pytest tests.
- frontend/ — React + TypeScript + Vite app, PWA assets, the reusable offline package (`src/offline/`), and vitest/Playwright tests.
- contracts/ — generated OpenAPI contract used as the shared API source of truth.
- docs/ — per-lot plans and briefs, design handoffs, incident notes, and the deployment note.
- scripts/ — single tooling entry point (`run.ps1` / `run.sh` with `install`, `test`, `build`, `dev`) and the PWA installability check.

## Working conventions

- Follow the project stack in [CLAUDE.md](CLAUDE.md): React + TypeScript + Vite, FastAPI + Pydantic v2, SQLAlchemy 2.0, Alembic, SQLite, and Dexie/IndexedDB for offline storage.
- Respect the contract-first rule: design or update schemas before backend/frontend implementation.
- Keep the PWA work grounded in real installability checks and offline/sync behavior rather than a generic "works in dev" assumption.
- Do not treat VtES rules labeled as [à confirmer] as established facts; they need explicit verification before turning into hard logic.
- Keep the monorepo layout and task ordering aligned with the roadmap in [CLAUDE.md](CLAUDE.md) §12. Lots 0 to 6 are delivered (skeleton and PWA, contract and model, CRUD, offline sync, inventory by printing, mobile and desktop design, accounts); games and tournaments (Lot 7) come next.
- Since Lot 6, every private resource belongs to an account: new routes take the current user from the session, scope every query by it, and answer 404 (never 403) for another account's resource.

## When modifying code

- Check [CLAUDE.md](CLAUDE.md) before making architectural decisions.
- Prefer the specialized agent context in .claude/agents/ for the relevant layer.
- Preserve a clear separation between contract, backend, frontend, offline sync, and QA responsibilities.
- Keep docs and agent-facing guidance concise, factual, and aligned with the project’s existing architecture.

## Quality bar

- Confirm any backend API change is reflected in the OpenAPI contract and generated client types.
- Validate that offline-write flows remain functional without a network and then sync cleanly when connectivity returns.
- Cover business rules in tests, especially VtES validation and offline synchronization behavior.
- Keep changes compatible with the reusable Barrin porting goal.
