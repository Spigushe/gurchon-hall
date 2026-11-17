# backend_website

nginx HTTPS vhost that serves a static build from `dist/` and
reverse-proxies everything else to a backend process listening on
`127.0.0.1:<port>`. Pairs with `fastapi_backend` (or any process bound to
localhost) to expose it publicly over HTTPS. If the domain has no static
frontend of its own (pure API), that's fine — `dist/` can simply not
exist, and every request falls through to the proxy.

## What it does

1. Templates the HTTPS vhost to
   `/etc/nginx/sites-enabled/<backend_website_server_name>.https.conf`:
   - optional redirect vhost for `backend_website_alternate_server_name` (e.g. a `www.`
     domain) straight to the primary domain,
   - `root <site_root>/dist` with `try_files $uri @backend`,
   - `@backend` proxies to `http://127.0.0.1:<backend_website_port>` with the usual
     `X-Forwarded-*`/`X-Real-IP` headers.
2. Reloads nginx.

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `backend_website_server_name` | yes | — | Public domain for this vhost. Certificate must already exist (run `register_ssl` first). |
| `backend_website_port` | yes | — | Local port the backend process listens on (`127.0.0.1:<port>`). |
| `backend_website_alternate_server_name` | no | `False` | Extra domain (e.g. `www.<domain>`) that 301-redirects to `backend_website_server_name`. Needs its own `register_ssl` call/certificate. |
| `backend_website_is_websocket` | no | `False` | Accepted for forward-compatibility but **not yet wired into the nginx template** — the `@backend` location has no `Upgrade`/`Connection` headers today. Add them to `templates/https.conf.j2` before relying on this flag for a websocket backend. |
| `backend_website_rate_limited_paths` | no | `[]` | List of `{path, zone, rate, burst}` — adds an nginx `limit_req_zone` (conf.d, http context) plus a matching `location <path> { limit_req zone=<zone> burst=<burst> nodelay; ... }` block for each entry, scoped to that path only (the rest of the vhost is unaffected). `rate` is an nginx rate string (e.g. `20r/s`). Per-IP (`$binary_remote_addr`) only — no per-caller-identity option. The effective nginx zone name is `<server_name-slug>_<zone>` (the role prefixes it, since `limit_req_zone` names are global to nginx's `http` context — a bare `zone` would collide across vhosts / `api.` vs `api-staging.`), so `zone` only needs to be unique *within* one entry list. See `barrins_api.yml`'s Tolaria News BFF entry for a real example. |

Internally, `site_root` resolves to `/home/{{username}}/projects/{{backend_website_server_name}}` — the same convention every other role uses, so it lines up with `fastapi_backend`'s `app_root` when both target the same `fastapi_backend_server_name`/`backend_website_server_name`.

## Requirements

- `register_ssl` must have run for `backend_website_server_name` (and
  `backend_website_alternate_server_name`, if set).
- A backend process actually listening on `127.0.0.1:<backend_website_port>` — e.g.
  `fastapi_backend` configured with the same `fastapi_backend_port`.

## Example

Paired with `fastapi_backend` on the same domain/port:

```yaml
- role: fastapi_backend
  tags: [backend]
  fastapi_backend_repo: my-org/my-api
  fastapi_backend_server_name: my-api.barrins-codex.org
  fastapi_backend_port: 8012
  fastapi_backend_entrypoint: "my_api.main:app"

- role: backend_website
  tags: [backend]
  backend_website_server_name: my-api.barrins-codex.org
  backend_website_port: 8012
```
