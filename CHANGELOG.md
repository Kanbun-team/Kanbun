# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Kanbun-team/Kanbun/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Kanbun-team/Kanbun/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kanbun-team/Kanbun/releases/tag/v0.1.0
