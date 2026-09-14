Reusable ECET quiz engine.

WHAT'S DIFFERENT FROM THE ORIGINAL TEMPLATE
- Every question in a subject's file is used, in order — no random 50-question
  subset, regardless of how many questions the file contains.
- Time limit = 1 minute x number of questions, calculated automatically
  (a 50-question file gets 50:00, a 30-question file gets 30:00).
- Digital Electronics now ships with 50 real, verified questions instead of
  an empty file.

RUNNING IT
Browsers block fetch() of local JSON over file://, so serve the folder:
    cd ecet-final
    python3 -m http.server 8000
    open http://localhost:8000
Or drag the folder into Netlify / GitHub Pages / Vercel — no build step needed.

QUESTION JSON FORMAT (data/<subject>.json)
[
  {
    "question": "Question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0
  }
]
answer: 0=A, 1=B, 2=C, 3=D.
"year" and "state" are optional extra fields — if present they're shown
next to the question number (useful once you add verbatim PYQ questions).

ADDING A NEW SUBJECT
1. Create data/<subject-id>.json in the format above.
2. Add one entry to subjects.json:
   { "id": "<subject-id>", "name": "<Display Name>", "file": "data/<subject-id>.json" }
3. Refresh the page. No HTML/CSS/JS edits needed.

ADDING VERBATIM PYQ QUESTIONS LATER
The scanned PDF and its OCR extract both have unreliable option text, so this
template intentionally does not invent answers from either source. Once a
subject's questions are typed out and answer-checked in a spreadsheet
(Question / Option A-D / Correct letter), send it over for instant conversion
to this JSON format.
