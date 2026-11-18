# Offline use and installing Kanbun

Kanbun is an installable Progressive Web App. Boards you opened before stay readable without a connection, and card edits made offline are sent when the connection returns.

## Requirements for operators

- **Serve Kanbun over HTTPS.** Browsers only run service workers on `https://` origins and on `http://localhost`. On a plain-HTTP LAN address the app works as before, without offline support or install prompts.
- **Do not cache `/sw.js` in a reverse proxy or CDN.** Kanbun sends `Cache-Control: no-cache, no-store, must-revalidate` for it; keep that header, or browsers may pick up new versions late.
- Nothing else to configure: no environment variable, no extra service.

Installing: Chrome, Edge and Android offer "Install app" from the address bar or menu; on iOS use Share, then "Add to Home Screen". The installed app opens on the boards list and has shortcuts to "My tasks" and "Boards".

## What works offline

- **Reading boards opened before** (board, list and calendar view), the boards list and "My tasks" if they were opened before. Pages that were never opened show a "You are offline" page.
- A banner says "Offline: showing data from ..." when the browser is offline or the live connection has been down for more than 10 seconds.
- **Queued edits** on a board: moving cards (drag and drop, keyboard, "Move to"), renaming cards, priority, deadline, cover color, assignees and tags from the card menu, and adding cards. They show up right away; "N changes waiting to sync" counts them. On reconnect they are sent in order through the normal server actions, then the board refreshes.
- **Reading cards offline.** Every card you open while online (side panel or full page) is stored with its description, checklist, comments, history, attachment list, assignees, tags, deadline and dependencies. When you open a board, a lightweight copy of all its cards is fetched in the background as well (see below), so cards you never opened can be read too. Offline, clicking a card opens these stored details in the side panel, with "Offline: read-only, from <time>" at the top. A full card page reloaded offline shows the same view. Cards that were never stored show what the board knows (title, priority, deadline, assignees, tags) and say so.
- **Queued edits in the offline card panel:** title, priority, deadline, assignees, tags, checking or unchecking checklist items, and new comments. A new comment shows as "Pending" in the timeline until it is posted. Everything else in the card (description, adding or editing checklist items, attachments, dependencies, cover, deleting) is shown read-only.
- Everything else (settings, column changes, deleting, the online card panel's other editors) needs the server. While offline those buttons say "You are offline" instead of failing, and typed text (for example a comment draft in the online panel) is kept.

## Conflicts

The last write wins: a queued edit overwrites what others changed meanwhile on the same field. Assignee, tag and checklist changes carry the intended state ("assigned", "not assigned", "done", "not done"), so replaying them never flips a change someone else made. Comments are posted in the order they were written through the normal comment action (mentions and notifications work as usual); if the connection drops exactly while one is being sent, it can be posted twice. If the server rejects a queued edit (the card was deleted, access was removed), Kanbun drops it and lists what could not be synced in a message. A card created offline gets a temporary id until the server assigns the real one; later queued edits of that card use the real id.

## Privacy and storage

- What is stored, per browser: the HTML of pages you visited (Cache Storage, in a cache named after your user id), the latest data of each board you opened, the details of the last 200 cards you opened, a lightweight copy of the cards of each board you opened, and the queue of unsynced edits (IndexedDB, keyed by your user id), and the app's static files (JavaScript, CSS, fonts, icons).
- Never stored by Kanbun: API responses (the service worker skips `/api/*`), sign-in routes, the settings and admin pages (they can show a pending two-factor secret, the user list and the audit log), live event streams, attachment downloads and images, and server action responses.
- **Attachments offline:** the card shows the file list (name, size, who added it). Images appear only when the browser still has them in its own HTTP cache from viewing them online (the attachment route allows private caching for up to an hour); otherwise a file icon is shown. Kanbun deliberately does not copy attachments into offline storage: files can be large and sensitive, and the browser cache expires on its own.
- **Logging out deletes the stored pages, board data, card details and queue** of that browser. If there are unsynced edits, Kanbun asks first. Opening the login page also clears the stored pages, and data of any user other than the one signed in is deleted as soon as the app starts, so a second person on the same device never sees the first person's boards.
- A session that simply expires (no logout) leaves the stored copies in place until the next sign-in on that browser: someone with access to the unlocked device could read boards offline. On shared devices, log out.

## How it works (for contributors)

- `public/sw.js`: hand-written service worker. Cache first for `/_next/static/*` (content hashed), network first with a cache fallback for page navigations, stale-while-revalidate for icons and the manifest. React Server Component requests (`RSC: 1`, `?_rsc=`) are not cached: offline they fail, Next.js falls back to a full navigation, and the worker answers that from the page cache. Pages reached by client navigation are stored by a `cache-page` message from the app.
- `src/components/pwa/PwaClient.tsx`: registers the worker in production builds as `/sw.js?v=<version>`, shows "A new version of Kanbun is available. Reload" when an update is waiting, tells the worker who is signed in, and replays the outbox.
- `src/lib/outbox.ts`: pure outbox logic (ordering, coalescing, temporary ids, replay, applying queued edits for display), unit tested in `src/lib/__tests__/outbox.test.ts`.
- `src/lib/offline-store.ts` and `src/lib/idb.ts`: IndexedDB persistence, keyed by user. Only one tab replays at a time (Web Locks).
- `src/components/board/useOfflineBoard.ts`: the board's data source (newer of server data and the stored snapshot, plus queued edits) and its mutation runner.
- `src/lib/offline-card.ts`: pure mapping of a card to its stored form (`toOfflineCard`, with `FULL_LIMITS` for opened cards and `LITE_LIMITS` for the board copy) and `applyCardOutbox` for showing queued edits on stored details, unit tested in `src/lib/__tests__/offline-card.test.ts`.
- `src/components/card/CardOffline.tsx` stores what the card view rendered; `OfflineCardView.tsx` and `OfflineCardSheet.tsx` show it offline.
- `GET /api/boards/[id]/offline` (`src/server/offline-cards.ts`): the lightweight copy of a board's cards, for board members only, sent with `Cache-Control: private, no-store`. The board page fetches it in the background at most every 10 minutes per board.

## Lightweight card copy: size

The lightweight copy is fetched for every board you open, so it is kept small: per card the description (first 2,000 characters), the checklist (first 50 items), the 3 newest comments (500 characters each), up to 20 attachment names, assignees, tags, deadline and dependencies, and no history. At most 1,000 cards per board (most recently changed first).

Measured on the 500-card board from `npm run seed:large`: 416 KB of JSON, 37 KB gzip-compressed on the wire (Next.js compresses responses), about 40 ms on the server. That is cheap enough to fetch in the background, so it is on for every board. Long descriptions and comments make it larger; the limits above cap a 500-card board at roughly 2.5 MB of JSON in the worst case. A card you open is stored in full (up to 200 comments and 300 history entries), replacing the lightweight copy when it is newer.
