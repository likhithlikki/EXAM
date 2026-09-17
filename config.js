/* Backend configuration. Deploy Code.gs as an Apps Script Web App and paste the /exec URL below. */
window.APP_CONFIG={
  APPS_SCRIPT_URL:'https://script.google.com/macros/s/AKfycbyEanSa0-5YevPxB2xI3IeDXOxwzAmXA41RUgErbvlZ-hYLGZCRm5PAXtr891X5v_L69Q/exec',
  SITE_URL:window.location.origin+window.location.pathname,
  ADMIN_EMAILS:['admin@example.com'],
  /* Admin panel password — a convenience gate only. This file is public
     (readable by anyone who views page source), same as any pure front-end
     password. The real protection is the matching check kept in Code.gs,
     which guards the actual create/import/update actions server-side. */
  ADMIN_PANEL_PASSWORD:'123'
};
