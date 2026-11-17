# fastapi_backend

Deploys a Python/FastAPI application from a private GitHub repository and
runs it under systemd via `uvicorn`, bound to `127.0.0.1:<port>` only —
pair it with `backend_website` (nginx reverse proxy + TLS) to expose it
publicly.

## What it does

1. Ensures `/home/<username>/projects/<fastapi_backend_server_name>` exists (the app
   root).
2. Resolves which ref to deploy:
   - **`fastapi_backend_use_release_tag: true`** (the production convention — see the
     Constitution's release policy) — uses `fastapi_backend_release_tag` if pinned, else
     queries the GitHub API for the repo's latest release and deploys that
     tag. Fails loudly if the repo has no release yet.
   - **`fastapi_backend_use_release_tag: false`** (default, the staging convention) —
     deploys `fastapi_backend_git_branch` as before.
3. Clones/pulls `fastapi_backend_repo` over HTTPS using a GitHub token embedded in the
   URL (`no_log: true` on this task so the token never appears in
   Ansible output/logs) at the ref resolved above.
4. Installs [`uv`](https://docs.astral.sh/uv/) via its official installer
   if not already present (`~/.local/bin/uv`, idempotent via `creates`).
5. Detects the dependency manager by checking for `pyproject.toml` at the
   app's working directory — the repo root, or `fastapi_backend_repo_subdir`
   within it for a monorepo checkout (see `fastapi_backend_repo_subdir`
   below):
   - **present** → ensures Python 3.14 is available via `uv python install
     3.14` (idempotent — a no-op if already installed) before `uv sync`
     (creates and populates `.venv` automatically). This lets `uv` manage
     the interpreter itself rather than relying on whatever Python the
     `setup_packages` role's `apt` install happens to provide.
   - **absent** → falls back to `pip install -r requirements.txt` into a
     `.venv` created with `python3 -m venv` (Debian's system pip refuses
     to install outside a venv — PEP 668 — so this is the only supported
     path).
6. If `fastapi_backend_env_file` is set **and exists on the control machine**, copies
   it to `<app_root>/.env` (mode `0600`, owned by `username`). If it
   doesn't exist, the step is skipped with a note — this file is meant to
   be a local, git-ignored `.env` (optionally `ansible-vault`-encrypted at
   rest), never committed, so it's normal for it to be absent on a machine
   that hasn't been given it. See the root repo's `secrets/README.md`.
7. Templates a systemd unit (`/etc/systemd/system/<fastapi_backend_app_name>.service`)
   that runs, as `username`:

   ```bash
   source .venv/bin/activate && uvicorn <fastapi_backend_entrypoint> --host 127.0.0.1 --port <fastapi_backend_port>
   ```

   with any `fastapi_backend_env` entries as `Environment=` lines.
8. Reloads systemd and (re)starts the service — picking up both the
   `.env` file from step 6 (if the app loads `.env` itself, e.g. via
   `pydantic-settings`) and any `fastapi_backend_env` entries baked into the unit file.

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `fastapi_backend_repo` | yes | — | GitHub repo, `org/name` form (private, HTTPS). |
| `fastapi_backend_repo_subdir` | no | `''` (repo root is the app) | Path within the cloned repo where this app actually lives — set this when `fastapi_backend_repo` is a monorepo (e.g. `apps/barrins_api`). `pyproject.toml`/`requirements.txt` detection, dependency install, the deployed `.env`, and the systemd unit's `WorkingDirectory` all resolve relative to `<app_root>/<repo_subdir>` instead of the repo root. The full repo is still cloned to `<app_root>` either way. |
| `fastapi_backend_server_name` | yes | — | Used to build the app root path (`/home/<username>/projects/<fastapi_backend_server_name>`) and, unless `fastapi_backend_app_name` is set, the service name. Usually the API's domain. |
| `fastapi_backend_port` | yes | — | Local port `uvicorn` binds to. Pick one not already in use (see the root README for a per-app port ledger). |
| `fastapi_backend_entrypoint` | yes | — | `module:app` uvicorn target, e.g. `my_api.main:app`. |
| `fastapi_backend_app_name` | no | `fastapi_backend_server_name` | systemd service name; also used as `WorkingDirectory` label. |
| `fastapi_backend_use_release_tag` | no | `false` | `true` deploys a GitHub release tag instead of a branch — the production convention (see "Release-tag deploys" in the root README). |
| `fastapi_backend_release_tag` | no | unset (auto-resolve latest) | Pins a specific tag instead of "whatever's latest" — how you roll back: pass a previous tag. Only used when `fastapi_backend_use_release_tag: true`. |
| `fastapi_backend_git_branch` | no | `main` | Branch/ref to check out. Only used when `fastapi_backend_use_release_tag: false`. |
| `fastapi_backend_env` | no | `{}` | Dict of environment variables written as `Environment=KEY=VALUE` in the unit file (visible via `systemctl show`/`journalctl`). Fine for non-secret toggles; for actual secrets prefer `fastapi_backend_env_file` below. |
| `fastapi_backend_env_file` | no | unset (no `.env` deployed) | Local path to a git-ignored `.env` file, copied to `<app_root>/.env` on every deploy if present on the control machine. This is the recommended way to manage an app's full secret configuration (`DATABASE_URL`, `SECRET_KEY`, SMTP creds, ...) — see the root repo's `secrets/README.md`. Never committed to git. |
| `fastapi_backend_github_token` | no | the play's `github_token` | Overrides the GitHub PAT used to clone this specific app, for when it lives in a different org/repo than the shared token covers. |

## Requirements

- A GitHub Personal Access Token (repo read scope) available as the
  play-level `github_token` var (vaulted — see the root README's "GitHub
  Token" section) or passed per-invocation via `fastapi_backend_github_token`. If
  `fastapi_backend_use_release_tag: true`, that token also needs read access to the
  repo's Releases (the same `repo` scope covers this).
- The repo (or `fastapi_backend_repo_subdir` within it) must contain either a
  `pyproject.toml` (uv-managed) or a `requirements.txt` (pip-managed).
- If `fastapi_backend_use_release_tag: true`, the repo needs at least one GitHub
  Release published — the role fails with a clear message otherwise.
- Pair with `backend_website` (and `register_ssl` for the domain) to make
  the API reachable over HTTPS.

## Example

```yaml
- role: fastapi_backend
  tags: [backend]
  fastapi_backend_repo: my-org/my-api
  fastapi_backend_server_name: my-api.barrins-codex.org
  fastapi_backend_port: 8012
  fastapi_backend_entrypoint: "my_api.main:app"
  fastapi_backend_use_release_tag: true              # production: deploy the latest release
  fastapi_backend_env_file: "{{ playbook_dir }}/secrets/my-api/production.env"
```
