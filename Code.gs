/* =====================================================================
   ECET Quiz — Google Apps Script backend (Sheets as database)
   ---------------------------------------------------------------------
   Bind this script to a Google Sheet (Extensions > Apps Script).
   The FIRST request automatically creates every tab and header row
   below — you never have to type sheet/column names by hand.
   See SETUP-BACKEND.md for the exact deployment steps.
   ===================================================================== */

/* Your Google Sheet (from the URL you shared):
   https://docs.google.com/spreadsheets/d/1QDu7YTv-MWm9jRuVsmRBGjwuBD6WFtj_4bRqj5B8hds/edit
   Hardcoded below so this script works whether it's bound to the sheet
   or deployed as a standalone Apps Script project. */
const SPREADSHEET_ID = "1QDu7YTv-MWm9jRuVsmRBGjwuBD6WFtj_4bRqj5B8hds";

const SHEETS = {
  Users:          ["Timestamp", "Name", "Email", "LastSubject"],
  Results:        ["ResultId", "Timestamp", "Name", "Email", "Subject", "SubjectId", "Score", "Total", "Percentage", "Correct", "Wrong", "Unanswered", "TotalTimeSec", "Rank", "RankOutOf"],
  Answers:        ["ResultId", "Email", "Subject", "QuestionId", "Year", "State", "QuestionNumber", "SelectedIndex", "CorrectIndex", "IsCorrect", "TimeSpentSec", "MarkedForReview"],
  WrongAnswers:   ["WrongId", "ResultId", "Email", "Subject", "QuestionId", "Year", "State", "QuestionNumber", "Question", "OptionsJSON", "CorrectIndex", "SelectedIndex", "DateAdded", "RevisionDueDate", "Revised", "ReminderSent"],
  Rankings:       ["Subject", "Email", "Name", "BestPercentage", "BestScore", "Total", "Attempts", "LastAttempt"],
  RevisionHistory:["Email", "Subject", "QuestionId", "ActionDate", "Action"]
};

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheets_() {
  const ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      const headers = SHEETS[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  });
  // Get rid of the default empty "Sheet1" only if it's blank and unused
  const def = ss.getSheetByName("Sheet1");
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  return ss;
}
function sheet_(name) { return ensureSheets_().getSheetByName(name); }

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function rowsToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(r => r.join("") !== "").map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}
function appendRow_(sh, headers, obj) {
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ""));
}

/* ---------------------------- doGet ---------------------------- */
function doGet(e) {
  ensureSheets_();
  const action = (e.parameter.action || "").trim();
  try {
    if (action === "ping") return jsonOut_({ ok: true, time: new Date().toISOString() });
    if (action === "dashboard") return jsonOut_({ ok: true, data: getDashboard_(e.parameter.email) });
    if (action === "mistakes") return jsonOut_({ ok: true, data: getMistakes_(e.parameter.email, e.parameter.subject) });
    return jsonOut_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* ---------------------------- doPost ---------------------------- */
function doPost(e) {
  ensureSheets_();
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return jsonOut_({ ok: false, error: "Bad JSON" }); }
  const action = body.action;
  try {
    if (action === "register") return jsonOut_(registerUser_(body));
    if (action === "submitExam") return jsonOut_(submitExam_(body));
    if (action === "markRevised") return jsonOut_(markRevised_(body));
    return jsonOut_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* ---------------------------- register ---------------------------- */
function registerUser_(body) {
  const sh = sheet_("Users");
  appendRow_(sh, SHEETS.Users, {
    Timestamp: new Date(), Name: body.name, Email: body.email, LastSubject: body.subject
  });
  return { ok: true };
}

/* ---------------------------- submit exam ---------------------------- */
function submitExam_(body) {
  const resultId = Utilities.getUuid();
  const now = new Date();
  const resultsSheet = sheet_("Results");
  const answersSheet = sheet_("Answers");
  const wrongSheet = sheet_("WrongAnswers");
  const rankSheet = sheet_("Rankings");

  // Rank = 1 + number of existing results in same subject with a strictly higher percentage
  const existing = rowsToObjects_(resultsSheet).filter(r => r.Subject === body.subject);
  const rank = 1 + existing.filter(r => Number(r.Percentage) > Number(body.percentage)).length;
  const rankOutOf = existing.length + 1;

  appendRow_(resultsSheet, SHEETS.Results, {
    ResultId: resultId, Timestamp: now, Name: body.name, Email: body.email, Subject: body.subject,
    SubjectId: body.subjectId, Score: body.score, Total: body.total, Percentage: body.percentage,
    Correct: body.correct, Wrong: body.wrong, Unanswered: body.unanswered, TotalTimeSec: body.totalTime,
    Rank: rank, RankOutOf: rankOutOf
  });

  const dueDate = Utilities.formatDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone() || "Etc/UTC", "yyyy-MM-dd");
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone() || "Etc/UTC", "yyyy-MM-dd");

  (body.detail || []).forEach(d => {
    const isCorrect = d.selected !== null && d.selected === d.correct;
    appendRow_(answersSheet, SHEETS.Answers, {
      ResultId: resultId, Email: body.email, Subject: body.subject, QuestionId: d.id,
      Year: d.year, State: d.state, QuestionNumber: d.questionNumber,
      SelectedIndex: d.selected === null ? "" : d.selected, CorrectIndex: d.correct,
      IsCorrect: isCorrect, TimeSpentSec: d.time, MarkedForReview: !!d.marked
    });
    if (d.selected !== null && !isCorrect) {
      const wrongId = resultId + "-" + d.id;
      appendRow_(wrongSheet, SHEETS.WrongAnswers, {
        WrongId: wrongId, ResultId: resultId, Email: body.email, Subject: body.subject, QuestionId: d.id,
        Year: d.year, State: d.state, QuestionNumber: d.questionNumber, Question: d.question,
        OptionsJSON: JSON.stringify(d.options), CorrectIndex: d.correct, SelectedIndex: d.selected,
        DateAdded: todayStr, RevisionDueDate: dueDate, Revised: false, ReminderSent: false
      });
    }
  });

  upsertRanking_(rankSheet, body);
  sendResultEmail_(body, rank, rankOutOf);

  return { ok: true, resultId, rank, rankOutOf };
}

function upsertRanking_(sh, body) {
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const subjectCol = headers.indexOf("Subject"), emailCol = headers.indexOf("Email");
  for (let i = 1; i < values.length; i++) {
    if (values[i][subjectCol] === body.subject && values[i][emailCol] === body.email) {
      const row = i + 1;
      const bestPct = sh.getRange(row, headers.indexOf("BestPercentage") + 1).getValue();
      const attempts = sh.getRange(row, headers.indexOf("Attempts") + 1).getValue();
      if (body.percentage > bestPct) {
        sh.getRange(row, headers.indexOf("BestPercentage") + 1).setValue(body.percentage);
        sh.getRange(row, headers.indexOf("BestScore") + 1).setValue(body.score);
      }
      sh.getRange(row, headers.indexOf("Attempts") + 1).setValue(Number(attempts) + 1);
      sh.getRange(row, headers.indexOf("LastAttempt") + 1).setValue(new Date());
      return;
    }
  }
  appendRow_(sh, SHEETS.Rankings, {
    Subject: body.subject, Email: body.email, Name: body.name, BestPercentage: body.percentage,
    BestScore: body.score, Total: body.total, Attempts: 1, LastAttempt: new Date()
  });
}

function sendResultEmail_(body, rank, rankOutOf) {
  try {
    const subject = "ECET " + body.subject + " — your result: " + body.percentage + "%";
    const html = "<p>Hi " + escapeHtml_(body.name) + ",</p>" +
      "<p>Here is your result for <b>" + escapeHtml_(body.subject) + "</b>:</p>" +
      "<ul>" +
      "<li>Score: " + body.score + " / " + body.total + "</li>" +
      "<li>Percentage: " + body.percentage + "%</li>" +
      "<li>Rank: #" + rank + " of " + rankOutOf + "</li>" +
      "<li>Correct: " + body.correct + " • Wrong: " + body.wrong + " • Unanswered: " + body.unanswered + "</li>" +
      "<li>Total time: " + Math.round(body.totalTime / 60) + " minutes</li>" +
      "</ul>" +
      "<p>Wrong questions have been added to your My Mistakes list and will be flagged for revision in 7 days.</p>";
    MailApp.sendEmail({ to: body.email, subject: subject, htmlBody: html });
  } catch (err) {
    // Email failures should never break exam submission
    console.log("Email send failed: " + err);
  }
}
function escapeHtml_(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------------------------- dashboard ---------------------------- */
function getDashboard_(email) {
  const results = rowsToObjects_(sheet_("Results")).filter(r => r.Email === email);
  const wrongs = rowsToObjects_(sheet_("WrongAnswers")).filter(r => r.Email === email);

  const attempts = results.length;
  const avgPercentage = attempts ? Math.round((results.reduce((s, r) => s + Number(r.Percentage), 0) / attempts) * 10) / 10 : 0;
  const bestPercentage = attempts ? Math.max(...results.map(r => Number(r.Percentage))) : 0;
  const weakCount = wrongs.filter(w => !w.Revised).length;

  const bySubject = {};
  results.forEach(r => {
    if (!bySubject[r.Subject]) bySubject[r.Subject] = { subject: r.Subject, sum: 0, n: 0 };
    bySubject[r.Subject].sum += Number(r.Percentage);
    bySubject[r.Subject].n++;
  });
  const subjectPerformance = Object.values(bySubject).map(s => ({ subject: s.subject, avgPercentage: Math.round((s.sum / s.n) * 10) / 10 }));

  const history = results
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map(r => ({
      date: Utilities.formatDate(new Date(r.Timestamp), Session.getScriptTimeZone() || "Etc/UTC", "yyyy-MM-dd HH:mm"),
      subject: r.Subject, score: r.Score, total: r.Total, percentage: r.Percentage, rank: r.Rank
    }));

  return { attempts, avgPercentage, bestPercentage, weakCount, subjectPerformance, history };
}

/* ---------------------------- mistakes ---------------------------- */
function getMistakes_(email, subjectFilter) {
  let wrongs = rowsToObjects_(sheet_("WrongAnswers")).filter(r => r.Email === email);
  if (subjectFilter) wrongs = wrongs.filter(r => r.Subject === subjectFilter);
  return wrongs
    .sort((a, b) => new Date(b.DateAdded) - new Date(a.DateAdded))
    .map(r => ({
      wrongId: r.WrongId, subject: r.Subject, question: r.Question,
      options: JSON.parse(r.OptionsJSON || "[]"), correctIndex: Number(r.CorrectIndex),
      selectedIndex: r.SelectedIndex === "" ? null : Number(r.SelectedIndex),
      revisionDueDate: r.RevisionDueDate, revised: !!r.Revised
    }));
}

function markRevised_(body) {
  const sh = sheet_("WrongAnswers");
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf("WrongId"), emailCol = headers.indexOf("Email"), revisedCol = headers.indexOf("Revised");
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === body.wrongId && values[i][emailCol] === body.email) {
      sh.getRange(i + 1, revisedCol + 1).setValue(true);
      appendRow_(sheet_("RevisionHistory"), SHEETS.RevisionHistory, {
        Email: body.email, Subject: values[i][headers.indexOf("Subject")], QuestionId: values[i][headers.indexOf("QuestionId")],
        ActionDate: new Date(), Action: "revised"
      });
      return { ok: true };
    }
  }
  return { ok: false, error: "Not found" };
}

/* =====================================================================
   7-DAY REVISION REMINDER — set up ONE time-driven trigger for this:
   Apps Script editor > Triggers (clock icon) > Add Trigger >
   Function: sendRevisionReminders, Event source: Time-driven,
   Type: Day timer, Time of day: whatever suits you (e.g. 8–9am).
   ===================================================================== */
function sendRevisionReminders() {
  ensureSheets_();
  const sh = sheet_("WrongAnswers");
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Etc/UTC", "yyyy-MM-dd");
  const col = n => headers.indexOf(n);

  const due = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const dueDate = row[col("RevisionDueDate")], revised = row[col("Revised")], reminderSent = row[col("ReminderSent")];
    if (dueDate && String(dueDate) <= todayStr && !revised && !reminderSent) {
      const email = row[col("Email")];
      if (!due[email]) due[email] = { name: null, items: [], rowIndexes: [] };
      due[email].items.push({ subject: row[col("Subject")], question: row[col("Question")] });
      due[email].rowIndexes.push(i + 1);
    }
  }
  const users = rowsToObjects_(sheet_("Users"));
  Object.keys(due).forEach(email => {
    const u = users.slice().reverse().find(x => x.Email === email);
    const name = u ? u.Name : "";
    const items = due[email].items;
    const bySubject = {};
    items.forEach(it => { (bySubject[it.subject] = bySubject[it.subject] || []).push(it.question); });
    let html = "<p>Hi " + escapeHtml_(name) + ",</p><p>It's been 7 days since these mistakes — time to revise them:</p>";
    Object.keys(bySubject).forEach(subj => {
      html += "<p><b>" + escapeHtml_(subj) + "</b></p><ul>" + bySubject[subj].slice(0, 10).map(q => "<li>" + escapeHtml_(q) + "</li>").join("") + "</ul>";
    });
    html += "<p>Open My Mistakes on the ECET Quiz site to review them.</p>";
    try {
      MailApp.sendEmail({ to: email, subject: "ECET Quiz — 7-day revision reminder", htmlBody: html });
      due[email].rowIndexes.forEach(r => sh.getRange(r, col("ReminderSent") + 1).setValue(true));
    } catch (err) {
      console.log("Reminder email failed for " + email + ": " + err);
    }
  });
}

/* Run once manually from the Apps Script editor to create sheets/tabs
   immediately, without waiting for the first web request. */
function setup() { ensureSheets_(); }
