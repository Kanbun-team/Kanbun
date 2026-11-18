# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub security advisories:

**https://github.com/Kanbun-team/Kanbun/security/advisories/new**

Include the Kanbun version (shown in the footer and in `/whats-new`), how Kanbun is deployed (Docker, Node, SQLite or PostgreSQL, single sign-on or not) and the steps to reproduce. We aim to acknowledge a report within a few working days, agree on a fix and a disclosure date with you, and credit you in the advisory unless you prefer otherwise.

## Supported versions

Security fixes are made for the latest release. Upgrade to it before reporting, if you can.

## Security model

Kanbun is a self-hosted application for a team that knows each other. The people it defends against are:

- **Anyone on the network** without an account: they can reach the login page, the first-run setup (only while no account exists), the REST API (bearer tokens only) and the static assets. Everything else needs a session.
- **Members**: they see and change the boards they belong to, nothing else. Board owners manage their board (members, columns, tags, webhooks, templates). Every server action and route handler checks board membership on the server for the object it touches, including ids passed for tags, columns, assignees and linked cards, which must belong to the same board.
- **Admins** are trusted. They manage users, see every board, read the audit log and can download a full backup (which contains the whole database, see below).

What Kanbun does:

- **Passwords** are hashed with bcrypt (cost 12). Failed logins are rate limited per client address and username, per address, and per username across all addresses, with the same answer and timing for unknown users. Sessions are signed JWT cookies (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS) whose user is re-read on every request, so deactivating a user, a role change or a password reset applies at once.
- **Two-factor authentication** (TOTP) secrets are encrypted at rest with a key derived from `AUTH_SECRET`; codes can not be replayed; recovery codes are stored as keyed hashes and are single-use.
- **Single sign-on** (OpenID Connect) uses the authorization code flow with PKCE and state. IdP accounts are linked by their subject; linking by email (`OIDC_MATCH_EMAIL`) or username (`OIDC_MATCH_USERNAME`) is off by default because the Kanbun side of those values is chosen by users. See [docs/SSO.md](docs/SSO.md).
- **API tokens** are stored as SHA-256 hashes, are scoped (`read` or `write`), can expire and be revoked, and are rate limited per token. The API never reads the session cookie, so it can not be used for CSRF.
- **CSRF**: server actions are checked by Next.js; the cookie-authenticated route handlers that accept POST (uploads, imports, presence, heartbeat) refuse requests from another `Origin`.
- **XSS**: React escapes all output. Markdown is rendered by a small renderer that escapes the input first and only emits links to `http`, `https` and `mailto`. Avatar URLs must be `https`. Pages carry a nonce-based Content-Security-Policy (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`) plus `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy: same-origin` and `Permissions-Policy`.
- **Attachments** are stored under random names outside the web root. Only PNG, JPEG, GIF and WebP whose bytes match are shown inline; everything else (SVG and HTML included) is a download with `nosniff` and a sandboxing CSP. Uploads are capped by `ATTACHMENT_MAX_MB` even without a `Content-Length`. Access is checked against the card's current board on every download.
- **Webhooks** only post to public addresses: every resolved address is checked when the connection is made (so DNS rebinding does not help), redirects are not followed, and payloads are signed with a per-webhook secret that is shown once. `WEBHOOK_ALLOW_PRIVATE=1` lifts the address check for receivers on your own network.
- **Exports** (board JSON and CSV, the admin full export) never contain password hashes, TOTP secrets, recovery codes, API token hashes or webhook secrets. CSV cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets do not run them as formulas.
- **Imports** are size limited (`IMPORT_MAX_MB`) while they are read, validated against a schema, and create new boards owned by the importing user.
- **Offline data**: the service worker caches pages per signed-in user and deletes other users' caches on login, logout and user switch; API responses and live streams are never cached. See [docs/OFFLINE.md](docs/OFFLINE.md).

Known limits:

- The **backup** (`/api/admin/backup`) is a copy of the whole database, including password hashes, encrypted TOTP secrets, webhook secrets and token hashes. Treat backup files like the database itself.
- The audit log and rate limits rely on the client address from `X-Forwarded-For` (see `TRUSTED_PROXIES` below). Without a reverse proxy a client can choose that header; the per-username limit still applies.
- Users who can import a board (any member) can name other users as members and comment authors in the imported file, as the format is also used to move boards between instances.

## Hardening checklist for operators

1. **Serve Kanbun over HTTPS only**, behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS. Set `NEXTAUTH_URL` (or `AUTH_URL`) to the public `https://` URL, so cookies are marked `Secure`. Redirect http to https and send HSTS from the proxy, for example `Strict-Transport-Security: max-age=31536000; includeSubDomains` (add `preload` only if you mean it). Do not publish the container port to the internet directly; bind it to localhost or an internal network.
2. **Set a strong `AUTH_SECRET`**: at least 32 random bytes, for example `openssl rand -base64 32`. It signs sessions and encrypts TOTP secrets. Keep it out of version control. Changing it signs everyone out and makes existing 2FA setups unreadable (admins then reset them).
3. **Forward the client address**: the proxy must append the connecting address to `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, Caddy and Traefik do it by default) and set `X-Forwarded-Proto` and `Host`. Set `TRUSTED_PROXIES` to the number of proxies that do so (default `1`; `2` for a CDN or load balancer in front of nginx). With a wrong value either clients can pick their address or all users share one, which shows up in the audit log.
4. **Back up regularly** (Admin, Backup and export) and store the archives encrypted and access-controlled: they contain everything. Test a restore now and then. With PostgreSQL, use `pg_dump` and copy the attachments folder.
5. **Keep `WEBHOOK_ALLOW_PRIVATE` off** unless webhooks must reach your own network, and then restrict what the Kanbun host can reach with a firewall.
6. **Single sign-on**: enforce MFA in the identity provider, keep `OIDC_ALLOW_SIGNUP` off unless every IdP user should get an account, and enable `OIDC_MATCH_EMAIL` or `OIDC_MATCH_USERNAME` only under the conditions in [docs/SSO.md](docs/SSO.md).
7. **Encourage two-factor authentication** for password accounts, admins first. Keep the number of admins small and deactivate accounts of people who leave.
8. **Upgrade** to new releases promptly; read the changelog in `/whats-new`. Run `npm audit --omit=dev` if you build from source.
9. **Limit request sizes at the proxy** to match `ATTACHMENT_MAX_MB` and `IMPORT_MAX_MB` (nginx: `client_max_body_size`), and keep the proxy's request buffering on.
10. **Protect the data volume**: the SQLite database and attachments live in `/data` in Docker. Restrict who can read the host and its backups.
