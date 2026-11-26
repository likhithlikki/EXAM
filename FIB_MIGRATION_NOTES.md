# FIB migration notes

## What changed

- FIB questions now use the main `Questions` sheet (`Type=FIB`, `Marks`, `Answer`).
- FIB-only subjects are created by the retained `fib-admin.html` uploader and appear in the main custom/additional test list.
- Main exam typed input, autosave/resume, palette, review, submission, result, retry, offline outbox, answer storage, My Mistakes, and revision paths now carry typed answers.
- The server reads the accepted FIB answer from the Questions sheet and grades it; it does not trust the client-supplied correct answer.
- `practice-rules.js` is retained and loaded by the main app. `fib-tests.js` checks both the shared library and the server-side `gradeFib` implementation.
- Removed `practice.html`, `practice.gs`, `practice-api.js`, `practice.css`, and `practice-rules-test.html`. The FIB admin uploader is now `fib-admin.html` with `fib-admin-api.js` and `fib-admin.css`.

## Deployment

1. Replace the corresponding files in the existing website repository with the files in this ZIP.
2. Keep the project's existing `index.html`, `style.css`, `config.js`, subject JSON files, icons, and other assets. They were not present in the supplied ZIP, so they are not reproduced here.
3. Replace Apps Script `Code.gs` with the updated file and deploy the web app.
4. Existing Sheets get missing headers appended by the existing schema initializer. Fresh sheets use the new schema order. No existing MCQ/NAT rows are rewritten.
5. Open `fib-admin.html`, authenticate as admin, enter a distinct FIB subject name, upload FIB-only questions, and verify that the new subject appears in the main exam list.
6. Run the local grading checks with `node fib-tests.js`.

## Validation boundary

The supplied archive did not include `index.html`, `config.js`, the main stylesheet, static question banks, or a live Apps Script/Google Sheets environment. JavaScript syntax checks and the 32 local grading checks were run, but browser end-to-end tests, live Sheet migration, live email delivery, and online/offline synchronization could not be executed in this environment. The manual checklist in the delivery message is required before production deployment.

## Fix added after continuity audit (old project vs new)

`append_` and `appendMany_` in Code.gs now write values in the order of the REAL header row of each sheet (new helper `liveHeaders_`). Before this, an existing Sheet that had new headers appended at the right edge (TestType, SelectedText, CorrectText, QuestionType) would have received values under the wrong headers. Fresh sheets behave exactly as before. Verified with a mock sheet only; check one real submission in your Sheet after deploying.
