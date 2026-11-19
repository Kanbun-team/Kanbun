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
   the e2e database, checks that it is hydrated within 5s, that a keyboard
   move (pick up, move to the next column, drop), a pointer drag start and
   clearing a filter stay within 300ms per step and typing a 4-character
   filter within 900ms, then removes the board. The budgets are about 3 times
   the targets so slow CI runners do not flake (the keyboard and filter steps
   are timed around Playwright calls and include its round trips, about 100ms
   locally); it is skipped without `E2E_PERF=1` so the normal suite stays
   fast.

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

### Interaction pass (v1.1)

The v1.0 pass left keyboard pick up, pointer drag start at 2x and clearing a
filter above 100ms. Same machine and setup as above, `scripts/perf-board.ts`
run against main at e809e6d (before) and this pass (after), slowest input
event with the longest long task in brackets. A pointer drag start has no
slow input event of its own (the work runs on a mouse move), so only its
long task is shown.

| | 1x before | 1x after | 2x before | 2x after | 4x before | 4x after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Keyboard pick up | 128 (77) | 72 | 232 (152) | 88 (56) | 496 (327) | 192 (135) |
| Keyboard move to next column | 56 (54) | 24 (52) | 80 (110) | 40 (67) | 128 (238) | 72 (159) |
| Keyboard drop | 48 | 56 | 80 | 72 | 184 (89) | 176 (86) |
| Pointer drag start | (77) | none over 50 | (139) | (50) | (289) | (95) |
| Pointer drag move, longest frame | none over 50 | (50) | (109) | (98) | (238) | (199) |
| Pointer drop | 40 | 48 | 64 | 56 | 144 (142) | 96 (73) |
| Type in the filter | 64 | 40 | 104 (77) | 56 | 216 (165) | 104 |
| Clear the filter | 144 (106) | 80 (70) | 224 (170) | 128 (79) | 488 (375) | 232 (141) |
| Open card panel | 48 | 24 | 88 (84) | 80 (68) | 176 (173) | 152 (144) |
| First load: hydrated | 479 | 469 | 578 | 468 | 1017 | 574 |

Event Timing rounds durations to 8ms, and runs vary by about one step.

What made the difference, measured one at a time with a CPU profile and a
trace of the pick up:

- **Zero transforms.** During a drag dnd-kit gives every card of the active
  column a transform, almost all of them zero. `translate3d(0px, 0px, 0)`
  still put each card on its own compositor layer: 49ms of "Layerize" and
  20ms of raster per pick up. Cards now only get a transform when it moves
  them, and a transition only in the dragged card's column.
- **Stable wrapper for the drag overlay.** The overlay was inserted straight
  into the board's `space-y-3` container, whose sibling selectors made the
  browser recalculate the style of the whole board (12,000 elements, 18ms)
  on every pick up. It now sits in a `display: contents` wrapper, and
  `DragPreview` reads the active item from dnd-kit itself, so a pick up no
  longer re-renders Board either.
- **Fewer drop targets.** dnd-kit measures every drop target when a drag
  starts, and each measurement walks all scrollable ancestors with
  `getComputedStyle`: 16ms of the 54ms pick up at 1x for 500 cards. Only the
  cards of the column where focus or the last press is (`armed`) and of the
  columns the dragged card has been in are drop targets now; the other
  columns are targets themselves. A card dragged into a column first goes to
  the place under it (`insertIndex`, read from the DOM, also used for the
  announcement), then that column's cards become targets and sorting
  continues as before. Collision detection looks for the column first and
  then for the closest card in it, instead of testing all 500 rects on every
  move.
- **Arrow keys right after a pick up.** dnd-kit's keyboard sensor listens
  for keys from the next task on; with the faster pick up an arrow key could
  arrive before that and be lost. `BoardKeyboardSensor` hands arrow keys in
  that gap to the sensor.
- **Filtering keeps the cards.** Cards that do not match a filter stay
  mounted with the `hidden` attribute (no box, not in the accessibility tree,
  not found by find in page), so clearing a filter shows them again instead
  of creating 470 cards and registering them with dnd-kit. Drag and drop is
  still off while filtering, but by refusing to start in the sensors
  (`gated` activators) instead of disabling every card, which re-rendered
  all 500 card bodies; screen readers hear that moving is off from the drag
  instructions (`dndInstructionsFiltered`). Keyboard navigation (j/k/h/l),
  the live change animations and `insertIndex` skip hidden cards
  (`[data-card-id]:not([hidden])`).
- **Smaller wins.** Column ids and card `data` are memoized, the column's
  content is a memoized component below the column's own dnd-kit hook, so
  the several context updates of a pick up re-render only the hook-bearing
  wrappers.

Tried and dropped: freezing dnd-kit's context for columns a drag has not
reached (every sortable card re-renders about four times per pick up)
needs dnd-kit to export its internal contexts, so a patch. It saved about
10ms at 2x on top of the above, not worth a patched dependency.

### Filter clear pass

The v1.1 pass left clearing a filter at about 128ms at 2x. Same machine and
setup, `scripts/perf-board.ts` run three times per row (median, slowest
input event with the longest long task in brackets). Before is main at
0a9a6bf, after is this pass. "First load: hydrated" is the end of the last
long task; "none" means the load had no task over 50ms.

| | 1x before | 1x after | 2x before | 2x after | 4x before | 4x after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Clear the filter ("fix", most cards come back) | 72 | 32 | 136 (127) | 64 (53) | 272 (164) | 120 (72) |
| Type in the filter | 32 | 24 | 56 | 40 | 120 (59) | 72 |
| Keyboard pick up | 48 | 40 | 96 (64) | 88 (69) | 208 (144) | 160 (123) |
| Keyboard move to next column | 24 | 16 | 40 (87) | 24 (71) | 40 (192) | 40 (146) |
| Keyboard drop | 40 | 40 | 80 | 72 | 176 (98) | 120 (59) |
| Pointer drag start | none over 50 | none over 50 | (56) | (62) | (122) | (114) |
| Pointer drag move, longest frame | (53) | none over 50 | (107) | (69) | (223) | (135) |
| Pointer drop | 24 | 24 | 56 | 48 | 112 (83) | 80 (64) |
| Open card panel | 32 | 24 | 40 (74) | 24 | 80 (151) | 40 (75) |
| First load: hydrated | 443 | none | 477 | none | 915 | 481 |

A separate script with 11 repetitions per interaction (filter typed and cleared
11 times, 11 pick ups and drag starts) gave the same picture: clear 64 to
32 at 1x and 128 to 56 at 2x; typing 32 to 24 and 56 to 32; keyboard pick up
32 to 32 and 72 to 64; drag start had no long task and a longest frame of
17ms (1x) and 33ms (2x) before and after.

A trace of the clear at 2x showed where the time went before: 13ms of
React (the input event), then the browser's forced style recalculation
(11,300 elements, 34ms) and layout (35ms) of every card that came back, a
16ms hit test and 26ms of paint. After: 4ms and 7ms of style for 600 and
2,500 elements, 16ms of style and layout in the frame, 13ms of paint. The
JavaScript part is the same.

What changed:

- **`content-visibility: auto` on cards** (`.board-card` in
  `src/app/globals.css`, on the sortable wrapper in `Column.tsx`). A card
  outside its column's scroll area skips style, layout and paint; only the
  six or seven cards per column on screen are rendered when a filter is
  cleared, when the board first loads and when a column re-renders during a
  drag. `contain-intrinsic-size: auto 92px` (median card height 93px)
  reserves space for a card not rendered yet and remembers the real size
  once it has been. Paint containment clips at the card's box, so
  `overflow-clip-margin: 10px` keeps the focus ring, the shadow and the
  presence avatar (8px outside the card) visible.
- Checked on the 500-card board with the change on and off: j pressed 40
  times keeps the focused card in view, a keyboard reorder of 25 places and
  a keyboard move to the next column from the 100th card land where
  announced, and a pointer drag onto a card in the middle of a scrolled
  column lands next to it; the board e2e specs, the axe checks and the
  `E2E_PERF` guard pass. Keyboard moves to another column target the column
  (since v1.1), not card rects, which is why the v1.0 failure (see "Checked
  and left alone") does not come back.

Tried and dropped, measured at 2x with 9 repetitions:

- `contain: layout style` on columns: no change (56 both ways); cards
  already contain themselves.
- The card list as a flex column with `gap` instead of `space-y-2`: clearing
  went from 56 to 112. A flex container sizes every item, so the skipped
  cards are laid out anyway.
- No card shadow and no transitions in cards: no change.
- Setting `hidden` on the cards from a layout effect in the column instead
  of rendering it (so the 470 sortable cards do not re-render): 64 to 56,
  one Event Timing step, but the server would render a filtered board
  (`?deadline=none`) unfiltered until hydration. Not worth it.

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
- `content-visibility: auto` on cards: dropped in v1.0 because keyboard moves
  to the next column failed. Since v1.1 those moves target the column, not
  card rects, and it is now used (see "Filter clear pass" below).
- Lazy-loading dialogs and the command palette: they are small and build on
  React Aria, which the board loads anyway; the remaining JavaScript is
  React, Next.js, React Aria, dnd-kit and the translations.

## Still above the target

- Keyboard pick up and pointer drag start are under 100ms at 2x (88ms and a
  50ms task) but not at 4x (192ms, 95ms task): dnd-kit still re-renders every
  sortable card a few times per drag start (see "Tried and dropped" above).
- The translations of all seven languages are in the client bundle (about
  14 KB compressed each, so about 100 KB). Loading only the current language would need `t()` to
  become asynchronous or a per-locale bundle.

## Rules for new board code

- Keep `Column`, `ColumnContent`, `SortableCard` and `CardBody` memoized and
  give them stable props: no inline objects or functions from Board (add
  handlers to the objects passed through `useStableHandlers`), no per-render
  arrays. Do not put values that change for every card (such as the filter
  state) into `shared`.
- Keep the `board-card` class (`content-visibility: auto`) on the sortable
  card wrapper and the column's card list a plain block (`space-y-*`): a flex
  or grid list makes the browser size every card and undoes the saving.
  Anything drawn more than 10px outside a card's box is clipped
  (`overflow-clip-margin`), so badges and rings stay within that.
- Cards hidden by a filter are still in the page: code that looks cards up
  in the DOM for something on screen uses `[data-card-id]:not([hidden])`.
- Do not give sortable items zero transforms or put elements that come and go
  straight into containers styled with sibling selectors (`space-y-*`).
- Do not put per-card React Aria components or other heavy widgets on the
  card face; build them when the user reaches the card, like the card menu.
- New card fields: add them to `sameCard` in `reconcile.ts`, or cards will
  not update when only that field changes.
- Check with `scripts/perf-board.ts` before and after changes to the board,
  and run `E2E_PERF=1 npx playwright test e2e/perf.spec.ts`.
