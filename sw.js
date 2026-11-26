/* ===================== SERVICE WORKER =====================
 * Makes the app installable-and-usable with zero connectivity, which is
 * what turns "Add to Home Screen" into a real app icon instead of a
 * bookmark that breaks offline. Two jobs, kept deliberately separate:
 *
 * 1. PRECACHE (install step): only the small app shell — HTML/JS/CSS,
 *    manifest, icons, subjects.json and data/subjects.json — is cached up
 *    front, so the app boots offline. Question banks are NOT precached any
 *    more (12 files on every install was wasteful); each one is cached the
 *    first time it is opened (runtime cache below) and also saved to
 *    localStorage by cacheBankForOffline_ in app.js.
 * 2. RUNTIME CACHE (fetch handler): any other same-origin GET response
 *    (an updated subjects.json, a newly added subject file, etc.) is
 *    cached the first time it's fetched successfully, so it becomes
 *    available offline from then on too — this is on top of, not instead
 *    of, the offline question-bank cache the app itself keeps in
 *    localStorage (see cacheBankForOffline_ in app.js), which additionally
 *    stores server-imported (admin-added) questions that don't live in a
 *    static file at all.
 *
 * The Apps Script backend (script.google.com) is NEVER intercepted or
 * cached here — every request to it must always hit the real network (or
 * fail loudly) so apiGet/apiPost's own offline handling in app.js runs
 * (the outbox queue, cached dashboard/mistakes fallbacks, etc.) instead of
 * silently serving a stale cached API response.
 */
const CACHE_VERSION = "v13"; // bump this string on every deploy to force a clean cache refresh
const SHELL_CACHE = "ecet-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "ecet-runtime-" + CACHE_VERSION;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./about.html",
  "./404.html",
  "./practice-rules.js",
  "./fib-admin.html",
  "./fib-admin.css",
  "./fib-admin-api.js",
  "./privacy.html",
  "./terms.html",
  "./cookies.html",
  "./refund.html",
  "./app.js",
  "./style.css",
  "./legal.css",
  "./config.js",
  "./manifest.json",
  "./subjects.json",
  "./data/subjects.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Cache files individually rather than one addAll() call — a single
      // missing/renamed file in the list would otherwise fail the WHOLE
      // install and leave the service worker (and offline support) never
      // activated at all.
      Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn("SW precache skipped:", url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only ever handle simple GETs; POSTs (submitExam, submitRevision, etc.)
  // must always go straight to the network untouched.
  if (req.method !== "GET") return;

  const path = new URL(req.url).pathname;

  // Generated data (data/*.json, written by the GitHub sync job from Google Sheets):
  // network-first so data/export-meta.json is NEVER served stale (the "Update content"
  // poll and the ?v=<hash> cache-busting both depend on it), falling back to the cached
  // copy when offline. Responses are stored under the bare path (query string removed),
  // so there is exactly one cached copy per file instead of one per ?v= / ?t= URL, and
  // offline reads still find it whatever hash or timestamp the app asks for.
  if (/\/data\/.*\.json$/i.test(path)) {
    const u = new URL(req.url);
    u.search = "";
    const key = new Request(u.toString());
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(key, copy)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(key).then((hit) => hit || caches.match(req, { ignoreSearch: true })))
    );
    return;
  }

  // practice-rules.js holds the editable answer-checking rules: network-first so an
  // edit shows on the very next reload (cached copy only used when offline).
  if (/\/practice-rules\.js$/i.test(path)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // NEVER intercept the Apps Script backend — see file header.
  if (req.url.includes("script.google.com")) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // Cache a copy of anything that loads successfully (same-origin
          // or opaque cross-origin like Google Fonts / the SheetJS CDN)
          // so it's available next time there's no connection.
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached); // network failed — fall back to whatever's cached (may be undefined)

      // Cache-first for instant offline loads; network still runs in the
      // background to keep the runtime cache fresh for next time.
      return cached || network;
    })
  );
});
