# ECET Data Structures through C — verification notes

`data-structures-c.json` was generated from `datastructures-through-c-final-v6.json`
(206 records, 2016–2026, AP & TS), checked against the accompanying
`datastructures-through-c-final-audit-v6.json`.

## Checks performed (automated, 206/206 records)
- JSON parses; every record has exactly 4 options.
- No empty option text; no duplicate options within a question.
- Answer index is valid (maps to one of the 4 options).
- No duplicate `(year, state, questionNumber)` keys.
- No empty question text.
- Per-paper question counts match the audit file's `perPaperCounts`
  exactly for all 18 papers (2016 TS through 2026 AP/TS).

## Corrections already present in the source (confirmed applied)
1. **2020 TS Q136** — "Linked list elements are not stored at ___
   locations" → answer corrected to "contiguous" (the question asks
   for the *non*-storage location).
2. **2019 TS Q137** — options restored to Θ(n²), O(n^1.5), Θ(n log n),
   Θ((log n)²); answer set to Θ(n log n) for the given nested-loop
   complexity.
3. **2017 TS Q146** — stack-sequence options restored; answer confirmed
   as "2 2 1 1 2".

## Answer-index convention
The source file used 1-indexed answers (1–4). `data-structures-c.json`
converts these to 0-indexed (0–3) to match the existing
`digital-electronics.json` convention, since the site's `app.js` reads
`answer` as a direct index into the `options` array.

## Known source/convention flags (not treated as errors)
The audit file lists 14 additional items as documented
source/convention/wording assumptions rather than extraction errors
(e.g. `sizeof(unsigned long)` assumed 4 bytes, recursive-`main()`
question intent, complete-vs-full binary tree wording in one 2022
question, etc.). These are left as-is per the audit's own conclusion —
see `datastructures-through-c-final-audit-v6.json` →
`sourceOrConventionFlags` for the full list and reasoning on each.

## What was NOT added
No explanations were written for individual questions — the source
data doesn't include them, and inventing 206 technical explanations
risked introducing wrong information. Only the verified correct answer
is shown for each question.
