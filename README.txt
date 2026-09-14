Reusable ECET quiz engine.

Question JSON format:
[
  {
    "question": "Question text",
    "options": ["Option A","Option B","Option C","Option D"],
    "answer": 0,
    "year": 2026,
    "state": "TS"
  }
]

answer: 0=A, 1=B, 2=C, 3=D.

To add a subject, create another JSON file inside data/ and add one object to subjects.json.

The supplied scanned/OCR PDF should be processed into this JSON only after question text and answer keys are verified. This template intentionally does not invent answers.
