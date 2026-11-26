# Turning this into an Android APK

The site itself is already a full PWA (installable, works offline, no browser
address bar — see `manifest.json` and `sw.js`). That alone is enough for most
students: "Add to Home Screen" in Chrome gives them an app icon and an
app-like window with zero extra work.

If you specifically want a real, installable `.apk` file (for the Play Store,
or to share directly), this project is now pre-configured for **Capacitor**,
which wraps the existing site as-is — no rewrite, no separate codebase to
maintain. You keep editing `app.js`/`index.html`/etc. exactly as before.

## Prerequisites

- [Node.js](https://nodejs.org) (v18 or newer) and npm
- [Android Studio](https://developer.android.com/studio) installed, with an
  Android SDK configured (Android Studio prompts you through this on first
  launch)

## One-time setup

Run these from this project's root folder (where `capacitor.config.json`
already lives):

```bash
npm install
npx cap add android
```

This creates an `android/` folder containing a native Android project that
simply loads this site's files as its UI.

**Before your first real build**, open `capacitor.config.json` and change
`"appId"` from `"com.ecet.mocktest"` to your own reverse-domain identifier
(e.g. `com.yourname.ecettest`) — this must be globally unique if you ever
publish to the Play Store, and can't be changed later without it counting as
a different app.

## Every time you change the website files

Whenever you edit `app.js`, `index.html`, `style.css`, `Code.gs`'s frontend
counterpart, or add/change question JSON files, re-sync them into the native
project before rebuilding:

```bash
npx cap sync android
```

## Building the APK

```bash
npx cap open android
```

This opens the project in Android Studio. From there:

1. Wait for Gradle to finish syncing (first time can take a few minutes).
2. Go to **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Once it finishes, click **locate** in the notification — your APK is at
   `android/app/build/outputs/apk/debug/app-debug.apk`.

That debug APK can be installed directly on any Android device (enable
"Install from unknown sources" if prompted) or shared as a file.

### For a Play Store release build

A debug APK is fine for testing/sharing directly, but the Play Store needs a
**signed release build**. In Android Studio: **Build → Generate Signed Bundle
/ APK**, create (or reuse) a keystore, and follow the wizard — Google's own
guide covers this in detail: https://developer.android.com/studio/publish/app-signing

## Optional cleanup

`capacitor.config.json` currently points `webDir` at the project root (`.`),
so Capacitor packages the whole folder as-is — including files like
`Code.gs`, the `README*.md` files, and `capacitor.config.json` itself, which
the app never actually loads. This is harmless (they just sit unused inside
the APK's assets), but if you want a leaner build later, you can move the
site's actual runtime files (`index.html`, `app.js`, `style.css`, `config.js`,
`manifest.json`, `sw.js`, the `*.json` question banks, icons, `about.html`)
into a `www/` subfolder and change `"webDir": "."` to `"webDir": "www"`.

## What still works exactly the same

- The app talks to the same Apps Script backend (`config.js`'s
  `APPS_SCRIPT_URL`) — no backend changes needed.
- Offline exam-taking and the auto-sync submission outbox (added to `app.js`)
  work identically inside the wrapped app — Capacitor's WebView supports
  `localStorage`, `IndexedDB`, and service workers the same as a normal
  mobile browser.
- All existing features (admin panel, reminders, dashboard, revision tests,
  etc.) are unchanged — Capacitor only changes *how the site is launched*,
  not what it does.
