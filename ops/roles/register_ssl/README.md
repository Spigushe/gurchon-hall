# register_ssl

Issues/renews a Let's Encrypt certificate for a domain and deploys the
shared nginx TLS snippet used by every other HTTPS-serving role. This role
must run for a domain **before** `react_frontend` or `backend_website`,
since their vhost templates reference the certificate files this role
creates.

## What it does

1. Templates `/etc/nginx/snippets/ssl-params.conf` (TLS session cache /
   OCSP stapling settings shared by all HTTPS vhosts on the host —
   idempotent, safe to re-run from every `register_ssl` invocation).
2. Templates an HTTP (port 80) vhost for `register_ssl_server_name`: serves the
   ACME HTTP-01 challenge from `/usr/share/nginx/html` and redirects
   everything else to HTTPS.
3. Reloads nginx so the HTTP vhost is live for the challenge.
4. Runs `certbot certonly --webroot` to obtain the certificate. Skipped on
   future runs if `/etc/letsencrypt/live/<domain>/fullchain.pem` already
   exists (certbot doesn't auto-renew via this role — see "Renewal"
   below).

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `register_ssl_server_name` | yes | — | Domain to issue the certificate for, e.g. `my-app.barrins-codex.org`. Must already point (DNS A record) at this server. |
| `register_ssl_contact_name` | yes | — | Real, monitored email passed to `certbot --email` for expiry/urgent notices. Previously defaulted to `<username>@<server_name>` — a non-existent mailbox on every domain, since Let's Encrypt doesn't verify deliverability at registration time and certbot never complained. |

## Requirements

- `setup_packages` must have run on the host first (installs `nginx`,
  `certbot`, `python3-certbot-nginx`).
- Port 80 must be reachable from the internet for the ACME HTTP-01
  challenge to succeed.
- One `register_ssl` call per domain — call it again with the alternate
  domain name if a role also needs a `www.` redirect
  (`backend_website_alternate_server_name`/etc.), since certbot issues one cert per
  `-d` here.

## Renewal

Certbot installs its own renewal systemd timer/cron job when first run
(standard Debian `certbot` package behavior) — this role only handles the
*initial* issuance. Nothing further to do in Ansible for renewal.

## Example

```yaml
- role: register_ssl
  tags: [frontend, certs]
  register_ssl_server_name: my-app.barrins-codex.org
  register_ssl_contact_name: admin@example.com
```
