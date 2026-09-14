/* ===================== ECET Quiz App ===================== */
const app = document.getElementById("app");
const API = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_URL) || "";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = sec => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h > 0 ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- storage ---------- */
const store = {
  profile: () => JSON.parse(localStorage.getItem("ecet_profile") || "null"),
  setProfile: p => localStorage.setItem("ecet_profile", JSON.stringify(p)),
  progressKey: id => "ecet_progress_" + id,
  getProgress: id => JSON.parse(localStorage.getItem(store.progressKey(id)) || "null"),
  setProgress: (id, data) => localStorage.setItem(store.progressKey(id), JSON.stringify(data)),
  clearProgress: id => localStorage.removeItem(store.progressKey(id)),
  mistakesCache: () => JSON.parse(localStorage.getItem("ecet_mistakes_cache") || "[]"),
  setMistakesCache: arr => localStorage.setItem("ecet_mistakes_cache", JSON.stringify(arr))
};

/* ---------- backend ---------- */
async function apiGet(action, params) {
  if (!API) return null;
  const q = new URLSearchParams({ action, ...params }).toString();
  try {
    const r = await fetch(API + "?" + q);
    return await r.json();
  } catch (e) { console.warn("apiGet failed", e); return null; }
}
async function apiPost(action, payload) {
  if (!API) return null;
  try {
    const r = await fetch(API, { method: "POST", body: JSON.stringify({ action, ...payload }) });
    return await r.json();
  } catch (e) { console.warn("apiPost failed", e); return null; }
}

/* ---------- global state ---------- */
let subjects = [], bank = [], test = [], answers = [], marked = [], qTime = [];
let current = 0, left = 0, timer = null, questionStartedAt = 0, examStartedAt = 0;
let activeSubject = null; // subjects.json entry
let saveTick = 0;

function backHome() { clearInterval(timer); home(); }

/* ===================== HOME ===================== */
async function home() {
  if (!subjects.length) subjects = await fetch("subjects.json").then(r => r.json());
  const profile = store.profile();
  app.innerHTML = `<div class="home">
    <h1>ECET Online Test</h1>
    <p class="subtitle">Choose a subject. Enter its password to open the exam.</p>
    <div class="home-nav">
      <button onclick="goDashboard()">My Dashboard</button>
      <button onclick="goMistakes()">My Mistakes</button>
      ${profile ? `<button onclick="editProfile()">${esc(profile.name)} (${esc(profile.email)})</button>` : ""}
    </div>
    <div class="subject-grid">${subjects.map((s, i) => `
      <div class="subject-card">
        <div class="subject-no">${i + 1}</div>
        <h2>${esc(s.name)}</h2>
        <p>${s.available ? "Questions available" : "Question bank coming soon"}</p>
        <button ${s.available ? `onclick="openPassword(${i})"` : "disabled"}>${s.available ? "Open Exam" : "Coming Soon"}</button>
      </div>`).join("")}
    </div>
  </div>`;
}

function editProfile() {
  const p = store.profile() || { name: "", email: "" };
  app.innerHTML = `<div class="card enroll-card"><h1>Your details</h1>
    <label>Name</label><input id="pname" value="${esc(p.name)}">
    <label>Email</label><input id="pemail" type="email" value="${esc(p.email)}">
    <div id="pErr" class="error"></div>
    <div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div>
  </div>`;
}
function saveProfileEdit() {
  const name = document.getElementById("pname").value.trim();
  const email = document.getElementById("pemail").value.trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) { document.getElementById("pErr").textContent = "Enter a valid name and email."; return; }
  store.setProfile({ name, email });
  home();
}

/* ===================== PASSWORD GATE ===================== */
function openPassword(i) {
  const s = subjects[i];
  app.innerHTML = `<div class="card password-card"><h1>${esc(s.name)}</h1>
    <p>Enter the subject password to continue.</p>
    <input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword(${i})">
    <div id="passError" class="error"></div>
    <div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword(${i})">Continue</button></div>
  </div>`;
  document.getElementById("password").focus();
}
async function checkPassword(i) {
  const s = subjects[i], value = document.getElementById("password").value;
  if (value !== String(s.password)) { document.getElementById("passError").textContent = "Incorrect password."; return; }
  bank = await fetch(s.file).then(r => r.json());
  if (!bank.length) { app.innerHTML = `<div class="card"><h2>Question bank not available yet.</h2><p>The password is correct, but questions for <b>${esc(s.name)}</b> have not been added yet.</p><button onclick="home()">Back to Subjects</button></div>`; return; }
  activeSubject = s;
  enroll();
}

/* ===================== ENROLL (Name + Email) ===================== */
function enroll() {
  const p = store.profile();
  if (p) {
    app.innerHTML = `<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1>
      <p>Continue as <b>${esc(p.name)}</b> (${esc(p.email)})?</p>
      <div class="buttons"><button onclick="editProfile()">Use different details</button><button onclick="beginExam()">Start Exam</button></div>
    </div>`;
    return;
  }
  app.innerHTML = `<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1>
    <p>Enter your name and email before starting.</p>
    <label>Name</label><input id="ename" placeholder="Full name">
    <label>Email</label><input id="eemail" type="email" placeholder="you@example.com">
    <div id="eErr" class="error"></div>
    <div class="buttons"><button onclick="home()">Back</button><button onclick="submitEnroll()">Start Exam</button></div>
  </div>`;
}
function submitEnroll() {
  const name = document.getElementById("ename").value.trim();
  const email = document.getElementById("eemail").value.trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) { document.getElementById("eErr").textContent = "Enter a valid name and email."; return; }
  store.setProfile({ name, email });
  beginExam();
}
function beginExam() {
  apiPost("register", { name: store.profile().name, email: store.profile().email, subject: activeSubject.name });
  start();
}

/* ===================== EXAM ===================== */
function start() {
  clearInterval(timer);
  const key = activeSubject.id;
  const saved = store.getProgress(key);
  const profile = store.profile();
  if (saved && saved.email === profile.email && saved.left > 0 && saved.answers && saved.answers.length === bank.length) {
    test = bank; answers = saved.answers; marked = saved.marked; qTime = saved.qTime; current = saved.current || 0; left = saved.left; examStartedAt = saved.examStartedAt;
  } else {
    test = bank;
    answers = Array(test.length).fill(null);
    marked = Array(test.length).fill(false);
    qTime = Array(test.length).fill(0);
    current = 0;
    left = test.length * 60 + 20 * 60;
    examStartedAt = Date.now();
  }
  questionStartedAt = Date.now();
  timer = setInterval(() => {
    left--;
    const el = document.querySelector(".timer");
    if (el) { el.textContent = clock(left); el.classList.toggle("low", left <= 60); }
    if (++saveTick % 5 === 0) persist();
    if (left <= 0) { left = 0; submit(); }
  }, 1000);
  render();
}

function persist() {
  store.setProgress(activeSubject.id, { email: store.profile().email, answers, marked, qTime, current, left, examStartedAt });
}
function commitTime() {
  const spent = (Date.now() - questionStartedAt) / 1000;
  qTime[current] = (qTime[current] || 0) + spent;
  questionStartedAt = Date.now();
}
function choose(v) { answers[current] = v; persist(); render(); }
function toggleReview() { marked[current] = !marked[current]; persist(); render(); }
function go(n) {
  commitTime();
  current = Math.max(0, Math.min(test.length - 1, n));
  questionStartedAt = Date.now();
  persist();
  render();
}
function restartExam() {
  if (!confirm("Restart this exam? Your current answers will be cleared.")) return;
  store.clearProgress(activeSubject.id);
  start();
}

function render() {
  const q = test[current];
  const answeredCount = answers.filter(x => x !== null).length;
  const markedCount = marked.filter(Boolean).length;
  app.innerHTML = `
  <div class="top"><h1>ECET ${esc(activeSubject.name)}</h1><div class="timer ${left <= 60 ? "low" : ""}">${clock(left)}</div></div>
  <div class="card">
    <div class="meta">
      <span>Question ${current + 1} of ${test.length} • ${esc(q.year)} ${esc(q.state)} • PYQ ${esc(q.questionNumber)}</span>
      <span>Answered ${answeredCount}/${test.length} • Marked ${markedCount}</span>
    </div>
    <div class="question">${esc(q.question)}</div>
    ${q.options.map((o, k) => `<label class="option ${answers[current] === k ? "selected" : ""}"><input type="radio" name="answer" ${answers[current] === k ? "checked" : ""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}
    <button class="review-toggle ${marked[current] ? "active" : ""}" onclick="toggleReview()">${marked[current] ? "★ Marked for review" : "☆ Mark for review"}</button>
    <div class="palette-wrap">
      <div class="palette-legend">
        <span><i class="legend-dot" style="background:#eee"></i> Not answered</span>
        <span><i class="legend-dot" style="background:#1a7f37"></i> Answered</span>
        <span><i class="legend-dot" style="background:#8a6300"></i> Marked for review</span>
        <span><i class="legend-dot" style="outline:2px solid #222;background:#fff"></i> Current</span>
      </div>
      <div class="palette">${test.map((_, k) => `<button class="num ${answers[k] !== null ? "answered" : ""} ${marked[k] ? "review" : ""} ${k === current ? "current" : ""}" onclick="go(${k})">${k + 1}</button>`).join("")}</div>
    </div>
    <div class="examfoot">
      <button onclick="go(current-1)" ${current === 0 ? "disabled" : ""}>◀ Previous</button>
      <button onclick="restartExam()">Restart</button>
      <button onclick="go(current+1)" ${current === test.length - 1 ? "disabled" : ""}>Next ▶</button>
      <button class="submit" onclick="confirmSubmit()">Submit</button>
    </div>
  </div>`;
}
function confirmSubmit() {
  const unanswered = answers.filter(x => x === null).length;
  if (unanswered > 0 && !confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  submit();
}

/* ===================== SUBMIT / RESULT ===================== */
async function submit() {
  commitTime();
  clearInterval(timer);
  store.clearProgress(activeSubject.id);
  const profile = store.profile();
  const totalTime = Math.round((Date.now() - examStartedAt) / 1000);

  const detail = test.map((q, n) => ({
    id: q.id, year: q.year, state: q.state, questionNumber: q.questionNumber,
    question: q.question, options: q.options, correct: q.answer,
    selected: answers[n], marked: marked[n], time: Math.round(qTime[n] || 0)
  }));
  const score = detail.filter(d => d.selected === d.correct).length;
  const wrong = detail.filter(d => d.selected !== null && d.selected !== d.correct).length;
  const unanswered = detail.filter(d => d.selected === null).length;
  const percentage = Math.round((score / test.length) * 1000) / 10;

  app.innerHTML = `<div class="card"><h1>Scoring…</h1><p class="note">Saving your result…</p></div>`;

  const resp = await apiPost("submitExam", {
    name: profile.name, email: profile.email, subject: activeSubject.name, subjectId: activeSubject.id,
    score, total: test.length, percentage, correct: score, wrong, unanswered, totalTime, detail
  });

  renderResult({ score, total: test.length, percentage, wrong, unanswered, totalTime, detail, rank: resp && resp.rank, rankOutOf: resp && resp.rankOutOf });
}

function renderResult(r) {
  const maxT = Math.max(1, ...r.detail.map(d => d.time));
  app.innerHTML = `<div class="card">
    <h1>Result — ${esc(activeSubject.name)}</h1>
    <div class="stats">
      <div class="stat"><b>${r.score}/${r.total}</b>Score</div>
      <div class="stat"><b>${r.percentage}%</b>Percentage</div>
      <div class="stat"><b>${r.rank ? "#" + r.rank + (r.rankOutOf ? " / " + r.rankOutOf : "") : "—"}</b>Rank${r.rank ? "" : " (backend not connected)"}</div>
      <div class="stat"><b>${r.score}</b>Correct</div>
      <div class="stat"><b>${r.wrong}</b>Wrong</div>
      <div class="stat"><b>${r.unanswered}</b>Unanswered</div>
    </div>
    <p class="meta">Total time taken: <b>${clock(r.totalTime)}</b></p>
    <h2>Time spent per question</h2>
    <div class="bars">${r.detail.map(d => `<div class="bar ${d.selected===null?"unansbar":(d.selected!==d.correct?"wrongbar":"")}" style="height:${Math.max(4, (d.time / maxT) * 90)}px" title="Q${r.detail.indexOf(d)+1}: ${d.time}s"></div>`).join("")}</div>
    <div class="buttons"><button onclick="start()">Retry Test</button><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div>
    <h2>Review</h2>
    <div class="filterbar">
      <button class="active" data-f="all" onclick="filterReview('all',this)">All (${r.detail.length})</button>
      <button data-f="wrong" onclick="filterReview('wrong',this)">Wrong (${r.wrong})</button>
      <button data-f="unanswered" onclick="filterReview('unanswered',this)">Unanswered (${r.unanswered})</button>
      <button data-f="marked" onclick="filterReview('marked',this)">Marked (${r.detail.filter(d=>d.marked).length})</button>
    </div>
    <div id="reviewList">${reviewListHTML(r.detail, "all")}</div>
  </div>`;
  window._lastResultDetail = r.detail;
}
function filterReview(f, btn) {
  document.querySelectorAll(".filterbar button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("reviewList").innerHTML = reviewListHTML(window._lastResultDetail, f);
}
function reviewListHTML(detail, filter) {
  return detail.map((d, n) => {
    const isWrong = d.selected !== null && d.selected !== d.correct;
    const isUnans = d.selected === null;
    if (filter === "wrong" && !isWrong) return "";
    if (filter === "unanswered" && !isUnans) return "";
    if (filter === "marked" && !d.marked) return "";
    return `<div class="review ${isWrong || isUnans ? "wrong" : ""}">
      <b>Q${n + 1} • ${esc(d.year)} ${esc(d.state)} • PYQ ${esc(d.questionNumber)}</b> <span class="qtime">(${d.time}s)</span>${d.marked ? " • ★ marked" : ""}<br>
      ${esc(d.question)}<br>
      Your answer: <span class="${isUnans ? "" : (isWrong ? "wronganswer" : "correct")}">${d.selected === null ? "Unanswered" : "ABCD"[d.selected] + ". " + esc(d.options[d.selected])}</span><br>
      Correct answer: <span class="correct">${"ABCD"[d.correct]}. ${esc(d.options[d.correct])}</span>
    </div>`;
  }).join("") || `<p class="note">Nothing to show for this filter.</p>`;
}

/* ===================== DASHBOARD ===================== */
let _afterProfile = null;
function goDashboard() { requireProfile(dashboard); }
function goMistakes() { requireProfile(mistakes); }
function requireProfile(next) {
  if (store.profile()) return next();
  _afterProfile = next;
  app.innerHTML = `<div class="card enroll-card"><h1>Enter your details</h1>
    <p>Your dashboard and mistakes list are tied to your email.</p>
    <label>Name</label><input id="ename" placeholder="Full name">
    <label>Email</label><input id="eemail" type="email" placeholder="you@example.com">
    <div id="eErr" class="error"></div>
    <div class="buttons"><button onclick="home()">Back</button><button onclick="submitProfileAndContinue()">Continue</button></div>
  </div>`;
}
function submitProfileAndContinue() {
  const n = document.getElementById("ename").value.trim(), em = document.getElementById("eemail").value.trim();
  if (!n || !/^\S+@\S+\.\S+$/.test(em)) { document.getElementById("eErr").textContent = "Enter a valid name and email."; return; }
  store.setProfile({ name: n, email: em });
  const next = _afterProfile; _afterProfile = null;
  if (next) next();
}
async function dashboard() {
  app.innerHTML = `<div class="card"><h1>My Dashboard</h1><p class="note">Loading…</p></div>`;
  const profile = store.profile();
  const data = API ? await apiGet("dashboard", { email: profile.email }) : null;
  if (!data || !data.ok) {
    app.innerHTML = `<div class="card"><h1>My Dashboard</h1>
      <p class="note">${API ? "Could not load your dashboard right now." : "Backend not connected yet — set APPS_SCRIPT_URL in config.js to enable the dashboard, rankings and email features."}</p>
      <div class="buttons"><button onclick="home()">Back</button></div></div>`;
    return;
  }
  const d = data.data;
  app.innerHTML = `<div class="card"><h1>My Dashboard</h1><p class="meta">${esc(profile.name)} (${esc(profile.email)})</p>
    <div class="dash-grid">
      <div class="dash-tile"><b>${d.attempts}</b><span>Tests taken</span></div>
      <div class="dash-tile"><b>${d.avgPercentage}%</b><span>Average score</span></div>
      <div class="dash-tile"><b>${d.bestPercentage}%</b><span>Best score</span></div>
      <div class="dash-tile"><b>${d.weakCount}</b><span>Wrong / weak questions</span></div>
    </div>
    <h2>Subject-wise performance</h2>
    ${d.subjectPerformance.map(s => `<div class="subjbar-row"><div class="subjbar-label">${esc(s.subject)}</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${s.avgPercentage}%"></div></div><div>${s.avgPercentage}%</div></div>`).join("") || '<p class="note">No attempts yet.</p>'}
    <h2>Test history</h2>
    <table class="simple"><tr><th>Date</th><th>Subject</th><th>Score</th><th>%</th><th>Rank</th></tr>
      ${d.history.map(h => `<tr><td>${esc(h.date)}</td><td>${esc(h.subject)}</td><td>${h.score}/${h.total}</td><td>${h.percentage}%</td><td>${h.rank ? "#" + h.rank : "—"}</td></tr>`).join("") || '<tr><td colspan="5">No attempts yet.</td></tr>'}
    </table>
    <div class="buttons"><button onclick="goMistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div>
  </div>`;
}

/* ===================== MY MISTAKES ===================== */
async function mistakes() {
  app.innerHTML = `<div class="card"><h1>My Mistakes</h1><p class="note">Loading…</p></div>`;
  const profile = store.profile();
  const data = API ? await apiGet("mistakes", { email: profile.email }) : null;
  if (!data || !data.ok) {
    app.innerHTML = `<div class="card"><h1>My Mistakes</h1>
      <p class="note">${API ? "Could not load your mistakes right now." : "Backend not connected yet — set APPS_SCRIPT_URL in config.js to enable My Mistakes and the 7-day revision reminders."}</p>
      <div class="buttons"><button onclick="home()">Back</button></div></div>`;
    return;
  }
  store.setMistakesCache(data.data);
  renderMistakes(data.data);
}
function renderMistakes(items) {
  const today = todayISO();
  app.innerHTML = `<div class="card"><h1>My Mistakes</h1>
    <p class="meta">Wrong questions become due for revision 7 days after you get them wrong.</p>
    ${items.length ? items.map(m => {
      const due = m.revisionDueDate <= today;
      const tag = m.revised ? `<span class="mistake-tag tag-done">Revised</span>` : due ? `<span class="mistake-tag tag-due">Due for revision</span>` : `<span class="mistake-tag tag-wait">Due ${esc(m.revisionDueDate)}</span>`;
      return `<div class="mistake-card">
        ${tag}<span class="mistake-tag tag-wait">${esc(m.subject)}</span>
        <p><b>${esc(m.question)}</b></p>
        ${m.options.map((o, k) => `<div>${"ABCD"[k]}. ${esc(o)} ${k === m.correctIndex ? "<b class='correct'>(correct)</b>" : ""} ${k === m.selectedIndex ? "<i>(your answer)</i>" : ""}</div>`).join("")}
        <div class="buttons"><button onclick="markRevised('${m.wrongId}')" ${m.revised ? "disabled" : ""}>${m.revised ? "Already revised" : "Mark as revised"}</button></div>
      </div>`;
    }).join("") : '<p class="note">No mistakes recorded yet — nice work, or take a test first.</p>'}
    <div class="buttons"><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div>
  </div>`;
}
async function markRevised(wrongId) {
  const profile = store.profile();
  await apiPost("markRevised", { email: profile.email, wrongId });
  const items = store.mistakesCache().map(m => m.wrongId === wrongId ? { ...m, revised: true } : m);
  store.setMistakesCache(items);
  renderMistakes(items);
}

/* ===================== INIT ===================== */
home();
