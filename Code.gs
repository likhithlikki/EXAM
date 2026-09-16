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
    'Revised', 'ReminderSent', 'TestUrl'
  ],

  Rankings: [
    'Subject', 'Email', 'Name', 'BestPercentage', 'BestScore',
    'Total', 'Attempts', 'LastAttempt'
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

  Notifications: [
    'NotificationId', 'ReminderId', 'Email', 'UserName', 'Name',
    'Message', 'RelatedTask', 'RelatedUrl', 'ScheduledAt', 'SentAt',
    'Status', 'Error', 'RetryCount'
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
    ensureSheets_();

    switch (action) {
      case 'dashboard':
        return out_({
          ok: true,
          data: dashboard_(e.parameter.email)
        });

      case 'mistakes':
      case 'revision':
        return out_({
          ok: true,
          data: mistakes_(e.parameter.email)
        });

      case 'history':
      case 'attemptHistory':
        return out_({
          ok: true,
          data: history_(e.parameter.email)
        });

      case 'reminders':
        return out_({
          ok: true,
          data: reminders_(e.parameter.email)
        });

      case 'notifications':
      case 'notificationHistory':
        return out_({
          ok: true,
          data: notifications_(e.parameter.email)
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

    ensureSheets_();

    var body = {};

    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = String(body.action || '').trim();

    switch (action) {
      case 'register':
        return out_(register_(body));

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

  append_(
    sh_('Users'),
    SHEETS.Users,
    {
      Timestamp: new Date(),
      Name: name,
      Email: email,
      LastSubject: body.subject || '',
      LastTestUrl: body.testUrl || ''
    }
  );

  return {
    ok: true,
    message: 'User saved.'
  };
}


// ============================================================
// 6. RANKING
// ============================================================

function practiceRank_(subject, email, percentage) {
  var rows = objs_(sh_('Results')).filter(function (row) {
    return String(row.Subject) === String(subject);
  });

  var bestByUser = {};

  rows.forEach(function (row) {
    var userEmail = email_(row.Email);

    if (!userEmail) {
      return;
    }

    var pct = Math.max(
      0,
      Math.min(100, num_(row.Percentage))
    );

    if (
      bestByUser[userEmail] === undefined ||
      pct > bestByUser[userEmail]
    ) {
      bestByUser[userEmail] = pct;
    }
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

  // Duplicate submission protection.
  if (sessionId) {
    var prior = objs_(sh_('SubmittedSessions')).find(function (row) {
      return String(row.ExamSessionId) === sessionId;
    });

    if (prior) {
      var oldResult = objs_(sh_('Results')).find(function (row) {
        return String(row.ResultId) === String(prior.ResultId);
      });

      if (oldResult) {
        return resultResponse_(oldResult, true);
      }
    }
  }

  var now = new Date();
  var startTime = toDate_(body.startTime, now);
  var detail = Array.isArray(body.detail) ? body.detail : [];

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

  try {
    MailApp.sendEmail({
      to: email_(result.Email),
      subject: subject,
      htmlBody: html
    });

    return {
      status: 'SENT'
    };

  } catch (error) {
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
}


// ============================================================
// 10. DASHBOARD / MISTAKES / HISTORY
// ============================================================

function dashboard_(email) {
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
        attempts: 0
      };
    }

    subjects[key].best = Math.max(
      subjects[key].best,
      num_(row.Percentage)
    );

    subjects[key].attempts++;
  });

  var percentages = results.map(function (row) {
    return num_(row.Percentage);
  });

  return {
    attempts: results.length,

    best:
      percentages.length
        ? Math.max.apply(null, percentages)
        : 0,

    avg:
      percentages.length
        ? Math.round(
          (
            percentages.reduce(function (a, b) {
              return a + b;
            }, 0) /
            percentages.length
          ) * 10
        ) / 10
        : 0,

    mistakes: mistakes.length,

    subjects: Object.keys(subjects).map(function (key) {
      return subjects[key];
    })
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
        rank: row.Rank,
        rankOutOf: row.RankOutOf,
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
  }

  if (values.length > 1) {
    sheet
      .getRange(
        2,
        1,
        values.length - 1,
        headers.length
      )
      .setValues(values.slice(1));
  }

  appendMany_(
    sh_('RevisionHistory'),
    SHEETS.RevisionHistory,
    historyRows
  );

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
  var id = Utilities.getUuid();

  var frequency =
    normalizeFrequency_(body.frequency);

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

  for (var i = 1; i < values.length; i++) {
    if (
      String(values[i][idIndex]) === reminderId &&
      email_(values[i][emailIndex]) === email
    ) {
      sheet.deleteRow(i + 1);

      return {
        ok: true
      };
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

  try {
    lock.waitLock(30000);

    ensureSheets_();

    var reminderSheet = sh_('Reminders');
    var reminders = objs_(reminderSheet);
    var now = new Date();

    var processed = 0;

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

      processed++;

      var notificationId =
        Utilities.getUuid();

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

      var sent = sendReminder_(
        reminder,
        notificationId
      );

      updateReminderAfterSend_(
        reminder.ReminderId,
        sent,
        dueAt,
        reminder.Frequency
      );
    });

    return (
      'Reminder processor completed. ' +
      'Processed: ' + processed
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {
      // Nothing to do.
    }
  }
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

  try {
    lock.waitLock(30000);

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

    var sentAtIndex =
      headers.indexOf('SentAt');

    var processed = 0;

    for (var i = 1; i < values.length; i++) {
      var status =
        String(values[i][statusIndex] || '');

      if (
        status !== 'PENDING' &&
        status.indexOf('FAILED') !== 0
      ) {
        continue;
      }

      try {
        MailApp.sendEmail({
          to: values[i][toIndex],
          subject: values[i][subjectIndex],
          htmlBody: values[i][htmlIndex]
        });

        values[i][sentAtIndex] = new Date();
        values[i][statusIndex] = 'SENT';

        processed++;

      } catch (error) {
        values[i][statusIndex] =
          'FAILED: ' +
          String(error).slice(0, 200);
      }

      sheet
        .getRange(
          i + 1,
          1,
          1,
          headers.length
        )
        .setValues([values[i]]);
    }

    return (
      'Email queue completed. ' +
      'Processed: ' + processed
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {
      // Nothing to do.
    }
  }
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
