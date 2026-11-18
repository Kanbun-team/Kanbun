/* Kanbun service worker: offline-tolerant PWA.
 *
 * Registered by src/components/pwa/PwaClient.tsx (production builds only) as
 * /sw.js?v=<app version>. What it caches, and what it never caches:
 *
 * - /_next/static/* (content-hashed JS, CSS, fonts): cache first, shared by
 *   all users because it holds no user data.
 * - /icons/*, /favicon.ico, /manifest.webmanifest and the /offline page:
 *   the app shell, refreshed in the background.
 * - Page navigations (HTML): network first; a successful page is stored in a
 *   cache named after the signed-in user, so boards opened before can be
 *   reloaded offline. The cache of any other user is deleted as soon as the
 *   page reports who is signed in, on logout and whenever /login is opened.
 * - Never cached: /api/* (auth, live event streams, attachments downloads,
 *   heartbeats), React Server Component requests (client navigations; offline
 *   they fail and Next.js falls back to a full navigation, which is served
 *   from the page cache), non-GET requests and other origins.
 *
 * Board data is also kept in IndexedDB by the page itself (see
 * src/lib/offline-store.ts), which is fresher than the cached HTML.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = "kanbun-static";
const SHELL_CACHE = `kanbun-shell-${VERSION}`;
const PAGES_PREFIX = "kanbun-pages-";
const META_CACHE = "kanbun-meta";
const META_USER = "/__kanbun/user";
const OFFLINE_URL = "/offline";
const SHELL_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icons/kanbun-192.png", "/icons/kanbun-512.png", "/icons/icon-192.svg"];
const MAX_STATIC_ENTRIES = 400;
const MAX_PAGE_ENTRIES = 100;
/** A page cached this recently is not fetched again by a "cache-page" message. */
const PAGE_FRESH_MS = 60_000;
/**
 * Pages that are never stored: they belong to no user, or hold secrets
 * (settings can show a pending two-factor secret, admin pages the user list
 * and the audit log).
 */
const UNCACHED_PAGES = [/^\/login/, /^\/setup/, /^\/offline/, /^\/api\//, /^\/settings/, /^\/admin/];

let currentUser; // undefined: not read yet, null: nobody signed in
// User changes run one after another, and readers wait for them, so a page
// is never stored under a user that is being replaced.
let userChain = Promise.resolve();

async function getUser() {
  await userChain;
  return readUser();
}

async function readUser() {
  if (currentUser !== undefined) return currentUser;
  try {
    const meta = await caches.open(META_CACHE);
    const res = await meta.match(META_USER);
    currentUser = res ? (await res.text()) || null : null;
  } catch {
    currentUser = null;
  }
  return currentUser;
}

function setUser(userId) {
  userChain = userChain.then(() => applyUser(userId)).catch(() => {});
  return userChain;
}

async function applyUser(userId) {
  const previous = await readUser();
  currentUser = userId;
  const meta = await caches.open(META_CACHE);
  if (userId) await meta.put(META_USER, new Response(userId));
  else await meta.delete(META_USER);
  // Only the signed-in user's pages are kept.
  const keep = userId ? PAGES_PREFIX + userId : null;
  if (previous !== userId || !userId) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(PAGES_PREFIX) && n !== keep).map((n) => caches.delete(n)));
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isShellAsset(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest"
  );
}

function pageCacheable(url) {
  return !UNCACHED_PAGES.some((re) => re.test(url.pathname));
}

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

/** Stores a page for the current user, with the time it was stored. */
async function storePage(url, res) {
  const userId = await getUser();
  if (!userId || !res.ok || res.status !== 200 || res.redirected || !isHtml(res)) return;
  const headers = new Headers(res.headers);
  headers.set("x-kanbun-cached-at", String(Date.now()));
  const body = await res.blob();
  // The user may have changed while the body was read.
  if ((await getUser()) !== userId) return;
  const cache = await caches.open(PAGES_PREFIX + userId);
  await cache.put(url, new Response(body, { status: 200, statusText: "OK", headers }));
  await trim(cache, MAX_PAGE_ENTRIES);
}

async function cachedPage(url) {
  const userId = await getUser();
  if (!userId) return undefined;
  const cache = await caches.open(PAGES_PREFIX + userId);
  return (
    (await cache.match(url, { ignoreVary: true })) ||
    // Same page with other query parameters (e.g. ?view=list).
    (await cache.match(url, { ignoreVary: true, ignoreSearch: true }))
  );
}

async function offlinePage() {
  const cache = await caches.open(SHELL_CACHE);
  const res = await cache.match(OFFLINE_URL, { ignoreVary: true });
  return (
    res ||
    new Response("<!doctype html><title>Offline</title><h1>You are offline</h1>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  );
}

async function handleNavigation(event) {
  const url = new URL(event.request.url);
  // Opening the login page means nobody (or somebody else) is signing in:
  // forget the previous user's pages before anything else is stored.
  if (/^\/(login|setup)/.test(url.pathname)) await setUser(null);
  try {
    const res = await fetch(event.request);
    if (res.redirected && new URL(res.url).pathname.startsWith("/login")) {
      await setUser(null);
    } else if (pageCacheable(url)) {
      event.waitUntil(storePage(url.href, res.clone()).catch(() => {}));
    }
    return res;
  } catch (error) {
    const cached = pageCacheable(url) ? await cachedPage(url.href) : undefined;
    if (cached) return cached;
    if (/^\/api\//.test(url.pathname)) throw error;
    return offlinePage();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) {
    await cache.put(request, res.clone());
    void trim(cache, MAX_STATIC_ENTRIES);
  }
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(event.request, { ignoreVary: true });
  const network = fetch(event.request)
    .then(async (res) => {
      if (res.ok && res.status === 200) await cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  return (await network) || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_URLS.map((u) =>
          fetch(u, { credentials: "same-origin", cache: "no-cache" })
            .then((res) => (res.ok && !res.redirected ? cache.put(u, res) : undefined))
            .catch(() => undefined)
        )
      );
      // The first install takes over right away; updates wait until the user
      // chooses to reload (see the SKIP_WAITING message).
      if (!self.registration.active) await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("kanbun-shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  // Only pages of this origin can message the worker; check anyway.
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data || {};
  switch (data.type) {
    case "SKIP_WAITING":
      event.waitUntil(self.skipWaiting());
      break;
    case "user":
      if (typeof data.userId === "string" && data.userId) event.waitUntil(setUser(data.userId));
      break;
    case "logout":
      event.waitUntil(setUser(null));
      break;
    case "precache":
      // Assets the page loaded before the worker controlled it.
      if (Array.isArray(data.urls)) {
        event.waitUntil(
          (async () => {
            const cache = await caches.open(STATIC_CACHE);
            for (const raw of data.urls.slice(0, 200)) {
              try {
                const url = new URL(raw, self.location.origin);
                if (url.origin !== self.location.origin || !isStaticAsset(url)) continue;
                if (await cache.match(url.href)) continue;
                const res = await fetch(url.href);
                if (res.ok && res.status === 200) await cache.put(url.href, res);
              } catch {
                // Best effort.
              }
            }
            await trim(cache, MAX_STATIC_ENTRIES);
          })()
        );
      }
      break;
    case "cache-page":
      // A page reached by client navigation: store its HTML for offline reloads.
      if (typeof data.url === "string") {
        event.waitUntil(
          (async () => {
            const url = new URL(data.url, self.location.origin);
            if (url.origin !== self.location.origin || !pageCacheable(url)) return;
            const userId = await getUser();
            if (!userId) return;
            const cache = await caches.open(PAGES_PREFIX + userId);
            const hit = await cache.match(url.href, { ignoreVary: true });
            const at = Number(hit?.headers.get("x-kanbun-cached-at") || 0);
            if (hit && Date.now() - at < PAGE_FRESH_MS) return;
            try {
              const res = await fetch(url.href, { credentials: "same-origin", headers: { Accept: "text/html" } });
              await storePage(url.href, res);
            } catch {
              // Offline: keep what is cached.
            }
          })()
        );
      }
      break;
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    // Opening an auth route (sign out of a broken session, SSO callback)
    // changes who is signed in: forget the previous user's pages.
    if (request.mode === "navigate" && url.pathname.startsWith("/api/auth/")) event.waitUntil(setUser(null));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // Everything else, including RSC payloads (?_rsc=, RSC: 1), goes to the network.
});
