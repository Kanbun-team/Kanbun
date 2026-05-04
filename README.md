# Kanbun

Self-hosted task board for teams. Single binary mindset, no external services.

## Features

- Boards, columns, cards with native HTML5 drag-and-drop.
- Subtasks, tags, comments, blocking dependencies, priorities, deadlines.
- Per-board membership with owner/member roles. Admin override.
- User profiles with year-long activity heatmap, latest moves, latest comments.
- Active and recent sessions per user, with web/mobile/desktop detection.
- Online dot driven by a 60s heartbeat. 5-minute online window.
- Light/dark theme + English/Polish UI. Login screen stays English.
- Mobile responsive with hamburger drawer. PWA manifest + safe-area insets.
- Loading skeletons on every data-fetching page.

## Stack

- Next.js 15 (App Router, server components by default)
- TypeScript
- Prisma + SQLite (`file:./dev.db`)
- Auth.js v5 (credentials + JWT sessions, bcrypt)
- Tailwind CSS v3 with `darkMode: "class"`

## Quick start (local)

```bash
cp .env.example .env
# edit AUTH_SECRET to a long random string
npm install
npx prisma migrate deploy
npm run create-admin
npm run dev
```

Visit `http://localhost:3000` and log in.

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
  middleware.ts        protects routes
prisma/
  schema.prisma        SQLite data model
public/
  manifest.webmanifest PWA manifest
  icons/               192/512/maskable SVG icons
scripts/
  create-admin.ts      bootstrap script
```

## Notes

- Schema changes: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`.
- The session heartbeat creates a `panelSessionId` cookie scoped per browser.
- Card moves are logged to `TaskCardMoveEvent` only when the column actually changes.
- Card-to-card blocking is restricted to the same board and prevents self-cycles.

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
- **Commercial license** available for organizations that cannot accept the AGPL network-copyleft clause, or for OEM / SaaS embedding. Contact: **me@mrellwart.com**.

See [LICENSING.md](./LICENSING.md) for the long form.

## Contributing

Contributions go through a Contributor License Agreement so that the project can offer both AGPL and commercial licenses. See [CLA.md](./CLA.md). The CLA assistant bot will prompt you on your first PR.
