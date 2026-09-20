ECET BACKEND — VERIFIED Code.gs

1. Open Apps Script attached to your ECET Google Sheet.
2. Replace the contents of Code.gs with the Code.gs in this package.
3. Save the project.
4. Run setup() manually once and approve the requested Google permissions.
5. Deploy > New deployment > Web app.
   - Execute as: Me / User deploying the web app
   - Who has access: Anyone / Anyone with the link (anonymous access if shown)
6. Copy the deployed URL ending in /exec.
7. Put that exact /exec URL into the WEBSITE frontend API configuration.
8. Do NOT use the script.googleusercontent.com echo URL shown after opening the endpoint in a browser. Google Content Service redirects responses to a temporary googleusercontent URL.
9. Test in the browser:
   YOUR_EXEC_URL?action=ping
   It should return JSON containing ok:true and "ECET backend is online."

Important:
- This package fixes several backend logic issues found during review, including retryable FAILED email queue records, preservation of reminder fields during partial edits, safer monthly recurrence dates, and duplicate legacy revision-trigger cleanup.
- The code passes a JavaScript syntax check. Apps Script services still require deployment/authorization testing in your Google account.
- The frontend (index.html/app.js/etc.) was not included in the current code attachment, so this package does not claim to verify frontend code. The frontend must use the current /exec URL.

TOPIC-WISE TESTS (new)
- Subjects can be split into topic tests. In Admin -> Add Questions pick a Topic (or "New topic...").
- Questions saved with a topic appear on Home inside their subject. The full-subject test still contains every question.
- Old questions: Admin -> Edit Questions -> tick questions -> "Move the ticked questions to a topic".
- Built-in subjects (JSON files): add a "topic" field to a question, e.g. "topic": "Boolean Algebra".

CONTROL CENTRE (new)
- Admin page -> "Control Centre" (password is set in Code.gs: CONTROL_CENTRE_PASSWORD).
- Locks & Timers: default wait 24 hours / 3 days / 7 days / 1 month / custom; lock or unlock a subject for one student.
- Passwords: show all subject and admin passwords.
- Subjects: set GATE / ECET / other exam per subject; tick several custom subjects and delete them.
- Home: every subject card shows its exam and how many topic tests it has; topic tests open as a numbered list.

