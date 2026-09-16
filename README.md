# ECET Quiz

Static, mobile-friendly practice-test site for ECET (AP/TS) subjects.
All files live in the repo root — no subfolders, drop straight into
GitHub Pages.

## What's here
- `index.html`, `style.css`, `app.js`, `config.js` — the site.
- `subjects.json` — subject list, passwords, availability.
- `digital-electronics.json` — 153 verified questions (unchanged).
- `data-structures-c.json` — **206 verified questions**, newly added
  from the uploaded PYQs (2016–2026, AP & TS), cross-checked against
  `datastructures-through-c-final-audit-v6.json`: all 3 flagged
  "definite" corrections were already applied in the source, and every
  record passes structural checks (4 unique options, valid answer
  index, no duplicate question keys, per-paper counts match the audit
  exactly).
- All other subject files (`operating-systems.json`, `dbms.json`, etc.)
  are placeholders (`[]`) — "Coming soon" on the site — ready for you
  to drop in verified question banks the same way later.
- `Code.gs` — Google Apps Script backend (Sheets as the database).
- `SETUP-BACKEND.md` — exact steps to turn the backend on.

## Subject passwords
Digital Electronics=18, Software Engineering=19, Computer Organisation
& Microprocessors=20, Data Structures through C=21, Computer Networks
& Cyber Security=22, Operating Systems=23, DBMS=24, Java Programming=25,
Web Technologies=26, Big Data & Cloud Computing=27, Android
Programming=28, Internet of Things (IoT)=29, Python Programming=30.

## What's new in this upgrade
- **Name + email + subject password gate** before every exam, with a pre-start summary showing test name, subject, question count, and total time.
- **Sticky Previous/Next/Submit bar**, **answered/unanswered status**,
  **mark for review**, a full **question palette**, **auto-save**
  (localStorage — refreshing mid-exam resumes exactly where you left
  off), and the existing per-subject **1-minute-per-question countdown timer**, automatic timeout submission, resume after unexpected browser closure, and active-test navigation protection.
- **Result screen**: score, percentage, rank (once the backend is
  connected), correct/wrong/unanswered counts, total time, a per-question
  time bar chart, and a filterable review list (all/wrong/unanswered/marked)
  showing the correct answer for every wrong question.
- **My Mistakes**: every wrong answer, tagged "due for revision" once
  1 day has passed, with a "mark as revised" action.
- **Dashboard**: attempts, average/best score, subject-wise performance
  bars, and full test history with rank per attempt.
- **Backend (Google Sheets + Apps Script)**: users, results, per-question
  answers and time spent, rankings, wrong answers, and revision history
  — all auto-provisioned (tabs + headers created on first run, nothing
  typed by hand). Emails: exam result + rank/percentage on submission,
  and a daily 1-day revision reminder with a direct Take Test button.

## Honest limitations (please read)
- **I could not deploy the Apps Script backend for you** — that step
  needs your Google account. `config.js` ships with `APPS_SCRIPT_URL`
  empty, so the site currently runs in fully-local mode: exams, the
  timer, auto-save, review, and the offline result screen all work
  right now. Dashboard/My Mistakes will say "Backend not connected
  yet" until you follow `SETUP-BACKEND.md` (5–10 minutes).
- **No per-question written explanations.** The source PYQ data has
  questions, options, and answers — not explanations — and I didn't
  fabricate any, since an invented technical explanation could be
  wrong. The correct answer is always shown clearly for every wrong
  question; if you have (or want to write) real explanations, the
  `Answers`/review code has one clear place to plug an `explanation`
  field in per question.
- **Scoring runs client-side** (the browser has the answer key to grade
  itself) — fine for a personal practice tool, not tamper-proof.
- Charts are plain CSS bars, not a charting library — matches the
  "simple and fast" brief and needs no external dependency.

## Testing performed
- Automated structural validation of `data-structures-c.json`: 206/206
  records pass (unique options, valid answer index, no duplicate
  question keys, per-paper counts match the audit file exactly).
- Headless browser test (jsdom) driving the real `app.js`: home page
  renders all 13 subjects, password gate, enrollment, exam start,
  answering, mark-for-review + navigation persistence, submit, result
  screen, and the "backend not connected" fallback on Dashboard — all
  passed.
- Standalone unit tests of `Code.gs` against a mocked Sheets/Mail API:
  sheet auto-creation, ranking math (including a second user overtaking
  the first), wrong-answer capture, dashboard aggregation, mistakes
  list, mark-as-revised, and the 1-day reminder trigger — all passed.
