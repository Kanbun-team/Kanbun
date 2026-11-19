<div align="center">

<img src="public/icons/kanbun-512.png" alt="Kanbun" width="128" height="128" />

# Kanbun

**Self-hosted task board for teams. Single binary mindset, no external services.**

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-blue.svg)](LICENSE)
[![Commercial license](https://img.shields.io/badge/commercial-available-brightgreen.svg)](LICENSING.md)
[![CI](https://github.com/Kanbun-team/Kanbun/actions/workflows/ci.yml/badge.svg)](https://github.com/Kanbun-team/Kanbun/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Kanbun-team/Kanbun?include_prereleases&sort=semver)](https://github.com/Kanbun-team/Kanbun/releases)
[![GHCR](https://img.shields.io/badge/ghcr.io-kanbun-2496ED?logo=docker&logoColor=white)](https://github.com/Kanbun-team/Kanbun/pkgs/container/kanbun)
[![Stars](https://img.shields.io/github/stars/Kanbun-team/Kanbun?style=flat)](https://github.com/Kanbun-team/Kanbun/stargazers)

</div>

![Kanbun board view](docs/screenshot.png)

## Features

- Boards, columns and cards with drag and drop that works with a mouse, on touch screens (long-press) and with the keyboard (Space, arrows), with screen-reader announcements. Every card also has a "Move to" action.
- Search everything with Cmd/Ctrl+K: boards, card titles, descriptions and comments (SQLite FTS5 or PostgreSQL full-text search), plus quick commands.
- Board, list and calendar views, saved filters shared with the board, and a "My tasks" page grouped into overdue, today, upcoming and done this week.
- Swimlanes: group the board into rows by assignee, priority or tag (`?group=` in the URL). Drag a card, or move it with the keyboard (Shift+Up/Down while moving), into another lane to change its assignee, priority or tag. A card with several assignees or tags is moved from the first lane it belongs to and shows a read-only copy in the others. WIP limits still count the whole column.
- Card history: moves, edits, assignees, tags and dependencies in one timeline with comments; @mention autocomplete; searchable pickers.
- Cards open in a side panel over the board; keyboard shortcuts for common actions (press `?` on a board).
- Live board updates over Server-Sent Events: changes appear for everyone on the board without a refresh, with avatars of who is viewing the board and who has the same card open.
- Checklists with an assignee and due date per item (reorder, convert to card), tags, comments, blocking dependencies, priorities, deadlines.
- File and image attachments on cards, stored next to the database or in S3-compatible object storage. Large images get a small WebP preview (480px wide) made on the server and stored next to the original.
- Per-board membership with owner/member roles. Admin override.
- User profiles with year-long activity heatmap, latest moves, latest comments.
- Active and recent sessions per user, with web/mobile/desktop detection.
- Online dot driven by a 60s heartbeat. 5-minute online window.
- Markdown in card descriptions and comments, WIP limits, card covers, board filters.
- Notifications for assignments, @mentions, blocked cards and watched cards and boards, each set to in-app, in-app + email (optional SMTP) or off, with an optional daily digest.
- Trash with undo: deleted cards, columns and boards can be restored for 30 days.
- Card templates (title, description, priority, tags, checklist) and repeating cards ("Every Monday", "Monthly on the 1st") per board.
- REST API with personal access tokens (read or read and write, optional expiry), an OpenAPI 3.1 description, and signed outgoing webhooks per board. See [docs/API.md](docs/API.md).
- First-run setup in the browser and built-in board templates (Simple, Software, Personal).
- Deactivate users instead of deleting them: they can no longer sign in, but their work stays.
- Single sign-on with any OpenID Connect provider (Authentik, Keycloak, Google Workspace) alongside passwords, and optional two-factor authentication (TOTP with recovery codes) for password accounts. See [docs/SSO.md](docs/SSO.md).
- Runs on SQLite by default; PostgreSQL and Redis let several instances run behind a load balancer. See [docs/SCALING.md](docs/SCALING.md).
- Security headers with a nonce-based Content Security Policy, rate-limited sign-in, and an operator checklist in [SECURITY.md](SECURITY.md).
- Import boards from Trello or Kanbun JSON, import cards from CSV with a preview, export a board as JSON or CSV, and (admins) export everything or download a one-click backup. See [docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md).
- Admin audit log of sign-ins, user and role changes, board deletions, membership changes, imports, exports and backups, with filters and CSV download.
- Accessible by default: WCAG 2.2 AA checked with axe in light and dark themes on every CI run, Lighthouse accessibility 100 on every main page.
- Fast on big boards: a 500-card board loads in about half a second ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- Light, dark and system theme, IBM Plex Sans bundled (no external font requests). UI in English, Polish, German, Italian, French, Spanish, Brazilian Portuguese, Dutch, Czech and Ukrainian (see [src/locales](src/locales/README.md) to add a language); the login screen follows the browser language.
- Mobile responsive with hamburger drawer and safe-area insets. Installable PWA that works offline: boards opened before stay readable, and card edits made offline sync when the connection returns ([docs/OFFLINE.md](docs/OFFLINE.md)).
- Loading skeletons on every data-fetching page.

## Stack

- Next.js 16 (App Router, server components by default)
- TypeScript
- Prisma + SQLite (`file:./dev.db`) by default, PostgreSQL and Redis optional for running several instances ([docs/SCALING.md](docs/SCALING.md))
- Auth.js v5 (credentials + JWT sessions, bcrypt)
- React 19, Tailwind CSS v3 with `darkMode: "class"`

## Quick start (local)

```bash
cp .env.example .env
# edit AUTH_SECRET to a long random string
npm install
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`. On a new database Kanbun opens the first-run setup: create the admin account, then pick a first board (Simple, Software, Personal or blank).

Want to look around first? On an empty database, `npm run seed:demo` creates a demo workspace instead (log in as `admin` / `demo1234`).

Checks (also run in CI):

```bash
npm run lint
npm run typecheck
npm test

# End-to-end and accessibility tests (Playwright + axe) against a production build
npx playwright install chromium   # once
npm run build && npm run test:e2e
```

The e2e suite starts its own server on port 3456 with a throwaway demo database (`prisma/e2e.db`), plus a second one on port 3457 with an empty database (`prisma/e2e-setup.db`) for the first-run setup test. Set `E2E_PORT` to move both.

## Quick start (Docker)

```bash
cp .env.example .env
# edit AUTH_SECRET
docker compose up -d --build
```

Then open the app in your browser (`http://localhost:3000` by default). The first visit shows the setup screen: create the admin account and your first board. Setup is only available while the database has no users.

Data persists in the `kanbun-data` volume at `/data/kanbun.db`. Card attachments are stored next to the database in `/data/attachments`, so the same volume keeps them; back up the whole `/data` folder, not only the database file (or use the one-click backup below).

## Backup and restore

Admins can download a backup from **Admin > Backup and export > Download backup**. It is a `.tar.gz` with:

- `kanbun.db`: a consistent snapshot of the SQLite database, made with `VACUUM INTO` while Kanbun keeps running,
- `attachments/`: every attachment file,
- `backup.json`: the Kanbun version, the time of the backup and where attachments are stored.

The download is recorded in the audit log. It only works with the built-in SQLite database; with another database engine, back up with that engine's tools (for PostgreSQL, `pg_dump`) and copy the attachments folder.

With attachments in S3 (see [Attachments in S3](#attachments-in-s3)) the archive holds the database only: `backup.json` says the files are in S3 and not included (`"attachmentStorage": { "type": "s3", "included": false, ... }`), and the admin page shows the same note. Back up the bucket with your provider's tools (versioning, replication or a scheduled bucket copy).

To restore a backup into the Docker setup:

```bash
docker compose stop kanbun
mkdir restore && tar -xzf kanbun-backup-<date>.tar.gz -C restore
# copy the files into the kanbun-data volume, replacing what is there
docker run --rm -v kanbun_kanbun-data:/data -v "$PWD/restore":/restore alpine \
  sh -c 'rm -rf /data/kanbun.db /data/kanbun.db-journal /data/kanbun.db-wal /data/kanbun.db-shm /data/attachments && cp -a /restore/kanbun.db /restore/attachments /data/'
docker compose start kanbun
```

(The volume is usually named `<project>_kanbun-data`; `docker volume ls` shows it.) Without Docker, stop Kanbun, replace the database file named in `DATABASE_URL` and the attachments folder (`ATTACHMENTS_DIR`, or `attachments` next to the database) with the ones from the archive, and start it again. Migrations run on start, so a backup from an older version is upgraded automatically; do not restore a backup into an older version than the one that made it.

Boards can also be moved between instances with the JSON export and import, see [docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md).

## Admin from the command line (optional)

You don't need this for a new install, the browser setup creates the first admin. The script is still there for headless installs and for recovering access:

```bash
npm run create-admin
# or, in Docker:
docker compose exec kanbun npm run create-admin
```

You will be prompted for username, display name, and password. The script creates an `admin` user, or upgrades an existing user to admin and resets their password (and, if they have two-factor authentication on, offers to turn it off).

## Environment

- `DATABASE_URL` - SQLite URL, e.g. `file:./dev.db` or `file:/data/kanbun.db`, or a PostgreSQL URL (`postgresql://user:pass@host:5432/kanbun`, see [docs/SCALING.md](docs/SCALING.md))
- `REDIS_URL` - optional, e.g. `redis://redis:6379`. Needed only to run several instances behind a load balancer: shares live updates, presence, rate limits and job locks between them. `KANBUN_REDIS_PREFIX` sets the key prefix (default `kanbun:`)
- `AUTH_SECRET` - long random string used to sign JWT cookies
- `AUTH_TRUST_HOST` - set to `true` when behind a proxy
- `NEXTAUTH_URL` - public URL of the app (also the base for links in emails; `AUTH_URL` works too)
- `SMTP_URL` - optional, enables email notifications, e.g. `smtp://user:pass@smtp.example.com:587` (use `smtps://` for port 465). Without it email is off and the settings page says so.
- `SMTP_FROM` - sender for notification emails, e.g. `Kanbun <kanbun@example.com>`
- `ATTACHMENTS_DIR` - optional folder for card attachments. Defaults to an `attachments` folder next to the SQLite file (`/data/attachments` in Docker, `prisma/attachments` for `file:./dev.db`). Set it with PostgreSQL, and point every instance at the same shared volume, or use S3 instead
- `ATTACHMENTS_S3_BUCKET` - optional: store attachments in this S3-compatible bucket instead of on disk (AWS S3, MinIO, Cloudflare R2, Backblaze B2). Uses `ATTACHMENTS_S3_ACCESS_KEY_ID` and `ATTACHMENTS_S3_SECRET_ACCESS_KEY` (plus `ATTACHMENTS_S3_SESSION_TOKEN` for temporary keys), or without them the AWS credential chain (`AWS_*` variables, EKS web identity, ECS or EC2 roles); further options `ATTACHMENTS_S3_REGION` (default `us-east-1`; `auto` for R2), `ATTACHMENTS_S3_ENDPOINT` (for anything but AWS, e.g. `http://minio:9000`), `ATTACHMENTS_S3_FORCE_PATH_STYLE` (`1` or `0`; defaults to on when an endpoint is set) and `ATTACHMENTS_S3_PREFIX` (a folder inside the bucket). See [Attachments in S3](#attachments-in-s3)
- `ATTACHMENT_MAX_MB` - optional upload limit per file in megabytes, default `10`
- `IMPORT_MAX_MB` - optional size limit for imported files (Trello, Kanbun JSON, CSV) in megabytes, default `20`
- `AUDIT_RETENTION_DAYS` - how long audit log entries are kept, default `365`; `0` keeps them forever
- `TZ` - time zone for repeating card schedules, e.g. `Europe/Warsaw` (the server clock otherwise)
- `API_RATE_LIMIT` - optional, REST API requests per token per minute, default `120`
- `TRUSTED_PROXIES` - number of reverse proxies in front of Kanbun that append to `X-Forwarded-For`, default `1`. The client address for rate limits and the audit log is read that many entries from the right, so clients can not choose it. Set `2` behind a CDN plus nginx, for example. See [SECURITY.md](SECURITY.md)
- `WEBHOOK_ALLOW_PRIVATE` - set to `1` to let webhooks post to private, loopback and link-local addresses (for receivers on your own network). Off by default, so a board owner can not make the server call internal services.
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` - optional single sign-on with an OpenID Connect provider (Authentik, Keycloak, Google Workspace, ...). Further options: `OIDC_SCOPES`, `OIDC_ALLOW_SIGNUP`, `OIDC_ADMIN_GROUP`, `OIDC_MATCH_USERNAME`, `OIDC_MATCH_EMAIL`, `OIDC_DISABLE_PASSWORD`. See [docs/SSO.md](docs/SSO.md).

### Attachments in S3

By default attachment files live on the local disk. Set `ATTACHMENTS_S3_BUCKET` and the keys to keep them in an S3-compatible bucket instead, which is the easiest way to share them between several instances ([docs/SCALING.md](docs/SCALING.md)). The bucket stays private: downloads still go through Kanbun, which checks board access and streams the file with the same headers as from disk, so no public bucket policy or presigned URLs are needed.

```bash
# AWS S3
ATTACHMENTS_S3_BUCKET=kanbun-attachments
ATTACHMENTS_S3_REGION=eu-central-1
ATTACHMENTS_S3_ACCESS_KEY_ID=AKIA...
ATTACHMENTS_S3_SECRET_ACCESS_KEY=...
# MinIO: add the endpoint (path-style addressing is used automatically)
ATTACHMENTS_S3_ENDPOINT=http://minio:9000
# Cloudflare R2: ATTACHMENTS_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com and ATTACHMENTS_S3_REGION=auto
# Backblaze B2: ATTACHMENTS_S3_ENDPOINT=https://s3.<region>.backblazeb2.com and ATTACHMENTS_S3_REGION=<region>
```

The keys need `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the bucket (or prefix), plus `s3:ListBucket` so a missing file answers 404 rather than 403. Kanbun signs requests itself (AWS Signature Version 4, no AWS SDK). A misconfigured bucket is reported in the log at startup.

Temporary credentials work too. Add `ATTACHMENTS_S3_SESSION_TOKEN` to static keys that come with a session token. Or leave both `ATTACHMENTS_S3_ACCESS_KEY_ID` and `ATTACHMENTS_S3_SECRET_ACCESS_KEY` unset, and Kanbun looks for credentials the way the AWS SDKs do, in this order:

1. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN`.
2. Web identity, as on EKS with IAM roles for service accounts: `AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN` (optional `AWS_ROLE_SESSION_NAME`), exchanged with STS `AssumeRoleWithWebIdentity` at the regional endpoint of `AWS_REGION` when set.
3. Container credentials, as on ECS or with EKS Pod Identity: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or `AWS_CONTAINER_CREDENTIALS_FULL_URI`, with `AWS_CONTAINER_AUTHORIZATION_TOKEN` or `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` when set.
4. The EC2 instance role, from instance metadata (IMDSv2, one-second timeouts). `AWS_EC2_METADATA_DISABLED=true` skips it.

Temporary credentials are cached and fetched again five minutes before they expire. Config and credential files in `~/.aws` and SSO profiles are not read.

To move existing attachments from the disk to the bucket, set the `ATTACHMENTS_S3_*` variables and run, with Kanbun stopped or before switching:

```bash
npm run attachments:to-s3 -- --dry-run    # counts what it would copy
npm run attachments:to-s3                 # copies; run again to resume, existing objects are skipped
# Docker: docker compose run --rm -e ATTACHMENTS_S3_BUCKET=... kanbun npm run attachments:to-s3
```

`--from <folder>` picks another source folder (by default `ATTACHMENTS_DIR`, or `attachments` next to the SQLite database). The local files are left in place; delete them once Kanbun runs on S3 and downloads work.

### Single sign-on and two-factor authentication

Kanbun can sign people in through your identity provider (OpenID Connect) alongside passwords, and password accounts can turn on two-factor authentication with an authenticator app in Settings (with single-use recovery codes; admins can reset it from the users page). Setup for Authentik, Keycloak and Google Workspace, the account linking rules, the break-glass admin login and the 2FA details are in [docs/SSO.md](docs/SSO.md). The TOTP secrets are encrypted with a key derived from `AUTH_SECRET`, so changing `AUTH_SECRET` requires resetting existing 2FA setups.

### Notifications

People get notified when they are assigned, mentioned or their card gets blocked, and about cards and boards they watch: new comments, moves to another column and approaching deadlines (due today or tomorrow) for watched cards, new cards for watched boards. You watch a card automatically when you create it, comment on it or are assigned to it; the "Watch" button in the card and board header toggles it by hand. You are never notified about your own actions, and one event gives at most one notification per person (the most specific reason wins, e.g. a mention over a comment).

In Settings, under "Notifications", each type is set to one of: **In-app** (default), **In-app + email** (email always comes with the in-app notification) or **Off**. Email needs `SMTP_URL` and an email address in your settings. The **Daily digest** (off by default) emails once a day a summary of new notifications you have not read. Emails are sent in the background; a failing SMTP server is logged and never blocks the action.

## Project layout

```
src/
  app/
    (app)/             authenticated routes
    api/auth/...       Auth.js handlers
    api/v1/...         REST API (docs/API.md, docs/openapi.json)
    api/session/...    heartbeat
    login/             English-only login screen
    setup/             first-run setup (admin account, first board)
  components/          UI building blocks
  lib/                 i18n, locale, prisma client, helpers
  server/              server actions
  server/jobs/         background jobs (recurring cards)
  auth.ts              Auth.js setup
  proxy.ts             protects routes
prisma/
  schema.prisma        data model (SQLite, the source of truth)
  postgres/            generated PostgreSQL schema, its migrations and search SQL
public/
  manifest.webmanifest PWA manifest
  sw.js                service worker (offline support)
  icons/               app icons (PNG + SVG)
scripts/
  create-admin.ts      optional CLI to create or reset an admin
  db.mjs               generate clients / migrate for the database in DATABASE_URL
  sqlite-to-postgres.ts copy a SQLite install into PostgreSQL
  seed-large.ts        a 500-card board for performance testing (npm run seed:large)
  perf-board.ts        measures that board on a production build
```

## Notes

- Schema changes: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`, and create the PostgreSQL migration too (`npm run db:pg:baseline` or `npm run db:pg:migration -- <change>`, see [docs/SCALING.md](docs/SCALING.md#adding-a-migration)).
- The session heartbeat creates a `panelSessionId` cookie scoped per browser.
- Card moves are logged to `TaskCardMoveEvent` only when the column actually changes.
- Deleted cards, columns and boards are stored as JSON snapshots in `TrashItem` and restored with their original ids (`src/server/trash.ts`). Items older than 30 days are purged on the next delete.
- Search uses an FTS5 table (`CardSearch`) kept in sync by SQLite triggers (migration `20261118100000_card_search`). Prisma does not model it, so `prisma migrate dev` will propose `DROP TABLE "CardSearch..."` in new migrations: delete those lines. A migration that rebuilds `TaskCard` or `TaskCardComment` must recreate the triggers.
- Server actions return typed results (`{ ok, error }`, see `src/lib/action-result.ts`); the UI turns error codes into translated toasts.
- Card-to-card blocking is restricted to the same board and prevents self-cycles.
- Sessions are JWTs, but the user is re-read from the database on every request, so deactivating or deleting a user, changing a role, or resetting a password applies immediately.
- The admin audit log (`AuditLog`, `/admin/audit`) records security-relevant events through `audit()` in `src/server/audit.ts`. Failed sign-ins record the username that was tried, never the password. Old entries are purged by the `audit-purge` background job.
- Failed logins are rate limited per IP and username, and per username across all addresses (in memory, or in Redis when `REDIS_URL` is set). The client IP is the entry `TRUSTED_PROXIES` positions from the right of `X-Forwarded-For`, so put Kanbun behind a reverse proxy that appends to it. The security model and an operator hardening checklist are in [SECURITY.md](SECURITY.md).
- Pages are served with a nonce-based Content-Security-Policy (`src/lib/csp.ts`, set in `src/proxy.ts`); other security headers are in `next.config.mjs`.
- Offline support needs HTTPS (or localhost) and an uncached `/sw.js`; see [docs/OFFLINE.md](docs/OFFLINE.md) for what is stored in the browser and when it is deleted.
- Performance: the 500-card board budget, how to measure it and the rules that keep the board fast (memoized columns and cards, stable handlers) are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). `E2E_PERF=1 npx playwright test e2e/perf.spec.ts` runs the performance guard.
- Live updates use an in-process event bus (`src/lib/realtime.ts`) and SSE endpoints at `/api/boards/<id>/events` (a single board) and `/api/boards/events` (the boards list). In process by default; with `REDIS_URL` events go through Redis pub/sub so every instance delivers them ([docs/SCALING.md](docs/SCALING.md)).

## Pro modules (optional)

Kanbun supports drop-in proprietary modules distributed as separate npm packages named `@kanbun/pro-*`. The community edition runs without them. To enable Pro:

1. `npm install @kanbun/pro-<module>` (requires a Pro license, sold separately).
2. Set `KANBUN_LICENSE_KEY` in your environment.
3. Restart the server. The footer badge switches from `Community` to `Pro`.

Plugin contract lives in [src/lib/plugins.ts](src/lib/plugins.ts). Each Pro package's default export must implement:

```ts
export default {
  id: "string-id",
  name: "Display name",
  version: "1.0.0",
  init: async () => { /* register routes, server actions, jobs, etc. */ },
};
```

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability (privately, through GitHub security advisories), the security model and a hardening checklist for operators.

## License

Kanbun is dual-licensed.

- **AGPL-3.0-only** for open-source / self-hosted use. Full text in [LICENSE](./LICENSE).
- **Commercial license** available for organizations that cannot accept the AGPL network-copyleft clause, or for OEM / SaaS embedding. Contact: **mrsanten@tuta.com**.

See [LICENSING.md](./LICENSING.md) for the long form.

## Contributing

Where the project is heading and the design rules it follows: [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DESIGN.md](docs/DESIGN.md).

Contributions go through a Contributor License Agreement so that the project can offer both AGPL and commercial licenses. See [CLA.md](./CLA.md). The CLA assistant bot will prompt you on your first PR.
