# Kanbun roadmap

Goal: the best self-hosted board for small teams. Fast enough that it never gets in the way, calm enough to leave open all day, and safe enough that nobody loses work. Visual and interaction rules are in [DESIGN.md](DESIGN.md); every item below follows them.

Status as of v0.5.0 (November 2026): Next.js 16, React 19, SQLite, live updates over SSE, 4 languages, trash and undo, design tokens, keyboard and touch drag and drop, a card side panel, global search, list and calendar views, card history, and lint, unit, end-to-end and accessibility tests in CI. The items below come from a hands-on review of the running app (demo workspace, desktop and phone, light and dark, Lighthouse) plus a code review.

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

## Phase 3: Find and focus (v0.5): done

Shipped in v0.5.0.

1. **Command palette and search.** Done: Cmd/Ctrl+K palette, SQLite FTS5 over titles, descriptions and comments with triggers, accent-insensitive including Polish ł, access-filtered. Running card actions from the palette ("Move to Done") is not in yet. *Fixes F9, F10.*
2. **My work.** Done: Overdue, Today, Upcoming, Later, Done this week, with the shared card face.
3. **Saved filters and views.** Done: board, list and calendar views (`?view=`), saved filters shared per board.
4. **Better pickers.** Done: searchable comboboxes for assignees, tags and blocking cards, @mention autocomplete and highlighting.
5. **Boards home redesign.** Done: one primary action, tiles with open/overdue counts, members and progress, pins, recently opened. *Fixes F8.*
6. **Card activity log.** Done, merged with comments in one timeline.
7. **Moved from Phase 2.** Done: phone "Add card" bar, `d` shortcut with a shared date picker.

## Phase 4: Team and collaboration (v0.6): done

Shipped in v0.6.0.

1. **Presence.** Done: viewer avatars in the board header, "also viewing this card" in the card panel, a marker on cards others have open, and a soft highlight for teammates' new cards, moves and renames (moved from Phase 2).
2. **Watchers and notification settings.** Done: watch cards and boards (automatic for cards you create, comment on or are assigned to), In-app, In-app + email or Off per type, optional SMTP, daily digest, deadline reminders.
3. **Attachments.** Done: stored next to the database, size limit, image thumbnails resized on the server, only safe image types shown inline, kept through trash and restore.
4. **Checklists 2.0.** Done: assignee and due date per item, drag and keyboard reorder, convert to card, items in My tasks, a notification when someone gives you an item.
5. **Card templates and recurring cards.** Done: templates per board, daily, weekly and monthly schedules.
6. **Onboarding.** Done: browser setup for the first admin and first board, board templates in "New board", teaching empty states.

## Phase 5: Platform (v1.0): done

Shipped in v1.0.0, together with a security review, a performance and Lighthouse pass, and the leftovers from earlier phases.

1. **REST API with personal access tokens** and outgoing **webhooks**; OpenAPI spec. Done: `/api/v1` with read or read-and-write tokens, signed webhooks with SSRF protection, `docs/openapi.json` and `docs/API.md`.
2. **Import and export.** Done: Trello, Kanbun JSON and CSV import, board JSON and CSV export, full admin export and one-click backup (SQLite).
3. **Single sign-on.** Done: OIDC alongside passwords, TOTP 2FA with recovery codes. Linking by email is opt-in (`OIDC_MATCH_EMAIL`).
4. **Scale-out option.** Done: PostgreSQL from a generated schema, Redis for live updates, presence, rate limits and job locks, a SQLite to PostgreSQL copy script, and a CI job on two instances. *Fixes F11.*
5. **Offline-tolerant PWA.** Done: boards readable offline, queued board edits sync on reconnect.
6. **Admin audit log.** Done, with filters, CSV download and retention.

Closed in v1.1.0: card details readable offline, a durable webhook queue, S3-compatible attachment storage, nodemailer 10, faster drag start and filter clear on large boards, consistent German, Italian and Polish copy.

Closed in v1.2.0: S3 temporary credentials and IAM roles, MinIO in CI, idempotent comments, offline board counts, and clearing a filter on a 500-card board in 64ms at 2x CPU throttling. Nothing from the earlier lists is still open.

Closed in v1.3.0: French, Spanish, Brazilian Portuguese, Dutch, Czech and Ukrainian, only the current language sent to the browser, and server-side image thumbnails.

## Phase 6: Flow (v1.4)

Goal: help a team see how work moves and spend less time on bookkeeping, without turning the board into a project-management suite.

1. **Board insights.** Done: `/tasks/<id>/insights`, linked from the board header and the command palette. Cycle time, throughput per week, a cumulative flow chart and aging work in progress, computed from the card history the board already keeps. Readable as tables too, in both themes and at 390px.
2. **Card age on the board.** Done: an hourglass with the days on cards that have been in a work column longer than 85% of the cards that left it in the last 90 days (at least 3 days, with 5 or more of them), said in the card's accessible name.
3. **Swimlanes.** Group the board by assignee, priority or tag, with drag and drop and keyboard moves across lanes.
4. **Simple automations.** Done: per-board rules in board settings, listed in plain language. "When a card enters a column" (from any move, a new card, a template or a schedule) assigns or unassigns, adds or removes a tag, sets the priority, sets or clears the deadline and completes the checklist, inside the same transaction as the move; "when the deadline passes" (a background job, once per card and deadline) moves or tags. Every rule run is in the card history under the rule's name and can be undone from the toast or the history; a depth guard keeps rules from looping. Read-only in the REST API, part of board exports and the board trash.

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
