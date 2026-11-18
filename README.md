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
- Live board updates over Server-Sent Events: changes appear for everyone on the board without a refresh.
- Subtasks, tags, comments, blocking dependencies, priorities, deadlines.
- Per-board membership with owner/member roles. Admin override.
- User profiles with year-long activity heatmap, latest moves, latest comments.
- Active and recent sessions per user, with web/mobile/desktop detection.
- Online dot driven by a 60s heartbeat. 5-minute online window.
- Markdown in card descriptions and comments, WIP limits, card covers, board filters.
- In-app notifications for assignments, @mentions and blocked cards.
- Trash with undo: deleted cards, columns and boards can be restored for 30 days.
- Deactivate users instead of deleting them: they can no longer sign in, but their work stays.
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
npm run create-admin
npm run dev
```

Want to look around first? On an empty database, `npm run seed:demo` creates a demo workspace (log in as `admin` / `demo1234`).

Visit `http://localhost:3000` and log in.

Checks (also run in CI):

```bash
npm run lint
npm run typecheck
npm test

# End-to-end and accessibility tests (Playwright + axe) against a production build
npx playwright install chromium   # once
npm run build && npm run test:e2e
```

The e2e suite starts its own server on port 3456 with a throwaway demo database (`prisma/e2e.db`).

## Quick start (Docker)

```bash
cp .env.example .env
# edit AUTH_SECRET
docker compose up -d --build
docker compose exec kanbun npm run create-admin
```

Data persists in the `kanbun-data` volume at `/data/kanbun.db`.

## Bootstrap an admin

```bash
npm run create-admin
```

You will be prompted for username, display name, and password. The script creates an `admin` user with `accessTasks=true`, or upgrades an existing user.

## Environment

- `DATABASE_URL` - SQLite URL, e.g. `file:./dev.db` or `file:/data/kanbun.db`
- `AUTH_SECRET` - long random string used to sign JWT cookies
- `AUTH_TRUST_HOST` - set to `true` when behind a proxy
- `NEXTAUTH_URL` - public URL of the app

## Project layout

```
src/
  app/
    (app)/             authenticated routes
    api/auth/...       Auth.js handlers
    api/session/...    heartbeat
    login/             English-only login screen
  components/          UI building blocks
  lib/                 i18n, locale, prisma client, helpers
  server/              server actions
  auth.ts              Auth.js setup
  proxy.ts             protects routes
prisma/
  schema.prisma        SQLite data model
public/
  manifest.webmanifest PWA manifest
  icons/               app icons (PNG + SVG)
scripts/
  create-admin.ts      bootstrap script
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
