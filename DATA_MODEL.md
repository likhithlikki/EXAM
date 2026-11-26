# FIB question and result data model

## Questions sheet

FIB questions live in the existing `Questions` sheet; no separate Practice Bank is used.

- `Type`: exactly `FIB` (MCQ rows remain `MCQ`; existing GATE types such as `NAT` remain unchanged).
- `Marks`: positive numeric mark value for the question. A correct FIB response earns the full value; wrong or blank earns zero. FIB never has negative marking.
- `Question`: contains exactly one blank, written as three or more underscores (for example `The ______ stores one bit.`).
- `Answer`: accepted answer specification. Alternatives are separated by `;` (for example `CPU;processor`). Numeric ranges use `low to high` (for example `2 to 3`). Decimals are valid.
- FIB questions have no options and do not use `CorrectAnswer`.
- A FIB test is a separate subject whose questions are all `Type = FIB`; MCQ questions must not be mixed into it.

## Results and per-question answers

`Results.TestType` identifies `FIB` versus `MCQ`. Existing `Score`, `Total`, `Percentage`, `Correct`, `Wrong`, and `Unanswered` retain their meanings; for a FIB result, Score and Total are mark-weighted (full `Marks` for each correct answer, zero otherwise), while Correct/Wrong/Unanswered remain question counts.

`Answers` adds `SelectedText` and `CorrectText` immediately after `SelectedIndex` and `CorrectIndex`. FIB rows populate the text fields and leave the index fields empty. MCQ rows continue to populate the index fields and leave the text fields empty.

`WrongAnswers` adds `SelectedText`, `CorrectText`, and `QuestionType`. FIB mistakes store the exact submitted text and the accepted answer specification, so My Mistakes and revision can display and grade typed answers. MCQ mistakes continue to use `SelectedIndex`/`CorrectIndex`.

## Grading contract

`gradeFib(userText, answerSpec)` returns `{correct: true|false}`. Empty/whitespace answers are incorrect. It supports case/punctuation-insensitive text, semicolon alternatives, numeric decimals, and inclusive numeric ranges. The server is authoritative; client grading is only for immediate local/offline result display. Offline submissions retain `selectedText` and `correctText` in the existing outbox payload.


For an already-populated Google Sheet, the existing schema initializer adds missing headers without rewriting or moving existing columns, so newly added columns may appear at the right edge of a legacy tab. Freshly created tabs use the order above.
