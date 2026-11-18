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
- Everything else (comments, card panel, settings, column changes, deleting) needs the server. While offline those buttons say "You are offline" instead of failing, and typed text (for example a comment draft) is kept.
- Card details are not stored offline; opening a card while offline shows a short message and stays on the board.

## Conflicts

The last write wins: a queued edit overwrites what others changed meanwhile on the same field. Assignee and tag changes carry the intended state ("assigned", "not assigned"), so replaying them never flips a change someone else made. If the server rejects a queued edit (the card was deleted, access was removed), Kanbun drops it and lists what could not be synced in a message. A card created offline gets a temporary id until the server assigns the real one; later queued edits of that card use the real id.

## Privacy and storage

- What is stored, per browser: the HTML of pages you visited (Cache Storage, in a cache named after your user id), the latest data of each board you opened and the queue of unsynced edits (IndexedDB), and the app's static files (JavaScript, CSS, fonts, icons).
- Never stored: API responses, sign-in routes, live event streams, attachment downloads and images, and server action responses.
- **Logging out deletes the stored pages, board data and queue** of that browser. If there are unsynced edits, Kanbun asks first. Opening the login page also clears the stored pages, and data of any user other than the one signed in is deleted as soon as the app starts, so a second person on the same device never sees the first person's boards.
- A session that simply expires (no logout) leaves the stored copies in place until the next sign-in on that browser: someone with access to the unlocked device could read boards offline. On shared devices, log out.

## How it works (for contributors)

- `public/sw.js`: hand-written service worker. Cache first for `/_next/static/*` (content hashed), network first with a cache fallback for page navigations, stale-while-revalidate for icons and the manifest. React Server Component requests (`RSC: 1`, `?_rsc=`) are not cached: offline they fail, Next.js falls back to a full navigation, and the worker answers that from the page cache. Pages reached by client navigation are stored by a `cache-page` message from the app.
- `src/components/pwa/PwaClient.tsx`: registers the worker in production builds as `/sw.js?v=<version>`, shows "A new version of Kanbun is available. Reload" when an update is waiting, tells the worker who is signed in, and replays the outbox.
- `src/lib/outbox.ts`: pure outbox logic (ordering, coalescing, temporary ids, replay, applying queued edits for display), unit tested in `src/lib/__tests__/outbox.test.ts`.
- `src/lib/offline-store.ts` and `src/lib/idb.ts`: IndexedDB persistence, keyed by user. Only one tab replays at a time (Web Locks).
- `src/components/board/useOfflineBoard.ts`: the board's data source (newer of server data and the stored snapshot, plus queued edits) and its mutation runner.
