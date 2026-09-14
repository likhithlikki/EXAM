# Backend setup (Google Sheets + Apps Script)

This gives you rankings, the dashboard, "My Mistakes", and the three
emails (result, rank/percentage, 7-day revision reminder) — all backed
by a single Google Sheet you own. You never type sheet or column names
yourself; the script creates every tab and header row automatically.

The site works fully **without** this too (exam, timer, auto-save,
mark-for-review, palette, review screen) — this step only adds the
backend features.

## 1. Create the Sheet
1. Go to [sheets.google.com](https://sheets.google.com) → **Blank spreadsheet**.
2. Name it e.g. `ECET Quiz Data`.

## 2. Add the script
1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste in the contents
   of this repo's `Code.gs` file.
3. Click **Save** (disk icon).

## 3. Run setup once
1. In the Apps Script toolbar, select the function `setup` from the
   dropdown next to "Run", then click **Run**.
2. The first time, Google will ask you to authorize the script
   (it needs access to the Sheet and to send email as you) — approve it.
3. Go back to the Sheet — you should now see 6 tabs already created
   with header rows: `Users`, `Results`, `Answers`, `WrongAnswers`,
   `Rankings`, `RevisionHistory`.

## 4. Deploy as a Web App
1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Settings:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, authorize again if asked.
5. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## 5. Connect the site
1. Open `config.js` in your website files.
2. Paste the URL:
   ```js
   window.APP_CONFIG = {
     APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb.../exec"
   };
   ```
3. Commit/push. Reload the site — take a test, and you should see a
   real rank on the result screen, plus a result email.

## 6. Turn on the 7-day revision reminder
This runs once a day and emails anyone with wrong-answer questions
that became due for revision.
1. In Apps Script, click the **clock icon (Triggers)** in the left sidebar.
2. **Add Trigger**:
   - Function: `sendRevisionReminders`
   - Event source: **Time-driven**
   - Type: **Day timer**
   - Time of day: pick any window, e.g. 8am–9am
3. Save.

## Notes
- Every request re-checks the tabs exist, so if you ever accidentally
  delete a tab, it's recreated automatically on the next request.
- Redeploy (**Deploy → Manage deployments → Edit → New version**)
  any time you change `Code.gs`, or the live URL keeps running the old code.
- This is a lightweight personal-project backend (Sheets read/write is
  fast enough for personal or small-group use, not built for heavy
  concurrent traffic).
- Scoring is computed in the browser using the question bank JSON and
  sent to the sheet — fine for a self-practice tool, but keep in mind
  it isn't tamper-proof the way a server-side-only answer key would be.
