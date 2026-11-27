/* ===================== Theme switcher (dark / light) =====================
 * Dark theme  = NovaPay look  (deep slate + sky blue)
 * Light theme = Celadon look  (soft clay surfaces + jade)
 *
 * Load this file in <head> WITHOUT defer/async: the first block below sets
 * <html data-theme="..."> before the first paint, so there is no flash of the
 * wrong theme. The rest (toggle button, top bar, fonts) runs once the DOM exists.
 *
 * Choice order: saved choice  ->  device setting (prefers-color-scheme)  ->  light.
 */
(function () {
  "use strict";
  var KEY = "tm-theme";
  var root = document.documentElement;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; }
    catch (e) { return null; }
  }
  function system() {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
    catch (e) { return "light"; }
  }
  function current() { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; }

  /* Fonts: Outfit is shared; DM Sans is the dark-theme body font, Albert Sans the light one.
     Only the active theme's body font is requested; the other loads if the user switches. */
  var loadedFonts = {};
  function loadFonts(theme) {
    var fam = theme === "dark"
      ? "family=Outfit:wght@300;400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700"
      : "family=Outfit:wght@300;400;500;600;700;800&family=Albert+Sans:wght@400;500;600;700";
    if (loadedFonts[theme]) return;
    loadedFonts[theme] = true;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?" + fam + "&display=swap";
    document.head.appendChild(l);
  }

  function setMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    m.setAttribute("content", theme === "dark" ? "#0F1319" : "#E8EDF7");
  }

  function apply(theme, persist) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    setMeta(theme);
    if (persist) { try { localStorage.setItem(KEY, theme); } catch (e) {} }
    var btn = document.getElementById("tmToggle");
    if (btn) {
      var toDark = theme !== "dark";
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      btn.setAttribute("aria-label", toDark ? "Switch to dark theme" : "Switch to light theme");
      btn.title = toDark ? "Switch to dark theme" : "Switch to light theme";
    }
    if (document.head) loadFonts(theme);
    try { window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } })); } catch (e) {}
  }

  /* ---- 1. before first paint ---- */
  apply(saved() || system(), false);

  /* Follow the device setting live, but only while the user has not picked a theme themselves. */
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSys = function () { if (!saved()) apply(system(), false); };
    if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);
  } catch (e) {}

  /* Keep several open tabs in step. */
  window.addEventListener("storage", function (e) {
    if (e.key === KEY && (e.newValue === "dark" || e.newValue === "light")) apply(e.newValue, false);
  });

  /* ---- 2. toggle button + top bar ---- */
  var SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>';

  function makeToggle() {
    var b = document.createElement("button");
    b.type = "button";
    b.id = "tmToggle";
    b.className = "tm-toggle";
    b.innerHTML = '<span class="tm-ico tm-sun">' + SUN + '</span><span class="tm-ico tm-moon">' + MOON + '</span><span class="tm-knob" aria-hidden="true"></span>';
    b.addEventListener("click", function () { apply(current() === "dark" ? "light" : "dark", true); });
    return b;
  }

  function mount() {
    if (document.getElementById("tmToggle")) return;
    var toggle = makeToggle();
    var bar = document.querySelector(".bar .wrap");           /* about / legal / 404 pages already have a header */
    if (bar) {
      var nav = bar.querySelector("nav");
      toggle.classList.add("tm-in-bar");
      (nav || bar).appendChild(toggle);
    } else {                                                  /* main app + FIB admin: add a slim header */
      var h = document.createElement("header");
      h.className = "tm-bar";
      h.innerHTML =
        '<div class="tm-bar-in">' +
          '<a class="tm-brand" href="index.html"><i aria-hidden="true">✎</i><span>Online Mock Test</span></a>' +
          '<nav class="tm-nav" aria-label="Site"><a href="about.html">About</a></nav>' +
        '</div>';
      h.querySelector(".tm-nav").appendChild(toggle);
      document.body.insertBefore(h, document.body.firstChild);
      root.classList.add("tm-has-bar");
    }
    apply(current(), false);                                  /* sync aria-label now the button exists */
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
