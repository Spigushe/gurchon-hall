# react_frontend

Builds a Node.js frontend (React/Vite or anything with an `npm run
build`-style step) from a private GitHub repository and serves the static
output via nginx, with a single-page-app fallback to `index.html` for
client-side routing. Self-contained: unlike `fastapi_backend`, it does not
need pairing with `backend_website` — it templates and serves its own
HTTPS vhost directly.

## What it does

Everything runs as **root** (the play's default `become` user) so that
redeploys stay idempotent even though the last step hands ownership to
`www-data` — see the comment at the top of `tasks/main.yml` for why.

1. Ensures `/home/<username>/projects/<react_frontend_server_name>` exists (the site
   root).
2. Resolves which ref to deploy — same rule as `fastapi_backend`:
   `react_frontend_use_release_tag: true` (production convention) deploys
   `react_frontend_release_tag` if pinned, else the repo's latest GitHub release tag
   (fails if none exists); `false` (default, staging convention) deploys
   `react_frontend_git_branch`.
3. Clones/pulls `react_frontend_repo` over HTTPS using a GitHub token embedded in the
   URL (`no_log: true`, token never logged) at the ref resolved above.
4. Installs [`nvm`](https://github.com/nvm-sh/nvm) to `/opt/nvm` if not
   already present — **shared across every `react_frontend` invocation on
   the host**, so multiple apps don't each install their own copy.
5. Installs the requested Node version via `nvm install`.
6. If `react_frontend_build_env` is non-empty, writes it as a `.env` file at
   the app's working directory (the repo root, or `react_frontend_repo_subdir`
   within it) before building (for build-time variables baked into the
   bundle, e.g. Vite's `VITE_*`).
7. Runs `<react_frontend_package_manager> install` then `react_frontend_build_command`
   from that same working directory.
8. Symlinks `<site_root>/dist -> <working_dir>/<react_frontend_build_dir>`
   whenever that doesn't already resolve to `<site_root>/dist` on its own
   (i.e. always when `react_frontend_repo_subdir` is set, or when the build
   output isn't literally named `dist`) — the nginx template always serves
   `<site_root>/dist`.
9. Recursively chowns the site root to `www-data` so nginx can read it —
   this is the **last** task with `tags: deploy`, done every deploy run.
10. Templates the HTTPS vhost and reloads nginx.

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `react_frontend_repo` | yes | — | GitHub repo, `org/name` form (private, HTTPS). |
| `react_frontend_repo_subdir` | no | `''` (repo root is the app) | Path within the cloned repo where this app actually lives — set this when `react_frontend_repo` is a monorepo (e.g. `apps/tamiyo_scroll`). The build (`npm install`/build command, `build_env` file) runs from `<site_root>/<repo_subdir>` instead of the repo root; the `dist` symlink served by nginx is adjusted to match. The full repo is still cloned to `<site_root>` either way. |
| `react_frontend_server_name` | yes | — | Public domain; also used for the site root path. Certificate must already exist (run `register_ssl` first). |
| `react_frontend_app_name` | no | `react_frontend_server_name` | Currently informational only (no systemd unit — this role has no long-running process). |
| `react_frontend_use_release_tag` | no | `false` | `true` deploys a GitHub release tag instead of a branch — the production convention. |
| `react_frontend_release_tag` | no | unset (auto-resolve latest) | Pins a specific tag instead of "whatever's latest" — how you roll back. Only used when `react_frontend_use_release_tag: true`. |
| `react_frontend_git_branch` | no | `main` | Branch/ref to check out. Only used when `react_frontend_use_release_tag: false`. |
| `react_frontend_node_version` | no | `22` | Node version passed to `nvm install`/`nvm use`. |
| `react_frontend_package_manager` | no | `npm` | Must support `<pm> install` (e.g. `yarn`, `pnpm`). |
| `react_frontend_build_command` | no | `npm run build` | Full build command, run from the repo root. |
| `react_frontend_build_dir` | no | `dist` | Where the build output lands relative to the repo root. Symlinked to `dist` if different. |
| `react_frontend_build_env` | no | `{}` | Dict written to a `.env` file before building (build-time vars, not runtime secrets — there's no running process to pass `Environment=` to). |
| `react_frontend_github_token` | no | the play's `github_token` | Overrides the GitHub PAT used to clone this specific app, for when it lives in a different org/repo than the shared token covers. |

## Requirements

- A GitHub Personal Access Token (repo read scope) available as the
  play-level `github_token` var (vaulted — see the root README) or passed
  per-invocation via `react_frontend_github_token`. If `react_frontend_use_release_tag: true`,
  that token also needs read access to the repo's Releases (the same
  `repo` scope covers this).
- If `react_frontend_use_release_tag: true`, the repo needs at least one GitHub
  Release published — the role fails with a clear message otherwise.
- `register_ssl` must have run for `react_frontend_server_name` first.
- The build must produce a client-side-routed SPA (or a plain static
  site) — the nginx `try_files $uri /index.html;` fallback assumes any
  unmatched path should render the app shell, not 404.

## Example

```yaml
- role: register_ssl
  tags: [frontend, certs]
  register_ssl_server_name: my-app.barrins-codex.org

- role: react_frontend
  tags: [frontend]
  react_frontend_repo: my-org/my-app
  react_frontend_server_name: my-app.barrins-codex.org
```
