/* =====================================================================
 *  practice-rules.js  —  THE ONLY FILE YOU EDIT TO CHANGE HOW STRICT
 *                        FILL-IN-THE-BLANK MARKING IS
 * =====================================================================
 *
 *  The site calls ONE function:
 *
 *        isAnswerCorrect(typedAnswer, expectedAnswer)   ->  true  /  false
 *
 *  true  = "yes, accept it"      false = "no, wrong"
 *
 *  expectedAnswer is the text saved with the question, for example:
 *        "CPU;processor"        several accepted answers, split by ;
 *        "random access memory" a phrase
 *        "0.9 to 1.1"           a number range
 *        "5"                    one exact number
 *
 *  HOW TO MAKE IT STRICTER OR LOOSER
 *  ---------------------------------
 *  Scroll to  SECTION 3: ACTIVE_RULES.  Each line is one rule.
 *  A typed answer is accepted when ANY active rule says yes.
 *     - Loosen : remove the  //  in front of a rule line.
 *     - Tighten: put  //  in front of a rule line.
 *  To change what a rule does, edit its function in SECTION 2.
 *  Run `node fib-tests.js` to check the shared grading rules.
 *
 *  Nothing in this file touches the MCQ exams. It is used only by
 *  main exam engine and FIB admin uploader.
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ===================================================================
   *  SECTION 1: SMALL SETTINGS  (numbers you may want to change)
   * =================================================================== */
  const SETTINGS = {
    // Multi-word answers: how many of the expected words must be present.
    // 0.6 = three words need 2, five words need 3. (Rule: wordsMatch)
    WORDS_NEEDED: 0.6,

    // Single-word answers: forgive ONE wrong/missing/extra letter,
    // but only when the expected word has at least this many letters.
    // Short words (CPU / GPU / RAM / ROM) are never forgiven. (Rule: oneTypo)
    TYPO_MIN_LENGTH: 6,

    // Words ignored when counting matched words in a phrase.
    STOP_WORDS: ['the', 'a', 'an', 'of', 'is', 'are', 'to', 'and', 'in', 'on'],

    // Numbers: accepted distance from a single expected number.
    // 0 = must be equal. 0.01 = 5 also accepts 4.99 to 5.01.
    NUMBER_TOLERANCE: 0,

    // Separator between several accepted answers.
    ALT_SEPARATOR: ';',

    // Authoring checks (used by the admin page when adding questions).
    MAX_WORDS_IN_ANSWER: 5,
    MAX_CHARS_IN_ANSWER: 60
  };

  /* ===================================================================
   *  SECTION 2: THE RULES
   *  Every rule is  (typed, expected) => true | false
   *  `typed` and `expected` are ONE alternative each (already split on ;).
   * =================================================================== */

  // ---- helpers ------------------------------------------------------
  // lower-case, drop punctuation, squeeze spaces:  "  The  CPU. " -> "the cpu"
  function clean(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9.\s-]/g, ' ')   // keep letters, digits, . and -
      .replace(/([a-z])-(?=[a-z])/g, '$1 ') // flip-flop -> flip flop
      .replace(/\.+(?=\s|$)/g, '')        // trailing full stop: "cpu." -> "cpu"
      .replace(/(^|\s)[.-]+(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function wordsOf(text) {
    return clean(text).split(' ').filter(Boolean);
  }
  function contentWords(text) {
    const stop = SETTINGS.STOP_WORDS;
    const all = wordsOf(text);
    const kept = all.filter(function (w) { return stop.indexOf(w) === -1; });
    return kept.length ? kept : all;     // never end up with zero words
  }
  function editDistanceAtMostOne(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
  function toNumber(text) {
    const t = String(text == null ? '' : text).trim().replace(/,/g, '').replace(/\s+/g, '');
    return NUMBER_RE.test(t) ? Number(t) : null;
  }
  // "0.9 to 1.1" / "0.9..1.1" / "0.9~1.1"  ->  {lo, hi}   else null
  const RANGE_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:to|\.\.|~)\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*$/i;
  function parseRange(text) {
    const m = RANGE_RE.exec(String(text == null ? '' : text));
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]);
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }

  // ---- rule 1: same text (capitals, extra spaces, punctuation ignored)
  function sameText(typed, expected) {
    return clean(typed) !== '' && clean(typed) === clean(expected);
  }

  // ---- rule 2: same text if all spaces are ignored  ("hashmap" = "hash map")
  function sameIgnoringSpaces(typed, expected) {
    const t = clean(typed).replace(/\s/g, '');
    return t !== '' && t === clean(expected).replace(/\s/g, '');
  }

  // ---- rule 2b: same after dropping filler words  ("the CPU" = "CPU")
  function sameWithoutFillerWords(typed, expected) {
    const t = contentWords(typed).join(' ');
    return t !== '' && t === contentWords(expected).join(' ');
  }

  // ---- rule 3: numbers.  expected "5" or "0.9 to 1.1"
  function numberInRange(typed, expected) {
    const n = toNumber(typed);
    if (n === null) return false;
    const range = parseRange(expected);
    if (range) return n >= range.lo && n <= range.hi;
    const exp = toNumber(expected);
    if (exp === null) return false;
    return Math.abs(n - exp) <= SETTINGS.NUMBER_TOLERANCE + 1e-9;
  }

  // ---- rule 4: phrases.  enough of the expected words are present
  //      "random access memory": "random memory" -> yes, "memory" -> no
  function wordsMatch(typed, expected) {
    const want = contentWords(expected);
    if (want.length < 2) return false;               // single words: other rules
    const have = contentWords(typed);
    let hit = 0;
    want.forEach(function (w) {
      const found = have.some(function (h) {
        return h === w || (w.length >= SETTINGS.TYPO_MIN_LENGTH && editDistanceAtMostOne(h, w));
      });
      if (found) hit++;
    });
    return hit / want.length >= SETTINGS.WORDS_NEEDED;
  }

  // ---- rule 5: single long word with one slip  ("compiler" ~ "compilar")
  function oneTypo(typed, expected) {
    const t = clean(typed), e = clean(expected);
    if (t === '' || e.indexOf(' ') !== -1 || t.indexOf(' ') !== -1) return false;
    if (NUMBER_RE.test(e)) return false;              // never for numbers
    if (e.length < SETTINGS.TYPO_MIN_LENGTH) return false;
    return editDistanceAtMostOne(t, e);
  }

  /* ===================================================================
   *  SECTION 3: ACTIVE_RULES   <-- turn strictness up or down HERE
   *  Order does not matter. Any rule saying yes = answer accepted.
   * =================================================================== */
  const ACTIVE_RULES = [
    { name: 'sameText',            test: sameText },
    { name: 'sameIgnoringSpaces',  test: sameIgnoringSpaces },
    { name: 'sameWithoutFillerWords', test: sameWithoutFillerWords },
    { name: 'numberInRange',       test: numberInRange },
    { name: 'wordsMatch',          test: wordsMatch },
    { name: 'oneTypo',             test: oneTypo }
    // Examples of extra rules you can add:
    // { name: 'startsWith', test: function (t, e) { return clean(e).startsWith(clean(t)) && clean(t).length >= 4; } },
  ];

  /* ===================================================================
   *  SECTION 4: THE FUNCTIONS THE SITE CALLS   (normally no edit needed)
   * =================================================================== */

  // Split "CPU;processor" into ["CPU","processor"]. A range such as
  // "0.9 to 1.1" has no separator so it stays one alternative.
  function alternativesOf(expectedField) {
    return String(expectedField == null ? '' : expectedField)
      .split(SETTINGS.ALT_SEPARATOR)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  // Detailed version: tells you WHICH rule said yes (used by the test page).
  function checkAnswerDetailed(typed, expectedField) {
    const t = String(typed == null ? '' : typed).trim();
    if (t === '') return { ok: false, rule: null, alternative: null };
    const alts = alternativesOf(expectedField);
    for (let i = 0; i < alts.length; i++) {
      for (let r = 0; r < ACTIVE_RULES.length; r++) {
        let yes = false;
        try { yes = !!ACTIVE_RULES[r].test(t, alts[i]); } catch (e) { yes = false; }
        if (yes) return { ok: true, rule: ACTIVE_RULES[r].name, alternative: alts[i] };
      }
    }
    return { ok: false, rule: null, alternative: null };
  }

  // Shared FIB grading contract used by the main exam engine.
  function gradeFib(userText, answerSpec) {
    return { correct: checkAnswerDetailed(userText, answerSpec).ok };
  }

  // THE MAIN FUNCTION: yes (true) or no (false).
  function isAnswerCorrect(typed, expectedField) {
    return gradeFib(typed, expectedField).correct;
  }

  /* ===================================================================
   *  SECTION 5: CHECKS WHEN AN ADMIN ADDS A QUESTION
   *  Returns { errors:[...], warnings:[...] }.  Errors block the upload.
   * =================================================================== */
  const MATH_SYMBOLS_RE = /[√^²³∑∫π≤≥≠±×÷∞∆Δ\\$]/;
  const BLANK_RE = /_{3,}/g;

  function validateQuestion(q) {
    const errors = [], warnings = [];
    const type = String(q && q.type || '').toUpperCase();
    const text = String(q && q.question || '').trim();
    const answer = String(q && q.answer || '').trim();

    if (type !== 'FIB' && type !== 'MCQ') errors.push('Type must be FIB or MCQ.');
    if (!text) errors.push('Question text is empty.');
    if (!answer) errors.push('Answer is empty.');
    if (errors.length) return { errors: errors, warnings: warnings };

    if (type === 'MCQ') {
      const o = q.options || {};
      ['A', 'B', 'C', 'D'].forEach(function (k) {
        if (!String(o[k] == null ? '' : o[k]).trim()) errors.push('Option ' + k + ' is empty.');
      });
      if (!/^[ABCD]$/.test(answer.toUpperCase())) errors.push('MCQ answer must be A, B, C or D.');
      return { errors: errors, warnings: warnings };
    }

    // ---- FIB ----
    const blanks = text.match(BLANK_RE) || [];
    if (blanks.length === 0) errors.push('The question needs one blank written as ______ (3 or more underscores).');
    if (blanks.length > 1) errors.push('Only ONE blank per question is allowed (found ' + blanks.length + ').');
    if (text.replace(BLANK_RE, '').trim().length < 15) warnings.push('Question has very little text around the blank. Add context so only one answer fits.');

    const alts = alternativesOf(answer);
    if (!alts.length) errors.push('Answer is empty.');
    alts.forEach(function (a) {
      if (MATH_SYMBOLS_RE.test(a)) errors.push('Answer "' + a + '" has math symbols. Use plain words or plain numbers only.');
      if (/^\s*[+-]?\d+\s*\/\s*\d+\s*$/.test(a)) errors.push('Answer "' + a + '" is a fraction. Write it as a decimal number.');
      if (a.length > SETTINGS.MAX_CHARS_IN_ANSWER) errors.push('Answer "' + a.slice(0, 20) + '..." is too long. Keep answers short.');
      if (!parseRange(a) && a.split(/\s+/).length > SETTINGS.MAX_WORDS_IN_ANSWER) errors.push('Answer "' + a + '" has more than ' + SETTINGS.MAX_WORDS_IN_ANSWER + ' words.');
      if (/\bto\b|\.\./i.test(a) && /\d/.test(a) && !parseRange(a) && !/[a-z]{3,}/i.test(a.replace(/\bto\b/gi, ''))) errors.push('Range "' + a + '" is not valid. Use the form 0.9 to 1.1.');
      const r = parseRange(a);
      if (r && r.lo === r.hi) warnings.push('Range "' + a + '" has the same start and end. Write just the number.');
    });
    const seen = {};
    alts.forEach(function (a) { const k = clean(a); if (seen[k]) warnings.push('Answer "' + a + '" is listed twice.'); seen[k] = 1; });
    if (/\d/.test(answer) && !/[a-z]/i.test(answer.replace(/\bto\b/gi, '')) && !alts.some(parseRange) && !/(decimal|places|nearest|integer|whole)/i.test(text)) {
      warnings.push('Numeric answer: say in the question how to round it (for example "to 2 decimal places") or use a range.');
    }
    return { errors: errors, warnings: warnings };
  }

  /* ===================================================================
   *  SECTION 6: RULES TEXT FOR THE AI PROMPT
   *  The admin page puts this text inside the prompt it shows you, so the
   *  AI writes blanks that THESE rules can mark. If you change the
   *  rules above, change this text too.
   * =================================================================== */
  const AI_FIB_RULES = [
    'Write each question so that exactly ONE blank (written as ______) can be filled by exactly ONE idea.',
    'Use ONE blank per question. Never write two blanks like "___ and ___".',
    'Give enough context around the blank that a student who knows the topic can answer without guessing. No vague stems like "The ___ is important."',
    'Never blank out a small word (is, the, of, to). Blank out the key term, name or number.',
    'The answer must be short: one word, a short phrase of at most 5 words, or one number.',
    'Plain text and plain numbers only. No math symbols, no square roots, no powers (x^2), no fractions (1/2 - write 0.5), no Greek letters, no LaTeX, no units inside the answer.',
    'If more than one correct wording exists, list ALL of them in the answer separated by a semicolon, for example: CPU;processor;central processing unit',
    'Include common short forms and spellings in that list (for example: RAM;random access memory).',
    'Do not depend on capital letters or punctuation. The checker ignores them.',
    'For phrase answers use the most natural wording. The checker accepts an answer when about 60 percent of the key words are typed, so make every key word in the answer meaningful.',
    'For numeric answers, say in the question how to round (for example "up to 2 decimal places"), and write the answer as one number. If rounding could differ, write a range using the form: 0.9 to 1.1',
    'Do not write answers that are a whole sentence or an opinion. Every answer must be easy to check as right or wrong.',
    'Add a one-line explanation of why the answer is correct.'
  ];

  const api = {
    isAnswerCorrect: isAnswerCorrect,
    gradeFib: gradeFib,
    checkAnswerDetailed: checkAnswerDetailed,
    alternativesOf: alternativesOf,
    validateQuestion: validateQuestion,
    parseRange: parseRange,
    AI_FIB_RULES: AI_FIB_RULES,
    SETTINGS: SETTINGS,
    ACTIVE_RULES: ACTIVE_RULES
  };
  root.PracticeRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
