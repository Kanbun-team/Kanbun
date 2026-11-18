# Scaling out: PostgreSQL and Redis

Kanbun runs as a single Node process on SQLite by default, and that is the
right setup for most teams: one container, one file to back up, nothing else to
operate. A single instance comfortably serves dozens of people working on the
same boards at once.

This page is for the cases where one process is not enough:

- you want **more than one instance** behind a load balancer (high
  availability, rolling deploys, more CPU for many concurrent users), or
- your organisation **requires PostgreSQL** (managed backups, replication,
  existing database operations).

Both are optional and independent. PostgreSQL alone (one instance) works. Redis
is only needed when you run several instances.

| Setting | Single instance (default) | Several instances |
| --- | --- | --- |
| `DATABASE_URL` | `file:/data/kanbun.db` (SQLite) | `postgresql://...` |
| `REDIS_URL` | unset | `redis://...` |
| `ATTACHMENTS_DIR` | next to the SQLite file | a volume shared by every instance |

## What each piece does

**PostgreSQL.** The same image runs on either database. At startup
`DATABASE_URL` decides: a `postgres://` or `postgresql://` URL selects
PostgreSQL, anything else SQLite. `npm start` (the container's command) runs
the matching migrations first. Search uses PostgreSQL full-text search with the
`unaccent` extension, so it ignores diacritics like the SQLite build does
("zrodel" finds "źródeł").

**Redis** (`REDIS_URL`) gives the instances one shared view of:

- **Live updates.** Every board change is published on a Redis channel, and each
  instance forwards it to the browsers connected to it. A card moved through
  instance A shows up live for someone whose event stream is on instance B.
- **Presence.** Who is on a board and which card they have open is kept in Redis
  (a hash per board, one entry per open stream, refreshed every 20 seconds and
  dropped after a minute without refresh), so viewers on different instances
  see each other.
- **Rate limits.** Failed-login counters live in Redis, so the limit holds no
  matter which instance a request reaches.
- **Background jobs** (deadline reminders, the daily digest, repeating cards).
  Every instance runs the scheduler, but each run first takes a short Redis lock
  per job, so only one instance does the work.

Redis holds only short-lived state: it needs no persistence and no backups. If
Redis is unreachable, Kanbun keeps working: actions still succeed, live updates
only reach browsers on the same instance, the viewer list stays empty, rate
limits fall back to per-instance counters and background jobs pause until Redis
is back.

Without `REDIS_URL` none of this is loaded and everything stays in process.

**Attachments** are files on disk. Every instance must read and write the same
directory: set `ATTACHMENTS_DIR` to a shared volume (a Docker volume on one
host, NFS or a similar network file system across hosts). Object storage such as
S3 is not supported.

## Setup with Docker Compose

[`docker-compose.postgres.yml`](../docker-compose.postgres.yml) starts
PostgreSQL 16, Redis 7, two Kanbun instances and a Caddy load balancer:

```bash
cat > .env <<'EOF'
AUTH_SECRET=<a long random string, e.g. openssl rand -base64 32>
POSTGRES_PASSWORD=<a strong password>
NEXTAUTH_URL=https://kanban.example.com
EOF
docker compose -f docker-compose.postgres.yml up -d
docker compose -f docker-compose.postgres.yml exec kanbun-1 npm run create-admin
```

Notes for your own setup:

- Every instance needs the same `AUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`,
  `REDIS_URL` and `ATTACHMENTS_DIR`.
- No sticky sessions are needed. The load balancer must not buffer responses
  of type `text/event-stream` (Caddy and Traefik do not; for nginx Kanbun sends
  `X-Accel-Buffering: no`) and should allow long-lived connections.
- Set `X-Forwarded-For` at the load balancer: the login rate limit is per client
  IP.
- The database user must be allowed to `CREATE EXTENSION unaccent` once (the
  first migration does it). It is a trusted extension since PostgreSQL 13, so the
  database owner can create it; on managed services enable it if asked.
- PostgreSQL 13 or newer is supported (CI runs 16). Redis 6.2 or newer.
- Several Kanbun deployments can share one Redis: give each its own
  `KANBUN_REDIS_PREFIX` (default `kanbun:`).
- Instances apply migrations on start. Prisma takes a database lock, so
  starting several at once is safe.

## Moving from SQLite to PostgreSQL

`scripts/sqlite-to-postgres.ts` copies every table of a SQLite database into a
new PostgreSQL database in foreign-key order, inside one transaction, then
compares the row counts of both. It refuses to write into a database that
already has data.

1. Update to the latest Kanbun on SQLite first and start it once, so the SQLite
   database has every migration.
2. Stop Kanbun (no writes during the copy) and back up the SQLite file.
3. Create an empty PostgreSQL database and apply the migrations:
   ```bash
   DATABASE_URL=postgresql://kanbun:secret@db:5432/kanbun node scripts/db.mjs deploy
   ```
4. Check what will be copied (writes nothing):
   ```bash
   npm run db:sqlite-to-postgres -- --from file:/data/kanbun.db \
     --to postgresql://kanbun:secret@db:5432/kanbun --dry-run
   ```
5. Copy:
   ```bash
   npm run db:sqlite-to-postgres -- --from file:/data/kanbun.db \
     --to postgresql://kanbun:secret@db:5432/kanbun
   ```
   It prints the rows per table and finishes with `row counts match`. The search
   index fills itself while rows are inserted.
6. Copy the attachments folder (by default `attachments/` next to the SQLite
   file, `/data/attachments` in Docker) to the directory you set as
   `ATTACHMENTS_DIR`.
7. Start Kanbun with the PostgreSQL `DATABASE_URL`.

With Docker, run the script inside the Kanbun container, which has the SQLite
volume mounted, e.g.
`docker compose run --rm -e DATABASE_URL=postgresql://... kanbun npm run db:sqlite-to-postgres -- --from file:/data/kanbun.db --dry-run`
(`--to` defaults to `DATABASE_URL`). A relative `file:` path starts in
`prisma/`, as in `DATABASE_URL`. Sessions stay valid: they depend on
`AUTH_SECRET`, not on the database.

## For contributors: one schema, two databases

`prisma/schema.prisma` (SQLite) is the source of truth. Everything for
PostgreSQL is generated from it:

- `prisma/postgres/schema.prisma`: the same models with the `postgresql`
  provider, written by `npm run db:pg:generate-schema` (also run by
  `npm run build`). Never edit it by hand.
- `prisma/postgres/migrations/`: PostgreSQL's own migration history.
- `prisma/postgres/search.sql`: the hand-written search objects (the
  `CardSearch` table, its triggers and the `kanbun_search` text search
  configuration).

The build generates both Prisma clients (`node scripts/db.mjs generate`): the
SQLite one in the default `node_modules/.prisma/client`, the PostgreSQL one in
`node_modules/.prisma/client-postgres`. `src/lib/db-local.ts` loads one at
startup based on `DATABASE_URL`; Next.js keeps the PostgreSQL client external
(`serverExternalPackages` in `next.config.mjs`). Code imports types from
`@prisma/client` as usual. For raw SQL use `DbPrisma.sql` from
`src/lib/db-local.ts` (not `Prisma.sql` from `@prisma/client`) and branch on
`isPostgres()` where the SQL differs, as `src/server/search-actions.ts` does.
For user-facing text filters use `textFilter("contains", value)` from
`src/lib/db-provider.ts`: SQLite's `contains` ignores ASCII case, PostgreSQL's
does not unless asked.

### Adding a migration

1. Edit `prisma/schema.prisma` and create the SQLite migration as before
   (`npx prisma migrate dev --create-only --name <change>` on a scratch database,
   removing the `CardSearch` lines Prisma proposes).
2. Create the PostgreSQL migration:
   - **Until v1.0 is released** (no PostgreSQL install exists yet), regenerate
     the single baseline instead:
     ```bash
     npm run db:pg:baseline
     ```
   - **After v1.0**, add a migration. It needs a scratch PostgreSQL database that
     Prisma may wipe:
     ```bash
     PG_SHADOW_DATABASE_URL=postgresql://kanbun:pw@localhost:5432/kanbun_shadow \
       npm run db:pg:migration -- <change>
     ```
     It writes `prisma/postgres/migrations/<timestamp>_<change>/migration.sql`
     with the search statements stripped. Once the first release with PostgreSQL
     has shipped, `db:pg:baseline` refuses to run if other migrations exist.
3. If your change touches `TaskCard.title`, `TaskCard.description` or
   `TaskCardComment.body`, check the search triggers on both databases.
4. Commit both migrations and the regenerated `prisma/postgres/schema.prisma`.

Checks: `npm test` fails when `prisma/postgres/schema.prisma` is out of date or
the baseline misses a table, and the PostgreSQL CI job migrates a real database
and runs `node scripts/gen-postgres-schema.mjs --check-db`, which fails when a
PostgreSQL migration is missing.

### Running the tests on PostgreSQL

```bash
docker run -d --name kanbun-pg -p 55432:5432 -e POSTGRES_PASSWORD=pw postgres:16
docker run -d --name kanbun-redis -p 56379:6379 redis:7
npm run build
E2E_POSTGRES_URL=postgresql://postgres:pw@localhost:55432/kanbun_e2e \
REDIS_URL=redis://localhost:56379 E2E_SCALE_OUT=1 npx playwright test
TEST_REDIS_URL=redis://localhost:56379 npm test
```

`E2E_POSTGRES_URL` makes `scripts/e2e-serve.sh` recreate that database (and
`<name>_setup` for the first-run tests). `E2E_SCALE_OUT=1` starts a second
instance on the same database and Redis for `e2e/scale-out.spec.ts`, which
checks presence and live updates across instances.
