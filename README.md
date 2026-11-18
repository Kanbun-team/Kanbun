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
- Search everything with Cmd/Ctrl+K: boards, card titles, descriptions and comments (SQLite FTS5), plus quick commands.
- Board, list and calendar views, saved filters shared with the board, and a "My tasks" page grouped into overdue, today, upcoming and done this week.
- Card history: moves, edits, assignees, tags and dependencies in one timeline with comments; @mention autocomplete; searchable pickers.
- Cards open in a side panel over the board; keyboard shortcuts for common actions (press `?` on a board).
- Live board updates over Server-Sent Events: changes appear for everyone on the board without a refresh, with avatars of who is viewing the board and who has the same card open.
- Checklists with an assignee and due date per item (reorder, convert to card), tags, comments, blocking dependencies, priorities, deadlines.
- File and image attachments on cards, stored next to the database.
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
- Import boards from Trello or Kanbun JSON, import cards from CSV with a preview, export a board as JSON or CSV, and (admins) export everything or download a one-click backup. See [docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md).
- Admin audit log of sign-ins, user and role changes, board deletions, membership changes, imports, exports and backups, with filters and CSV download.
- Accessible by default: WCAG 2.2 AA checked with axe in light and dark themes on every CI run.
- Light, dark and system theme, IBM Plex Sans bundled (no external font requests). UI in English, Polish, German and Italian (see [src/locales](src/locales/README.md) to add a language). Login screen stays English.
- Mobile responsive with hamburger drawer. PWA manifest + safe-area insets.
- Loading skeletons on every data-fetching page.

## Stack

- Next.js 16 (App Router, server components by default)
- TypeScript
- Prisma + SQLite (`file:./dev.db`)
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
- `backup.json`: the Kanbun version and the time of the backup.

The download is recorded in the audit log. It only works with the built-in SQLite database; with another database engine, back up with that engine's tools (for PostgreSQL, `pg_dump`) and copy the attachments folder.

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

- `DATABASE_URL` - SQLite URL, e.g. `file:./dev.db` or `file:/data/kanbun.db`
- `AUTH_SECRET` - long random string used to sign JWT cookies
- `AUTH_TRUST_HOST` - set to `true` when behind a proxy
- `NEXTAUTH_URL` - public URL of the app (also the base for links in emails; `AUTH_URL` works too)
- `SMTP_URL` - optional, enables email notifications, e.g. `smtp://user:pass@smtp.example.com:587` (use `smtps://` for port 465). Without it email is off and the settings page says so.
- `SMTP_FROM` - sender for notification emails, e.g. `Kanbun <kanbun@example.com>`
- `ATTACHMENTS_DIR` - optional folder for card attachments. Defaults to an `attachments` folder next to the SQLite file (`/data/attachments` in Docker, `prisma/attachments` for `file:./dev.db`)
- `ATTACHMENT_MAX_MB` - optional upload limit per file in megabytes, default `10`
- `IMPORT_MAX_MB` - optional size limit for imported files (Trello, Kanbun JSON, CSV) in megabytes, default `20`
- `AUDIT_RETENTION_DAYS` - how long audit log entries are kept, default `365`; `0` keeps them forever
- `TZ` - time zone for repeating card schedules, e.g. `Europe/Warsaw` (the server clock otherwise)
- `API_RATE_LIMIT` - optional, REST API requests per token per minute, default `120`
- `WEBHOOK_ALLOW_PRIVATE` - set to `1` to let webhooks post to private, loopback and link-local addresses (for receivers on your own network). Off by default, so a board owner can not make the server call internal services.
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` - optional single sign-on with an OpenID Connect provider (Authentik, Keycloak, Google Workspace, ...). Further options: `OIDC_SCOPES`, `OIDC_ALLOW_SIGNUP`, `OIDC_ADMIN_GROUP`, `OIDC_MATCH_USERNAME`, `OIDC_DISABLE_PASSWORD`. See [docs/SSO.md](docs/SSO.md).

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
  schema.prisma        SQLite data model
public/
  manifest.webmanifest PWA manifest
  icons/               app icons (PNG + SVG)
scripts/
  create-admin.ts      optional CLI to create or reset an admin
```

## Notes

- Schema changes: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`.
- The session heartbeat creates a `panelSessionId` cookie scoped per browser.
- Card moves are logged to `TaskCardMoveEvent` only when the column actually changes.
- Deleted cards, columns and boards are stored as JSON snapshots in `TrashItem` and restored with their original ids (`src/server/trash.ts`). Items older than 30 days are purged on the next delete.
- Search uses an FTS5 table (`CardSearch`) kept in sync by SQLite triggers (migration `20261118100000_card_search`). Prisma does not model it, so `prisma migrate dev` will propose `DROP TABLE "CardSearch..."` in new migrations: delete those lines. A migration that rebuilds `TaskCard` or `TaskCardComment` must recreate the triggers.
- Server actions return typed results (`{ ok, error }`, see `src/lib/action-result.ts`); the UI turns error codes into translated toasts.
- Card-to-card blocking is restricted to the same board and prevents self-cycles.
- Sessions are JWTs, but the user is re-read from the database on every request, so deactivating or deleting a user, changing a role, or resetting a password applies immediately.
- The admin audit log (`AuditLog`, `/admin/audit`) records security-relevant events through `audit()` in `src/server/audit.ts`. Failed sign-ins record the username that was tried, never the password. Old entries are purged by the `audit-purge` background job.
- Failed logins are rate limited in memory per IP and username. Behind a reverse proxy the client IP comes from `X-Forwarded-For`, so make sure your proxy sets it and do not expose the app directly if you rely on the limit.
- Live updates use an in-process event bus (`src/lib/realtime.ts`) and SSE endpoints at `/api/boards/<id>/events` (a single board) and `/api/boards/events` (the boards list). This is single-process by design; running multiple instances would need an external broker.

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

## License

Kanbun is dual-licensed.

- **AGPL-3.0-only** for open-source / self-hosted use. Full text in [LICENSE](./LICENSE).
- **Commercial license** available for organizations that cannot accept the AGPL network-copyleft clause, or for OEM / SaaS embedding. Contact: **mrsanten@tuta.com**.

See [LICENSING.md](./LICENSING.md) for the long form.

## Contributing

Where the project is heading and the design rules it follows: [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DESIGN.md](docs/DESIGN.md).

Contributions go through a Contributor License Agreement so that the project can offer both AGPL and commercial licenses. See [CLA.md](./CLA.md). The CLA assistant bot will prompt you on your first PR.
