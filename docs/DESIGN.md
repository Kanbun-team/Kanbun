# Kanbun design standards

This is the reference for every screen in Kanbun. When code and this document disagree, fix one of them in the same PR. The roadmap that applies these standards lives in [ROADMAP.md](ROADMAP.md).

## 1. What we are designing

Kanbun is a self-hosted board for small teams who run it on their own server. People open it many times a day for a few seconds at a time: check what is next, move a card, answer a mention. It is a working tool, not a showcase.

So the design optimizes for:

- **Glanceability.** The state of a board must be readable in two seconds: what is stuck, what is late, who is on what.
- **Speed of the common action.** Moving, creating and editing cards must take one gesture or one keystroke, never a page load.
- **Calm.** Color and motion are reserved for things that need attention. A healthy board looks quiet.
- **Trust.** Nothing is lost by accident. Every destructive action can be undone or is confirmed with its consequences spelled out.

## 2. Principles

1. **The board is the product.** Every other screen exists to get you back to a board. The board view gets the full window, the best keyboard support and the most design attention.
2. **Signal, not decoration.** A visual element earns its place by carrying information. A "Normal" priority badge on every card carries none, so it is not shown. Color means something (late, blocked, critical) or it is not used.
3. **Context stays on screen.** Opening a card does not leave the board. Editing happens inline. Navigation never loses scroll position or filters.
4. **Keyboard and touch are first-class.** Anything you can do with a mouse you can do with a keyboard and on a phone. Dragging always has a non-drag alternative (WCAG 2.2, 2.5.7).
5. **Undo over confirm.** Prefer doing the action immediately with an "Undo" toast. Use a confirmation only when undo is impossible, and then name exactly what will be lost.
6. **Same word, same thing.** An action keeps its name through the whole flow: the button "Archive board" produces the toast "Board archived".

## 3. Visual identity

The name comes from *kanban*, the Japanese signboard. The identity borrows two materials from that world: **indigo dye** (ai-iro) for the brand and **vermilion seal ink** for the one thing that must stop you, an overdue or critical card. Everything else is neutral paper and ink.

What we deliberately avoid, because it reads as a generic template: all-caps eyebrow labels above sections, meta strings joined with middle dots, monospace text for small labels, identical shadows on every element, gradient washes, and a different accent color per screen.

### 3.1 Color tokens

All colors are CSS custom properties on `:root` and `html.dark` (stored as RGB triplets so opacity modifiers work). Components use semantic tokens only, never raw hex or Tailwind palette classes like `bg-slate-800`. In Tailwind they are `paper`, `surface`, `raised`, `ink`, `ink-muted`, `line`, `accent` (indigo, with `accent-soft`, `accent-hover`, `accent-fg`), `danger` (vermilion), `warning` (amber) and `success` (moss).

| Token | Role | Light | Dark |
|---|---|---|---|
| `--paper` | page background | `#F6F7F9` | `#0E1116` |
| `--surface` | columns, panels | `#FFFFFF` | `#161A21` |
| `--surface-raised` | cards, popovers, menus | `#FFFFFF` | `#1D222B` |
| `--ink` | primary text | `#15171C` | `#E7E9EE` |
| `--ink-muted` | secondary text, icons | `#5B6170` | `#9AA1AE` |
| `--line` | borders, dividers | `#E1E4EA` | `#272D37` |
| `--indigo` | brand, primary actions, focus ring, links | `#2B4C9B` | `#8EA7E6` |
| `--indigo-soft` | selected rows, active filters | `#E8EDF8` | `#1E2840` |
| `--vermilion` | overdue, critical, destructive | `#B4321F` | `#F07A66` |
| `--amber` | due soon, high priority, WIP limit reached | `#8F5B00` | `#E6B35C` |
| `--moss` | done, success | `#1F7A4D` | `#6FCB98` |

Rules:

- Text tokens meet **4.5:1** against `--paper`, `--surface` and `--surface-raised` in both themes. Large text and icons meet **3:1**. This is checked in CI (see section 8).
- `--vermilion`, `--amber` and `--moss` are status colors. They never decorate. If a screen has no late, critical or done items, it shows no status color.
- Color is never the only signal. Overdue also says "Overdue" or shows a clock icon. Priority also has a label in the card's accessible name.

### 3.2 User-chosen colors (tags, covers, board colors, avatars)

Users pick from a fixed palette of 10 hues. Each hue has a pre-computed pair per theme so text on a tinted chip always reaches 4.5:1:

- Chip background: the hue at about 14% opacity over the surface.
- Chip text: a darker shade of the hue in light mode, a lighter shade in dark mode. Never the raw hue on its own tint (that is what fails today: `#ea580c` on its own tint is 2.8:1).
- Avatar initials: white on the hue only when the pair reaches 4.5:1. Otherwise use the dark shade for the background.

The palette lives in one module (`src/lib/palette.ts`) with a unit test that asserts every pair's contrast. Because users can also enter a custom hex color, text colors are derived at render time: the hue is shifted toward black (light) or white (dark) until it reaches 4.5:1 on its own tint.

### 3.3 Typography

One family: **IBM Plex Sans**, bundled with the app through `@fontsource` (no requests to Google or any CDN: self-hosted means no third-party calls). It covers every UI language (Latin with Polish, Czech, German, Italian, French, Spanish, Portuguese and Dutch, and Cyrillic for Ukrainian), has a large x-height that holds up at 13px, and tabular figures for counts and dates.

| Step | Size / line height | Weight | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | 500 | chip text, timestamps |
| `text-sm` | 13 / 18 | 400, 500 | card meta, secondary UI |
| `text-base` | 14 / 20 | 400, 500 | default UI text, card titles |
| `text-md` | 16 / 24 | 400 | long-form text: descriptions, comments |
| `text-lg` | 20 / 28 | 600 | page and panel titles |
| `text-xl` | 24 / 32 | 600 | board title |

Rules:

- **Sentence case everywhere.** No all-caps headings, tags or category names. Section headings use weight and size, not uppercase and letter-spacing.
- Counts, dates and WIP numbers use `font-variant-numeric: tabular-nums` so they do not jitter.
- Long-form text (descriptions, comments) is capped at about 70 characters per line.
- Minimum text size is 12px. Today some chips use 10px; that goes away.

### 3.4 Space, shape, depth

- **Spacing** is a 4px grid. Common steps: 4, 8, 12, 16, 24, 32. Card padding 12, column gap 12, page gutter 16 (mobile) and 24 (desktop).
- **Radius** follows hierarchy, so nesting reads correctly: 6px for controls and chips, 8px for cards, 12px for columns, panels, menus and dialogs, full for avatars only.
- **Elevation** has three levels and only floating things use shadows:
  - Level 0: flat, separated by `--line` (columns, panels).
  - Level 1: cards. A 1px line plus a very soft shadow, so they read as movable objects.
  - Level 2: menus, popovers, the card panel and the drag preview. A distinct, larger shadow.

### 3.5 Motion

- Durations: 120ms for hover and press feedback, 180ms for opening menus and panels, 220ms for a card settling after a drop.
- Motion only answers a user action or a live change from a teammate (a card moved by someone else glides to its new place instead of jumping).
- `prefers-reduced-motion: reduce` turns all of it into instant changes. No exceptions.

### 3.6 Iconography

One icon set (Lucide), 16px in dense UI and 20px in navigation, 1.5px stroke, `currentColor`. Icons that carry meaning on their own (subtasks, comments, attachments, blocked) always have an accessible label or sit next to a number with one.

## 4. Layout

```
+--------------------------------------------------------------------------------+
| [K] Kanbun   Boards  My tasks   Website relaunch v      [Search  /]  (bell) (MN)|
+--------------------------------------------------------------------------------+
| Website relaunch                      [Filter] [Members] [...]                 |
+-----------------+-----------------+-----------------+--------------------------+
| Backlog       2 | To do         3 | In progress 3/3 | Review 2/2   |   card    |
| +-------------+ | +-------------+ | +-------------+ | +----------+ |  panel    |
| | card        | | | card        | | | card        | | | card     | |  (opens   |
| +-------------+ | +-------------+ | +-------------+ | +----------+ |  on the   |
| + Add card      | + Add card      | + Add card      | + Add card   |  right)   |
+-----------------+-----------------+-----------------+--------------+-----------+
```

- The board is full-bleed and scrolls horizontally. Columns are 288px wide. The page has no footer on the board view.
- Opening a card slides a panel in from the right (desktop) or a full-height sheet (phone). The URL changes to the card's URL, so links and the back button work, but the board stays rendered underneath with its scroll and filters intact.
- Other pages (boards list, settings, profile) use a centered column with a 1200px max width.
- On phones, the board shows one column at a time with swipe between columns and a column switcher at the top.

### 4.1 Card anatomy

The card is the one place where the design spends its boldness. Everything else stays quiet.

```
 |                                        |
 |  Responsive navigation                 |   title: text-base, 500, up to 3 lines
 |  Frontend  Design                      |   tags: sentence-case chips
 |  [clock] in 2 days   [list] 3/4  [chat] 2       (MN)(TW) |
 |                                        |
 ^
 priority notch: a 3px left edge, only for High (amber) and Critical (vermilion)
```

- **Priority** is a notch on the left edge, shown only for High and Critical. Low and Normal show nothing.
- **Deadline** is relative ("Tomorrow", "in 3 days", "2 days late") with the absolute date in a tooltip. Late is vermilion with a clock icon; due within 48 hours is amber.
- **Blocked** cards show a "Blocked" chip with a lock icon, not a lone "!".
- **Meta** uses icons with numbers (subtasks 3/4, comments 2), never abbreviations like "2c".
- **Assignees** are an avatar stack with a 2px ring in the surface color so overlapping avatars stay distinct; more than three collapses to "+2".
- **Cover color** is a 4px band across the top.

## 5. Components

Kanbun owns its components (in `src/components/ui/`), built on **React Aria Components** for behavior and accessibility, styled with the tokens above. Every component below ships with keyboard support, visible focus, and translations.

| Component | Notes |
|---|---|
| Button | Variants: primary (indigo), secondary (line), ghost, danger. Sizes 28 / 32 / 40px. Loading state keeps width. |
| Icon button | Always has an accessible label and a tooltip. Hit area at least 32px (44px on touch). |
| Text field, textarea | Label above, help or error text below. Errors say what to do. |
| Combobox | Replaces native `<select>` for anything longer than 7 options (assignees, blocking cards, tags), with search. |
| Menu, context menu | One component for the card "..." menu and right-click. Destructive items last, in vermilion, separated. |
| Popover | Filters, date picker, quick edit. |
| Dialog | Only for focused tasks (create board) and irreversible confirmations. Never `window.confirm`. |
| Sheet / side panel | Card details. |
| Toast | Bottom-left, one at a time, with an action ("Undo", "View"). Announced to screen readers. |
| Tooltip | For icon buttons and truncated text. Never the only place information lives. |
| Avatar, avatar stack | Initials fallback from the validated palette. Online dot uses `--moss` with a ring. |
| Chip / tag | Sentence case, 12px, validated contrast pairs. |
| Date picker | Shared component, locale-aware, with quick picks: Today, Tomorrow, Next week, Clear. |
| Empty state | One sentence about what goes here and the action that fills it. |
| Skeleton | Matches the final layout so nothing shifts when data arrives. |
| Kbd | Shows shortcuts in menus and tooltips. |

## 6. Interaction standards

- **Drag and drop** uses `@dnd-kit`: pointer, touch (long-press to pick up) and keyboard (Space to lift, arrows to move, Space to drop, Esc to cancel), with screen-reader announcements ("Moved Responsive navigation to Review, position 2 of 3").
- **Non-drag alternative:** every card menu has "Move to..." (column and position) so nobody has to drag.
- **Swimlanes** (board grouped by assignee, priority or tag) keep the same gestures: dropping a card in another lane changes that field, Shift+Up/Down moves a picked-up card to the lane above or below, and announcements name the column and the lane. Lane headers are quiet (name, count, collapse); a card with several values shows a dashed read-only copy in its other lanes.
- **Optimistic updates:** moves and edits apply instantly; on server failure the change rolls back and a toast explains why.
- **Keyboard shortcuts** (shown in a `?` overlay): `/` search, `n` new card in focused column, `e` edit title, `a` assign to me, `d` set deadline, `Enter` open card, `Esc` close panel, `j`/`k` and arrows to move focus between cards. Shortcuts never fire while typing in a field.
- **Live updates** from teammates animate into place and never steal focus or scroll.
- **Errors** never show a raw error page for a failed action. Server actions return a typed result; the UI shows a toast with what failed and what to do.

## 7. Writing

- Sentence case, plain verbs, no filler. "Add card", not "Create a new card item".
- Buttons say what happens: "Delete column", "Move to Review", "Save changes".
- Confirmations name the consequence: "Delete the column "Backlog" and its 2 cards?"
- Errors say what happened and how to fix it, without apologizing: "Couldn't move the card: you are no longer a member of this board."
- Empty states invite action: "No cards yet. Add the first one, or press N."
- Plan for translation: German and Polish run about 35% longer than English, so no fixed-width text containers. Placeholders use `{name}` format.
- No em dashes in UI copy.

## 8. Accessibility and quality gates

Target: **WCAG 2.2 AA** in both themes, at 200% zoom, and at 320px width.

Enforced in CI:

- `axe-core` on every page in Playwright e2e tests, zero violations.
- Palette contrast unit test (section 3.2).
- Lighthouse accessibility and best practices at 100 on the board, boards list and card panel.
- i18n completeness check: every key in `en.json` exists in every locale.

Reviewed by hand on every UI change:

- Keyboard-only walkthrough of the changed flow.
- Screen reader spot check (VoiceOver) for anything with custom interaction.
- Light and dark screenshots, desktop and 390px phone, attached to the PR.
