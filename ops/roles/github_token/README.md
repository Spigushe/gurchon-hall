# github_token

Reads the shared GitHub Personal Access Token from a local, git-ignored
file and exposes it as the `github_token` fact — factored out of
`barrins_api.yml`/`tamiyo_scroll.yml`/`tolaria_news.yml`/`docs.yml`,
which each used to carry an identical copy-pasted `pre_tasks` block
doing this. `fastapi_backend`/`react_frontend`/`docs_site` all fall
back to this same `github_token` fact via
`<role>_github_token | default(github_token)` unless a playbook
overrides it per-invocation.

## What it does

1. Resolves `github_token_file` — the play's own value if set, else
   `<playbook_dir>/secrets/github/token.txt` (the shared default every
   current playbook uses).
2. Fails fast with a clear message if that file doesn't exist locally
   (Constitution §34 — never generated or committed silently).
3. Reads it and sets the `github_token` fact (`no_log: true`, never
   logged).

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `github_token_file` | no | `<playbook_dir>/secrets/github/token.txt` | Path to the local, git-ignored file holding the raw token. Override only if a specific playbook needs a different token than the shared default. |

## Requirements

None beyond the local file itself existing (see `secrets/README.md` for
how to create it) — this role must simply run **before** any role that
consumes `github_token` (`fastapi_backend`, `react_frontend`,
`docs_site`), i.e. first in the play's `roles:` list.

## Example

```yaml
roles:
  - role: github_token

  - role: register_ssl
    tags: [certs]
    register_ssl_server_name: my-app.barrins-codex.org
    register_ssl_contact_name: admin@example.com

  - role: react_frontend
    tags: [frontend]
    react_frontend_repo: my-org/my-app
    react_frontend_server_name: my-app.barrins-codex.org
```
