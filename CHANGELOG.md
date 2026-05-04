# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/mrellwart/kanbun/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mrellwart/kanbun/releases/tag/v0.1.0
