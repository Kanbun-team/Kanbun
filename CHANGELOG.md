# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kanbun-team/Kanbun/releases/tag/v0.1.0
