/**
 * ECET ONLINE TEST — Google Apps Script Backend
 * Clean, readable, and designed for the ECET test + revision + reminder system.
 *
 * IMPORTANT:
 * 1. Put this file in Apps Script as Code.gs.
 * 2. Replace SPREADSHEET_ID if your Google Sheet is different.
 * 3. Run setup() once from the Apps Script editor and authorize the script.
 * 4. Deploy as a Web App and make sure the frontend uses the deployed /exec URL.
 */

// ============================================================
// 1. CONFIGURATION
// ============================================================

const SPREADSHEET_ID = '1QDu7YTv-MWm9jRuVsmRBGjwuBD6WFtj_4bRqj5B8hds';

// Used only when a test URL is not supplied by the frontend.
// IMPORTANT: replace this with your real website URL if you use
// server-generated revision links.
const SITE_URL = ''; // Optional fallback website URL. Prefer frontend-supplied testUrl.

const SHEETS = {
  Users: [
    'Timestamp', 'Name', 'Email', 'LastSubject', 'LastTestUrl'
  ],

  Results: [
    'ResultId', 'Timestamp', 'Name', 'Email', 'Subject', 'SubjectId',
    'Score', 'Total', 'Percentage', 'Correct', 'Wrong', 'Unanswered',
    'TotalTimeSec', 'StartTime', 'EndTime', 'Rank', 'RankOutOf',
    'RevisionAvailableAt', 'RevisionUnlockedEmailSent', 'TestUrl'
  ],

  Answers: [
    'ResultId', 'Email', 'Subject', 'QuestionId', 'Year', 'State',
    'QuestionNumber', 'SelectedIndex', 'CorrectIndex', 'IsCorrect',
    'TimeSpentSec', 'MarkedForReview'
  ],

  WrongAnswers: [
    'WrongId', 'ResultId', 'Email', 'Subject', 'QuestionId', 'Year',
    'State', 'QuestionNumber', 'Question', 'OptionsJSON', 'CorrectIndex',
    'SelectedIndex', 'MistakeType', 'DateAdded', 'RevisionDueDate',
    'Revised', 'ReminderSent', 'TestUrl', 'ImagesJSON'
  ],

  Rankings: [
    'Subject', 'Email', 'Name', 'BestPercentage', 'BestScore',
    'Total', 'Attempts', 'LastAttempt'
  ],

  // One row per user. Kept up to date incrementally at submit-time so the
  // dashboard is a single-row lookup instead of a full Results/WrongAnswers
  // scan on every load (see dashboard_ and userStats_*).
  UserStats: [
    'Email', 'Attempts', 'SumPercentage', 'BestPercentage',
    'MistakesCount', 'SubjectStatsJSON', 'UpdatedAt'
  ],

  RevisionHistory: [
    'Email', 'Subject', 'QuestionId', 'ActionDate', 'Action', 'MistakeType'
  ],

  EmailQueue: [
    'QueueId', 'ToEmail', 'EmailType', 'Subject', 'HtmlBody',
    'CreatedAt', 'SentAt', 'Status'
  ],

  SubmittedSessions: [
    'ExamSessionId', 'ResultId', 'Email', 'Subject', 'SubmittedAt'
  ],

  Reminders: [
    'ReminderId', 'Email', 'UserName', 'Name', 'Message', 'RelatedTask',
    'RelatedUrl', 'Frequency', 'NextRunAt', 'Status', 'Enabled',
    'CreatedAt', 'UpdatedAt', 'LastSentAt'
  ],

  Questions: [
    'QuestionId', 'SubjectId', 'Subject', 'Year', 'State', 'QuestionNumber',
    'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'CorrectAnswer',
    'CreatedAt', 'CreatedBy', 'QuestionImage', 'OptionAImage', 'OptionBImage',
    'OptionCImage', 'OptionDImage'
  ],

  Subjects: [
    'SubjectId', 'Name', 'Password', 'Description', 'CreatedBy', 'CreatedAt'
  ],

  Notifications: [
    'NotificationId', 'ReminderId', 'Email', 'UserName', 'Name',
    'Message', 'RelatedTask', 'RelatedUrl', 'ScheduledAt', 'SentAt',
    'Status', 'Error', 'RetryCount'
  ],

  ChangeLog: [
    'ChangeId', 'Timestamp', 'EditedBy', 'Subject', 'SubjectId',
    'QuestionId', 'QuestionSnippet', 'BeforeJSON', 'AfterJSON', 'Summary'
  ]
};


// ============================================================
// 2. BASIC HELPERS
// ============================================================

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sh_(name) {
  return ss_().getSheetByName(name);
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Kolkata';
}

function iso_(value) {
  return Utilities.formatDate(
    new Date(value),
    tz_(),
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );
}

function display_(value) {
  return Utilities.formatDate(
    new Date(value),
    tz_(),
    'dd MMM yyyy, hh:mm a'
  );
}

function email_(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail_(value) {
  var email = email_(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esc_(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    }
  );
}

function out_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function bool_(value) {
  return value === true ||
    String(value).toLowerCase() === 'true' ||
    String(value) === '1';
}

function num_(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : (fallback || 0);
}

function validDate_(value) {
  var d = new Date(value);
  return !isNaN(d.getTime());
}

function toDate_(value, fallback) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  var d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d;
  }

  return fallback || new Date();
}

function normalizeFrequency_(value) {
  var f = String(value || 'once').trim().toLowerCase();

  var allowed = [
    'once',
    'one-time',
    'single',
    'hourly',
    'daily',
    'weekly',
    'monthly'
  ];

  if (allowed.indexOf(f) === -1) {
    return 'once';
  }

  if (f === 'one-time' || f === 'single') {
    return 'once';
  }

  return f;
}


// ============================================================
// 3. SHEET SETUP
// ============================================================

function ensureSheets_() {
  var book = ss_();

  Object.keys(SHEETS).forEach(function (name) {
    var sheet = book.getSheetByName(name);

    if (!sheet) {
      sheet = book.insertSheet(name);
    }

    var wantedHeaders = SHEETS[name];

    if (sheet.getLastRow() === 0) {
      sheet
        .getRange(1, 1, 1, wantedHeaders.length)
        .setValues([wantedHeaders])
        .setFontWeight('bold');

      sheet.setFrozenRows(1);
      return;
    }

    var lastColumn = Math.max(1, sheet.getLastColumn());

    var currentHeaders = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(String);

    var missingHeaders = wantedHeaders.filter(function (header) {
      return currentHeaders.indexOf(header) === -1;
    });

    if (missingHeaders.length) {
      sheet
        .getRange(
          1,
          sheet.getLastColumn() + 1,
          1,
          missingHeaders.length
        )
        .setValues([missingHeaders])
        .setFontWeight('bold');
    }

    sheet.setFrozenRows(1);
  });

  // Remove the unused default Sheet1 when safe to do so.
  var defaultSheet = book.getSheetByName('Sheet1');

  if (
    defaultSheet &&
    defaultSheet.getLastRow() === 0 &&
    book.getSheets().length > 1
  ) {
    book.deleteSheet(defaultSheet);
  }
}

function objs_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0];

  return values
    .slice(1)
    .filter(function (row) {
      return row.join('') !== '';
    })
    .map(function (row) {
      var obj = {};

      headers.forEach(function (header, index) {
        obj[header] = row[index];
      });

      return obj;
    });
}

// Finds the first row where columnHeader === value (TextFinder-based search
// of a single column, rather than pulling every column of every row into
// memory the way objs_() does) and returns that row as a header-keyed
// object. Use this instead of objs_().find(...) on hot paths / large sheets
// when you only need one row.
function findRowByColumn_(sheetName, columnHeader, value) {
  var sheet = sh_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf(columnHeader) + 1;
  if (!col) return null;

  var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
  var match = range.createTextFinder(String(value)).matchEntireCell(true).findNext();
  if (!match) return null;

  var rowValues = sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = rowValues[i]; });
  return obj;
}

// Same TextFinder search as findRowByColumn_, but returns just one other
// column's value from the matching row instead of the whole row — for
// lookups where that's all that's needed (e.g. session id -> result id).
function findInColumn_(sheetName, searchHeader, searchValue, returnHeader) {
  var sheet = sh_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var searchCol = headers.indexOf(searchHeader) + 1;
  var returnCol = headers.indexOf(returnHeader) + 1;
  if (!searchCol || !returnCol) return null;

  var range = sheet.getRange(2, searchCol, sheet.getLastRow() - 1, 1);
  var match = range.createTextFinder(String(searchValue)).matchEntireCell(true).findNext();
  if (!match) return null;

  var value = sheet.getRange(match.getRow(), returnCol).getValue();
  return (value === '' || value === null || value === undefined) ? null : String(value);
}

function append_(sheet, headers, object) {
  sheet.appendRow(
    headers.map(function (header) {
      return object[header] !== undefined ? object[header] : '';
    })
  );
}

function appendMany_(sheet, headers, objects) {
  if (!objects || !objects.length) {
    return;
  }

  var startRow = sheet.getLastRow() + 1;

  var values = objects.map(function (object) {
    return headers.map(function (header) {
      return object[header] !== undefined ? object[header] : '';
    });
  });

  sheet
    .getRange(startRow, 1, values.length, headers.length)
    .setValues(values);
}


// ============================================================
// 4. WEB APP ENTRY POINTS
// ============================================================

// ensureSheets_() scans every sheet's headers on every call — real but
// avoidable latency when it runs on every single request. Sheet structure
// only changes on deploy, so gate it behind a short CacheService flag and
// skip the rescan on the (very common) fast path.
function ensureSheetsCached_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sheets_ensured')) return;
    ensureSheets_();
    cache.put('sheets_ensured', '1', 300); // re-check at most every 5 min
  } catch (e) {
    ensureSheets_();
  }
}
function doGet(e) {
  e = e || { parameter: {} };

  var action = String(
    (e.parameter && e.parameter.action) || ''
  ).trim();

  // Ping/health must stay lightweight and must not fail merely because
  // sheet initialization fails, so it is answered before ensureSheets_()
  // and does not depend on it succeeding.
  if (action === 'ping' || action === 'health') {
    return out_({
      ok: true,
      time: iso_(new Date()),
      timezone: tz_(),
      message: 'ECET backend is online.'
    });
  }

  try {
    ensureSheetsCached_();

    switch (action) {
      case 'homeBundle':
        // Collapses the home-page startup burst (ping + isAdmin + customSubjects
        // + dashboard stats) into a single Apps Script execution instead of
        // several separate round trips firing at once and competing for the
        // same backend. Dashboard data is only computed/attached when an
        // email is present, and even then it's the cached, pre-aggregated
        // UserStats read (see dashboard_) — never a fresh scan.
        return out_({
          ok: true,
          data: {
            online: true,
            isAdmin: e.parameter.email ? isAdmin_(e.parameter.email, e.parameter.password) : false,
            customSubjects: customSubjects_(),
            dashboard: e.parameter.email ? cached_('dash_' + email_(e.parameter.email), 30, function () {
              return dashboard_(e.parameter.email);
            }) : null
          }
        });

      case 'subjectStatus':
        // Single-row lookup of one subject's cooldown state for this user —
        // not a recompute of anything. Lets the frontend gate "Open Exam"
        // with a live countdown without ever recalculating stats.
        return out_({
          ok: true,
          data: subjectStatus_(e.parameter.email, e.parameter.subject)
        });

      case 'dashboard':
        return out_({
          ok: true,
          data: cached_('dash_' + email_(e.parameter.email), 30, function () {
            return dashboard_(e.parameter.email);
          })
        });

      case 'customSubjects':
        return out_({
          ok: true,
          data: customSubjects_()
        });

      case 'profile':
        return out_({
          ok: true,
          data: profile_(e.parameter.email)
        });

      case 'mistakes':
      case 'revision':
        return out_({
          ok: true,
          data: cached_('mist_' + email_(e.parameter.email), 30, function () {
            return mistakes_(e.parameter.email);
          })
        });

      case 'history':
      case 'attemptHistory':
        return out_({
          ok: true,
          data: cached_('hist_' + email_(e.parameter.email), 30, function () {
            return history_(e.parameter.email);
          })
        });

      case 'reminders':
        return out_({
          ok: true,
          data: cached_('rmnd_' + email_(e.parameter.email), 30, function () {
            return reminders_(e.parameter.email);
          })
        });

      case 'questions':
        return out_({
          ok: true,
          data: questions_(e.parameter.subjectId)
        });

      case 'isAdmin':
        return out_({
          ok: true,
          isAdmin: isAdmin_(e.parameter.email, e.parameter.password)
        });

      case 'notifications':
      case 'notificationHistory':
        return out_({
          ok: true,
          data: notifications_(e.parameter.email)
        });

      case 'questionChangeLog':
        return out_({
          ok: true,
          data: questionChangeLog_()
        });

      default:
        return out_({
          ok: false,
          error: 'Unknown action: ' + action
        });
    }

  } catch (error) {
    return out_({
      ok: false,
      error: friendlyError_(error)
    });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    ensureSheetsCached_();

    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = String(body.action || '').trim();

    switch (action) {
      case 'register':
        return out_(register_(body));

      case 'deleteAccount':
        return out_(deleteAccount_(body));

      case 'importQuestions':
        return out_(importQuestions_(body));

      case 'updateQuestion':
        return out_(updateQuestion_(body));

      case 'createSubject':
        return out_(createSubject_(body));

      case 'submitExam':
        return out_(submitExam_(body));

      case 'submitRevision':
        return out_(submitRevision_(body));

      case 'createReminder':
      case 'remindMeLater':
        return out_(createReminder_(body));

      case 'updateReminder':
        return out_(updateReminder_(body));

      case 'toggleReminder':
        return out_(toggleReminder_(body));

      case 'deleteReminder':
        return out_(deleteReminder_(body));

      case 'retryNotification':
        return out_(retryNotification_(body));

      case 'processReminders':
        return out_({
          ok: true,
          message: processReminders()
        });

      case 'processEmailQueue':
        return out_({
          ok: true,
          message: processEmailQueue()
        });

      case 'sendRevisionUnlockEmails':
      case 'sendRevisionReminders':
        return out_({
          ok: true,
          message: sendRevisionUnlockEmails()
        });

      default:
        return out_({
          ok: false,
          error: 'Unknown action: ' + action
        });
    }

  } catch (error) {
    return out_({
      ok: false,
      error: friendlyError_(error)
    });

  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {
      // Nothing to do.
    }
  }
}

// Short-lived server-side cache (Apps Script CacheService) so repeated
// dashboard/history/mistakes/reminders loads don't rescan the whole sheet
// every time. TTL is intentionally short so edits show up quickly.
function cached_(key, ttlSeconds, fn) {
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
    var value = fn();
    try { cache.put(key, JSON.stringify(value), ttlSeconds); } catch (ignore) {}
    return value;
  } catch (e) {
    // Cache unavailable for any reason — fall back to computing directly.
    return fn();
  }
}

function friendlyError_(error) {
  if (!error) {
    return 'Unknown backend error.';
  }

  return String(error && error.message ? error.message : error)
    .slice(0, 500);
}


// ============================================================
// 5. USER REGISTRATION
// ============================================================

function register_(body) {
  var email = email_(body.email);
  var name = String(body.name || '').trim();

  if (!validEmail_(email)) {
    return {
      ok: false,
      error: 'A valid email address is required.'
    };
  }

  if (!name) {
    return {
      ok: false,
      error: 'Name is required.'
    };
  }

  var sheet = sh_('Users');
  var values = sheet.getDataRange().getValues();
  var headers = values[0] || SHEETS.Users;
  var emailIndex = headers.indexOf('Email');
  var found = false;

  for (var i = 1; i < values.length; i++) {
    if (email_(values[i][emailIndex]) === email) {
      var nameIndex = headers.indexOf('Name');
      var subjectIndex = headers.indexOf('LastSubject');
      var urlIndex = headers.indexOf('LastTestUrl');
      if (nameIndex >= 0) values[i][nameIndex] = name;
      // Timestamp is left untouched here on purpose: it records account
      // creation date and must not be overwritten on later logins.
      if (subjectIndex >= 0) values[i][subjectIndex] = body.subject || values[i][subjectIndex];
      if (urlIndex >= 0) values[i][urlIndex] = body.testUrl || values[i][urlIndex];
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
      found = true;
      break;
    }
  }

  if (!found) {
    append_(sheet, SHEETS.Users, {
      Timestamp: new Date(),
      Name: name,
      Email: email,
      LastSubject: body.subject || '',
      LastTestUrl: body.testUrl || ''
    });
  }

  return {
    ok: true,
    existing: found,
    message: found ? 'User updated.' : 'User saved.'
  };
}

// Deletes every row for an email from a sheet. Rewrites the kept rows in one
// setValues() call and trims the leftover tail in one deleteRows() call,
// instead of calling sheet.deleteRow() once per matching row — a user with a
// long history could have hundreds of Answers rows, and one deleteRow() per
// row (each of which reflows the whole sheet) was slow enough to blow past
// the client's timeout and, because doPost holds one script-wide lock, could
// also stall every OTHER concurrent register/submit/delete request queued
// behind it. This version costs exactly 2 sheet operations no matter how
// many rows are removed.
function deleteRowsByEmail_(sheetName, email) {
  var sheet = sh_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var emailIndex = headers.indexOf('Email');
  if (emailIndex === -1) return 0;

  var kept = [];
  var removed = 0;
  for (var i = 1; i < values.length; i++) {
    if (email_(values[i][emailIndex]) === email) {
      removed++;
    } else {
      kept.push(values[i]);
    }
  }
  if (!removed) return 0;

  var lastRow = sheet.getLastRow();
  var numCols = Math.max(1, sheet.getLastColumn());
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, numCols).setValues(kept);
  }
  var tailStart = kept.length + 2;
  if (tailStart <= lastRow) {
    sheet.deleteRows(tailStart, lastRow - tailStart + 1);
  }
  return removed;
}

// Permanently removes a student's account and every record tied to their
// email (results, answers, mistakes, reminders, notifications). Requires the
// email to be confirmed by the caller (the frontend asks for confirmation
// before sending this request).
function deleteAccount_(body) {
  var email = email_(body.email);
  if (!validEmail_(email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }

  var sheetsToClean = [
    'Users', 'Results', 'Answers', 'WrongAnswers', 'Rankings',
    'RevisionHistory', 'SubmittedSessions', 'Reminders', 'Notifications',
    'UserStats'
  ];

  var summary = {};
  sheetsToClean.forEach(function (name) {
    summary[name] = deleteRowsByEmail_(name, email);
  });

  return { ok: true, message: 'Account and related data deleted.', removed: summary };
}




// ============================================================
// 5A. QUESTION BANK IMPORT / ADMIN
// ============================================================

// Set one or more administrator emails before using the import tool.
// Keep this list private in Apps Script.
const ADMIN_EMAILS = [
  'admin@example.com'
];

// A simple shared password that unlocks the admin panel from the site itself,
// without needing to register an email above. Keep this in sync with
// ADMIN_PANEL_PASSWORD in app.js. Change it here (and in app.js) any time.
const ADMIN_PANEL_PASSWORD = '123';

function isAdmin_(email, password) {
  if (password && String(password) === ADMIN_PANEL_PASSWORD) return true;
  var normalized = email_(email);
  return validEmail_(normalized) && ADMIN_EMAILS.indexOf(normalized) !== -1 && normalized !== 'admin@example.com';
}

function questionId_() {
  return 'Q-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function slugify_(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Custom subjects created entirely from the Admin panel and stored in the
// 'Subjects' sheet. These need no code or GitHub changes: the homepage's
// "Practice Tests Added by Admin" section and the Add Questions dropdown
// both read this sheet live.
function customSubjects_() {
  var counts = {};
  objs_(sh_('Questions')).forEach(function (row) {
    var sid = String(row.SubjectId || '');
    if (!sid) return;
    counts[sid] = (counts[sid] || 0) + 1;
  });
  return objs_(sh_('Subjects')).map(function (row) {
    return {
      id: row.SubjectId,
      name: row.Name,
      password: row.Password,
      description: row.Description || '',
      createdAt: row.CreatedAt ? toDate_(row.CreatedAt).toISOString() : '',
      questionCount: counts[String(row.SubjectId)] || 0
    };
  });
}

function createSubject_(body) {
  var adminEmail = email_(body.adminEmail);
  if (!isAdmin_(adminEmail, body.adminPassword)) {
    return { ok: false, error: 'Admin access is required.' };
  }

  var name = String(body.name || '').trim();
  var password = String(body.password || '').trim();
  var description = String(body.description || '').trim();

  if (!name) {
    return { ok: false, error: 'Subject name is required.' };
  }
  if (!password) {
    return { ok: false, error: 'A password for this subject is required.' };
  }

  var sheet = sh_('Subjects');
  var existing = objs_(sheet);

  var nameLower = name.toLowerCase();
  var duplicate = existing.some(function (row) {
    return String(row.Name || '').trim().toLowerCase() === nameLower;
  });
  if (duplicate) {
    return { ok: false, error: 'A subject with this name already exists.' };
  }

  var base = slugify_(name) || 'subject';
  var id = base;
  var existingIds = {};
  existing.forEach(function (row) { existingIds[String(row.SubjectId || '')] = true; });
  var suffix = 1;
  while (existingIds[id]) {
    suffix++;
    id = base + '-' + suffix;
  }

  append_(sheet, SHEETS.Subjects, {
    SubjectId: id,
    Name: name,
    Password: password,
    Description: description,
    CreatedBy: adminEmail,
    CreatedAt: new Date()
  });

  return {
    ok: true,
    subject: { id: id, name: name, password: password, description: description }
  };
}

function importQuestions_(body) {
  var adminEmail = email_(body.adminEmail);
  if (!isAdmin_(adminEmail, body.adminPassword)) {
    return { ok: false, error: 'Admin access is required.' };
  }

  var subjectId = String(body.subjectId || '').trim();
  var subject = String(body.subject || '').trim();
  var rows = Array.isArray(body.questions) ? body.questions : [];

  if (!subjectId || !subject) {
    return { ok: false, error: 'Subject is required.' };
  }
  if (!rows.length) {
    return { ok: false, error: 'No questions were supplied.' };
  }
  if (rows.length > 500) {
    return { ok: false, error: 'Maximum 500 questions can be imported at once.' };
  }

  var valid = [];
  var errors = [];
  var seen = {};
  var letters = ['A', 'B', 'C', 'D'];

  // Protect against importing a question that already exists in the selected
  // subject. The browser-side validation catches duplicates inside the file,
  // while this server-side check also catches duplicates across earlier imports.
  var existing = {};
  var questionSheet = sh_('Questions');
  var existingLastRow = questionSheet ? questionSheet.getLastRow() : 0;
  if (existingLastRow > 1) {
    var existingValues = questionSheet.getRange(2, 1, existingLastRow - 1, SHEETS.Questions.length).getValues();
    existingValues.forEach(function(r) {
      var existingSubjectId = String(r[1] || '').trim();
      if (existingSubjectId !== subjectId) return;
      var existingQuestion = String(r[6] || '').trim().toLowerCase();
      var existingYear = String(r[3] || '').trim();
      var existingState = String(r[4] || 'TS').trim();
      var existingQno = String(r[5] || '').trim();
      if (existingQuestion) {
        existing[[existingQuestion, existingYear, existingState, existingQno].join('|')] = true;
      }
    });
  }

  rows.forEach(function(row, index) {
    var line = index + 2;
    var q = String(row.question || '').trim();
    var options = [
      String(row.optionA || '').trim(),
      String(row.optionB || '').trim(),
      String(row.optionC || '').trim(),
      String(row.optionD || '').trim()
    ];
    var correct = String(row.correctAnswer || '').trim().toUpperCase();
    var year = String(row.year || '').trim();
    var state = String(row.state || 'TS').trim();
    var qno = String(row.questionNumber || '').trim();
    var rowErrors = [];

    if (!q) rowErrors.push('Question is empty');
    options.forEach(function(o, i) { if (!o) rowErrors.push('Option ' + letters[i] + ' is empty'); });
    if (letters.indexOf(correct) === -1) rowErrors.push('Correct Answer must be A, B, C, or D');
    if (!year) rowErrors.push('Year is empty');

    var duplicateKey = [q.toLowerCase(), year, state, qno].join('|');
    if (seen[duplicateKey]) rowErrors.push('Duplicate question in this import');
    if (existing[duplicateKey]) rowErrors.push('Question already exists in this subject');
    seen[duplicateKey] = true;

    if (rowErrors.length) {
      errors.push({ row: line, errors: rowErrors });
      return;
    }

    valid.push({
      QuestionId: questionId_(),
      SubjectId: subjectId,
      Subject: subject,
      Year: year,
      State: state,
      QuestionNumber: qno,
      Question: q,
      OptionA: options[0],
      OptionB: options[1],
      OptionC: options[2],
      OptionD: options[3],
      CorrectAnswer: correct,
      CreatedAt: new Date(),
      CreatedBy: adminEmail,
      QuestionImage: String(row.questionImage || '').trim(),
      OptionAImage: String(row.optionAImage || '').trim(),
      OptionBImage: String(row.optionBImage || '').trim(),
      OptionCImage: String(row.optionCImage || '').trim(),
      OptionDImage: String(row.optionDImage || '').trim()
    });
  });

  if (errors.length) {
    return {
      ok: false,
      error: 'Import validation failed. No rows were added.',
      imported: 0,
      invalid: errors.length,
      errors: errors
    };
  }

  appendMany_(sh_('Questions'), SHEETS.Questions, valid);
  return { ok: true, imported: valid.length, invalid: 0, message: valid.length + ' question(s) imported successfully.' };
}

function questions_(subjectId) {
  var id = String(subjectId || '').trim();
  if (!id) return [];
  return objs_(sh_('Questions')).filter(function(row) {
    return String(row.SubjectId) === id;
  }).map(function(row) {
    var letters = ['A','B','C','D'];
    return {
      id: String(row.QuestionId),
      year: String(row.Year),
      state: String(row.State || ''),
      questionNumber: String(row.QuestionNumber || ''),
      question: String(row.Question || ''),
      options: [row.OptionA, row.OptionB, row.OptionC, row.OptionD].map(String),
      answer: Math.max(0, letters.indexOf(String(row.CorrectAnswer || '').toUpperCase())),
      image: String(row.QuestionImage || ''),
      optionImages: [row.OptionAImage, row.OptionBImage, row.OptionCImage, row.OptionDImage].map(function(v){return String(v||'');})
    };
  });
}

// Admin edit of a single existing question, matched by its QuestionId so it
// can never accidentally duplicate or touch the wrong row. Every edit is
// recorded to the ChangeLog sheet with a before/after snapshot.
function updateQuestion_(body) {
  var adminEmail = email_(body.adminEmail);
  if (!isAdmin_(adminEmail, body.adminPassword)) {
    return { ok: false, error: 'Admin access is required.' };
  }

  var questionId = String(body.questionId || '').trim();
  if (!questionId) {
    return { ok: false, error: 'questionId is required.' };
  }

  var q = String(body.question || '').trim();
  var options = [
    String(body.optionA || '').trim(),
    String(body.optionB || '').trim(),
    String(body.optionC || '').trim(),
    String(body.optionD || '').trim()
  ];
  var correct = String(body.correctAnswer || '').trim().toUpperCase();
  var year = String(body.year || '').trim();
  var letters = ['A', 'B', 'C', 'D'];

  if (!q) return { ok: false, error: 'Question is empty.' };
  for (var i = 0; i < options.length; i++) {
    if (!options[i]) return { ok: false, error: 'Option ' + letters[i] + ' is empty.' };
  }
  if (letters.indexOf(correct) === -1) return { ok: false, error: 'Correct Answer must be A, B, C, or D.' };
  if (!year) return { ok: false, error: 'Year is empty.' };

  var sheet = sh_('Questions');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'No questions found.' };

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idCol = headers.indexOf('QuestionId');
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  var rowIndex = -1;
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][idCol]) === questionId) { rowIndex = r; break; }
  }
  if (rowIndex === -1) return { ok: false, error: 'Question not found (it may have been deleted).' };

  var before = {};
  headers.forEach(function (h, i) { before[h] = values[rowIndex][i]; });

  var updated = {
    Question: q,
    OptionA: options[0], OptionB: options[1], OptionC: options[2], OptionD: options[3],
    CorrectAnswer: correct,
    Year: year,
    State: String(body.state || before.State || '').trim(),
    QuestionNumber: String(body.questionNumber || before.QuestionNumber || '').trim(),
    QuestionImage: String(body.questionImage || '').trim(),
    OptionAImage: String(body.optionAImage || '').trim(),
    OptionBImage: String(body.optionBImage || '').trim(),
    OptionCImage: String(body.optionCImage || '').trim(),
    OptionDImage: String(body.optionDImage || '').trim()
  };

  var after = {};
  headers.forEach(function (h) { after[h] = updated[h] !== undefined ? updated[h] : before[h]; });

  headers.forEach(function (h, i) {
    if (updated[h] !== undefined) {
      sheet.getRange(2 + rowIndex, i + 1).setValue(updated[h]);
    }
  });

  // Record the change (which fields differed) to ChangeLog.
  var changedFields = [];
  Object.keys(updated).forEach(function (h) {
    if (String(before[h] || '') !== String(updated[h] || '')) changedFields.push(h);
  });

  append_(sh_('ChangeLog'), SHEETS.ChangeLog, {
    ChangeId: 'C-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16),
    Timestamp: new Date(),
    EditedBy: adminEmail,
    Subject: String(before.Subject || ''),
    SubjectId: String(before.SubjectId || ''),
    QuestionId: questionId,
    QuestionSnippet: q.slice(0, 120),
    BeforeJSON: JSON.stringify(before),
    AfterJSON: JSON.stringify(after),
    Summary: changedFields.length ? ('Changed: ' + changedFields.join(', ')) : 'No field values changed'
  });

  return { ok: true, message: 'Question updated successfully.' };
}

// Returns the most recent ~50 ChangeLog entries, newest first.
function questionChangeLog_() {
  var rows = objs_(sh_('ChangeLog'));
  rows.sort(function (a, b) { return toDate_(b.Timestamp) - toDate_(a.Timestamp); });
  return rows.slice(0, 50).map(function (row) {
    return {
      changeId: String(row.ChangeId || ''),
      timestamp: row.Timestamp ? toDate_(row.Timestamp).toISOString() : '',
      editedBy: String(row.EditedBy || ''),
      subject: String(row.Subject || ''),
      subjectId: String(row.SubjectId || ''),
      questionId: String(row.QuestionId || ''),
      questionSnippet: String(row.QuestionSnippet || ''),
      summary: String(row.Summary || '')
    };
  });
}

// ============================================================
// 6. RANKING
// ============================================================

// Ranks this attempt against every other user's BEST score in the same
// subject. Used to read the entire Results sheet (every attempt from every
// user, across every subject) on every single test submission — the hottest
// write path in the app, and one that runs under the global script lock, so
// it was the biggest single thing slowing submissions down as history grew.
// The Rankings sheet already stores exactly one row per (user, subject) with
// their BestPercentage, kept current by upsertRanking_ right after this
// runs — so read that instead: it grows with unique user×subject pairs, not
// with every attempt ever taken.
function practiceRank_(subject, email, percentage) {
  var rows = objs_(sh_('Rankings')).filter(function (row) {
    return String(row.Subject) === String(subject);
  });

  var bestByUser = {};

  rows.forEach(function (row) {
    var userEmail = email_(row.Email);

    if (!userEmail) {
      return;
    }

    bestByUser[userEmail] = Math.max(
      0,
      Math.min(100, num_(row.BestPercentage))
    );
  });

  var currentEmail = email_(email);
  var currentPercentage = Math.max(
    0,
    Math.min(100, num_(percentage))
  );

  if (
    bestByUser[currentEmail] === undefined ||
    currentPercentage > bestByUser[currentEmail]
  ) {
    bestByUser[currentEmail] = currentPercentage;
  }

  var rank = 1;

  Object.keys(bestByUser).forEach(function (userEmail) {
    if (bestByUser[userEmail] > currentPercentage) {
      rank++;
    }
  });

  return {
    rank: rank,
    total: Object.keys(bestByUser).length
  };
}

/**
 * This is the configured ECET equalized-rank range used by the project.
 * It is NOT calculated from official ECET normalization data.
 */
function expectedRank_(percentage) {
  var p = num_(percentage);

  if (p >= 65) return '1 – 10';
  if (p >= 60) return '11 – 20';
  if (p >= 55) return '21 – 40';
  if (p >= 50) return '41 – 60';
  if (p >= 45) return '61 – 100';
  if (p >= 40) return '101 – 200';
  if (p >= 35) return '201 – 500';
  if (p >= 30) return '501 – 1000';

  return '1001+';
}


// ============================================================
// 7. EXAM SUBMISSION
// ============================================================

function submitExam_(body) {
  var sessionId = String(body.examSessionId || '').trim();
  var email = email_(body.email);
  var subject = String(body.subject || '').trim();
  var name = String(body.name || '').trim();

  if (!validEmail_(email)) {
    return {
      ok: false,
      error: 'A valid email address is required.'
    };
  }

  if (!subject) {
    return {
      ok: false,
      error: 'Test subject is required.'
    };
  }

  // Duplicate submission protection. Uses TextFinder to search just the
  // ExamSessionId / ResultId columns instead of objs_() (which would pull
  // every column of every row, across every user, into memory just to
  // find one match) — this runs on every single submission, so it's worth
  // keeping cheap as both sheets grow.
  if (sessionId) {
    var priorResultId = findInColumn_('SubmittedSessions', 'ExamSessionId', sessionId, 'ResultId');

    if (priorResultId) {
      var oldResult = findRowByColumn_('Results', 'ResultId', priorResultId);

      if (oldResult) {
        return resultResponse_(oldResult, true);
      }
    }
  }

  var now = new Date();
  var startTime = toDate_(body.startTime, now);
  var detail = Array.isArray(body.detail) ? body.detail : [];

  if (!detail.length) {
    return { ok: false, error: 'No question details were supplied. Please reopen the test and submit again.' };
  }

  // 3-day re-attempt cooldown. Only rejects a genuinely NEW session: if this
  // attempt's startTime is at or before the last completed attempt's time,
  // it's the resume of an exam that was already running before the cooldown
  // existed (or is that same completed attempt being resubmitted, which the
  // session-dedup check above already handled) — resuming is always allowed.
  // This never sends an email or creates a reminder; it's a pure pacing rule.
  var lastAttemptAt = getSubjectLastAttempt_(email, subject);
  if (lastAttemptAt) {
    var unlockAt = new Date(lastAttemptAt.getTime() + SUBJECT_COOLDOWN_MS);
    if (now < unlockAt && startTime > lastAttemptAt) {
      return {
        ok: false,
        error: 'You already attempted "' + subject + '" recently. You can retake it after ' + iso_(unlockAt) + '.',
        cooldown: { locked: true, unlockAt: iso_(unlockAt) }
      };
    }
  }

  var userRows = objs_(sh_('Users'));
  var knownUser = userRows.find(function(row){ return email_(row.Email) === email; });
  if (!name && knownUser) name = String(knownUser.Name || '').trim();
  if (!name) name = 'ECET Student';

  // ----------------------------------------------------------
  // Recalculate score from question details.
  // This prevents the browser from sending incorrect totals.
  // No negative marking is applied.
  // ----------------------------------------------------------

  var correct = 0;
  var wrong = 0;
  var unanswered = 0;
  var totalTimeSec = 0;

  detail.forEach(function (question) {
    var answered =
      question.selected !== null &&
      question.selected !== undefined &&
      question.selected !== '';

    var isCorrect =
      answered &&
      Number(question.selected) === Number(question.correct);

    if (!answered) {
      unanswered++;
    } else if (isCorrect) {
      correct++;
    } else {
      wrong++;
    }

    totalTimeSec += Math.max(0, num_(question.time));
  });

  var total = detail.length;

  // If the frontend sends no detail, fall back to its totals.
  // This keeps compatibility with older frontend versions.
  if (total === 0) {
    total = Math.max(0, Math.floor(num_(body.total)));
    correct = Math.max(0, Math.floor(num_(body.correct)));
    wrong = Math.max(0, Math.floor(num_(body.wrong)));
    unanswered = Math.max(
      0,
      Math.floor(num_(body.unanswered))
    );
    totalTimeSec = Math.max(
      0,
      Math.floor(num_(body.totalTime))
    );
  }

  // No negative marking.
  var score = correct;

  var percentage = total > 0
    ? Math.round((correct / total) * 10000) / 100
    : 0;

  var rank = practiceRank_(
    subject,
    email,
    percentage
  );

  var resultId = Utilities.getUuid();

  // Revision becomes available 24 hours after the completed test.
  var unlock = new Date(
    now.getTime() + 24 * 60 * 60 * 1000
  );

  var testUrl = String(body.testUrl || '').trim();
  var revisionTestUrl =
    String(body.revisionTestUrl || '').trim();

  var result = {
    ResultId: resultId,
    Timestamp: now,
    Name: name,
    Email: email,
    Subject: subject,
    SubjectId: body.subjectId || '',
    Score: score,
    Total: total,
    Percentage: percentage,
    Correct: correct,
    Wrong: wrong,
    Unanswered: unanswered,
    TotalTimeSec: totalTimeSec,
    StartTime: startTime,
    EndTime: now,
    Rank: rank.rank,
    RankOutOf: rank.total,
    RevisionAvailableAt: unlock,
    RevisionUnlockedEmailSent: false,
    TestUrl: testUrl
  };

  append_(
    sh_('Results'),
    SHEETS.Results,
    result
  );

  // ----------------------------------------------------------
  // Save every answer and every mistake.
  // Wrong + unattempted both become revision questions.
  // ----------------------------------------------------------

  var answerRows = [];
  var mistakeRows = [];

  detail.forEach(function (question) {
    var answered =
      question.selected !== null &&
      question.selected !== undefined &&
      question.selected !== '';

    var isCorrect =
      answered &&
      Number(question.selected) === Number(question.correct);

    answerRows.push({
      ResultId: resultId,
      Email: email,
      Subject: subject,
      QuestionId: question.id,
      Year: question.year,
      State: question.state,
      QuestionNumber: question.questionNumber,
      SelectedIndex: answered ? question.selected : '',
      CorrectIndex: question.correct,
      IsCorrect: isCorrect,
      TimeSpentSec: Math.max(0, num_(question.time)),
      MarkedForReview: bool_(question.marked)
    });

    if (!isCorrect) {
      mistakeRows.push({
        WrongId:
          resultId + '-' + String(question.id || Utilities.getUuid()),

        ResultId: resultId,
        Email: email,
        Subject: subject,
        QuestionId: question.id,
        Year: question.year,
        State: question.state,
        QuestionNumber: question.questionNumber,
        Question: question.question || '',
        OptionsJSON: JSON.stringify(question.options || []),
        ImagesJSON: JSON.stringify({image: question.image || '', optionImages: question.optionImages || []}),
        CorrectIndex: question.correct,
        SelectedIndex: answered ? question.selected : '',
        MistakeType: answered ? 'wrong' : 'unattempted',
        DateAdded: now,
        RevisionDueDate: unlock,
        Revised: false,
        ReminderSent: false,
        TestUrl:
          revisionTestUrl ||
          siteFromTestUrl_(testUrl)
      });
    }
  });

  appendMany_(
    sh_('Answers'),
    SHEETS.Answers,
    answerRows
  );

  appendMany_(
    sh_('WrongAnswers'),
    SHEETS.WrongAnswers,
    mistakeRows
  );

  recordAttemptInUserStats_(result, mistakeRows.length);

  if (sessionId) {
    append_(
      sh_('SubmittedSessions'),
      SHEETS.SubmittedSessions,
      {
        ExamSessionId: sessionId,
        ResultId: resultId,
        Email: email,
        Subject: subject,
        SubmittedAt: now
      }
    );
  }

  upsertRanking_(result);

  var emailResult = sendResultEmail_(
    result,
    rank.rank,
    unlock
  );

  return {
    ok: true,
    resultId: resultId,
    rank: rank.rank,
    rankOutOf: rank.total,
    expectedRank: expectedRank_(percentage),
    revisionAvailableAt: unlock.toISOString(),
    emailStatus: emailResult.status
  };
}

function resultResponse_(result, duplicate) {
  return {
    ok: true,
    duplicate: !!duplicate,
    resultId: result.ResultId || '',
    rank: result.Rank || '',
    rankOutOf: result.RankOutOf || '',
    expectedRank: expectedRank_(result.Percentage),
    revisionAvailableAt:
      result.RevisionAvailableAt
        ? new Date(result.RevisionAvailableAt).toISOString()
        : null,
    emailStatus: 'ALREADY_SENT'
  };
}


// ============================================================
// 8. RANKING SHEET
// ============================================================

function upsertRanking_(result) {
  var sheet = sh_('Rankings');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return;
  }

  var headers = values[0];

  var subjectIndex = headers.indexOf('Subject');
  var emailIndex = headers.indexOf('Email');
  var nameIndex = headers.indexOf('Name');
  var bestPercentageIndex =
    headers.indexOf('BestPercentage');
  var bestScoreIndex =
    headers.indexOf('BestScore');
  var totalIndex = headers.indexOf('Total');
  var attemptsIndex = headers.indexOf('Attempts');
  var lastAttemptIndex =
    headers.indexOf('LastAttempt');

  var userEmail = email_(result.Email);
  var currentPercentage = num_(result.Percentage);

  for (var i = 1; i < values.length; i++) {
    var row = values[i];

    if (
      String(row[subjectIndex]) === String(result.Subject) &&
      email_(row[emailIndex]) === userEmail
    ) {
      var oldBest = num_(row[bestPercentageIndex]);

      if (currentPercentage > oldBest) {
        row[bestPercentageIndex] = currentPercentage;
        row[bestScoreIndex] = num_(result.Score);
        row[totalIndex] = num_(result.Total);
      }

      row[attemptsIndex] =
        num_(row[attemptsIndex]) + 1;

      row[lastAttemptIndex] = new Date();

      sheet
        .getRange(i + 1, 1, 1, headers.length)
        .setValues([row]);

      return;
    }
  }

  append_(
    sheet,
    SHEETS.Rankings,
    {
      Subject: result.Subject,
      Email: userEmail,
      Name: result.Name,
      BestPercentage: currentPercentage,
      BestScore: num_(result.Score),
      Total: num_(result.Total),
      Attempts: 1,
      LastAttempt: new Date()
    }
  );
}


// ============================================================
// 8b. USER STATS (incremental dashboard cache)
// ============================================================
// dashboard_() used to recompute everything from a full scan of Results +
// WrongAnswers on every single load, which only gets slower as those sheets
// grow with every attempt from every user. UserStats keeps one row per user,
// updated incrementally right here at submit-time, so a dashboard load is a
// single-row lookup no matter how much history has piled up.

function userStatsHeaders_() {
  return SHEETS.UserStats;
}

// Finds the row (values[], 0-based, includes header row at index 0) for an
// email in a values[][] snapshot of the UserStats sheet. Returns -1 if none.
function findUserStatsRowIndex_(values, headers, email) {
  var emailIndex = headers.indexOf('Email');
  for (var i = 1; i < values.length; i++) {
    if (email_(values[i][emailIndex]) === email) return i;
  }
  return -1;
}

function parseSubjectStats_(json) {
  try {
    var parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

// Called once per submitted test, right after that attempt's mistakes are
// known. Updates (or creates) the single UserStats row for this email.
function recordAttemptInUserStats_(result, newMistakesCount) {
  var sheet = sh_('UserStats');
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0] : userStatsHeaders_();

  var email = email_(result.Email);
  var percentage = num_(result.Percentage);
  var subject = String(result.Subject || '');

  var emailIndex = headers.indexOf('Email');
  var attemptsIndex = headers.indexOf('Attempts');
  var sumIndex = headers.indexOf('SumPercentage');
  var bestIndex = headers.indexOf('BestPercentage');
  var mistakesIndex = headers.indexOf('MistakesCount');
  var subjJsonIndex = headers.indexOf('SubjectStatsJSON');
  var updatedIndex = headers.indexOf('UpdatedAt');

  var rowIndex = values.length
    ? findUserStatsRowIndex_(values, headers, email)
    : -1;

  var row = rowIndex === -1
    ? headers.map(function () { return ''; })
    : values[rowIndex];

  var subjectStats = parseSubjectStats_(row[subjJsonIndex]);
  var s = subjectStats[subject] || { attempts: 0, sum: 0, best: 0, worst: 100 };
  s.attempts += 1;
  s.sum += percentage;
  s.best = Math.max(s.best, percentage);
  // worst may be undefined on entries created before this field existed —
  // fall back to +Infinity so the very first comparison always takes
  // percentage rather than silently keeping an undefined "worst".
  s.worst = Math.min(s.worst === undefined ? Infinity : s.worst, percentage);
  // Drives the 3-day re-attempt cooldown (see subjectStatus_ / dashboard_).
  // Stored as an ISO string so it survives JSON round-tripping untouched.
  s.lastAttempt = iso_(result.EndTime || new Date());
  subjectStats[subject] = s;

  row[emailIndex] = email;
  row[attemptsIndex] = num_(row[attemptsIndex]) + 1;
  row[sumIndex] = num_(row[sumIndex]) + percentage;
  row[bestIndex] = Math.max(num_(row[bestIndex]), percentage);
  row[mistakesIndex] = num_(row[mistakesIndex]) + num_(newMistakesCount);
  row[subjJsonIndex] = JSON.stringify(subjectStats);
  row[updatedIndex] = new Date();

  if (rowIndex === -1) {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
  }
}

// Reads just the lastAttempt timestamp for one (email, subject) pair straight
// out of the already-maintained UserStats row — a single-row lookup, not a
// scan or recompute of anything. Returns null if the user/subject has no
// completed attempt yet. Backs both the 3-day cooldown check in submitExam_
// and the subjectStatus_ endpoint the frontend polls before starting a test.
function getSubjectLastAttempt_(email, subject) {
  email = email_(email);
  var sheet = sh_('UserStats');
  var values = sheet.getDataRange().getValues();
  if (!values.length) return null;
  var headers = values[0];
  var rowIndex = findUserStatsRowIndex_(values, headers, email);
  if (rowIndex === -1) return null;
  var subjJsonIndex = headers.indexOf('SubjectStatsJSON');
  var subjectStats = parseSubjectStats_(values[rowIndex][subjJsonIndex]);
  var s = subjectStats[String(subject || '')];
  if (!s || !s.lastAttempt) return null;
  var d = new Date(s.lastAttempt);
  return isNaN(d.getTime()) ? null : d;
}

// Re-attempt cooldown: once a subject is completed, the same user can't
// start a fresh attempt on it again for 3 days. Purely a practice-pacing
// rule — it never queues or sends any email/reminder about it, and it never
// blocks resuming an exam that was already in progress before the cooldown
// started (see subjectStatus_ callers on the frontend for that distinction).
var SUBJECT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

function subjectStatus_(email, subject) {
  email = email_(email);
  subject = String(subject || '');
  var lastAttempt = getSubjectLastAttempt_(email, subject);
  if (!lastAttempt) {
    return { locked: false, lastAttempt: null, unlockAt: null };
  }
  var unlockAt = new Date(lastAttempt.getTime() + SUBJECT_COOLDOWN_MS);
  var locked = new Date() < unlockAt;
  return {
    locked: locked,
    lastAttempt: iso_(lastAttempt),
    unlockAt: locked ? iso_(unlockAt) : null
  };
}


function adjustUserMistakesCount_(email, delta) {
  if (!delta) return;
  email = email_(email);
  var sheet = sh_('UserStats');
  var values = sheet.getDataRange().getValues();
  if (!values.length) return;

  var headers = values[0];
  var rowIndex = findUserStatsRowIndex_(values, headers, email);
  if (rowIndex === -1) return;

  var mistakesIndex = headers.indexOf('MistakesCount');
  var updatedIndex = headers.indexOf('UpdatedAt');
  var row = values[rowIndex];

  row[mistakesIndex] = Math.max(0, num_(row[mistakesIndex]) + delta);
  row[updatedIndex] = new Date();

  sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
}

// One-time backfill for users who already had Results/WrongAnswers before
// UserStats existed. Safe to re-run — it recomputes each user from scratch
// rather than double-adding. Run manually from the Apps Script editor once
// after deploying this update; not called from doGet/doPost.
function migrateUserStats_() {
  var results = objs_(sh_('Results'));
  var wrongAnswers = objs_(sh_('WrongAnswers')).filter(function (row) {
    return !bool_(row.Revised);
  });

  var byEmail = {};

  results.forEach(function (row) {
    var email = email_(row.Email);
    if (!byEmail[email]) {
      byEmail[email] = { attempts: 0, sum: 0, best: 0, mistakes: 0, subjects: {} };
    }
    var percentage = num_(row.Percentage);
    var subject = String(row.Subject || '');
    var u = byEmail[email];
    u.attempts += 1;
    u.sum += percentage;
    u.best = Math.max(u.best, percentage);
    var s = u.subjects[subject] || { attempts: 0, sum: 0, best: 0, worst: 100, lastAttempt: null };
    s.attempts += 1;
    s.sum += percentage;
    s.best = Math.max(s.best, percentage);
    s.worst = Math.min(s.worst, percentage);
    var endTime = toDate_(row.EndTime || row.Timestamp);
    if (!s.lastAttempt || endTime > new Date(s.lastAttempt)) {
      s.lastAttempt = iso_(endTime);
    }
    u.subjects[subject] = s;
  });

  wrongAnswers.forEach(function (row) {
    var email = email_(row.Email);
    if (!byEmail[email]) {
      byEmail[email] = { attempts: 0, sum: 0, best: 0, mistakes: 0, subjects: {} };
    }
    byEmail[email].mistakes += 1;
  });

  var sheet = sh_('UserStats');
  var headers = userStatsHeaders_();
  var now = new Date();

  var rows = Object.keys(byEmail).map(function (email) {
    var u = byEmail[email];
    return [
      email, u.attempts, u.sum, u.best, u.mistakes, JSON.stringify(u.subjects), now
    ];
  });

  // Wipe and rewrite rather than upsert row-by-row — this only runs once,
  // manually, so a clean full rebuild is simpler and safer than merging.
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { ok: true, usersMigrated: rows.length };
}


// ============================================================
// 9. RESULT EMAIL
// ============================================================

function minutes_(seconds) {
  var totalSeconds = Math.round(num_(seconds));

  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );
  var remainingSeconds =
    totalSeconds % 60;

  if (hours) {
    return (
      hours + 'h ' +
      minutes + 'm ' +
      remainingSeconds + 's'
    );
  }

  return (
    minutes + 'm ' +
    remainingSeconds + 's'
  );
}

function resultHtml_(result, rank, unlock) {
  var ready = new Date() >= new Date(unlock);

  var revisionUrl =
    String(result.RevisionTestUrl || '').trim() ||
    siteFromTestUrl_(result.TestUrl);

  var revisionSection = ready
    ? (
      revisionUrl
        ? '<a href="' + esc_(revisionUrl) + '"' +
          ' style="display:inline-block;padding:12px 18px;' +
          'background:#111;color:#fff;text-decoration:none;' +
          'border-radius:7px;margin:4px">Take Revision Test</a>'
        : '<p style="padding:12px;background:#f4f4f4;' +
          'border-radius:7px">Revision Test is unlocked. ' +
          'Open the website to start it.</p>'
    )
    : (
      '<p style="padding:12px;background:#f4f4f4;' +
      'border-radius:7px">' +
      'Revision Test unlocks on <b>' +
      esc_(display_(unlock)) +
      '</b>.</p>'
    );

  var rows = [
    ['Test Subject', result.Subject],
    ['Test Start Date & Time', display_(result.StartTime)],
    ['Test End Date & Time', display_(result.EndTime)],
    ['Total Time Spent', minutes_(result.TotalTimeSec)],
    ['Marks Obtained', result.Score],
    ['Percentage', result.Percentage + '%'],
    ['Total Questions', result.Total],
    ['Correct', result.Correct],
    ['Wrong', result.Wrong],
    ['Unattempted', result.Unanswered],
    ['Current Test Rank',
      result.Rank + ' / ' + result.RankOutOf],
    ['ECET Equalized Rank',
      expectedRank_(result.Percentage)]
  ];

  var table = rows.map(function (row) {
    return (
      '<tr>' +
      '<td style="padding:9px;border-bottom:1px solid #eee">' +
      '<b>' + esc_(row[0]) + '</b>' +
      '</td>' +
      '<td style="padding:9px;border-bottom:1px solid #eee">' +
      esc_(row[1]) +
      '</td>' +
      '</tr>'
    );
  }).join('');

  var retakeButton = result.TestUrl
    ? (
      '<a href="' + esc_(result.TestUrl) + '"' +
      ' style="display:inline-block;padding:12px 18px;' +
      'background:#111;color:#fff;text-decoration:none;' +
      'border-radius:7px;margin:4px">Retake Test</a>'
    )
    : '';

  return (
    '<div style="font-family:Arial,sans-serif;' +
    'max-width:680px;margin:auto;color:#222">' +

    '<h2>ECET Test Result</h2>' +

    '<p>Dear <b>' +
    esc_(result.Name) +
    '</b>,</p>' +

    '<table style="width:100%;border-collapse:collapse">' +
    table +
    '</table>' +

    '<p style="margin-top:20px">' +
    retakeButton +
    revisionSection +
    '</p>' +

    '<p style="font-size:12px;color:#777">' +
    'This email contains your test summary only.' +
    '</p>' +

    '</div>'
  );
}

function sendResultEmail_(result, rank, unlock) {
  var subject =
    'ECET ' + result.Subject + ' — Test Result';

  var html = resultHtml_(
    result,
    rank,
    unlock
  );

  // submitExam_ runs inside doPost's script lock. MailApp.sendEmail is a
  // network call (1–4s) — calling it live here would hold that lock for
  // the whole send, blocking every other doPost request (including other
  // students' submitExam calls) until it finished. So we never send here:
  // we just queue a fast sheet append, and processEmailQueue() (a
  // background trigger) sends it a few seconds later, outside this lock.
  append_(
    sh_('EmailQueue'),
    SHEETS.EmailQueue,
    {
      QueueId: Utilities.getUuid(),
      ToEmail: email_(result.Email),
      EmailType: 'result',
      Subject: subject,
      HtmlBody: html,
      CreatedAt: new Date(),
      SentAt: '',
      Status: 'PENDING'
    }
  );

  return {
    status: 'QUEUED'
  };
}


// ============================================================
// 10. DASHBOARD / MISTAKES / HISTORY
// ============================================================

// Reads the single UserStats row for this email — O(1)-ish regardless of how
// many attempts exist across the whole app. Falls back to the old full-sheet
// scan (dashboardLegacy_) only for a user who attempted tests before
// UserStats existed and hasn't had migrateUserStats_() run for them yet; that
// fallback also writes the computed result back so the NEXT load is fast.
function dashboard_(email) {
  email = email_(email);

  var sheet = sh_('UserStats');
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0] : userStatsHeaders_();
  var rowIndex = values.length ? findUserStatsRowIndex_(values, headers, email) : -1;

  if (rowIndex === -1) {
    var legacy = dashboardLegacy_(email);
    if (legacy.attempts > 0 || legacy.mistakes > 0) {
      bootstrapUserStatsRow_(email, legacy);
    }
    return legacy;
  }

  var row = values[rowIndex];
  var attempts = num_(row[headers.indexOf('Attempts')]);
  var sum = num_(row[headers.indexOf('SumPercentage')]);
  var best = num_(row[headers.indexOf('BestPercentage')]);
  var mistakes = num_(row[headers.indexOf('MistakesCount')]);
  var subjectStats = parseSubjectStats_(row[headers.indexOf('SubjectStatsJSON')]);

  var subjectList = Object.keys(subjectStats).map(function (key) {
    var s = subjectStats[key];
    return {
      subject: key,
      best: Math.round(s.best * 10) / 10,
      // Older rows created before "worst" existed won't have it — fall back
      // to best so the UI never shows a blank instead of a number.
      worst: Math.round((s.worst === undefined ? s.best : s.worst) * 10) / 10,
      avg: s.attempts ? Math.round((s.sum / s.attempts) * 10) / 10 : 0,
      attempts: s.attempts,
      lastAttempt: s.lastAttempt || null
    };
  });

  return {
    attempts: attempts,
    best: Math.round(best * 10) / 10,
    avg: attempts ? Math.round((sum / attempts) * 10) / 10 : 0,
    mistakes: mistakes,
    subjects: subjectList
  };
}

// Writes a freshly-computed legacy result into UserStats so subsequent loads
// for this user hit the fast path. Rebuilds SubjectStatsJSON in the {sum,
// best, attempts} shape recordAttemptInUserStats_ expects.
function bootstrapUserStatsRow_(email, legacy) {
  var sheet = sh_('UserStats');
  var headers = userStatsHeaders_();
  var subjectStats = {};
  (legacy.subjects || []).forEach(function (s) {
    subjectStats[s.subject] = {
      attempts: s.attempts,
      sum: s.avg * s.attempts,
      best: s.best,
      worst: s.worst === undefined ? s.best : s.worst,
      lastAttempt: s.lastAttempt || null
    };
  });
  sheet.appendRow([
    email, legacy.attempts, legacy.attempts * legacy.avg, legacy.best,
    legacy.mistakes, JSON.stringify(subjectStats), new Date()
  ]);
}

// The original full-sheet-scan implementation. Only reached now as a
// fallback for a user missing a UserStats row (see dashboard_ above) and by
// migrateUserStats_.
function dashboardLegacy_(email) {
  email = email_(email);

  var results = objs_(sh_('Results')).filter(function (row) {
    return email_(row.Email) === email;
  });

  var mistakes = objs_(sh_('WrongAnswers')).filter(function (row) {
    return (
      email_(row.Email) === email &&
      !bool_(row.Revised)
    );
  });

  var subjects = {};

  results.forEach(function (row) {
    var key = String(row.Subject || '');

    if (!subjects[key]) {
      subjects[key] = {
        subject: row.Subject,
        best: 0,
        worst: 100,
        attempts: 0,
        lastAttempt: null
      };
    }

    subjects[key].best = Math.max(
      subjects[key].best,
      num_(row.Percentage)
    );

    subjects[key].worst = Math.min(
      subjects[key].worst,
      num_(row.Percentage)
    );

    var endTime = toDate_(row.EndTime || row.Timestamp);
    if (!subjects[key].lastAttempt || endTime > new Date(subjects[key].lastAttempt)) {
      subjects[key].lastAttempt = iso_(endTime);
    }

    subjects[key].attempts++;
  });

  var percentages = results.map(function (row) {
    return num_(row.Percentage);
  });

  var subjectList = Object.keys(subjects).map(function (key) {
    var subjectResults = results.filter(function(row){ return String(row.Subject || '') === key; });
    var avg = subjectResults.length ? subjectResults.reduce(function(sum,row){ return sum + num_(row.Percentage); },0) / subjectResults.length : 0;
    return {
      subject: subjects[key].subject,
      best: Math.round(subjects[key].best * 10) / 10,
      worst: Math.round(subjects[key].worst * 10) / 10,
      avg: Math.round(avg * 10) / 10,
      attempts: subjects[key].attempts,
      lastAttempt: subjects[key].lastAttempt
    };
  });

  return {
    attempts: results.length,
    best: percentages.length ? Math.max.apply(null, percentages) : 0,
    avg: percentages.length ? Math.round((percentages.reduce(function (a, b) { return a + b; }, 0) / percentages.length) * 10) / 10 : 0,
    mistakes: mistakes.length,
    subjects: subjectList
  };
}

function profile_(email) {
  email = email_(email);

  var d = dashboard_(email);

  var userRow = objs_(sh_('Users')).filter(function (row) {
    return email_(row.Email) === email;
  })[0];

  var reminderCount = objs_(sh_('Reminders')).filter(function (row) {
    return email_(row.Email) === email;
  }).length;

  return {
    name: userRow ? userRow.Name : '',
    email: email,
    createdAt: userRow && userRow.Timestamp ? toDate_(userRow.Timestamp).toISOString() : '',
    attempts: d.attempts,
    avg: d.avg,
    best: d.best,
    mistakes: d.mistakes,
    reminders: reminderCount,
    subjects: d.subjects
  };
}

function mistakes_(email) {
  email = email_(email);

  return objs_(sh_('WrongAnswers'))
    .filter(function (row) {
      return (
        email_(row.Email) === email &&
        !bool_(row.Revised)
      );
    })
    .map(function (row) {
      var options = [];

      try {
        options = JSON.parse(
          row.OptionsJSON || '[]'
        );
      } catch (ignore) {
        options = [];
      }

      var images = {};
      try {
        images = JSON.parse(row.ImagesJSON || '{}');
      } catch (ignore) {
        images = {};
      }

      return {
        wrongId: row.WrongId,
        resultId: row.ResultId,
        subject: row.Subject,
        questionId: row.QuestionId,
        year: row.Year,
        state: row.State,
        questionNumber: row.QuestionNumber,
        question: row.Question,
        options: options,
        image: images.image || '',
        optionImages: images.optionImages || [],
        correctIndex: row.CorrectIndex,
        selectedIndex: row.SelectedIndex,
        mistakeType:
          String(
            row.MistakeType || 'wrong'
          ).toLowerCase(),
        revisionDueIso:
          row.RevisionDueDate
            ? new Date(row.RevisionDueDate).toISOString()
            : null,
        revised: bool_(row.Revised),
        testUrl: row.TestUrl || ''
      };
    });
}

function history_(email) {
  email = email_(email);

  return objs_(sh_('Results'))
    .filter(function (row) {
      return email_(row.Email) === email;
    })
    .sort(function (a, b) {
      return (
        new Date(b.EndTime || b.Timestamp) -
        new Date(a.EndTime || a.Timestamp)
      );
    })
    .map(function (row) {
      var liveRank = practiceRank_(row.Subject, row.Email, num_(row.Percentage));
      return {
        resultId: row.ResultId,
        timestamp: toDate_(
          row.Timestamp
        ).toISOString(),
        subject: row.Subject,
        subjectId: row.SubjectId,
        score: num_(row.Score),
        total: num_(row.Total),
        percentage: num_(row.Percentage),
        correct: num_(row.Correct),
        wrong: num_(row.Wrong),
        unanswered: num_(row.Unanswered),
        totalTimeSec: num_(row.TotalTimeSec),
        rank: liveRank.rank,
        rankOutOf: liveRank.total,
        startTime: toDate_(
          row.StartTime || row.Timestamp
        ).toISOString(),
        endTime: toDate_(
          row.EndTime || row.Timestamp
        ).toISOString()
      };
    });
}


// ============================================================
// 11. REVISION TEST SUBMISSION
// ============================================================

function submitRevision_(body) {
  var email = email_(body.email);

  if (!validEmail_(email)) {
    return {
      ok: false,
      error: 'A valid email address is required.'
    };
  }

  var sheet = sh_('WrongAnswers');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return {
      ok: true,
      correct: 0,
      wrong: 0,
      unattempted: 0
    };
  }

  var headers = values[0];

  function indexOfHeader(name) {
    return headers.indexOf(name);
  }

  var items = Array.isArray(body.items)
    ? body.items
    : [];

  var itemMap = new Map();

  items.forEach(function (item) {
    itemMap.set(
      String(item.wrongId),
      item
    );
  });

  var historyRows = [];

  var correct = 0;
  var wrong = 0;
  var unattempted = 0;

  var touchedRows = [];

  for (var i = 1; i < values.length; i++) {
    var wrongId = String(
      values[i][indexOfHeader('WrongId')]
    );

    if (!itemMap.has(wrongId)) {
      continue;
    }

    var storedEmail = email_(
      values[i][indexOfHeader('Email')]
    );

    if (storedEmail !== email) {
      continue;
    }

    var item = itemMap.get(wrongId);

    var answered =
      item.selected !== null &&
      item.selected !== undefined &&
      item.selected !== '';

    var isCorrect =
      answered &&
      Number(item.selected) ===
      Number(
        values[i][indexOfHeader('CorrectIndex')]
      );

    if (isCorrect) {
      correct++;

      values[i][indexOfHeader('Revised')] = true;

      historyRows.push({
        Email: email,
        Subject:
          values[i][indexOfHeader('Subject')],
        QuestionId:
          values[i][indexOfHeader('QuestionId')],
        ActionDate: new Date(),
        Action: 'revised',
        MistakeType:
          values[i][indexOfHeader('MistakeType')]
      });

    } else if (answered) {
      wrong++;
    } else {
      unattempted++;
    }

    values[i][indexOfHeader('ReminderSent')] = false;
    touchedRows.push(i);
  }

  // Write back only the rows that actually changed, instead of rewriting
  // the whole sheet on every revision submission (as before). WrongAnswers
  // accumulates one row per wrong/unattempted question from every user,
  // forever, so a full rewrite here got a little slower with every passing
  // day; this batch is bounded by how many questions were in THIS revision
  // test, not by how big the sheet has grown.
  touchedRows.forEach(function (i) {
    sheet.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
  });

  appendMany_(
    sh_('RevisionHistory'),
    SHEETS.RevisionHistory,
    historyRows
  );

  adjustUserMistakesCount_(email, -correct);

  return {
    ok: true,
    correct: correct,
    wrong: wrong,
    unattempted: unattempted,
    total:
      correct + wrong + unattempted
  };
}


// ============================================================
// 12. REMINDERS
// ============================================================

function createReminder_(body) {
  var email = email_(body.email);
  var name = String(body.name || '').trim();
  var message = String(
    body.message || ''
  ).trim();

  var nextRunAt = toDate_(
    body.nextRunAt,
    null
  );

  if (!validEmail_(email)) {
    return {
      ok: false,
      error: 'A valid registered email address is required.'
    };
  }

  if (!name) {
    return {
      ok: false,
      error: 'Reminder name is required.'
    };
  }

  if (!message) {
    return {
      ok: false,
      error: 'Reminder message is required.'
    };
  }

  if (
    !nextRunAt ||
    isNaN(nextRunAt.getTime()) ||
    nextRunAt <= new Date()
  ) {
    return {
      ok: false,
      error:
        'Please provide a valid future date/time.'
    };
  }

  var now = new Date();
  var frequency = normalizeFrequency_(body.frequency);
  var duplicate = objs_(sh_('Reminders')).find(function(row){
    return email_(row.Email) === email &&
      String(row.Name || '').trim() === name &&
      String(row.Message || '').trim() === message &&
      normalizeFrequency_(row.Frequency) === frequency &&
      new Date(row.NextRunAt).getTime() === nextRunAt.getTime() &&
      bool_(row.Enabled);
  });
  if (duplicate) {
    return { ok: true, duplicate: true, id: duplicate.ReminderId, nextRunAt: nextRunAt.toISOString(), status: duplicate.Status || 'Active' };
  }
  var id = Utilities.getUuid();

  append_(
    sh_('Reminders'),
    SHEETS.Reminders,
    {
      ReminderId: id,
      Email: email,
      UserName:
        String(
          body.userName ||
          body.userDisplayName ||
          name
        ).trim(),

      Name: name,
      Message: message,

      // Optional for standalone reminders.
      RelatedTask:
        String(
          body.relatedTask || ''
        ).trim(),

      RelatedUrl:
        String(
          body.relatedUrl || ''
        ).trim(),

      Frequency: frequency,
      NextRunAt: nextRunAt,
      Status: 'Active',
      Enabled: true,
      CreatedAt: now,
      UpdatedAt: now,
      LastSentAt: ''
    }
  );

  return {
    ok: true,
    id: id,
    nextRunAt: nextRunAt.toISOString(),
    status: 'Active'
  };
}

function updateReminder_(body) {
  var sheet = sh_('Reminders');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return {
      ok: false,
      error: 'Reminder not found.'
    };
  }

  var headers = values[0];

  var idIndex = headers.indexOf('ReminderId');
  var emailIndex = headers.indexOf('Email');

  var email = email_(body.email);
  var reminderId = String(body.id || '').trim();

  if (!validEmail_(email) || !reminderId) {
    return {
      ok: false,
      error: 'Valid email and reminder ID are required.'
    };
  }

  for (var i = 1; i < values.length; i++) {
    if (
      String(values[i][idIndex]) === reminderId &&
      email_(values[i][emailIndex]) === email
    ) {
      var nextRunAt = toDate_(
        body.nextRunAt,
        null
      );

      if (
        !nextRunAt ||
        isNaN(nextRunAt.getTime()) ||
        nextRunAt <= new Date()
      ) {
        return {
          ok: false,
          error:
            'Please provide a valid future date/time.'
        };
      }

      function setValue(column, value) {
        var index = headers.indexOf(column);

        if (index >= 0) {
          values[i][index] = value;
        }
      }

      var currentUserName =
        values[i][headers.indexOf('UserName')] || '';

      var reminderName =
        String(
          body.name ||
          values[i][headers.indexOf('Name')] ||
          ''
        ).trim();

      var reminderMessage =
        String(
          body.message ||
          values[i][headers.indexOf('Message')] ||
          ''
        ).trim();

      if (!reminderName) {
        return {
          ok: false,
          error: 'Reminder name is required.'
        };
      }

      if (!reminderMessage) {
        return {
          ok: false,
          error: 'Reminder message is required.'
        };
      }

      setValue(
        'UserName',
        String(
          body.userName ||
          currentUserName ||
          reminderName
        ).trim()
      );

      setValue('Name', reminderName);
      setValue('Message', reminderMessage);

      var currentTask =
        values[i][headers.indexOf('RelatedTask')] || '';
      var currentUrl =
        values[i][headers.indexOf('RelatedUrl')] || '';
      var currentFrequency =
        values[i][headers.indexOf('Frequency')] || 'once';

      setValue(
        'RelatedTask',
        body.relatedTask !== undefined
          ? String(body.relatedTask || '').trim()
          : String(currentTask).trim()
      );

      setValue(
        'RelatedUrl',
        body.relatedUrl !== undefined
          ? String(body.relatedUrl || '').trim()
          : String(currentUrl).trim()
      );

      setValue(
        'Frequency',
        body.frequency !== undefined
          ? normalizeFrequency_(body.frequency)
          : normalizeFrequency_(currentFrequency)
      );

      setValue(
        'NextRunAt',
        nextRunAt
      );

      setValue('Status', 'Active');
      setValue('Enabled', true);
      setValue('UpdatedAt', new Date());

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);

      return {
        ok: true,
        nextRunAt:
          nextRunAt.toISOString()
      };
    }
  }

  return {
    ok: false,
    error: 'Reminder not found.'
  };
}

function toggleReminder_(body) {
  var sheet = sh_('Reminders');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return {
      ok: false,
      error: 'Reminder not found.'
    };
  }

  var headers = values[0];

  var idIndex = headers.indexOf('ReminderId');
  var emailIndex = headers.indexOf('Email');
  var enabledIndex = headers.indexOf('Enabled');
  var statusIndex = headers.indexOf('Status');
  var updatedIndex = headers.indexOf('UpdatedAt');

  var email = email_(body.email);
  var reminderId = String(body.id || '').trim();
  var enabled = bool_(body.enabled);

  for (var i = 1; i < values.length; i++) {
    if (
      String(values[i][idIndex]) === reminderId &&
      email_(values[i][emailIndex]) === email
    ) {
      values[i][enabledIndex] = enabled;
      values[i][statusIndex] =
        enabled ? 'Active' : 'Paused';
      values[i][updatedIndex] = new Date();

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);

      return {
        ok: true,
        enabled: enabled,
        status:
          enabled ? 'Active' : 'Paused'
      };
    }
  }

  return {
    ok: false,
    error: 'Reminder not found.'
  };
}

function deleteReminder_(body) {
  // A single targeted lookup (one match, then done) rather than a scan
  // over many rows — a single TextFinder call is a safe, direct swap for
  // the full-sheet read here (no "many small calls" downside like a loop
  // of lookups would have).
  var sheet = sh_('Reminders');
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, error: 'Reminder not found.' };
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idCol = headers.indexOf('ReminderId') + 1;
  var emailIndex = headers.indexOf('Email');
  if (!idCol) return { ok: false, error: 'Reminder not found.' };

  var email = email_(body.email);
  var reminderId = String(body.id || '').trim();

  var idRange = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1);
  var match = idRange.createTextFinder(reminderId).matchEntireCell(true).findNext();

  if (match) {
    var rowNum = match.getRow();
    var rowEmail = email_(sheet.getRange(rowNum, emailIndex + 1).getValue());

    if (rowEmail === email) {
      sheet.deleteRow(rowNum);
      return { ok: true };
    }
  }

  return {
    ok: false,
    error: 'Reminder not found.'
  };
}

function reminders_(email) {
  email = email_(email);

  return objs_(sh_('Reminders'))
    .filter(function (row) {
      return email_(row.Email) === email;
    })
    .map(function (row) {
      return {
        id: row.ReminderId,
        userName: row.UserName || '',
        name: row.Name || '',
        message: row.Message || '',
        relatedTask: row.RelatedTask || '',
        relatedUrl: row.RelatedUrl || '',
        frequency:
          normalizeFrequency_(row.Frequency),

        nextRunAt:
          row.NextRunAt
            ? toDate_(row.NextRunAt).toISOString()
            : null,

        status:
          row.Status ||
          (bool_(row.Enabled)
            ? 'Active'
            : 'Paused'),

        enabled: bool_(row.Enabled),

        lastSentAt:
          row.LastSentAt
            ? toDate_(row.LastSentAt).toISOString()
            : null
      };
    });
}


// ============================================================
// 13. NOTIFICATION HISTORY
// ============================================================

function notifications_(email) {
  email = email_(email);

  return objs_(sh_('Notifications'))
    .filter(function (row) {
      return email_(row.Email) === email;
    })
    .sort(function (a, b) {
      return (
        new Date(b.ScheduledAt) -
        new Date(a.ScheduledAt)
      );
    })
    .map(function (row) {
      return {
        id: row.NotificationId,
        reminderId: row.ReminderId,
        name: row.Name || '',
        message: row.Message || '',
        relatedTask: row.RelatedTask || '',
        relatedUrl: row.RelatedUrl || '',

        scheduledAt:
          row.ScheduledAt
            ? toDate_(row.ScheduledAt).toISOString()
            : null,

        sentAt:
          row.SentAt
            ? toDate_(row.SentAt).toISOString()
            : null,

        status: row.Status || '',
        error: row.Error || '',
        retryCount:
          num_(row.RetryCount)
      };
    });
}


// ============================================================
// 14. SEND REMINDER EMAIL
// ============================================================

function sendReminder_(reminder, notificationId) {
  var subject =
    'Reminder: ' + String(reminder.Name || 'Reminder');

  var relatedTask =
    String(reminder.RelatedTask || '').trim();

  var relatedUrl =
    String(reminder.RelatedUrl || '').trim();

  var relatedSection = '';

  if (relatedTask) {
    relatedSection +=
      '<p><b>Related task:</b> ' +
      esc_(relatedTask) +
      '</p>';
  }

  if (relatedUrl) {
    relatedSection +=
      '<p>' +
      '<a href="' + esc_(relatedUrl) + '"' +
      ' style="display:inline-block;padding:12px 18px;' +
      'background:#111;color:#fff;text-decoration:none;' +
      'border-radius:7px">Open Task</a>' +
      '</p>';
  }

  var html =
    '<div style="font-family:Arial,sans-serif;' +
    'max-width:680px;margin:auto;color:#222">' +

    '<h2>Reminder</h2>' +

    '<p>Dear <b>' +
    esc_(
      reminder.UserName ||
      reminder.Name ||
      'User'
    ) +
    '</b>,</p>' +

    '<p>' +
    esc_(reminder.Message) +
    '</p>' +

    relatedSection +

    '<p><b>Date/time:</b> ' +
    esc_(
      display_(
        reminder.NextRunAt || new Date()
      )
    ) +
    '</p>' +

    '</div>';

  try {
    MailApp.sendEmail({
      to: email_(reminder.Email),
      subject: subject,
      htmlBody: html
    });

    updateNotificationStatus_(
      notificationId,
      'Sent',
      '',
      true
    );

    return true;

  } catch (error) {
    updateNotificationStatus_(
      notificationId,
      'Failed',
      String(error).slice(0, 300),
      false
    );

    return false;
  }
}

function updateNotificationStatus_(
  notificationId,
  status,
  errorText,
  sent
) {
  var sheet = sh_('Notifications');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return;
  }

  var headers = values[0];

  var idIndex =
    headers.indexOf('NotificationId');

  var statusIndex =
    headers.indexOf('Status');

  var sentAtIndex =
    headers.indexOf('SentAt');

  var errorIndex =
    headers.indexOf('Error');

  var retryIndex =
    headers.indexOf('RetryCount');

  for (var i = 1; i < values.length; i++) {
    if (
      String(values[i][idIndex]) ===
      String(notificationId)
    ) {
      values[i][statusIndex] = status;

      if (sent) {
        values[i][sentAtIndex] = new Date();
      }

      if (errorIndex >= 0) {
        values[i][errorIndex] =
          errorText || '';
      }

      if (!sent && retryIndex >= 0) {
        values[i][retryIndex] =
          num_(values[i][retryIndex]) + 1;
      }

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);

      return;
    }
  }
}


// ============================================================
// 15. PROCESS DUE REMINDERS
// ============================================================

function processReminders() {
  var lock = LockService.getScriptLock();

  // Run-guard: if a previous processReminders run (or an overlapping
  // trigger fire) is still in progress, skip this run instead of
  // waiting up to 30s for the lock and piling another lock-holder on
  // top of the last one. The next trigger fire a few minutes from now
  // will pick up anything still due.
  if (!lock.tryLock(0)) {
    return 'Reminder processor skipped — a previous run is still in progress.';
  }

  var dueList = [];

  try {
    ensureSheets_();

    var reminderSheet = sh_('Reminders');
    var reminders = objs_(reminderSheet);
    var now = new Date();

    reminders.forEach(function (reminder) {
      if (!bool_(reminder.Enabled)) {
        return;
      }

      if (String(reminder.Status) !== 'Active') {
        return;
      }

      var dueAt = toDate_(
        reminder.NextRunAt,
        null
      );

      if (
        !dueAt ||
        isNaN(dueAt.getTime()) ||
        dueAt > now
      ) {
        return;
      }

      var notificationId =
        Utilities.getUuid();

      // This append is a fast sheet write, not a network call, so it's
      // fine to do while still holding the lock — it also claims the
      // reminder so a concurrent run can't queue it twice.
      append_(
        sh_('Notifications'),
        SHEETS.Notifications,
        {
          NotificationId: notificationId,
          ReminderId: reminder.ReminderId,
          Email: reminder.Email,
          UserName: reminder.UserName || '',
          Name: reminder.Name || '',
          Message: reminder.Message || '',
          RelatedTask: reminder.RelatedTask || '',
          RelatedUrl: reminder.RelatedUrl || '',
          ScheduledAt: dueAt,
          SentAt: '',
          Status: 'Pending',
          Error: '',
          RetryCount: 0
        }
      );

      dueList.push({
        reminder: reminder,
        notificationId: notificationId,
        dueAt: dueAt
      });
    });

  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {
      // Nothing to do.
    }
  }

  // The slow part — MailApp.sendEmail is a network call, 1–4s each —
  // now runs AFTER the lock has been released, so a queue of reminders
  // no longer blocks doPost/submitExam or anything else waiting on the
  // script lock.
  var processed = 0;

  dueList.forEach(function (item) {
    processed++;

    var sent = sendReminder_(
      item.reminder,
      item.notificationId
    );

    updateReminderAfterSend_(
      item.reminder.ReminderId,
      sent,
      item.dueAt,
      item.reminder.Frequency
    );
  });

  return (
    'Reminder processor completed. ' +
    'Processed: ' + processed
  );
}

function updateReminderAfterSend_(
  reminderId,
  sent,
  scheduledAt,
  frequency
) {
  var sheet = sh_('Reminders');
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return;
  }

  var headers = values[0];

  var idIndex =
    headers.indexOf('ReminderId');

  var enabledIndex =
    headers.indexOf('Enabled');

  var statusIndex =
    headers.indexOf('Status');

  var nextRunIndex =
    headers.indexOf('NextRunAt');

  var lastSentIndex =
    headers.indexOf('LastSentAt');

  var updatedIndex =
    headers.indexOf('UpdatedAt');

  for (var i = 1; i < values.length; i++) {
    if (
      String(values[i][idIndex]) ===
      String(reminderId)
    ) {
      values[i][lastSentIndex] = new Date();

      if (
        normalizeFrequency_(frequency) ===
        'once'
      ) {
        values[i][enabledIndex] = false;
        values[i][statusIndex] =
          sent ? 'Completed' : 'Paused';

      } else {
        var next = nextRun_(
          scheduledAt,
          frequency
        );

        values[i][nextRunIndex] = next;
        values[i][statusIndex] =
          sent ? 'Active' : 'Paused';

        values[i][enabledIndex] = !!sent;
      }

      values[i][updatedIndex] = new Date();

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);

      return;
    }
  }
}

function nextRun_(date, frequency) {
  var next = new Date(date);
  var f = normalizeFrequency_(frequency);

  if (f === 'hourly') {
    next.setHours(
      next.getHours() + 1
    );
  } else if (f === 'daily') {
    next.setDate(
      next.getDate() + 1
    );
  } else if (f === 'weekly') {
    next.setDate(
      next.getDate() + 7
    );
  } else if (f === 'monthly') {
    var originalDay = next.getDate();
    var targetMonth = next.getMonth() + 1;

    // Move to the first day of the target month, then clamp
    // to that month's last valid day (e.g. Jan 31 -> Feb 28/29).
    next.setDate(1);
    next.setMonth(targetMonth);

    var lastDay = new Date(
      next.getFullYear(),
      next.getMonth() + 1,
      0
    ).getDate();

    next.setDate(Math.min(originalDay, lastDay));
  }

  return next;
}


// ============================================================
// 16. RETRY FAILED NOTIFICATION
// ============================================================

function retryNotification_(body) {
  var sheet = sh_('Notifications');
  var rows = sheet.getDataRange().getValues();

  if (!rows.length) {
    return {
      ok: false,
      error: 'Notification not found.'
    };
  }

  var headers = rows[0];

  var idIndex =
    headers.indexOf('NotificationId');

  var emailIndex =
    headers.indexOf('Email');

  var reminderIdIndex =
    headers.indexOf('ReminderId');

  var userNameIndex =
    headers.indexOf('UserName');

  var nameIndex =
    headers.indexOf('Name');

  var messageIndex =
    headers.indexOf('Message');

  var taskIndex =
    headers.indexOf('RelatedTask');

  var urlIndex =
    headers.indexOf('RelatedUrl');

  var notificationId =
    String(body.id || '').trim();

  var email = email_(body.email);

  for (var i = 1; i < rows.length; i++) {
    if (
      String(rows[i][idIndex]) === notificationId &&
      email_(rows[i][emailIndex]) === email
    ) {
      var retryId =
        Utilities.getUuid();

      var reminder = {
        Email: rows[i][emailIndex],
        UserName: rows[i][userNameIndex],
        Name: rows[i][nameIndex],
        Message: rows[i][messageIndex],
        RelatedTask: rows[i][taskIndex],
        RelatedUrl: rows[i][urlIndex],
        NextRunAt: new Date()
      };

      append_(
        sh_('Notifications'),
        SHEETS.Notifications,
        {
          NotificationId: retryId,
          ReminderId:
            rows[i][reminderIdIndex],
          Email: reminder.Email,
          UserName:
            reminder.UserName || '',
          Name: reminder.Name || '',
          Message:
            reminder.Message || '',
          RelatedTask:
            reminder.RelatedTask || '',
          RelatedUrl:
            reminder.RelatedUrl || '',
          ScheduledAt: new Date(),
          SentAt: '',
          Status: 'Pending',
          Error: '',
          RetryCount: 0
        }
      );

      var sent = sendReminder_(
        reminder,
        retryId
      );

      return {
        ok: true,
        sent: sent,
        retryNotificationId: retryId
      };
    }
  }

  return {
    ok: false,
    error: 'Notification not found.'
  };
}


// ============================================================
// 17. EMAIL QUEUE
// ============================================================

function processEmailQueue() {
  var lock = LockService.getScriptLock();

  // Run-guard: if a previous processEmailQueue run (or an overlapping
  // trigger fire) is still in progress, skip this run instead of
  // waiting up to 30s for the lock and piling another lock-holder on
  // top of the last one. The next trigger fire a few minutes from now
  // will pick up anything still pending.
  if (!lock.tryLock(0)) {
    return 'Email queue processor skipped — a previous run is still in progress.';
  }

  var toSend = [];

  try {
    ensureSheets_();

    var sheet = sh_('EmailQueue');
    var values = sheet.getDataRange().getValues();

    if (!values.length) {
      return 'Email queue is empty.';
    }

    var headers = values[0];

    var statusIndex =
      headers.indexOf('Status');

    var toIndex =
      headers.indexOf('ToEmail');

    var subjectIndex =
      headers.indexOf('Subject');

    var htmlIndex =
      headers.indexOf('HtmlBody');

    for (var i = 1; i < values.length; i++) {
      var status =
        String(values[i][statusIndex] || '');

      if (
        status !== 'PENDING' &&
        status.indexOf('FAILED') !== 0
      ) {
        continue;
      }

      // Claim this row now, while we still hold the lock, so a
      // concurrent run can't pick it up too. This is a fast sheet
      // write, not a network call.
      values[i][statusIndex] = 'SENDING';

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);

      toSend.push({
        rowIndex: i,
        to: values[i][toIndex],
        subject: values[i][subjectIndex],
        html: values[i][htmlIndex]
      });
    }

  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {
      // Nothing to do.
    }
  }

  if (!toSend.length) {
    return 'Email queue completed. Processed: 0';
  }

  // The slow part — MailApp.sendEmail, one network call per email —
  // now runs AFTER the lock has been released, so a backlog of queued
  // emails no longer blocks doPost/submitExam or anything else waiting
  // on the script lock.
  var sheet2 = sh_('EmailQueue');
  var headers2 = sheet2.getDataRange().getValues()[0];
  var statusIndex2 = headers2.indexOf('Status');
  var sentAtIndex2 = headers2.indexOf('SentAt');
  var processed = 0;

  toSend.forEach(function (item) {
    try {
      MailApp.sendEmail({
        to: item.to,
        subject: item.subject,
        htmlBody: item.html
      });

      sheet2
        .getRange(item.rowIndex + 1, statusIndex2 + 1)
        .setValue('SENT');

      sheet2
        .getRange(item.rowIndex + 1, sentAtIndex2 + 1)
        .setValue(new Date());

      processed++;

    } catch (error) {
      sheet2
        .getRange(item.rowIndex + 1, statusIndex2 + 1)
        .setValue('FAILED: ' + String(error).slice(0, 200));
    }
  });

  return (
    'Email queue completed. ' +
    'Processed: ' + processed
  );
}


// ============================================================
// 18. REVISION URL + UNLOCK EMAIL
// ============================================================

function siteFromTestUrl_(url) {
  var value = String(url || '').trim();

  if (!value) {
    return '';
  }

  // Remove an existing query string and add revision=1.
  return value.split('?')[0] +
    '?revision=1';
}

function sendRevisionUnlockEmails() {
  var sheet = sh_('Results');
  var rows = sheet.getDataRange().getValues();

  if (!rows.length) {
    return 'No results found.';
  }

  var headers = rows[0];

  var sentIndex =
    headers.indexOf(
      'RevisionUnlockedEmailSent'
    );

  var dueIndex =
    headers.indexOf(
      'RevisionAvailableAt'
    );

  var nameIndex =
    headers.indexOf('Name');

  var emailIndex =
    headers.indexOf('Email');

  var subjectIndex =
    headers.indexOf('Subject');

  var subjectIdIndex =
    headers.indexOf('SubjectId');

  var testUrlIndex =
    headers.indexOf('TestUrl');

  var sentCount = 0;

  for (var i = 1; i < rows.length; i++) {
    if (
      bool_(rows[i][sentIndex])
    ) {
      continue;
    }

    if (!rows[i][dueIndex]) {
      continue;
    }

    var due = new Date(
      rows[i][dueIndex]
    );

    if (
      isNaN(due.getTime()) ||
      due > new Date()
    ) {
      continue;
    }

    var name = rows[i][nameIndex];
    var email = rows[i][emailIndex];
    var subject = rows[i][subjectIndex];
    var subjectId =
      rows[i][subjectIdIndex];

    var testUrl =
      rows[i][testUrlIndex] || '';

    var revisionUrl =
      siteFromTestUrl_(testUrl);

    if (
      !revisionUrl &&
      typeof SITE_URL === 'string' &&
      SITE_URL &&
      SITE_URL !== 'https://example.com/'
    ) {
      revisionUrl =
        SITE_URL.split('?')[0] +
        '?revision=1';
    }

    var button = revisionUrl
      ? (
        '<p>' +
        '<a href="' +
        esc_(revisionUrl) +
        '"' +
        ' style="display:inline-block;padding:12px 18px;' +
        'background:#111;color:#fff;text-decoration:none;' +
        'border-radius:7px">Take Revision Test</a>' +
        '</p>'
      )
      : (
        '<p>' +
        'Your Revision Test is now unlocked. ' +
        'Open the ECET website to start it.' +
        '</p>'
      );

    var html =
      '<div style="font-family:Arial,sans-serif;' +
      'max-width:680px;margin:auto;color:#222">' +

      '<h2>ECET Revision Test Unlocked</h2>' +

      '<p>Dear <b>' +
      esc_(name) +
      '</b>,</p>' +

      '<p>Your Revision Test for <b>' +
      esc_(subject) +
      '</b> is now unlocked.</p>' +

      button +

      '<p style="font-size:12px;color:#777">' +
      'Subject ID: ' +
      esc_(subjectId) +
      '</p>' +

      '</div>';

    try {
      MailApp.sendEmail({
        to: email_(email),
        subject:
          'ECET Revision Test unlocked — ' +
          subject,
        htmlBody: html
      });

      rows[i][sentIndex] = true;

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([rows[i]]);

      sentCount++;

    } catch (error) {
      // Leave the flag false so the next trigger can retry.
      console.log(
        'Revision email failed: ' +
        String(error)
      );
    }
  }

  return (
    'Revision unlock email processor completed. ' +
    'Sent: ' + sentCount
  );
}

/**
 * Compatibility alias.
 * Your screenshot showed an old trigger/function name:
 * sendRevisionReminders.
 *
 * Keeping this alias prevents an old trigger or frontend call
 * from breaking after the function was renamed.
 */
function sendRevisionReminders() {
  return sendRevisionUnlockEmails();
}


// ============================================================
// 19. AUTOMATION SETUP
// ============================================================

function setup() {
  ensureSheets_();

  var triggers =
    ScriptApp.getProjectTriggers();

  // Remove the old compatibility trigger if it exists.
  // Otherwise both the old alias and the new function could send
  // the same revision-unlock email.
  triggers.forEach(function (trigger) {
    if (
      trigger.getHandlerFunction() ===
      'sendRevisionReminders'
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  function hasTrigger(functionName) {
    return ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === functionName;
    });
  }

  function addTrigger(functionName, minutes) {
    if (!hasTrigger(functionName)) {
      ScriptApp
        .newTrigger(functionName)
        .timeBased()
        .everyMinutes(minutes)
        .create();
    }
  }

  addTrigger('processReminders', 5);
  addTrigger('processEmailQueue', 5);
  addTrigger('sendRevisionUnlockEmails', 15);

  return (
    'Backend ready. Sheets and automation triggers are configured.'
  );
}


// ============================================================
// 20. OPTIONAL MANUAL TEST FUNCTIONS
// ============================================================

function testBackend() {
  ensureSheets_();

  return {
    ok: true,
    message: 'ECET backend is working.',
    spreadsheetId: SPREADSHEET_ID,
    timezone: tz_(),
    sheets: Object.keys(SHEETS)
  };
}

function testPing() {
  return {
    ok: true,
    time: iso_(new Date()),
    message: 'ECET backend is online.'
  };
}
