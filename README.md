# ECET Online Test

Responsive single-page ECET practice-test website with a Google Apps Script backend.

## Features

- Topic-wise tests inside a subject, one numbered list per exam (GATE, ECET or another), each test with its own best score and wait, plus a topic-wise breakdown on the full-test result.
- Control Centre for admins: locks and default wait, passwords, rename / merge / delete subjects, rename / move topic tests.
- About page (`about.html`).
- Main tests with 1 minute per question and no negative marking.
- Countdown timer and automatic submission at zero.
- Local autosave and resume after refresh/browser crash.
- Answered, unanswered and marked-for-review counts with question navigation.
- Mark for Review.
- Submission confirmation and duplicate-submit protection.
- Per-question time tracking and result analysis.
- Wrong + unattempted revision mistakes, with mistake type tracking.
- Revision unlocks one day after the original test.
- Professional result emails with retake and revision links.
- Full Test Attempt History with improvement and attempt comparison.
- Request Reminder with one-time/hourly/daily/weekly/monthly schedules.
- Remind Me Later for unfinished tests/tasks.
- Active/Paused/Completed reminder status.
- Notification History with Sent/Pending/Failed and Retry.
- SPA navigation with Back/Home controls and active-test browser-back protection.
- Mobile and desktop responsive layout.
- Backend/API/network error states, loading states, validation and retry paths.


## Content, subject locks and passwords

Question content originates in Google Sheets. Apps Script `exportAll` supplies the GitHub Action (`.github/workflows/sync-sheets.yml`), which runs `tools/sync-from-sheets.js` every 15 minutes (or through **Update content**) and publishes the static files under `data/`. Built-in banks in `data/questions/static/` are checked into the repository.

A completed test locks its **parent subject**: every topic test and the Full Subject Test inside that subject share the same cooldown. Different subjects lock independently. Each parent subject has one password shared by all of its tests; built-in passwords are configured in the Apps Script `SUBJECT_PASSWORDS_JSON` Script Property, while custom-subject passwords are stored in the `Subjects` sheet.

Control Centre authentication is held in `sessionStorage` for 15 minutes. The expiry is not extended by use; when it expires, the Control Centre password is requested again. Configure administrator email addresses as the same real, lowercase list in `config.js` and `Code.gs`; the `admin@example.com` placeholder is not an administrator.
