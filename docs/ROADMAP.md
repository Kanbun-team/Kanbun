# Kanbun roadmap

Goal: the best self-hosted board for small teams. Fast enough that it never gets in the way, calm enough to leave open all day, and safe enough that nobody loses work. Visual and interaction rules are in [DESIGN.md](DESIGN.md); every item below follows them.

Status as of v0.4.0 (November 2026): Next.js 16, React 19, SQLite, live updates over SSE, 4 languages, trash and undo, design tokens, keyboard and touch drag and drop, a card side panel, and lint, unit, end-to-end and accessibility tests in CI. The items below come from a hands-on review of the running app (demo workspace, desktop and phone, light and dark, Lighthouse) plus a code review.

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

## Phase 1: Foundations and trust (v0.3): done

Shipped in v0.3.0. What landed, and what moved:

1. **Design tokens and fonts.** Done. Semantic tokens in `globals.css` exposed as Tailwind keys (`paper`, `surface`, `raised`, `ink`, `line`, `accent`, `danger`, `warning`, `success`); IBM Plex Sans bundled; every screen migrated, no palette classes left.
2. **Validated color palette.** Done (`src/lib/palette.ts`, unit-tested). Text colors are derived per color and theme, so custom hex colors are safe too. *Fixes F5.*
3. **UI primitives.** Partly done: button styles, confirm dialog (React Aria), toast with action, tag chip, avatar, `ActionForm`; `window.confirm` is gone. Menu, Combobox, Popover, Sheet, Tooltip and DatePicker move to Phase 2 and 3, built together with the features that need them (card menu, card panel, pickers).
4. **Trash and undo.** Done. Snapshots in `TrashItem` instead of `deletedAt` columns, so live queries never need a soft-delete filter. *Fixes F3 for deletes.*
5. **Deactivate instead of delete users.** Done; hard delete keeps content (`SET NULL`). *Fixes F2.*
6. **Typed action results and error boundaries.** Done. *Fixes F3 for errors.*
7. **End-to-end tests.** Done: 12 Playwright tests, axe on 10 pages in both themes, zero violations, in CI.

## Phase 2: A board that feels instant (v0.4): done

Shipped in v0.4.0. What landed, and what moved:

1. **New drag and drop.** Done with `@dnd-kit`: mouse, touch long-press, keyboard (Left/Right jump between columns, Up/Down reorder), translated screen-reader announcements, column reordering, and "Move to" in the card menu. *Fixes F1.*
2. **Optimistic everything.** Done for moves and card-menu edits (rollback by re-fetching, with an error toast). Animating teammates' live changes into place moves to Phase 4 (presence).
3. **Card panel.** Done with a parallel `@panel` slot and an intercepting route; reloading a card URL still gives the full page. *Fixes F4.*
4. **Card face redesign.** Done per DESIGN.md 4.1. *Fixes F6.*
5. **Column menu.** Done: rename, WIP limit, add card, move left/right, collapse, delete. WIP count turns amber at the limit and red above it.
6. **Quick add and quick edit.** Done: `n`, `e`, multi-line paste.
7. **Mobile board.** Partly done: one column per screen with snap scrolling and a column switcher. The bottom "Add card" bar moves to Phase 3.
8. **Keyboard shortcuts.** Done with a `?` sheet. `d` (set deadline) moves to Phase 3 with the shared date picker. *Part of F10.*

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
