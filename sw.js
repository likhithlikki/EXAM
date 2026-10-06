/* ===================== SERVICE WORKER =====================
 * Makes the app installable-and-usable with zero connectivity, which is
 * what turns "Add to Home Screen" into a real app icon instead of a
 * bookmark that breaks offline. Two jobs, kept deliberately separate:
 *
 * 1. PRECACHE (install step): every static file the app shell needs to
 *    boot and render — HTML/JS/CSS, subjects.json, and every static
 *    question-bank JSON file — is cached up front, on install. This means
 *    a subject works offline on FIRST OPEN, without requiring the student
 *    to have opened it once online already.
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
const CACHE_VERSION = "v3"; // bump this string on every deploy to force a clean cache refresh
const SHELL_CACHE = "ecet-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "ecet-runtime-" + CACHE_VERSION;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./about.html",
  "./404.html",
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
  "./digital-electronics.json",
  "./data-structures-c.json",
  "./software-engineering.json",
  "./computer-organisation-microprocessors.json",
  "./computer-networks-cyber-security.json",
  "./operating-systems.json",
  "./dbms.json",
  "./java-programming.json",
  "./android-programming.json",
  "./python-programming.json",
  "./web-technologies.json",
  "./internet-of-things.json",
  "./big-data-cloud-computing.json",
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

  // NEVER intercept the Apps Script backend — see file header.
  if (req.url.includes("script.google.com")) return;

  event.respondWith(
    caches.match(req).then((cached) => {
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
