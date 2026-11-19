# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- French, Spanish, Brazilian Portuguese, Dutch, Czech and Ukrainian UI, complete with plural forms and informal address (tu, tú, você, je, ty) ([#2](https://github.com/Kanbun-team/Kanbun/issues/2), [#3](https://github.com/Kanbun-team/Kanbun/issues/3), [#7](https://github.com/Kanbun-team/Kanbun/issues/7), [#8](https://github.com/Kanbun-team/Kanbun/issues/8), [#6](https://github.com/Kanbun-team/Kanbun/issues/6), [#5](https://github.com/Kanbun-team/Kanbun/issues/5)). Browsers set to any variant of these languages get the login screen in that language.
- CSV import understands the French, Spanish and Portuguese priority names.
- Image attachments get a small WebP thumbnail (480px wide, without EXIF or location data) made on the server when they are uploaded and stored next to the original, on disk or in S3. The card panel loads the thumbnail and opens the original on click. Images uploaded before get theirs the first time they are shown; GIFs and images already small enough are shown as they are.

### Changed

- The language picker in Settings names each language in that language (Deutsch, Français, ...).
- Languages are listed in one place (`LOCALES` and `LOCALE_INFO` in `src/lib/i18n.ts`); the settings validation, the picker and browser language detection follow it. In-app release notes need English only, other languages fall back to it.
- Monthly repeat summaries write the day as "5." only in German, Polish and Czech.
- `sharp` is a direct dependency (it was installed as an optional dependency of Next.js). Without it, images are shown at full size as before.
- `npm run attachments:to-s3` copies thumbnails along with the original files.

## [1.2.0] - 2026-11-19

Closes the last gaps listed after v1.1.

### Added

- S3 attachment storage accepts temporary credentials: `ATTACHMENTS_S3_SESSION_TOKEN`, or without static keys the AWS credential chain (`AWS_*` variables, EKS web identity, ECS container credentials, EC2 instance role), cached and refreshed before they expire.
- The REST API accepts an optional `Idempotency-Key` header when adding a comment, so a retried request returns the first comment instead of adding another ([docs/API.md](docs/API.md)).

### Changed

- Clearing a filter on a 500-card board takes 64ms at 2x CPU throttling (was 136ms): cards off screen skip style, layout and paint ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- CI runs the PostgreSQL and Redis end-to-end job with attachments stored in MinIO.

### Fixed

- A comment sent again after the connection dropped (from the comment box or the offline queue) is no longer posted twice.
- Checklist ticks and comments made offline in the card panel update the board card's checklist badge and comment count right away, not only after syncing.
- The "could not reach the server" message no longer claims nothing was saved, since the change may have reached the server before the connection dropped.

## [1.1.0] - 2026-11-18

Closes the gaps listed after v1.0.

### Added

- Card details are readable offline: cards you opened, and a compact copy of every card on boards you opened, are kept in the browser. Title, priority, deadline, assignees, tags, checklist ticks and new comments made offline are queued and sync on reconnect ([docs/OFFLINE.md](docs/OFFLINE.md)).
- S3-compatible storage for attachments (AWS S3, MinIO, Cloudflare R2, Backblaze B2) with `ATTACHMENTS_S3_*` settings and `npm run attachments:to-s3` to copy existing files.

### Changed

- Webhook deliveries are stored in the database and sent by a background job, so a restart or another instance picks up pending ones. Delivery is at least once; use the `X-Kanbun-Delivery` id to skip duplicates.
- Picking up a card and clearing a filter on large boards are about twice as fast ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- German uses informal "du" throughout, Italian says "card" everywhere, and Polish pronouns are lowercase mid-sentence.

### Fixed

- nodemailer is upgraded to version 10; `npm audit` reports no vulnerabilities.
- The board's page title comes back after closing the card panel.
- Focus stays on a saved filter after renaming it.
- `npm run db:pg:migration` names new PostgreSQL migrations so they always sort after existing ones.

### Upgrade notes

- New webhook columns are added automatically on start; existing deliveries are kept as history.

## [1.0.0] - 2026-11-18

Phase 5 of the [roadmap](docs/ROADMAP.md): the platform release. Kanbun is now considered stable.

### Added

- REST API under `/api/v1` with personal access tokens (read-only or read and write, optional expiry, revocable in Settings), cursor pagination, per-token rate limits and an OpenAPI 3.1 description ([docs/API.md](docs/API.md)).
- Webhooks per board, signed with HMAC-SHA256, retried, switched off after repeated failures, with a test button and recent deliveries. Private network addresses are blocked unless `WEBHOOK_ALLOW_PRIVATE=1`.
- Import from Trello or Kanbun JSON as a new board, CSV import into a board with a preview, board export as JSON or CSV, a full export for admins and a one-click backup (database snapshot plus attachments) on SQLite ([docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md)).
- Admin audit log of sign-ins, user and role changes, deletions, membership changes, tokens, imports, exports and backups, with filters and CSV download. Kept for 365 days (`AUDIT_RETENTION_DAYS`).
- Single sign-on with OpenID Connect (Authentik, Keycloak, Google Workspace and others) alongside passwords, with account linking in Settings and optional admin group mapping ([docs/SSO.md](docs/SSO.md)).
- Two-factor authentication with an authenticator app for password accounts, with recovery codes; admins can reset it.
- PostgreSQL support and Redis for live updates, presence, rate limits and background jobs, so several instances can run behind a load balancer. SQLite stays the default. Includes a SQLite to PostgreSQL copy script ([docs/SCALING.md](docs/SCALING.md)).
- Works offline: boards you opened before stay readable, and moves, renames and other board edits made offline sync when the connection returns ([docs/OFFLINE.md](docs/OFFLINE.md)).
- Card actions in the command palette (move, assign to me, set priority) and "New card" on the current board.
- Rename saved filters.
- Notifications when you are given a checklist item; pasting several cards sends one notification; move notifications name the column.
- Teammates' new cards are highlighted on the board too.
- Page titles name the board, card or page.
- The login and setup screens follow the browser language.
- A security policy with an operator checklist ([SECURITY.md](SECURITY.md)).

### Changed

- A 500-card board loads in about half a second and drag and drop responds much faster ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- Security headers on every page, including a nonce-based Content Security Policy.
- Avatar URLs must use https.
- Pinned boards appear only under Pinned on the boards page.
- Counts use proper plural forms in every language.
- The `card.moved` webhook fires only when a card changes column; reordering within a column sends `card.updated`. Deleting a column sends `card.deleted` for each of its cards.
- Admin password resets also revoke the user's API tokens.
- Expired trash is purged daily, with the history of purged cards.

### Fixed

- Sign-in rate limits could be bypassed by sending a forged `X-Forwarded-For` header. The client address is now read from the right, counting `TRUSTED_PROXIES` (default 1), and there is also a per-username limit.
- Login no longer answers faster for usernames that do not exist.
- The offline cache no longer stores the settings and admin pages.
- Rounded corners on the calendar view.

### Upgrade notes

- New tables and columns are created automatically on start.
- Behind more than one reverse proxy (for example a CDN plus nginx), set `TRUSTED_PROXIES` to the number of proxies. Run Kanbun behind a reverse proxy that appends to `X-Forwarded-For`, see [SECURITY.md](SECURITY.md).
- SSO linking by email is off unless `OIDC_MATCH_EMAIL=true`, because users can set their own email.
- Webhook receivers that used `card.moved` for reordering within a column should listen for `card.updated`.

## [0.6.0] - 2026-11-18

Phase 4 of the [roadmap](docs/ROADMAP.md): team and collaboration.

### Added

- Presence: avatars of the people viewing a board in its header, "also viewing this card" in the card panel, a small marker on cards someone else has open, and a soft highlight when a teammate moves or renames a card (no motion with reduced motion turned on).
- Watchers: follow a card or a board with the Watch button. You watch cards you create, comment on or are assigned to automatically. Watchers hear about new comments, moves, approaching deadlines and new cards on watched boards.
- Notification settings: each kind of notification can be In-app, In-app + email or Off, plus an optional daily digest email. Email uses optional SMTP (`SMTP_URL`, `SMTP_FROM`) and is sent in the background.
- Attachments: drag files onto a card or pick them with a button. Images get thumbnails, other files a download row. Files live next to the database (`/data/attachments` in Docker); `ATTACHMENTS_DIR` and `ATTACHMENT_MAX_MB` change the folder and the per-file limit (default 10 MB). A paperclip count shows on the card face.
- Checklists 2.0: each item can have an assignee and a due date, items reorder by drag or keyboard, and an item can be turned into its own card. Items assigned to you appear under "Subtasks" in My tasks.
- Card templates per board (title, description, priority, tags, checklist), managed in board settings or saved from a card's menu, and used from a column's "New card from template".
- Recurring cards: create a card from a template every day, every week on a weekday or every month on a day, at an optional time (server time zone, `TZ`).
- First-run setup in the browser: a new install opens a setup screen to create the admin account and the first board from a template (Simple, Software, Personal or Blank). `npm run create-admin` still works.
- Board templates are also offered in the "New board" dialog.
- Empty states that explain what to do next on an empty board, the boards page, My tasks, the trash and a card without comments.

### Fixed

- Opening a card from My tasks no longer shows "Page not found".
- The notification bell's accessible name includes the unread count.

### Upgrade notes

- New tables for watchers, attachments, templates and schedules, and new columns on users and checklist items, are created automatically on start. Back up the whole `/data` folder from now on, since it holds attachments as well as the database.

## [0.5.0] - 2026-11-18

Phase 3 of the [roadmap](docs/ROADMAP.md): find and focus.

### Added

- Command palette (Cmd/Ctrl+K or the Search button): find boards and cards by title, description or comment text, with prefix matching and accent-insensitive search (including Polish ł), and jump to My tasks, Trash, Settings or the shortcut list. Results only include boards you can access.
- List view (sortable table) and calendar view (month grid, agenda on phones) for every board, linkable with `?view=list` or `?view=calendar`.
- Saved filters: name the current filter and share it with everyone on the board.
- Card activity: moves, renames, priority, deadline, assignee, tag, dependency and subtask changes are recorded and shown in one timeline with the comments.
- @mention suggestions while typing a comment; mentions are highlighted in comments.
- Searchable pickers for assignees, tags and blocking cards (the blocking picker no longer lists every card in a long select).
- Deadline picker with Today, Tomorrow, Next week and Clear, from the card menu or the `d` shortcut.
- Pinned boards and a "Recently opened" row on the boards page.
- An "Add card" bar at the bottom of the board on phones.

### Changed

- Boards page: one "New board" button (and one per category) instead of large empty tiles; board tiles show open and overdue cards, members and progress; archived boards sit in their own collapsed section.
- My tasks is grouped into Overdue, Today, Upcoming, Later and Done this week, using the same card design as the board.

### Fixed

- The board no longer scrolls sideways on phones because of hidden screen-reader text.
- The logo link in the top bar has an accessible name on small screens.

### Upgrade notes

- Three new tables and a search index are created automatically on start. The search index is filled from existing cards and comments during the migration.

## [0.4.0] - 2026-11-17

Phase 2 of the [roadmap](docs/ROADMAP.md): a board that feels instant.

### Added

- New drag and drop for cards and columns: mouse, touch (long-press) and keyboard (Space to pick up, arrows to move, Space to drop, Escape to cancel), with screen-reader announcements in every UI language. Cards can now be moved on phones.
- Columns can be reordered by dragging their handle or from the column menu.
- "Move to" in every card's menu moves a card to another column without dragging.
- Cards open in a side panel over the board (a full-height sheet on phones). The board keeps its scroll position and filters; the card URL still works on its own.
- A "..." menu on every card (also on right-click) and on every column: assign to me, assignees, tags, priority, cover, move, rename, WIP limit, collapse, delete.
- Collapsible columns, remembered per browser.
- Keyboard shortcuts on the board: `/` search, `n` new card, `e` rename, `a` assign to me, `j`/`k`/`h`/`l` or arrows to move between cards, `?` for the list.
- Pasting several lines into "Add card" creates one card per line.
- Phones show one column per screen with a column switcher at the top.

### Changed

- Redesigned card face: priority shows as a colored edge only for High and Critical, deadlines are relative ("Tomorrow", "In 3 days") and turn amber when due within a day and red when late, icons replace abbreviations like "2c", blocked cards show a "Blocked" label, and assignees are an overlapping avatar stack.
- Edits from the card menu apply instantly and roll back with a message if the server rejects them.
- The WIP count turns amber when a column reaches its limit and red when it goes over.

## [0.3.0] - 2026-11-17

Phase 1 of the [roadmap](docs/ROADMAP.md): foundations and trust.

### Added

- Trash: deleted cards, columns and boards stay restorable for 30 days from the new Trash page (user menu).
- Undo: deleting a card, column or board shows an "Undo" toast instead of asking for confirmation first.
- Admins can deactivate and reactivate users. Deactivated users are signed out, cannot log in and are hidden from pickers and mentions; their cards, comments and history stay.
- Error and not-found pages with a way back, instead of the framework's default error screen.
- End-to-end tests (Playwright) and accessibility checks (axe, WCAG 2.2 AA, light and dark) run in CI, plus a translation completeness test.

### Changed

- New visual foundation from [docs/DESIGN.md](docs/DESIGN.md): indigo brand color, semantic color tokens, IBM Plex Sans bundled with the app, sentence case instead of all-caps labels, 12px minimum text size.
- Tag chips and avatar initials use contrast-checked colors in both themes.
- Confirmations that remain (removing a member, deleting a tag, comment or user) use an accessible dialog that names what will happen, instead of the browser's confirm box.
- Failed actions show a short, translated message saying what went wrong, instead of an error page.

### Fixed

- Deleting a user no longer deletes the boards, cards, comments and dependencies they created. Their comments now show "Deleted user".
- 25 color contrast failures on tag chips, avatars and secondary text.

### Upgrade notes

- A database migration runs automatically on start (`prisma migrate deploy`). It rebuilds four tables to change foreign keys; back up the SQLite file first, as for any upgrade.

## [0.2.3] - 2026-11-17

### Changed

- Upgraded to Next.js 16 and React 19. No configuration changes are needed; the Docker image already runs Node 22.
- The board view uses the full window width, so all columns are visible instead of being clipped by the page container.

### Fixed

- Deleting a column, card, board, tag, comment, member or user now asks for confirmation and says what will be lost. Previously a single click on the small "x" in a column header deleted the column and every card in it.
- The "System" theme follows the operating system setting instead of always showing the dark theme.
- The page language attribute matches the selected UI language, which helps screen readers and hyphenation.

### Added

- `npm run seed:demo` fills an empty database with a demo workspace.
- A screenshot in the README, plus [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DESIGN.md](docs/DESIGN.md) describing where Kanbun is heading and the design standards it follows.

## [0.2.2] - 2026-11-17

### Fixed

- @mentions followed by punctuation now notify the user ("Thanks @bob." mentions `bob`), and email addresses are no longer treated as mentions.
- Markdown: formatting no longer applies inside `code` spans or link URLs, and links stay intact when an underscore appears later in the line.
- The Polish UI now uses proper Polish characters throughout.

### Added

- Complete German, Italian and Polish translations (previously missing strings fell back to English).
- ESLint, a Vitest test suite and both wired into CI (`npm run lint`, `npm test`).

## [0.2.1] - 2026-11-17

### Security

- Sessions are re-validated against the database on every request. Deleting a user, changing their role, or resetting their password now takes effect immediately instead of when the 30-day token expires. An admin password reset signs the user out everywhere (new `User.sessionVersion` column, applied automatically by `prisma migrate deploy`).
- Failed logins are rate limited per IP and username (10 per 15 minutes per account, 50 per IP).
- Only board members can be assigned to a card. Previously any member could assign, and notify, any user of the instance.
- Upgraded `next` to 15.5.29 and `next-auth` to 5.0.0-beta.32 to pick up upstream security fixes, and moved to `zod` 4. Removed the unused `@auth/prisma-adapter` dependency.

### Fixed

- `npm run create-admin` lowercases the username, so the account it creates can actually log in.
- Pages no longer throw when the session disappears mid-request; they redirect to the login screen.
- Expected failed-login errors are no longer logged in production builds.

### Changed

- Board filters collapsed into a single Filter dropdown.
- The add-card button flows as the last item in a column.
- Richer card context menu with submenus.

## [0.2.0] - 2026-06-17

### Added

- Live updates over Server-Sent Events. Card and column changes propagate to everyone viewing the same board, and board/category changes (reorder, create, rename, archive) propagate to everyone on the boards list, all without a manual refresh. Backed by an in-process event bus, so it works in a single Node process without an external broker.
- Filter and search bar on the board: by title, assignee, tag, priority, deadline state, and assigned-to-me. Drag is disabled while a filter is active.
- Markdown rendering for card descriptions and comments (bold, italic, code, lists, links, strikethrough), with a safe escape-first renderer.
- WIP limits per column, set inline in the column header, with an over-limit indicator.
- Card cover colors, shown as a strip on the board and picked from the card sidebar.
- In-app notifications with a live unread badge in the nav: triggered by being assigned to a card, being @mentioned in a comment, or having your card blocked.
- Enter saves a new card and immediately starts another (Shift+Enter for a newline).

### Changed

- Reworked the card detail sidebar into a single cohesive panel with direct, inline controls. Priority is a one-click segmented selector, the deadline saves inline with an overdue marker and quick-clear, and assignees and tags are removable chips with a `+` button to add. No more "Edit" buttons or save round-trips.

## [0.1.0] - 2026-05-04

### Added

- Boards, columns, and cards with native HTML5 drag-and-drop.
- Subtasks, tags, comments, blocking dependencies, priorities, deadlines.
- Per-board membership with owner/member roles, with admin override.
- User profiles with year-long activity heatmap, latest moves, latest comments.
- Active and recent sessions per user, with web/mobile/desktop detection.
- Online indicator driven by 60-second heartbeat, 5-minute online window.
- Light/dark theme + English/Polish UI. Login screen stays English.
- Mobile responsive with hamburger drawer. PWA manifest with safe-area insets.
- Loading skeletons on every data-fetching page.
- Admin panel for user CRUD, role + tasks-access toggle.
- Plugin system (`@kanbun/pro-*`) gated on `KANBUN_LICENSE_KEY`.
- Dual licensing: AGPL-3.0 with commercial option, CLA in place.
- Resilient session handling: stale/invalid JWT cookies are cleared via `/api/auth/clear` instead of crashing.

[Unreleased]: https://github.com/Kanbun-team/Kanbun/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Kanbun-team/Kanbun/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Kanbun-team/Kanbun/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kanbun-team/Kanbun/releases/tag/v0.1.0
