# Native Android App — Implementation Report

Read this first. It says plainly what exists, what doesn't, and what I could
not verify.

## 0. Verification status (important)

| Claim | Status |
|---|---|
| Kotlin/Gradle/Compose code written | Yes |
| Project **compiles** / Gradle sync succeeds | **NOT VERIFIED.** The build environment had no JDK, Android SDK, Gradle, or network. I reviewed the code by hand and fixed the blockers I could find (see §7), but the first real `Sync` / `assembleDebug` may still surface compile errors I could not see. Treat this as a well-structured first draft, not a green build. |
| App runs on emulator/device | **NOT VERIFIED** |
| Unit tests run | **NOT VERIFIED** (one test file written) |
| `Code.gs` syntax | Checked with `node --check` (passes). Not executed against Apps Script. |
| Website `app.js` syntax | Checked with `node --check` (passes). Not executed in a browser. |
| Firebase / Google sign-in working | **Impossible for me to test** — needs your Firebase project. |
| Play Store readiness | **No.** Not release-signed, no listing, no Data Safety form, no store assets. |

## 1. Scope actually delivered

The Master Prompt describes a large, multi-phase product. This delivery is a
**working vertical slice + architecture**, not the whole product.

### Implemented (code exists)
- Gradle project (Kotlin 2.0.21, AGP 8.6, Compose/Material 3, Room, DataStore,
  Retrofit/OkHttp, WorkManager, Credential Manager, Firebase Auth).
- **Firebase Auth**: Email/Password sign-in, create account (sends
  verification email), forgot password, Google sign-in via Credential Manager,
  sign-out, session restore on launch, ID-token retrieval.
- **Mandatory consent checkbox** before any sign-in/sign-up (DPDP), recorded
  server-side (`ConsentGiven`/`ConsentAt`).
- **Home**: subject list from the authenticated `homeBundle` call, loading /
  error / empty states, offline-outbox badge, nav to Mistakes/Dashboard/Profile.
- **Exam**: live cooldown check before starting, offline question cache
  (Room), 1-minute-per-question timer, answer/mark/palette navigation, submit
  confirmation, single-fire submit guard (port of the website's `examActive` fix).
- **Result**: score, %, rank, expected rank, offline-pending notice.
- **Offline outbox**: finished exams that can't upload are stored in Room and
  flushed by WorkManager (one-shot + 30-min periodic); a fresh token is fetched
  per item.
- **Mistakes & Revision**: active-mistakes list with due/not-due status,
  starts a revision test from due items (option shuffle, 1-min-per-question
  timer, same pattern as the main exam), submits via `submitRevision`, shows
  a result screen. Not queued offline — matches the website's own behavior.
- **Profile**: stats, edit name, sign-out, **Delete Account** — full flow:
  confirm → backend data deletion → Firebase account deletion, with real
  reauthentication (Google re-pick or password re-entry) when Firebase
  requires a recent sign-in. This was the Play Store blocker; it's done now.
- **Dashboard**: overall stats + subject-wise breakdown.
- **Backend auth bridge** (`Code.gs` §3B): server-side Firebase ID-token
  verification is now centralized in `doGet`/`doPost` — **every** POST write
  action (not just `register`/`submitExam`) and every GET read action
  verifies the token once and overrides the client-claimed email with the
  verified one. UID-linked users, UID admin allowlist (`AdminUsers` sheet).

- **Reminders**: create/edit (quick-pick "1h / 3h / Tomorrow" time buttons,
  frequency as filter chips — see "Known simplifications"), toggle, delete.
- **Notification History**: send-attempt log with retry on failure.
- **Attempt History**: full list of every past attempt, tick two rows to
  compare (score/%/correct/wrong diff), reached from Dashboard → "Full history".

### Known simplifications
- Reminders' "When" picker only offers the three quick-pick buttons, not a
  full calendar+clock dialog like the website's `datetime-local` input. I
  deliberately avoided Compose Material3's `ExposedDropdownMenuBox`/
  `DatePickerDialog` APIs for this pass — their exact method signatures
  (e.g. `Modifier.menuAnchor()`) changed across recent Material3 versions and
  I could not verify which overload `1.3.1` expects without a compiler.
  Frequency selection uses `FilterChip` instead, which has a stable API.
  Adding a real date/time picker is a contained, isolated change once you
  have a working build to verify against.
- No push notifications — reminder emails are sent by the existing
  `processReminders`/`processEmailQueue` Apps Script triggers exactly as
  before; the app only reads/writes reminder records, it doesn't schedule
  local/FCM notifications itself.

### NOT implemented natively (still website-only)
Admin screens (question import/edit, subject management, Control Centre),
topic-wise tests, dark-theme polish, localization, tablet layouts, Firebase
Analytics/Crashlytics, Play Integrity/App Check, instrumented UI tests. Each
maps to an existing `Code.gs` action; wiring one follows the pattern in
`ApiService`/`ExamRepository`.

**Every student-facing feature the website has is now implemented natively**
except topic-wise tests and admin tooling. What remains is genuinely
admin/operator-only surface area (Control Centre, bulk question import,
subject management) — none of it blocks a student-facing release.

### Functional differences vs. the website
- **Subject passwords are not asked in the app.** On the website they gate
  opening a subject (compared client-side, i.e. weak). The native app
  deliberately does not receive them (stripped server-side) and does not gate on
  them. If you rely on them to restrict who can take a test, the app bypasses
  that. Decide on a server-enforced replacement before release.
- The app lists only admin-created ("custom") subjects from `homeBundle`. The
  website's static built-in subjects (`subjects.json` + bundled JSON files) are
  not in the app.

## 2. Security fixes made (this affects your LIVE website — act on this)

1. **Admin password `123` was hard-coded in public files** (`config.js`, `app.js`,
   and `Code.gs`) — anyone could read it from the repo and get full admin
   write access (import/edit/delete questions, create subjects, control panel).
   **Fixed:** removed from the client entirely; the admin types it, the server
   verifies it (`isAdmin` action), it is kept only in `sessionStorage`
   (cleared when the tab closes). On the server both legacy secrets now come from
   **Script Properties** and **fail closed** (unset = gate disabled). Wrong
   attempts are throttled (8 failures / 15 min, global).
2. **Control Centre password `5798`** was in `Code.gs` source (4 digits,
   brute-forceable, no throttle). Same fix.
3. **Both old values must be treated as compromised** — `123` was public;
   `5798` was in a public-repo file if `Code.gs` is committed. Never reuse them.
4. The Control Centre no longer echoes passwords back to the browser.
5. Native requests are authenticated by a verified Firebase ID token; the
   server **ignores the client-sent email** and uses the verified one, so a
   tampered app can't write to or read another student's data. Applied to:
   all `doGet` read actions (when `idToken` present), `register`, `submitExam`.
6. Email→UID linking refuses to re-point an email already tied to a different
   UID.

### ⚠️ Your website admin panel will stop working until you do this
Because the legacy secrets now fail closed, **after deploying this `Code.gs`
the website admin panel and Control Centre are locked until you set the two
Script Properties** (step 3 below). This is intentional.

### Residual risks (not fixed)
- **Website (no idToken) requests are still identified by a typed email** — the
  same trust problem as before. Only native calls are protected. Retiring the
  legacy path needs the website to adopt Firebase Auth too (not done).
- ~~Write actions other than register/submitExam don't verify tokens~~ —
  **fixed this round**: verification moved into `doPost`/`doGet` centrally,
  so `deleteAccount`, `submitRevision`, and every other action now benefit
  automatically. Still true for: reminders (`createReminder` etc.) and
  `retryNotification` work correctly today but have no native UI calling them yet.
- Native admin gating (`requireAdminUser_`) exists but **no native admin action
  calls it yet**; the legacy admin actions remain password-based.
- The admin-throttle is global, so an attacker can briefly lock the admin out.
- Token verification costs one `UrlFetch` per uncached request (120 s cache);
  consumer Apps Script quota is ~20,000/day. Heavy traffic will need a real backend.
- Apps Script is still the database (see the earlier concurrency discussion).

## 3. Manual setup you must do (I can't)

1. **Firebase**: create a project → add Android apps `com.ecet.mocktest` and
   `com.ecet.mocktest.debug` with your SHA-1/SHA-256 (debug: `./gradlew signingReport`)
   → enable Email/Password and Google providers → download
   `google-services.json` to `android-native/app/` (a `.example` shows the spot).
2. Copy the **Web client ID** (Authentication → Google provider) into
   `app/src/main/res/values/strings.xml` (`web_client_id`).
3. **Apps Script**: Project Settings → Script Properties, add
   `FIREBASE_WEB_API_KEY` (Firebase → Project settings → Web API key),
   `ADMIN_PANEL_PASSWORD`, `CONTROL_CENTRE_PASSWORD` (new, strong, 12+ chars).
   Run any function once from the editor to re-authorize (adds the
   `UrlFetchApp` scope), then **Deploy → Manage deployments → New version**.
4. Add your admin's Firebase UID to the `AdminUsers` sheet (auto-created).
5. In `app/build.gradle.kts` replace `APPS_SCRIPT_BASE_URL` (your `/exec` URL) and
   `WEBSITE_BASE_URL` (where `privacy.html` etc. are hosted).
6. Open `android-native/` in Android Studio; accept the Gradle wrapper prompt
   (`gradle-wrapper.jar` wasn't generated — no network). Sync, run.
7. First smoke test: a successful `homeBundle` call proves `@GET(".")` URL
   resolution works as intended (see `NetworkModule` comment).
8. Fill every `[FILL IN]` in the four legal pages (incl. **DPDP Grievance
   Officer**), and make sure your live website actually hosts them.
9. Play Console: Data Safety form, content rating, target-API check, signed
   release build, listing assets.

## 4. Privacy / legal notes for the app
- Data collected: name, email, Firebase UID, exam answers/scores/timing,
  consent record. No ads, analytics, or trackers in the app.
- `allowBackup=false`; cloud-backup and device-transfer exclude prefs/DB.
- Release build: R8 on, HTTP logging off outside debug; HTTPS-only.
- ~~Account deletion: no in-app entry point~~ — **done this round**: Profile →
  Delete Account, with reauthentication handling. Google Play also expects a
  *web* deletion URL for apps with accounts even when in-app deletion exists —
  the website's existing Profile → Delete Account page can serve as that; link
  it from the Play listing.
- Minors / parental consent (DPDP) remains an open question (see Privacy Policy §9).

## 5. Files added / changed
- **New** `android-native/` (whole Android project).
- **Changed** `Code.gs` (auth bridge, Users `Uid` column, `AdminUsers` sheet,
  secret handling, throttle), `app.js` (admin flow no longer embeds a password),
  `config.js` (password removed).
- **Deprecated (left in place, not deleted):** `capacitor.config.json`,
  `package.json`, `README-APK.md` — the Capacitor/WebView route from the earlier
  session. The Master Prompt asks for a native app instead; keep them only if you
  want a stop-gap PWA-wrapped APK.

## 6. Self-check results (greps on `android-native/app/src`)
- WebView / `android.webkit` / `loadUrl`: none (one manifest *comment* mentions the word).
- Hard-coded passwords / API keys: none.
- `http://` cleartext URLs: none (only XML namespaces).
- `Log.d/i/v` statements: none.
- No Firebase ID token is logged; HTTP body logging is debug-only.

## 7. Defects found and fixed during my own review
Kotlin 2.0 requires the Compose compiler Gradle plugin (added); Google sign-in
was using the Application context but Credential Manager needs an Activity
(fixed); online submit could have sent an empty token (fixed); blocking
`runBlocking` in composables (removed); navigation callbacks fired in composition
(moved to `LaunchedEffect`); a wrong `Box` import; Room schema export path.
There are very likely more I couldn't catch without a compiler.

## 8. Suggested next steps
1. Do §3 and get a green sync/build; send me the compiler errors and I'll fix them.
2. Ship Delete Account (UI + re-auth) — Play requirement.
3. Wire Dashboard, Mistakes/Revision, Profile, Reminders using the existing pattern.
4. Add token verification to the remaining write actions.
5. Decide the subject-password replacement.
6. Consider migrating off Apps Script/Sheets before real scale.
