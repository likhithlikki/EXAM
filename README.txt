ECET reusable quiz engine — updated.

Behavior:
- Uses ALL questions in the selected subject file. No random 50-question limit.
- Timer = 1 minute per question + 20 minutes.
  Example: 50 questions = 70 minutes.
  Example: 146 questions = 166 minutes.
- Previous / Next and question palette.
- Auto-submit at 00:00.
- Result and review page.
- Add subjects by adding a JSON file and one entry to subjects.json.

Question JSON:
{
  "question": "Question text",
  "options": ["A","B","C","D"],
  "answer": 0
}
