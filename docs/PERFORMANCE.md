# Performance

The quality bar in [ROADMAP.md](ROADMAP.md): a board with 500 cards loads in
under 1.5s on a mid-range laptop and responds to interactions in under 100ms,
and the board, boards list and card panel score 100 for accessibility in
Lighthouse. This page says how that is measured, what the numbers were before
and after the v1.0 performance pass, and the rules that keep the board fast.

## Measuring

1. Build: `npm run build`.
2. A database with a large board. `npm run seed:large` adds a board called
   "Large board (performance)" with 500 cards over 6 columns (tags,
   assignees, checklists, comments, a few blockers) to the database in
   `DATABASE_URL`. It uses the existing users as members, so run it after
   `npm run seed:demo` (or on the e2e database). Running it again replaces the
   board, `-- --remove` deletes it, `SEED_LARGE_CARDS=1000` changes the size.

   ```sh
   export DATABASE_URL=file:./perf.db
   node scripts/db.mjs deploy && npm run seed:demo && npm run seed:large
   AUTH_SECRET=some-long-random-secret AUTH_TRUST_HOST=true npx next start -p 3550
   ```

3. Measure: `PERF_URL=http://localhost:3550 PERF_CPU=1 npx tsx scripts/perf-board.ts`
   prints a JSON report. It signs in as `admin` / `demo1234` (`PERF_USER`,
   `PERF_PASSWORD`), opens the large board and measures:
   - server render of `/tasks/<id>` without a browser (time to first byte and
     to the last byte, median of 5);
   - first load in Chromium (Navigation Timing, first contentful paint, long
     tasks and the end of the last long task, which is when hydration is done
     and the board answers input);
   - interactions, as the slowest input event (Event Timing: input delay,
     handlers and the next paint, the same thing INP measures) and the long
     tasks they cause: hover, keyboard pick up / move / drop, pointer drag
     start / move / drop, opening the card panel, typing in and clearing the
     filter, list, calendar and board views, the command palette;
   - the My tasks page load.

   `PERF_CPU=4` slows the browser's CPU down four times (DevTools
   throttling). The machine used below is fast, so 2x is roughly a mid-range
   laptop and 4x a slow one.

4. Lighthouse (desktop preset): `npx lighthouse@12 <url> --preset=desktop`.
   Signed-in pages need a browser profile with a session
   (`--chrome-flags=--user-data-dir=<profile> --disable-storage-reset`):
   passing the cookie with `--extra-headers` does not reach EventSource
   requests, so the live-update streams fail and Lighthouse reports console
   errors that do not happen for real users. The card panel only exists after a
   click on the board, so it is audited in Lighthouse snapshot mode (Chrome
   DevTools, Lighthouse panel, "Snapshot") after opening a card.

5. A regression guard runs the important parts in Playwright:
   `E2E_PERF=1 npx playwright test e2e/perf.spec.ts` seeds the large board into
   the e2e database, checks that it is hydrated within 5s and that a keyboard
   move (pick up, move to the next column, drop) and filter typing stay within
   500ms per step, then removes the board. The budgets are 3 to 5 times the
   targets so slow CI runners do not flake; it is skipped without `E2E_PERF=1`
   so the normal suite stays fast.

## Results

Machine: Apple M2 Pro (12 cores), 32 GB, macOS 26.6, Node 24, Chromium from
Playwright 1.65, production build (`next start`) on SQLite. Board of 500 cards,
viewport 1440x900. Times in milliseconds; interactions are the slowest input
event, with the longest long task in brackets where one occurred. Before is
main at 839c4e9, after is this pass.

### Server

| | Before | After |
| --- | ---: | ---: |
| `/tasks/<id>` time to first byte | 17 | 12 |
| `/tasks/<id>` full response | 136 | 87 |
| HTML size | 1.78 MB | 1.69 MB |
| RSC payload of a refresh (live update, after an edit) | 240 KB | 211 KB |
| Card page prefetches when the board opens | 72 requests | 0 |

### Browser, CPU not throttled

| | Before | After |
| --- | ---: | ---: |
| First load: hydrated (end of last long task) | 664 | 471 |
| First load: long tasks total | 164 | 67 |
| Keyboard pick up | 688 (645) | 120 (76) |
| Keyboard move to next column | 48 | 48 |
| Keyboard drop | 192 (171) | 40 |
| Pointer drag start | (412) | (73) |
| Pointer drag move, longest frame | (299) | none over 50 |
| Pointer drop | 192 (186) | 40 |
| Open card panel | 56 (68) | 48 |
| Type in the filter | 88 (71) | 56 |
| Clear the filter (500 cards come back) | 152 (148) | 136 (101) |
| List view | 24 | 24 |
| Calendar view | 16 | 16 |
| Back to board view | 16 (54) | 16 (54) |
| Open command palette | 56 | 56 |
| Command palette results after the last key (150ms debounce + search) | about 210 | 203 |
| My tasks: HTML complete | 80 | 71 |

### Browser, CPU 4x slower

| | Before | After |
| --- | ---: | ---: |
| First load: hydrated (end of last long task) | 1603 | 614 |
| First load: long tasks total | 672 | 214 |
| Keyboard pick up | 1776 (1618) | 424 (279) |
| Keyboard drop | 808 (736) | 144 (71) |
| Pointer drag start | (1619) | (255) |
| Pointer drag move, longest frame | (1344) | (191) |
| Pointer drop | 760 (730) | 128 (123) |
| Open card panel | 72 (601) | 160 (148) |
| Type in the filter | 312 (260) | 192 (139) |
| Clear the filter | (586) | 416 (407) |
| List view | 72 (205) | 56 (193) |
| Back to board view | 16 (254) | 16 (205) |
| Open command palette | 208 (138) | 200 (137) |
| My tasks: end of last long task | 498 | 494 |

At 2x (after only): first load 562, keyboard pick up 216, move 80, drop 64,
drag start (118), longest drag frame (91), drop 56, card panel 88, filter
typing 136, filter clear 208, command palette 104.

### Lighthouse (desktop, after)

Accessibility 100 and best practices 100 in light and dark on: login, setup,
boards list, board (demo and 500 cards), card page, card panel (snapshot), My
tasks and settings. Performance 100 on every page (99 to 100 for the 500-card
board, which Lighthouse flags for DOM size). The first Lighthouse run of this
pass found a layout shift that was already on main: My tasks scored 75 for
performance (layout shift 0.96) and the 500-card board 92 (0.11); both are now
under 0.05.

## What changed

- **Memoized columns and cards.** The React Compiler is not enabled (only its
  lint rules are), so nothing was memoized: every drag event, filter key and
  refresh re-rendered all 500 cards. `Column`, the sortable card and the card
  body are now `React.memo`, and Board keeps their props stable: handlers go
  through `useStableHandlers` (`src/lib/use-stable.ts`), members, tags and
  templates through `useStableValue`, dnd-kit sensor options are module
  constants (new option objects gave every card new listeners), and the
  "editing" card is a boolean per card instead of part of the shared props.
  The sortable wrapper still re-renders on drag events (it reads dnd-kit's
  context), but the card body below it does not.
- **Structural sharing on refresh** (`src/components/board/reconcile.ts`).
  Each `router.refresh()` brings a new copy of every card; unchanged cards and
  columns keep their previous objects, so a live update or the refresh after
  an edit only re-renders what changed.
- **No ResizeObserver per card while dragging.** dnd-kit created one for each
  of the 500 droppable cards on every drag start; cards do not change size
  mid-drag and columns still observe theirs.
- **Card menu built on demand.** Each card had a React Aria menu trigger with
  all its items (about 30 elements, and 400 KB of the HTML). The card now
  renders a plain button with the same look, name and `aria-haspopup`, and
  swaps in the real menu when a mouse or focus reaches the card; the stand-in
  opens the menu itself when pressed directly. Menu items are only built while
  the menu is open.
- **Fewer live refetches.** A live "board changed" event that arrived before
  a refresh this tab started (after its own edit) is already covered by it and
  no longer triggers a second full refetch (`markBoardRefreshed` /
  `refreshedSince` in `src/lib/board-stream.ts`); bursts were already
  coalesced into one refetch after 250ms.
- **Card pages prefetched on intent.** Card links no longer prefetch while in
  view (72 requests when the large board opens); they prefetch when the
  pointer or focus reaches the card.
- **Leaner board query.** The board page selects only the fields the card face
  needs, counts checklist items with `_count` and one grouped query for the
  done ones instead of loading every checklist row, and reuses one object per
  person and tag so the serialized page does not repeat them.
- **Smaller client bundle.** zod was in the board's client bundle only for the
  saved-filter schema; the schema moved to `src/lib/board-filters-schema.ts`
  (server only). About 140 KB less JavaScript on the board (1.15 MB to
  1.01 MB uncompressed).
- **Layout shift.** `scrollbar-gutter: stable` on the page, so replacing a
  loading skeleton with content taller than the window does not shift the
  layout sideways, and the board's skeleton is as wide as the board.
- **Accessibility.** The remove button on a card's tag chips showed a "×"
  character that was not part of its accessible name ("Remove: Frontend"); it
  is now a hidden icon.

Checked and left alone:

- Database indexes: every query of the board page, My tasks and search uses an
  index already (cards by column and position, tags, assignees, checklist
  items and comments by card), so no migration was needed.
- Virtualization: not needed at 500 cards, and it would get in the way of
  drag and drop, keyboard navigation and find-in-page.
- `content-visibility: auto` on cards: it saves layout work, but dnd-kit then
  measures off-screen cards with their placeholder size and keyboard moves to
  the next column failed, so it is not used.
- Lazy-loading dialogs and the command palette: they are small and build on
  React Aria, which the board loads anyway; the remaining JavaScript is
  React, Next.js, React Aria, dnd-kit and the translations.

## Still above the target

- Picking up a card with the keyboard takes about 120ms unthrottled (216ms at
  2x): dnd-kit re-renders every sortable card when a drag starts. The card
  bodies no longer re-render, but the 500 sortable wrappers do. Pointer drag
  start is under 100ms unthrottled but about 120ms at 2x.
- Clearing a filter that hid most of the board takes 136ms unthrottled: the
  hidden cards are created again. Keeping them mounted and hidden did not
  help, because turning drag and drop back on re-renders every card anyway.
- The translations of all four languages are in the client bundle (about
  50 KB compressed). Loading only the current language would need `t()` to
  become asynchronous or a per-locale bundle.

## Rules for new board code

- Keep `Column`, `SortableCard` and `CardBody` memoized and give them stable
  props: no inline objects or functions from Board (add handlers to the
  objects passed through `useStableHandlers`), no per-render arrays.
- Do not put per-card React Aria components or other heavy widgets on the
  card face; build them when the user reaches the card, like the card menu.
- New card fields: add them to `sameCard` in `reconcile.ts`, or cards will
  not update when only that field changes.
- Check with `scripts/perf-board.ts` before and after changes to the board,
  and run `E2E_PERF=1 npx playwright test e2e/perf.spec.ts`.
