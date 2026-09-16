/* ===================== ECET Quiz App ===================== */
const app = document.getElementById("app");
const API = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_URL) || "";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const clock = sec => { sec=Math.max(0,Math.floor(sec||0)); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return (h?String(h).padStart(2,"0")+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); };
const isoDate = d => { const x=new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const formatDateTime = v => { const d=new Date(v); return isNaN(d)?String(v||"—"):d.toLocaleString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
const formatSeconds = s => { s=Math.max(0,Math.round(Number(s)||0)); return s<60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; };
const addDays = (v,n) => { const d=new Date(v); d.setDate(d.getDate()+n); return d; };
const dueDate = m => new Date(m.revisionDueIso || m.revisionDueDate);
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

const store = {
  profile:()=>JSON.parse(localStorage.getItem("ecet_profile")||"null"),
  setProfile:p=>localStorage.setItem("ecet_profile",JSON.stringify(p)),
  progressKey:id=>"ecet_progress_"+id,
  getProgress:id=>JSON.parse(localStorage.getItem(store.progressKey(id))||"null"),
  setProgress:(id,data)=>localStorage.setItem(store.progressKey(id),JSON.stringify(data)),
  clearProgress:id=>localStorage.removeItem(store.progressKey(id)),
  mistakesCache:()=>JSON.parse(localStorage.getItem("ecet_mistakes_cache")||"[]"),
  setMistakesCache:a=>localStorage.setItem("ecet_mistakes_cache",JSON.stringify(a))
};

async function apiGet(action,params={}){ if(!API)return null; try{const r=await fetch(API+"?"+new URLSearchParams({action,...params}));return await r.json();}catch(e){console.warn(e);return null;} }
async function apiPost(action,payload={}){ if(!API)return null; try{const r=await fetch(API,{method:"POST",body:JSON.stringify({action,...payload})});return await r.json();}catch(e){console.warn(e);return null;} }

let subjects=[],bank=[],test=[],answers=[],marked=[],qTime=[];
let current=0,left=0,timer=null,questionStartedAt=0,examStartedAt=0,activeSubject=null,saveTick=0,isSubmitting=false;
let examSessionId="";
let revisionMode=false, revisionItems=[];
let _afterProfile=null;

function newSessionId(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+"-"+Math.random().toString(16).slice(2); }
function clearExam(){
  clearInterval(timer); timer=null; isSubmitting=false;
  window.removeEventListener("beforeunload",handleBeforeUnload);
  window.removeEventListener("pagehide",handlePageHide);
  window.removeEventListener("beforeunload",handleRevisionBeforeUnload);
  window.removeEventListener("pagehide",handleRevisionPageHide);
  disarmBackGuard();
}

/* ===================== BROWSER BACK GUARD (during an active test) =====================
   Browsers do not let scripts fully block the back button, but pushState + popstate lets
   us intercept the very first back action, ask for confirmation, and auto-submit if the
   person confirms. Refresh/close/tab-close are handled separately by beforeunload/pagehide
   (see handleBeforeUnload/handlePageHide and their revision equivalents) — those cannot
   guarantee interception either; browsers only allow a generic "leave site?" prompt there. */
function armBackGuard(){
  try{ history.pushState({ecetGuard:true},""); }catch(e){}
  window.addEventListener("popstate",handleBackGuard);
}
function disarmBackGuard(){
  window.removeEventListener("popstate",handleBackGuard);
}
function handleBackGuard(){
  const inExam=activeSubject&&test.length&&!isSubmitting&&left>0&&!revisionMode;
  const inRevision=revisionMode&&revisionItems.length&&!isSubmitting;
  if(!inExam&&!inRevision){ disarmBackGuard(); return; }
  const leave=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");
  if(leave){
    disarmBackGuard();
    if(inRevision)submitRevisionTest();else submit();
  } else {
    try{ history.pushState({ecetGuard:true},""); }catch(e){}
  }
}
function persist(){
  if(!activeSubject||revisionMode)return;
  const p=store.profile();
  try{
    store.setProgress(activeSubject.id,{
      email:p?.email,answers,marked,qTime,current,left,examStartedAt,examSessionId,
      questionOrder:test.map(q=>q.id),
      optionOrders:test.map(q=>Array.isArray(q.optionOrder)?q.optionOrder:q.options.map((_,i)=>i)),
      savedAt:Date.now()
    });
  }catch(e){console.warn("Autosave failed",e);}
}
function commitTime(){ if(!test.length)return; const spent=(Date.now()-questionStartedAt)/1000; qTime[current]=(qTime[current]||0)+spent; questionStartedAt=Date.now(); }

function submissionPayload(compact=false){
  commitTime();
  const p=store.profile();
  const detail=test.map((q,n)=>{
    const selected=answers[n], isWrong=selected!==null&&selected!==undefined&&Number(selected)!==Number(q.answer);
    const d={id:q.id,year:q.year,state:q.state,questionNumber:q.questionNumber,correct:q.answer,selected,marked:marked[n],time:Math.round(qTime[n]||0)};
    // On normal submit keep everything. On tab-close submit, omit question/options
    // for correct/unanswered items to keep the Beacon payload small enough for browsers.
    if(!compact || isWrong){ d.question=q.question; d.options=q.options; }
    return d;
  });
  const score=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)===Number(d.correct)).length;
  const wrong=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)!==Number(d.correct)).length;
  const unanswered=detail.filter(d=>d.selected===null||d.selected===undefined).length;
  const percentage=test.length?Math.round(score/test.length*1000)/10:0;
  return {name:p.name,email:p.email,subject:activeSubject.name,subjectId:activeSubject.id,score,total:test.length,percentage,correct:score,wrong,unanswered,totalTime:Math.round((Date.now()-examStartedAt)/1000),detail,examSessionId,autoSubmitted:!!compact};
}
function sendAutoSubmit(){
  if(isSubmitting||revisionMode||!activeSubject||!test.length||left<=0||!API)return false;
  const marker="ecet_auto_submit_"+examSessionId;
  if(sessionStorage.getItem(marker)==="1")return true;
  isSubmitting=true;
  const payload={action:"submitExam",...submissionPayload(true)};
  const body=JSON.stringify(payload);
  let accepted=false;
  try{
    if(navigator.sendBeacon){ accepted=navigator.sendBeacon(API,new Blob([body],{type:"text/plain;charset=UTF-8"})); }
  }catch(err){console.warn("Beacon submit failed",err);}
  if(!accepted){
    try{ fetch(API,{method:"POST",body,keepalive:true}); accepted=true; }catch(err){console.warn("Keepalive submit failed",err);}
  }
  if(accepted){ sessionStorage.setItem(marker,"1"); store.clearProgress(activeSubject.id); }
  return accepted;
}
function handleBeforeUnload(e){
  if(isSubmitting||revisionMode||!activeSubject||!test.length||left<=0)return;
  persist();
  sendAutoSubmit();
  e.preventDefault();
  e.returnValue="Your exam is still running. It will be submitted automatically.";
  return e.returnValue;
}
function handlePageHide(){
  if(isSubmitting||revisionMode||!activeSubject||!test.length||left<=0)return;
  persist();
  sendAutoSubmit();
}

/* ===================== HOME ===================== */
async function home(){
  clearExam(); revisionMode=false;
  if(!subjects.length) subjects=await fetch("subjects.json").then(r=>r.json());
  const p=store.profile();
  app.innerHTML=`<div class="home"><h1>ECET Online Test</h1><p class="subtitle">Choose a subject. Each test gets exactly 1 minute per question — no extra time.</p>
    <div class="home-nav"><button onclick="goDashboard()">My Dashboard</button><button onclick="goMistakes()">My Mistakes</button><button onclick="goReminders()">Reminders</button>${p?`<button onclick="editProfile()">${esc(p.name)}</button>`:""}</div>
    <div class="subject-grid">${subjects.map((s,i)=>{const unfinished=s.available&&store.getProgress(s.id);return `<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${s.available?(unfinished?"Test in progress — resume any time":"Questions available"):"Question bank coming soon"}</p><button ${s.available?`onclick="openPassword(${i})"`:"disabled"}>${s.available?(unfinished?"Resume Exam":"Open Exam"):"Coming Soon"}</button>${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;}).join("")}</div>
  </div>`;
}
function editProfile(){const p=store.profile()||{name:"",email:""};app.innerHTML=`<div class="card enroll-card"><h1>Your details</h1><label>Name</label><input id="pname" value="${esc(p.name)}"><label>Email</label><input id="pemail" type="email" value="${esc(p.email)}"><div id="pErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div></div>`;}
function saveProfileEdit(){const n=document.getElementById("pname").value.trim(),e=document.getElementById("pemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("pErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});home();}

/* ===================== PASSWORD ===================== */
function openPassword(i){const s=subjects[i];app.innerHTML=`<div class="card password-card"><h1>${esc(s.name)}</h1><p>Enter the subject password.</p><input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword(${i})"><div id="passError" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword(${i})">Continue</button></div></div>`;document.getElementById("password").focus();}
async function checkPassword(i){const s=subjects[i],v=document.getElementById("password").value;if(v!==String(s.password)){document.getElementById("passError").textContent="Incorrect password.";return;}try{bank=await fetch(s.file).then(r=>r.json());}catch(e){bank=[];}if(!bank.length){app.innerHTML=`<div class="card"><h2>Question bank not available.</h2><button onclick="home()">Back</button></div>`;return;}activeSubject=s;enroll();}
function enroll(){const p=store.profile();if(p){app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1><p>Continue as <b>${esc(p.name)}</b> (${esc(p.email)})?</p><div class="buttons"><button onclick="editProfile()">Change details</button><button onclick="beginExam()">Start Exam</button></div></div>`;return;}app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1><p>Enter your name and email.</p><label>Name</label><input id="ename" placeholder="Full name"><label>Email</label><input id="eemail" type="email" placeholder="you@example.com"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitEnroll()">Start Exam</button></div></div>`;}
function submitEnroll(){const n=document.getElementById("ename").value.trim(),e=document.getElementById("eemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("eErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});beginExam();}
async function beginExam(){const p=store.profile();apiPost("register",{name:p.name,email:p.email,subject:activeSubject.name});start();}

/* ===================== EXAM ===================== */
function start(){
  revisionMode=false; clearExam();
  const saved=store.getProgress(activeSubject.id),p=store.profile();
  const bankById=new Map(bank.map(q=>[String(q.id),q]));
  if(saved&&saved.email===p.email&&saved.left>0&&saved.answers?.length===bank.length&&Array.isArray(saved.questionOrder)&&saved.questionOrder.length===bank.length){
    const restored=saved.questionOrder.map((id,pos)=>{
      const q=bankById.get(String(id));
      return q?restoreQuestionOrder(q,saved.optionOrders?.[pos]):null;
    }).filter(Boolean);
    if(restored.length===bank.length){
      test=restored;answers=saved.answers;marked=saved.marked;qTime=saved.qTime;current=Math.max(0,Math.min(test.length-1,saved.current||0));left=saved.left;examStartedAt=saved.examStartedAt;examSessionId=saved.examSessionId||newSessionId();
    } else { startFreshExam(); }
  } else { startFreshExam(); }
  questionStartedAt=Date.now();isSubmitting=false;saveTick=0;
  window.addEventListener("beforeunload",handleBeforeUnload);
  window.addEventListener("pagehide",handlePageHide);
  armBackGuard();
  persist();render();
  timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el){el.textContent=clock(left);el.classList.toggle("low",left<=60);}if(++saveTick%5===0)persist();if(left<=0){left=0;submit();}},1000);
}
function randomizeQuestionOptions(q){
  const pairs=(q.options||[]).map((text,index)=>({text,index}));
  const shuffled=shuffle(pairs);
  return {...q,options:shuffled.map(x=>x.text),answer:shuffled.findIndex(x=>x.index===Number(q.answer)),optionOrder:shuffled.map(x=>x.index)};
}
function restoreQuestionOrder(q,order){
  if(!Array.isArray(order)||order.length!==(q.options||[]).length)return randomizeQuestionOptions(q);
  const pairs=order.map(i=>({text:q.options[i],index:i}));
  if(pairs.some(x=>x.text===undefined))return randomizeQuestionOptions(q);
  return {...q,options:pairs.map(x=>x.text),answer:pairs.findIndex(x=>x.index===Number(q.answer)),optionOrder:order.slice()};
}
function startFreshExam(){
  test=shuffle(bank).map(randomizeQuestionOptions);
  // Time rule: exactly 1 minute per question. No extra time is added.
  answers=Array(test.length).fill(null);marked=Array(test.length).fill(false);qTime=Array(test.length).fill(0);current=0;left=test.length*60;examStartedAt=Date.now();examSessionId=newSessionId();
}
function choose(v){answers[current]=v;persist();render();}
function toggleReview(){marked[current]=!marked[current];persist();render();}
function go(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();persist();render();}
function restartExam(){if(confirm("Restart this exam? Your current answers will be cleared.")){store.clearProgress(activeSubject.id);start();}}
function confirmSubmit(){const u=answers.filter(x=>x===null).length;if(u&&!confirm(`You have ${u} unanswered question(s). Submit anyway?`))return;submit();}
function render(){const q=test[current],answered=answers.filter(x=>x!==null).length,markedCount=marked.filter(Boolean).length;app.innerHTML=`<div class="top"><h1>ECET ${esc(activeSubject.name)}</h1><div class="timer ${left<=60?"low":""}">${clock(left)}</div></div><div class="card"><div class="meta"><span>Question ${current+1} of ${test.length} • ${esc(q.year)} ${esc(q.state)} • PYQ ${esc(q.questionNumber)}</span><span>Answered ${answered}/${test.length} • Review ${markedCount}</span></div><div class="question">${esc(q.question)}</div>${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" name="answer" ${answers[current]===k?"checked":""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}<button class="review-toggle ${marked[current]?"active":""}" onclick="toggleReview()">${marked[current]?"★ Marked for review":"☆ Mark for review"}</button><div class="palette-legend"><span>⬜ Unanswered</span><span>🟩 Answered</span><span>🟨 Review</span></div><div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${marked[k]?"review":""} ${k===current?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div><div class="examfoot"><button onclick="go(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="toggleReview()">${marked[current]?"Unmark":"Review"}</button><button onclick="go(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="confirmSubmit()">Submit</button></div></div>`;}

/* ===================== RESULT ===================== */
async function submit(){
  if(isSubmitting||!test.length)return; isSubmitting=true;clearExam();
  const payload=submissionPayload();store.clearProgress(activeSubject.id);
  const score=payload.score,total=payload.total,percentage=payload.percentage,wrong=payload.wrong,unanswered=payload.unanswered;
  app.innerHTML=`<div class="card"><h1>Saving result…</h1><p class="note">Your result will appear immediately.</p></div>`;
  const resp=await apiPost("submitExam",payload);
  if(!resp?.ok){
    isSubmitting=false;
    store.setProgress(activeSubject.id,{email:store.profile()?.email,answers,marked,qTime,current,left,examStartedAt,examSessionId,questionOrder:test.map(q=>q.id),optionOrders:test.map(q=>q.optionOrder)});
    app.innerHTML=`<div class="card"><h1>Could not save result</h1><p class="note">Your answers are still saved on this device. Please check your internet connection and try submitting again.</p><div class="buttons"><button onclick="submit()">Try again</button><button onclick="home()">Subjects</button></div></div>`;
    return;
  }
  renderResult({score,total,percentage,wrong,unanswered,totalTime:payload.totalTime,detail:payload.detail,rank:resp.rank,rankOutOf:resp.rankOutOf,expectedRank:resp.expectedRank,equivalentMarks:resp.equivalentMarks});
}
function pieHTML(r){const total=Math.max(1,r.total),c=r.score/total*100,w=r.wrong/total*100,u=r.unanswered/total*100;return `<div class="pie-wrap"><div class="pie" style="background:conic-gradient(#1a7f37 0 ${c}%,#b00020 ${c}% ${c+w}%,#d4a72c ${c+w}% 100%)"></div><div class="pie-legend"><span><i class="dot green"></i>Correct ${c.toFixed(1)}%</span><span><i class="dot red"></i>Wrong ${w.toFixed(1)}%</span><span><i class="dot yellow"></i>Unanswered ${u.toFixed(1)}%</span></div></div>`;}
function timeChart(detail){const max=Math.max(60,...detail.map(d=>d.time||0));const ticks=[0,Math.round(max/4),Math.round(max/2),Math.round(max*3/4),max];return `<div class="chart-area"><div class="y-axis">${ticks.slice().reverse().map(v=>`<span>${formatSeconds(v)}</span>`).join("")}</div><div class="chart-main"><div class="gridlines">${ticks.map(()=>`<i></i>`).join("")}</div><div class="bars">${detail.map((d,i)=>{const h=Math.max(3,(d.time/max)*100);return `<button class="bar-col ${d.selected===null?"unansbar":d.selected!==d.correct?"wrongbar":""}" style="height:${h}%" onclick="showQuestionTime(${i})" title="Q${i+1}: ${formatSeconds(d.time)}"><span>${i+1}</span></button>`;}).join("")}</div><div class="x-axis">${detail.map((_,i)=>`<span>${i+1}</span>`).join("")}</div></div></div><div id="timeDetail" class="chart-detail">Click any question bar to see exact time.</div>`;}
function showQuestionTime(i){const d=window._lastResultDetail?.[i];if(!d)return;const el=document.getElementById("timeDetail");if(el)el.innerHTML=`<b>Question ${i+1}</b> — time spent: <b>${formatSeconds(d.time)}</b><br>${esc(d.question)}`;}
function renderResult(r){
  window._lastResultDetail=r.detail;
  const expected=r.expectedRank||"—",eq=r.equivalentMarks??Math.round(r.percentage*2*10)/10;
  app.innerHTML=`<div class="card"><h1>Result — ${esc(activeSubject.name)}</h1><div class="stats"><div class="stat"><b>${r.score}/${r.total}</b>Score</div><div class="stat"><b>${r.percentage}%</b>Percentage</div><div class="stat"><b>${eq}/200</b>Equivalent AP ECET</div><div class="stat"><b>${expected}</b>Expected AP ECET Rank</div><div class="stat"><b>${r.rank?"#"+r.rank:"—"}</b>Practice Rank</div><div class="stat"><b>${r.rankOutOf||"—"}</b>Students</div><div class="stat"><b>${r.wrong}</b>Wrong</div><div class="stat"><b>${r.unanswered}</b>Unanswered</div></div><p class="meta">Total time: <b>${clock(r.totalTime)}</b></p><h2>Result breakdown</h2>${pieHTML(r)}<h2>Time spent per question</h2>${timeChart(r.detail)}<div class="buttons"><button onclick="start()">Retry Test</button><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div><h2>Question review</h2><div class="filterbar"><button class="active" onclick="filterReview('all',this)">All (${r.detail.length})</button><button onclick="filterReview('wrong',this)">Wrong (${r.wrong})</button><button onclick="filterReview('unanswered',this)">Unanswered (${r.unanswered})</button><button onclick="filterReview('marked',this)">Review (${r.detail.filter(d=>d.marked).length})</button></div><div id="reviewList">${reviewListHTML(r.detail,"all")}</div></div>`;
}
function filterReview(f,b){document.querySelectorAll(".filterbar button").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.getElementById("reviewList").innerHTML=reviewListHTML(window._lastResultDetail,f);}
function reviewListHTML(detail,filter){return detail.map((d,n)=>{const iw=d.selected!==null&&d.selected!==d.correct,iu=d.selected===null;if((filter==="wrong"&&!iw)||(filter==="unanswered"&&!iu)||(filter==="marked"&&!d.marked))return"";return `<div class="review ${iw||iu?"wrong":""}"><b>Q${n+1} • ${esc(d.year)} ${esc(d.state)} • PYQ ${esc(d.questionNumber)}</b> <span class="qtime">${formatSeconds(d.time)}</span><p>${esc(d.question)}</p><div>Your answer: <span class="${iu?"":iw?"wronganswer":"correct"}">${iu?"Unanswered":"ABCD"[d.selected]+". "+esc(d.options[d.selected])}</span></div><div>Correct answer: <span class="correct">${"ABCD"[d.correct]}. ${esc(d.options[d.correct])}</span></div></div>`;}).join("")||`<p class="note">Nothing to show.</p>`;}

/* ===================== PROFILE / DASHBOARD ===================== */
function goDashboard(){requireProfile(dashboard);} function goMistakes(){requireProfile(mistakes);}
function requireProfile(next){if(store.profile())return next();_afterProfile=next;app.innerHTML=`<div class="card enroll-card"><h1>Enter your details</h1><p>Your dashboard and mistakes are tied to your email.</p><label>Name</label><input id="ename"><label>Email</label><input id="eemail" type="email"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitProfileAndContinue()">Continue</button></div></div>`;}
function submitProfileAndContinue(){const n=document.getElementById("ename").value.trim(),e=document.getElementById("eemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("eErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});const next=_afterProfile;_afterProfile=null;if(next)next();}
async function dashboard(){
  clearExam();app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">Loading…</p></div>`;const p=store.profile(),res=API?await apiGet("dashboard",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">${API?"Could not load dashboard.":"Connect Apps Script in config.js first."}</p><button onclick="home()">Back</button></div>`;return;}
  const d=res.data;
  app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="meta">${esc(p.name)} • ${esc(p.email)}</p><div class="dash-grid"><div class="dash-tile"><b>${d.attempts}</b><span>Tests taken</span></div><div class="dash-tile"><b>${d.avgPercentage}%</b><span>Average %</span></div><div class="dash-tile"><b>${d.bestPercentage}%</b><span>Best %</span></div><div class="dash-tile"><b>${d.weakCount}</b><span>Active mistakes</span></div></div>
    ${d.strongest?`<div class="advice good"><b>Strongest subject:</b> ${esc(d.strongest.subject)} — ${d.strongest.avgPercentage}% average.</div>`:""}${d.weakest?`<div class="advice weak"><b>Needs more practice:</b> ${esc(d.weakest.subject)} — ${d.weakest.avgPercentage}% average.</div>`:""}
    <h2>Subject-wise performance</h2>${d.subjectPerformance.map(s=>`<div class="subjbar-row"><div class="subjbar-label">${esc(s.subject)}</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${Math.min(100,s.avgPercentage)}%"></div></div><div>${s.avgPercentage}%</div></div>`).join("")||'<p class="note">No attempts yet.</p>'}
    <h2>Test history</h2><div class="table-scroll"><table class="simple"><tr><th>Date</th><th>Subject</th><th>Score</th><th>%</th><th>Equivalent /200</th><th>Expected AP Rank</th><th>Current Practice Rank</th></tr>${d.history.map(h=>`<tr><td>${esc(h.date)}</td><td>${esc(h.subject)}</td><td>${h.score}/${h.total}</td><td>${h.percentage}%</td><td>${h.equivalentMarks}</td><td>${esc(h.expectedRank)}</td><td>${h.currentRank?`#${h.currentRank} / ${h.currentRankOutOf}`:"—"}</td></tr>`).join("")||'<tr><td colspan="7">No attempts yet.</td></tr>'}</table></div>
    <div class="buttons"><button onclick="goMistakes()">My Mistakes</button><button onclick="goAttemptHistory()">Attempt History</button><button onclick="home()">Subjects</button></div></div>`;
}

/* ===================== ATTEMPT HISTORY (full list + compare) ===================== */
let _historyCache=[],_compareIds=[];
function goAttemptHistory(){requireProfile(attemptHistory);}
async function attemptHistory(){
  clearExam();app.innerHTML=`<div class="card"><h1>Attempt History</h1><p class="note">Loading…</p></div>`;
  const p=store.profile(),res=API?await apiGet("history",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>Attempt History</h1><p class="note">${API?"Could not load attempt history.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="attemptHistory()">Retry</button><button onclick="goDashboard()">Back</button></div></div>`;return;}
  _historyCache=res.data||[];_compareIds=[];
  renderAttemptHistory();
}
function renderAttemptHistory(){
  const rows=_historyCache;
  app.innerHTML=`<div class="card"><h1>Attempt History</h1><p class="meta">Every attempt is kept — nothing is overwritten. Tick two rows to compare them.</p>
  <div class="table-scroll"><table class="simple"><tr><th></th><th>Date</th><th>Subject</th><th>Score</th><th>%</th><th>Correct</th><th>Wrong</th><th>Unattempted</th><th>Total time</th><th>Rank</th></tr>
  ${rows.map(h=>`<tr><td><input type="checkbox" ${_compareIds.includes(h.resultId)?"checked":""} onchange="toggleCompare('${h.resultId}',this.checked)"></td><td>${esc(formatDateTime(h.endTime||h.timestamp))}</td><td>${esc(h.subject)}</td><td>${h.score}/${h.total}</td><td>${h.percentage}%</td><td>${h.correct}</td><td>${h.wrong}</td><td>${h.unanswered}</td><td>${clock(h.totalTimeSec)}</td><td>${h.rank?`#${h.rank}${h.rankOutOf?" / "+h.rankOutOf:""}`:"—"}</td></tr>`).join("")||'<tr><td colspan="10">No attempts yet.</td></tr>'}
  </table></div>
  <div id="compareBox">${compareHTML()}</div>
  <div class="buttons"><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div></div>`;
}
function toggleCompare(id,checked){
  if(checked){ if(!_compareIds.includes(id)){ if(_compareIds.length>=2)_compareIds.shift(); _compareIds.push(id); } }
  else { _compareIds=_compareIds.filter(x=>x!==id); }
  renderAttemptHistory();
}
function compareHTML(){
  if(_compareIds.length!==2)return'<p class="note">Select exactly two attempts above to compare improvement.</p>';
  const [a,b]=_compareIds.map(id=>_historyCache.find(h=>h.resultId===id)).sort((x,y)=>new Date(x.endTime||x.timestamp)-new Date(y.endTime||y.timestamp));
  if(!a||!b)return"";
  const diff=(x,y)=>{const d=(Number(y)-Number(x));return `${d>0?"+":""}${Math.round(d*100)/100}`;};
  return `<div class="advice ${b.percentage>=a.percentage?"good":"weak"}"><b>Comparing:</b> ${esc(a.subject)} on ${esc(formatDateTime(a.endTime||a.timestamp))} → ${esc(b.subject)} on ${esc(formatDateTime(b.endTime||b.timestamp))}<br>
  Score: ${a.score}/${a.total} → ${b.score}/${b.total} (${diff(a.score,b.score)}) • Percentage: ${a.percentage}% → ${b.percentage}% (${diff(a.percentage,b.percentage)}%) • Wrong: ${a.wrong} → ${b.wrong} • Unattempted: ${a.unanswered} → ${b.unanswered}</div>`;
}

/* ===================== REMINDERS (standalone, not test-dependent) ===================== */
const REMINDER_FREQUENCIES=[["once","One-time"],["hourly","Hourly"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]];
let _remindersCache=[];
function goReminders(){requireProfile(remindersPage);}
async function remindersPage(){
  clearExam();app.innerHTML=`<div class="card"><h1>Reminders</h1><p class="note">Loading…</p></div>`;
  const p=store.profile(),res=API?await apiGet("reminders",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>Reminders</h1><p class="note">${API?"Could not load reminders.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="remindersPage()">Retry</button><button onclick="home()">Back</button></div></div>`;return;}
  _remindersCache=res.data||[];renderReminders();
}
function renderReminders(saveError){
  const p=store.profile();
  const groups={Active:[],Paused:[],Completed:[]};
  _remindersCache.forEach(r=>{const key=r.status==="Paused"?"Paused":r.status==="Completed"?"Completed":"Active";groups[key].push(r);});
  const row=r=>`<div class="mistake-card"><div><span class="mistake-tag ${r.status==="Active"?"tag-due":"tag-wait"}">${esc(r.status)}</span> <span class="mistake-tag">${esc(r.frequency)}</span></div>
    <p><b>${esc(r.name)}</b></p><p>${esc(r.message)}</p>
    ${r.relatedTask?`<p class="note">Task: ${esc(r.relatedTask)}</p>`:""}${r.relatedUrl?`<p class="note"><a href="${esc(r.relatedUrl)}" target="_blank" rel="noopener">${esc(r.relatedUrl)}</a></p>`:""}
    <p class="meta">Next: ${r.nextRunAt?esc(formatDateTime(r.nextRunAt)):"—"}${r.lastSentAt?` • Last sent: ${esc(formatDateTime(r.lastSentAt))}`:""}</p>
    <div class="buttons"><button onclick="openEditReminder('${r.id}')">Edit</button><button onclick="reminderToggle('${r.id}',${!r.enabled})">${r.enabled?"Pause":"Resume"}</button><button onclick="reminderDelete('${r.id}')">Delete</button></div></div>`;
  app.innerHTML=`<div class="card"><h1>Reminders</h1><p class="meta">Registered email: <b>${esc(p.email)}</b>. Standalone reminders — not tied to any specific test.</p>
  ${saveError?`<div class="error">${esc(saveError)}</div>`:""}
  <div class="buttons"><button onclick="openCreateReminder()">+ New reminder</button><button onclick="notificationsPage()">Notification history</button></div>
  <h2>Active (${groups.Active.length})</h2>${groups.Active.map(row).join("")||'<p class="note">No active reminders.</p>'}
  <h2>Paused (${groups.Paused.length})</h2>${groups.Paused.map(row).join("")||'<p class="note">None paused.</p>'}
  <h2>Completed (${groups.Completed.length})</h2>${groups.Completed.map(row).join("")||'<p class="note">None completed yet.</p>'}
  <div class="buttons"><button onclick="home()">Subjects</button></div></div>`;
}
function reminderFormHTML(existing){
  const r=existing||{};
  const in1h=new Date(Date.now()+3600e3),in3h=new Date(Date.now()+3*3600e3),tomorrow=new Date(Date.now()+24*3600e3);
  const toLocal=d=>{const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
  return `<div class="card enroll-card"><h1>${existing?"Edit reminder":"New reminder"}</h1>
  <label>Related task/name</label><input id="rName" value="${esc(r.name||"")}" placeholder="e.g. Revise Digital Electronics">
  <label>Message</label><input id="rMessage" value="${esc(r.message||"")}" placeholder="What should the reminder say?">
  <label>Related URL (optional)</label><input id="rUrl" value="${esc(r.relatedUrl||"")}" placeholder="https://…">
  <label>When</label>
  <div class="buttons" style="justify-content:flex-start">
    <button type="button" onclick="document.getElementById('rWhen').value='${toLocal(in1h)}'">In 1 hour</button>
    <button type="button" onclick="document.getElementById('rWhen').value='${toLocal(in3h)}'">In 3 hours</button>
    <button type="button" onclick="document.getElementById('rWhen').value='${toLocal(tomorrow)}'">Tomorrow</button>
  </div>
  <input id="rWhen" type="datetime-local" value="${r.nextRunAt?toLocal(new Date(r.nextRunAt)):""}">
  <label>Repeat</label>
  <select id="rFreq">${REMINDER_FREQUENCIES.map(([v,l])=>`<option value="${v}" ${((r.frequency||"once")===v)?"selected":""}>${l}</option>`).join("")}</select>
  <div id="rErr" class="error"></div>
  <div class="buttons"><button onclick="remindersPage()">Cancel</button><button onclick="saveReminder(${existing?`'${existing.id}'`:"null"})">${existing?"Save changes":"Create reminder"}</button></div></div>`;
}
function openCreateReminder(){clearExam();app.innerHTML=reminderFormHTML(null);}
function quickRemindLater(subjectId,subjectName){requireProfile(()=>{clearExam();app.innerHTML=reminderFormHTML({name:"Finish "+subjectName,message:"You have an unfinished "+subjectName+" test waiting — come back and finish it.",relatedUrl:location.href.split("#")[0]});});}
function openEditReminder(id){clearExam();app.innerHTML=reminderFormHTML(_remindersCache.find(r=>r.id===id));}
async function saveReminder(id){
  const p=store.profile();
  const name=document.getElementById("rName").value.trim();
  const message=document.getElementById("rMessage").value.trim();
  const relatedUrl=document.getElementById("rUrl").value.trim();
  const whenLocal=document.getElementById("rWhen").value;
  const frequency=document.getElementById("rFreq").value;
  const errEl=document.getElementById("rErr");
  if(!name||!message){errEl.textContent="Name and message are required.";return;}
  const when=whenLocal?new Date(whenLocal):null;
  if(!when||isNaN(when)||when<=new Date()){errEl.textContent="Pick a valid future date/time.";return;}
  const payload={email:p.email,userName:p.name,name,message,relatedTask:name,relatedUrl,frequency,nextRunAt:when.toISOString()};
  const res=await apiPost(id?"updateReminder":"createReminder",id?{...payload,id}:payload);
  if(!res?.ok){errEl.textContent=res?.error||"Could not save reminder. Check your connection and try again.";return;}
  const fresh=API?await apiGet("reminders",{email:p.email}):null;
  _remindersCache=fresh?.data||_remindersCache;renderReminders();
}
async function reminderToggle(id,enabled){
  const p=store.profile();const res=await apiPost("toggleReminder",{email:p.email,id,enabled});
  if(res?.ok){const fresh=await apiGet("reminders",{email:p.email});_remindersCache=fresh?.data||_remindersCache;}
  renderReminders(res?.ok?null:(res?.error||"Could not update reminder."));
}
async function reminderDelete(id){
  if(!confirm("Delete this reminder? This cannot be undone."))return;
  const p=store.profile();const res=await apiPost("deleteReminder",{email:p.email,id});
  if(res?.ok)_remindersCache=_remindersCache.filter(r=>r.id!==id);
  renderReminders(res?.ok?null:(res?.error||"Could not delete reminder."));
}

/* ===================== NOTIFICATION HISTORY ===================== */
async function notificationsPage(){
  clearExam();app.innerHTML=`<div class="card"><h1>Notification History</h1><p class="note">Loading…</p></div>`;
  const p=store.profile(),res=API?await apiGet("notifications",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>Notification History</h1><p class="note">${API?"Could not load notification history.":"Connect Apps Script first."}</p><div class="buttons"><button onclick="notificationsPage()">Retry</button><button onclick="remindersPage()">Back</button></div></div>`;return;}
  renderNotifications(res.data||[]);
}
function renderNotifications(items){
  const statusClass=s=>s==="Sent"?"tag-due":s==="Failed"?"tag-wait":"tag-wait";
  app.innerHTML=`<div class="card"><h1>Notification History</h1><p class="meta">Every reminder send attempt, separate from your active reminders list.</p>
  ${items.map(n=>`<div class="mistake-card"><div><span class="mistake-tag ${statusClass(n.status)}">${esc(n.status||"Pending")}</span></div>
    <p><b>${esc(n.name)}</b></p><p>${esc(n.message)}</p>
    <p class="meta">Scheduled: ${esc(formatDateTime(n.scheduledAt))}${n.sentAt?` • Sent: ${esc(formatDateTime(n.sentAt))}`:""}</p>
    ${n.status==="Failed"?`<p class="note">Reason: ${esc(n.error||"Unknown error")}</p><div class="buttons"><button onclick="retryNotificationUI('${n.id}')">Retry</button></div>`:""}
    </div>`).join("")||'<p class="note">No notifications yet.</p>'}
  <div class="buttons"><button onclick="remindersPage()">Reminders</button><button onclick="home()">Subjects</button></div></div>`;
}
async function retryNotificationUI(id){
  const p=store.profile();const res=await apiPost("retryNotification",{email:p.email,id});
  const fresh=API?await apiGet("notifications",{email:p.email}):null;
  renderNotifications(fresh?.data||[]);
  if(!res?.ok)alert(res?.error||"Retry failed. Check your connection and try again.");
}

/* ===================== MY MISTAKES + REVISION ===================== */
async function mistakes(){
  clearExam();app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">Loading…</p></div>`;const p=store.profile(),res=API?await apiGet("mistakes",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">${API?"Could not load mistakes.":"Connect Apps Script first."}</p><button onclick="home()">Back</button></div>`;return;}
  store.setMistakesCache(res.data);renderMistakes(res.data);
}
function renderMistakes(items){
  const now=new Date();
  const due=items.filter(m=>dueDate(m)<=now);
  const next=items.filter(m=>dueDate(m)>now).sort((a,b)=>dueDate(a)-dueDate(b))[0];
  let countdown="";
  if(next){const ms=Math.max(0,dueDate(next)-now);countdown=`<div class="countdown"><b>Next revision test:</b> ${formatCountdown(ms)}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small></div>`;}
  app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="meta">Active mistakes: <b>${items.length}</b> • Due now: <b>${due.length}</b>. A mistake stays here until you answer it correctly.</p>${items.length?`${countdown}<div class="buttons"><button ${due.length?"":"disabled"} onclick="startRevisionTest()">Start revision test ${due.length?`(${due.length})`:"(not due yet)"}</button></div>${items.map(m=>{const isDue=dueDate(m)<=now;return `<div class="mistake-card"><div><span class="mistake-tag">${esc(m.subject)}</span> <span class="mistake-tag ${isDue?"tag-due":"tag-wait"}">${isDue?"Due now":"Due "+formatDateTime(m.revisionDueIso||m.revisionDueDate)}</span></div><p><b>${esc(m.question)}</b></p>${m.options.map((o,k)=>`<div>${"ABCD"[k]}. ${esc(o)} ${k===m.correctIndex?"<b class='correct'>(correct)</b>":""} ${k===m.selectedIndex?"<i>(last answer)</i>":""}</div>`).join("")}</div>`;}).join("")}`:'<p class="note">No active mistakes — excellent. 🎉</p>'}<div class="buttons"><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div></div>`;
  if(next)setTimeout(()=>mistakeCountdownLoop(),1000);
}
function formatCountdown(ms){let s=Math.ceil(ms/1000);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60),sec=s%60;return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(sec).padStart(2,"0")}s`;}
function mistakeCountdownLoop(){const el=document.querySelector(".countdown");if(!el)return;const items=store.mistakesCache(),next=items.filter(m=>dueDate(m)>new Date()).sort((a,b)=>dueDate(a)-dueDate(b))[0];if(!next){mistakes();return;}el.innerHTML=`<b>Next revision test:</b> ${formatCountdown(dueDate(next)-new Date())}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small>`;setTimeout(mistakeCountdownLoop,1000);}
async function startRevisionTest(){const items=store.mistakesCache().filter(m=>dueDate(m)<=new Date()&&!m.revised);if(!items.length){mistakes();return;}revisionMode=true;revisionItems=shuffle(items).map(m=>({...m,options:shuffle((m.options||[]).map((text,index)=>({text,index})))}));revisionItems=revisionItems.map(m=>{const order=m.options.map(x=>x.index),opts=m.options.map(x=>x.text);return {...m,options:opts,correctIndex:order.indexOf(Number(m.correctIndex)),optionOrder:order};});test=revisionItems.map(m=>({id:m.wrongId,year:m.year,state:m.state,questionNumber:m.questionNumber,question:m.question,options:m.options,answer:m.correctIndex,wrongId:m.wrongId}));answers=Array(test.length).fill(null);marked=Array(test.length).fill(false);qTime=Array(test.length).fill(0);current=0;left=test.length*60;/* 1 min/question, no extra time */examStartedAt=Date.now();questionStartedAt=Date.now();clearInterval(timer);timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el)el.textContent=clock(left);if(left<=0){left=0;submitRevisionTest();}},1000);window.addEventListener("beforeunload",handleRevisionBeforeUnload);window.addEventListener("pagehide",handleRevisionPageHide);armBackGuard();renderRevision();}
function sendRevisionAutoSubmit(){
  if(isSubmitting||!revisionMode||!revisionItems.length||!API)return false;
  const marker="ecet_revision_auto_submit_"+(revisionItems.map(x=>x.wrongId).join("|")||Date.now());
  if(sessionStorage.getItem(marker)==="1")return true;
  isSubmitting=true;
  commitTime();
  const p=store.profile();
  const payload={action:"submitRevision",email:p.email,items:revisionItems.map((m,i)=>({wrongId:m.wrongId,selected:answers[i],time:qTime[i]})),autoSubmitted:true};
  const body=JSON.stringify(payload);
  let accepted=false;
  try{if(navigator.sendBeacon)accepted=navigator.sendBeacon(API,new Blob([body],{type:"text/plain;charset=UTF-8"}));}catch(e){console.warn("Revision beacon failed",e);}
  if(!accepted){try{fetch(API,{method:"POST",body,keepalive:true});accepted=true;}catch(e){console.warn("Revision keepalive failed",e);}}
  if(accepted)sessionStorage.setItem(marker,"1");
  return accepted;
}
function handleRevisionBeforeUnload(e){
  if(isSubmitting||!revisionMode||!revisionItems.length)return;
  sendRevisionAutoSubmit();
  e.preventDefault();e.returnValue="Your revision test is still running. It will be submitted automatically.";return e.returnValue;
}
function handleRevisionPageHide(){if(!isSubmitting&&revisionMode&&revisionItems.length)sendRevisionAutoSubmit();}

function renderRevision(){const q=test[current],answered=answers.filter(x=>x!==null).length;app.innerHTML=`<div class="top"><h1>1-Day Revision Test</h1><div class="timer">${clock(left)}</div></div><div class="card"><div class="meta">Question ${current+1} of ${test.length} • Answered ${answered}/${test.length}</div><div class="question">${esc(q.question)}</div>${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" ${answers[current]===k?"checked":""} onchange="revisionChoose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}<div class="examfoot"><button onclick="revisionGo(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="revisionGo(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="submitRevisionTest()">Finish revision</button></div></div>`;}
function revisionChoose(v){answers[current]=v;renderRevision();}
function revisionGo(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();renderRevision();}
async function submitRevisionTest(){if(isSubmitting)return;isSubmitting=true;clearInterval(timer);window.removeEventListener("beforeunload",handleRevisionBeforeUnload);window.removeEventListener("pagehide",handleRevisionPageHide);disarmBackGuard();commitTime();const p=store.profile();const items=revisionItems.map((m,i)=>({wrongId:m.wrongId,selected:answers[i],time:qTime[i]}));app.innerHTML=`<div class="card"><h1>Checking revision…</h1><p class="note">Updating your mistakes.</p></div>`;const res=await apiPost("submitRevision",{email:p.email,items});if(res?.ok){const fresh=await apiGet("mistakes",{email:p.email});store.setMistakesCache(fresh?.data||[]);app.innerHTML=`<div class="card"><h1>Revision result</h1><div class="stats"><div class="stat"><b>${res.correct}</b>Correct</div><div class="stat"><b>${res.wrong}</b>Wrong again</div><div class="stat"><b>${res.unanswered}</b>Unanswered</div><div class="stat"><b>${(fresh?.data||[]).length}</b>Active mistakes</div></div><p class="note">Correct answers are removed from My Mistakes. Wrong or unanswered questions are scheduled again for 1 day.</p><div class="buttons"><button onclick="mistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div></div>`;}else{isSubmitting=false;app.innerHTML=`<div class="card"><h2>Could not save revision.</h2><button onclick="mistakes()">Back</button></div>`;}}

home();
