# GATE Previous Year Tests

Entry point: the **🎓 GATE Previous Year Tests** button on Home opens `gate.html`, which loads
the same exam engine at `index.html?gate=1`. Everything is driven by the JSON in `gate-pyq/`.

## Adding or fixing a paper (no code changes)
1. Put the paper's JSON in `gate-pyq/source_json/` and its images in `gate-pyq/assets/<paper>/`.
2. Make sure the file name is listed in `gate-pyq/manifest.json` → `"json_files"`.
3. Open GATE Tests → **↻ Reload data**, then look at **Data check** to see how many questions
   were accepted and why any were skipped.

File names become paper names: `2021.json` → "GATE 2021", `2016_set1.json` → "GATE 2016 — Set 1".
To drop a paper from the app, delete its line from `manifest.json`.

## JSON format (one file per paper, a bare list; `{"questions":[...]}` is also accepted)
| field | meaning |
|---|---|
| `question_number`, `section` | number in the paper; `"GA"` or `"EC"` |
| `subject` | **drives Subject-wise tests** — one test per distinct value |
| `marks` | 1 or 2 |
| `question_type` | `MCQ`, `MSQ` or `NAT` |
| `question`, `question_image` | text and/or image path (relative to `gate-pyq/`) |
| `options` | `{"A":{"type":"text","text":".."}, "B":{"type":"image","image":"assets/.."}, ...}` |
| `correct_answer` | `"B"`, `"A;C"` (MSQ) or `"0.9 to 1.1"` / `"4"` (NAT) |
| `negative_marks` | deducted for a wrong answer, **used exactly as written** (e.g. 0.3333, 0.6667, 0) |
| `verification_status` | anything other than `verified` shows a "not fully verified" notice |

**Want finer subject tests** (Signals & Systems, Networks, …)? Set `subject` to that name on each
question — a test for it appears automatically. No code change.

## How tests work
- **Year-wise:** one paper, original order (GA first, then core). Time = **1.8 min per mark**
  (180 min for 100 marks). Only questions that pass validation are included; marks/time are for those.
- **Subject-wise:** a random sample (15 / 30 / 45 / whole pool) from all papers; same marking and pacing.
- **Marking:** correct = `marks`; wrong MCQ = −`negative_marks`; MSQ all-or-nothing; NAT accepts the
  answer-key range (inclusive); unanswered = 0. Retry keeps the same marking.
- Settings are constants at the top of the GATE block in `app.js` (`GATE_MIN_PER_MARK`,
  `GATE_SUBJECT_TEST_SIZES`, `GATE_INCLUDE_GA_SUBJECT_TEST`, `GATE_YEAR_KEEP_PAPER_ORDER`,
  `GATE_SHUFFLE_OPTIONS`).

## What gets skipped (and is listed under "Data check")
A question is left out — never shown half-broken — when: it has no text and no image; an MCQ/MSQ
doesn't have 4 non-empty options; an option is only a label like "(C)" or contains another option's
marker; the answer key is blank/invalid or points at an empty option; a NAT has no numeric answer;
symbols are unreadable; or a matrix/brace layout was lost in extraction and no image shows it.
PDF symbol-font characters (π, ω, Ω, ≤, ∫ …) are decoded using the standard Symbol encoding;
repeated identical glyphs are treated as filler and not decoded.

## ⚠ What the app can NOT detect
Options that are well-formed but belong to a **different question** pass every check. Example in the
current data: 2016 Set 1 Q1 ("Mount Everest is ___") has options `M4k + 1, M4k + 2…`. Those must be
fixed in the JSON. All records are marked `source_extracted_not_fully_verified`; the official GATE
answer key is final.

## Current data status (from the Data check)
Fully usable: 2021, 2022, 2023, 2025, 2026 and 2017 Set 2 (65/65). Partial: 2024 (57), 2019 (56),
2018 (56), 2016 Set 1 (55), 2016 Set 3 (46). Mostly unavailable until the JSON is completed:
2020 (14 — MCQ options missing) and 2017 Set 1 (23 — NAT only).
`2017_set2.json` is your earlier rebuild kept in the older format; remove it from `manifest.json`
if you don't want it. Superseded files are in `gate-pyq/old_source_json/`.
`FINAL_AUDIT.txt` and `PENDING_SOURCES.md` come from the dataset package.
