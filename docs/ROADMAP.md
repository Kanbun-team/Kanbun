# Kanbun roadmap

Goal: the best self-hosted board for small teams. Fast enough that it never gets in the way, calm enough to leave open all day, and safe enough that nobody loses work. Visual and interaction rules are in [DESIGN.md](DESIGN.md); every item below follows them.

Status as of v0.2.2 (November 2026): Next.js 16, React 19, SQLite, live updates over SSE, 4 languages, lint and unit tests in CI. The items below come from a hands-on review of the running app (demo workspace, desktop and phone, light and dark, Lighthouse) plus a code review.

## Where we stand

### What already works well

- Clean, legible board with live updates for everyone on it.
- Inline card editing (priority, deadline, assignees, tags, cover) without save buttons.
- Lighthouse: Best Practices 100, SEO 100, Accessibility 95.
- Simple deployment: one container, one SQLite file, no external services.

### What holds it back

| # | Finding | Impact |
|---|---|---|
| F1 | Drag and drop uses native HTML5 events: no touch support, no keyboard support. | Cards cannot be moved on a phone at all. Fails WCAG 2.2 (2.5.7 Dragging Movements, 2.1.1 Keyboard). |
| F2 | Deleting a user cascades to every card they created, including cards assigned to others. | Silent loss of team data when someone leaves. |
| F3 | No undo, no trash, no error boundaries. Failed actions throw to a generic error page. | One mistake loses work; errors give no direction. Confirmations were added in v0.2.3 as a stopgap. |
| F4 | Opening a card navigates away from the board to a full page. | Loses board context, scroll and filters; slow triage. |
| F5 | 25 contrast failures: tag chips (as low as 2.8:1) and avatar initials (3.5:1). | Hard to read; fails WCAG AA. |
| F6 | Card face is noisy and cryptic: "Normal" badge on every card, "2c" for comments, a lone "!" for blocked, absolute dates only. | Slower to scan; meaning has to be learned. |
| F7 | All-caps section titles and tags, ad hoc radii and shadows, hard-coded Tailwind grays next to CSS variables, 10px text. | Inconsistent look, harder to maintain, reads as a template. |
| F8 | Boards list: a large empty "Create board" tile for uncategorized boards and another per category; board tiles show no progress. | Wasted space, little information. |
| F9 | Blocking picker is a native select listing every card on the board; no search anywhere in the app. | Unusable on large boards. |
| F10 | No keyboard shortcuts, no command palette, no global search. | Power users slow down as boards grow. |
| F11 | Single process only (in-memory event bus and rate limiter), SQLite only. | Fine for most self-hosters; blocks larger teams and HA setups. |

## Phase 1: Foundations and trust (v0.3)

Make the app safe to rely on and give it a real design system, so everything after this is built once and built right.

1. **Design tokens and fonts.** Implement the color, type, spacing, radius and elevation tokens from DESIGN.md as CSS variables plus Tailwind theme keys; bundle IBM Plex Sans; remove hard-coded palette classes. *Done when:* no `slate-*`/`gray-*` classes or raw hex remain in components; both themes pass the contrast test.
2. **Validated color palette.** One palette module for tags, covers, boards and avatars with per-theme text/background pairs and a unit test asserting 4.5:1. *Fixes F5.*
3. **UI primitives** in `src/components/ui/` on React Aria Components: Button, IconButton, TextField, Combobox, Menu, Popover, Dialog, Sheet, Toast, Tooltip, Avatar, Chip, DatePicker, EmptyState. *Done when:* existing screens use them and `window.confirm` is gone.
4. **Trash and undo.** Soft-delete cards, columns and boards (`deletedAt`), restorable for 30 days from a Trash view; every delete shows an "Undo" toast. Replace the v0.2.3 confirmations with undo where possible. *Fixes F3.*
5. **Deactivate instead of delete users.** Deactivated users cannot log in and disappear from pickers, but their cards, comments and history stay; `createdBy` moves to `SetNull`. Hard delete stays as an admin-only action that reassigns content first. *Fixes F2.*
6. **Typed action results and error boundaries.** Server actions return `{ ok, error }` with translated messages; add `error.tsx` and `not-found.tsx` per route group. *Fixes F3.*
7. **End-to-end tests.** Playwright on the demo seed: log in, create board, add/move/edit card, comment with mention, filters, permissions. Run `axe` on each page. *Done when:* CI fails on any accessibility violation.

## Phase 2: A board that feels instant (v0.4)

The board is the product (DESIGN.md, principle 1). This phase makes it the best part of the app.

1. **New drag and drop** with `@dnd-kit`: mouse, touch (long-press), keyboard, screen-reader announcements, auto-scroll at edges, column reordering. Plus a "Move to..." action in the card menu. *Fixes F1.*
2. **Optimistic everything.** Moves and edits apply instantly and roll back with a toast on failure. Teammates' changes glide into place.
3. **Card panel.** Open cards in a side panel (sheet on phones) through intercepting routes, so the URL still points at the card but the board stays mounted. *Fixes F4.*
4. **Card face redesign** per DESIGN.md 4.1: priority notch for High and Critical only, relative deadlines with amber/vermilion states, icon meta, "Blocked" chip, ringed avatar stack. *Fixes F6.*
5. **Column menu.** Rename, set WIP limit, move, collapse, and delete (via trash) in one "..." menu instead of a bare "x" next to the count. WIP limit shown as a small gauge that turns amber when reached.
6. **Quick add and quick edit.** `n` adds a card in the focused column; inline title edit with `e`; paste multiple lines to create multiple cards.
7. **Mobile board.** One column per screen with swipe, a column switcher, and a bottom "Add card" bar within thumb reach.
8. **Keyboard shortcuts** with a `?` cheat sheet (DESIGN.md section 6). *Part of F10.*

## Phase 3: Find and focus (v0.5)

1. **Command palette and search (`/` or Ctrl/Cmd+K).** Jump to any board or card, run actions ("Move to Done", "Assign to me"). SQLite FTS5 index over titles, descriptions and comments. *Fixes F9, F10.*
2. **My work.** Rebuild "My tasks" into Today, Overdue, Upcoming and Done this week, grouped across boards, with the same card face.
3. **Saved filters and views.** Name and share a filter; add List view (sortable table) and Calendar view (by deadline) for every board.
4. **Better pickers.** Searchable comboboxes for assignees, tags and blocking cards; @mention autocomplete in comments; mentions highlighted in rendered comments.
5. **Boards home redesign.** Remove the empty "Create board" tiles in favor of one primary action; board tiles show open cards, overdue count and members; pin favorite boards; recently opened row. *Fixes F8.*
6. **Card activity log.** Who changed what and when on each card (moves, assignment, deadline, edits), merged with comments in one timeline.

## Phase 4: Team and collaboration (v0.6)

1. **Presence.** Avatars of who is viewing the board; a subtle indicator when someone else has the same card open.
2. **Watchers and notification settings.** Follow a card or board; per-user choice of in-app, email (optional SMTP) or none for each notification type; daily digest.
3. **Attachments.** Files and images on cards, stored on the local volume next to the database, with size limits and image previews.
4. **Checklists 2.0.** Subtasks with their own assignee and due date, reorderable, convertible to cards.
5. **Card templates and recurring cards.**
6. **Onboarding.** First-run setup in the browser (create admin, first board from a template) instead of the `create-admin` CLI; empty states that teach.

## Phase 5: Platform (v1.0)

1. **REST API with personal access tokens** and outgoing **webhooks**; OpenAPI spec.
2. **Import and export.** Trello and CSV import; full JSON export; one-click backup download for admins.
3. **Single sign-on.** OIDC (Authentik, Keycloak, Google Workspace) alongside passwords; optional 2FA (TOTP) for password accounts.
4. **Scale-out option.** PostgreSQL support and a Redis-backed event bus and rate limiter, so several instances can run behind a load balancer. SQLite stays the default. *Fixes F11.*
5. **Offline-tolerant PWA.** Boards readable offline; queued edits sync when back online.
6. **Admin audit log** of security-relevant events (logins, role changes, deletions).

## Quality bar for every release

- Lint, typecheck, unit tests, Playwright e2e with `axe`, and i18n completeness pass in CI.
- Lighthouse accessibility 100 on the board, boards list and card panel.
- Board with 500 cards: interaction response under 100ms, first load under 1.5s on a mid-range laptop.
- Light, dark and 390px screenshots for every UI change.
- Every user-visible change in `CHANGELOG.md` and `src/lib/changelog.ts`.

## How we will know it is the best

- **Time to first card** for a new admin under 60 seconds from `docker compose up`.
- **Full parity:** every action possible with keyboard only and on a phone.
- **Zero data-loss paths:** every destructive action is undoable or explicitly confirmed with its consequences.
- **Accessibility:** zero `axe` violations, WCAG 2.2 AA in both themes.
