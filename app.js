/* ===================== ECET Quiz App ===================== */
const app = document.getElementById("app");
const API = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_URL) || "";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const TEST_TIME_PER_QUESTION=60;
const SITE_URL=window.APP_CONFIG?.SITE_URL || window.location.href.split("?")[0].split("#")[0];
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
let _afterProfile=null, examHistoryGuard=false;

function newSessionId(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+"-"+Math.random().toString(16).slice(2); }
function clearExam(){
  clearInterval(timer); timer=null;
  examHistoryGuard=false;
  window.removeEventListener("beforeunload",handleBeforeUnload);
  window.removeEventListener("pagehide",handlePageHide);
  window.removeEventListener("beforeunload",handleRevisionBeforeUnload);
  window.removeEventListener("pagehide",handleRevisionPageHide);
}
function persist(){
  if(!activeSubject||revisionMode)return;
  const p=store.profile();
  try{
    store.setProgress(activeSubject.id,{
      email:p?.email,answers,marked,qTime,current,left,examStartedAt,examSessionId,startedAt:examStartedAt,
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
  return {name:p.name,email:p.email,subject:activeSubject.name,subjectId:activeSubject.id,score,total:test.length,percentage,correct:score,wrong,unanswered,totalTime:Math.round((Date.now()-examStartedAt)/1000),detail,examSessionId,testUrl:testUrl(activeSubject.id),revisionTestUrl:SITE_URL+"?revision=1",autoSubmitted:!!compact};
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
  e.preventDefault();
  e.returnValue="Exam is in progress. Do you want to go back? Your test will be submitted automatically.";
  return e.returnValue;
}
function handlePageHide(){
  if(isSubmitting||revisionMode||!activeSubject||!test.length||left<=0)return;
  persist();
}

window.addEventListener("popstate",()=>{if(isSubmitting||!test.length)return;if(!revisionMode&&activeSubject&&left>0){const ok=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");if(ok){submit();}else{history.pushState({examActive:true},"",location.href);}}else if(revisionMode&&revisionItems.length){const ok=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");if(ok){submitRevisionTest();}else{history.pushState({examActive:true},"",location.href);}}});

/* ===================== HOME ===================== */
async function home(){
  clearExam(); isSubmitting=false; revisionMode=false;
  if(!subjects.length) subjects=await fetch("subjects.json").then(r=>r.json());
  const p=store.profile();
  app.innerHTML=`<div class="home"><h1>ECET Online Test</h1><p class="subtitle">Choose a subject. Test time is 1 minute per question.</p>
    <div class="home-nav"><button onclick="goDashboard()">My Dashboard</button><button onclick="goMistakes()">My Mistakes</button>${p?`<button onclick="editProfile()">${esc(p.name)}</button>`:""}</div>
    <div class="subject-grid">${subjects.map((s,i)=>`<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${s.available?"Questions available":"Question bank coming soon"}</p><button ${s.available?`onclick="openPassword(${i})"`:"disabled"}>${s.available?"Take Test":"Coming Soon"}</button></div>`).join("")}</div>
  </div>`;
}
function editProfile(){const p=store.profile()||{name:"",email:""};app.innerHTML=`<div class="card enroll-card"><h1>Your details</h1><label>Name</label><input id="pname" value="${esc(p.name)}"><label>Email</label><input id="pemail" type="email" value="${esc(p.email)}"><div id="pErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div></div>`;}
function saveProfileEdit(){const n=document.getElementById("pname").value.trim(),e=document.getElementById("pemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("pErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});async function routeFromUrl(){
  const params=new URLSearchParams(location.search),id=params.get("subject"),revision=params.get("revision")==="1";
  if(!subjects.length) subjects=await fetch("subjects.json").then(r=>r.json()).catch(()=>[]);
  if(revision){
    if(!store.profile()){_afterProfile=()=>{mistakes().then(()=>startRevisionTest());};requireProfile(_afterProfile);return;}
    await mistakes();
    startRevisionTest();
    return;
  }
  if(!id){home();return;}
  const i=subjects.findIndex(x=>x.id===id);
  if(i<0||!subjects[i].available){home();return;}
  openPassword(i);
}
routeFromUrl();}

/* ===================== PASSWORD ===================== */
function openPassword(i){const s=subjects[i];app.innerHTML=`<div class="card password-card"><h1>${esc(s.name)}</h1><p>Enter the subject password.</p><input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword(${i})"><div id="passError" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword(${i})">Continue</button></div></div>`;document.getElementById("password").focus();}
async function checkPassword(i){const s=subjects[i],v=document.getElementById("password").value;if(v!==String(s.password)){document.getElementById("passError").textContent="Incorrect password.";return;}try{bank=await fetch(s.file).then(r=>r.json());}catch(e){bank=[];}if(!bank.length){app.innerHTML=`<div class="card"><h2>Question bank not available.</h2><button onclick="home()">Back</button></div>`;return;}activeSubject=s;enroll();}
function enroll(){const p=store.profile();const preview=`<div class="test-summary"><b>Test Name:</b> ${esc(activeSubject.name)}<br><b>Subject:</b> ${esc(activeSubject.name)}<br><b>Number of Questions:</b> ${bank.length}<br><b>Total Time:</b> ${clock(bank.length*TEST_TIME_PER_QUESTION)}</div>`;if(p){app.innerHTML=`<div class="card enroll-card"><h1>Start Test</h1>${preview}<p>Continue as <b>${esc(p.name)}</b> (${esc(p.email)})?</p><div class="buttons"><button onclick="home()">Back</button><button onclick="beginExam()">Take Test</button></div></div>`;return;}app.innerHTML=`<div class="card enroll-card"><h1>Start Test</h1>${preview}<p>Enter your name and email.</p><label>Name</label><input id="ename" placeholder="Full name"><label>Email</label><input id="eemail" type="email" placeholder="you@example.com"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitEnroll()">Take Test</button></div></div>`;}
function submitEnroll(){const n=document.getElementById("ename").value.trim(),e=document.getElementById("eemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("eErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});beginExam();}
async function beginExam(){const p=store.profile();apiPost("register",{name:p.name,email:p.email,subject:activeSubject.name,testUrl:testUrl(activeSubject.id)});start();}
function testUrl(subjectId){return SITE_URL+"?subject="+encodeURIComponent(subjectId);}

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
  persist();render();
  if(!examHistoryGuard){history.pushState({examActive:true},"",location.href);examHistoryGuard=true;}
  timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el){el.textContent=clock(left);el.classList.toggle("low",left<=60);}persist();if(left<=0){left=0;submit();}},1000);
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
  answers=Array(test.length).fill(null);marked=Array(test.length).fill(false);qTime=Array(test.length).fill(0);current=0;left=test.length*TEST_TIME_PER_QUESTION;examStartedAt=Date.now();examSessionId=newSessionId();
}
function choose(v){answers[current]=v;persist();render();}
function toggleReview(){marked[current]=!marked[current];persist();render();}
function go(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();persist();render();}
function restartExam(){if(confirm("Restart this exam? Your current answers will be cleared.")){store.clearProgress(activeSubject.id);start();}}
function confirmSubmit(){const answered=answers.filter(x=>x!==null).length,u=test.length-answered;if(!confirm(`Before submission: ${answered} answered, ${u} unanswered. Do you want to submit your test?`))return;submit();}
function render(){const q=test[current],answered=answers.filter(x=>x!==null).length,unanswered=test.length-answered,markedCount=marked.filter(Boolean).length;app.innerHTML=`<div class="top"><h1>ECET ${esc(activeSubject.name)}</h1><div class="timer ${left<=60?"low":""}">${clock(left)}</div></div><div class="card"><div class="meta"><span>Question ${current+1} of ${test.length} • ${esc(q.year)} ${esc(q.state)} • PYQ ${esc(q.questionNumber)}</span><span>Answered <b>${answered}</b> • Unanswered <b>${unanswered}</b> • Review <b>${markedCount}</b></span></div><div class="question">${esc(q.question)}</div>${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" name="answer" ${answers[current]===k?"checked":""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}<button class="review-toggle ${marked[current]?"active":""}" onclick="toggleReview()">${marked[current]?"★ Marked for review":"☆ Mark for Review"}</button><div class="palette-legend"><span>⬜ Unanswered</span><span>🟩 Answered</span><span>🟨 Marked for review</span></div><div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${marked[k]?"review":""} ${k===current?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div><div class="examfoot"><button onclick="go(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="toggleReview()">${marked[current]?"Unmark":"Mark for Review"}</button><button onclick="go(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" id="submitBtn" onclick="confirmSubmit()">Submit Test</button></div></div>`;}

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
  clearExam(); isSubmitting=false;app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">Loading…</p></div>`;const p=store.profile(),res=API?await apiGet("dashboard",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">${API?"Could not load dashboard.":"Connect Apps Script in config.js first."}</p><button onclick="home()">Back</button></div>`;return;}
  const d=res.data;
  app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="meta">${esc(p.name)} • ${esc(p.email)}</p><div class="dash-grid"><div class="dash-tile"><b>${d.attempts}</b><span>Tests taken</span></div><div class="dash-tile"><b>${d.avgPercentage}%</b><span>Average %</span></div><div class="dash-tile"><b>${d.bestPercentage}%</b><span>Best %</span></div><div class="dash-tile"><b>${d.weakCount}</b><span>Active mistakes</span></div></div>
    ${d.strongest?`<div class="advice good"><b>Strongest subject:</b> ${esc(d.strongest.subject)} — ${d.strongest.avgPercentage}% average.</div>`:""}${d.weakest?`<div class="advice weak"><b>Needs more practice:</b> ${esc(d.weakest.subject)} — ${d.weakest.avgPercentage}% average.</div>`:""}
    <h2>Subject-wise performance</h2>${d.subjectPerformance.map(s=>`<div class="subjbar-row"><div class="subjbar-label">${esc(s.subject)}</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${Math.min(100,s.avgPercentage)}%"></div></div><div>${s.avgPercentage}%</div></div>`).join("")||'<p class="note">No attempts yet.</p>'}
    <h2>Test history</h2><div class="table-scroll"><table class="simple"><tr><th>Date</th><th>Subject</th><th>Score</th><th>%</th><th>Equivalent /200</th><th>Expected AP Rank</th><th>Current Practice Rank</th></tr>${d.history.map(h=>`<tr><td>${esc(h.date)}</td><td>${esc(h.subject)}</td><td>${h.score}/${h.total}</td><td>${h.percentage}%</td><td>${h.equivalentMarks}</td><td>${esc(h.expectedRank)}</td><td>${h.currentRank?`#${h.currentRank} / ${h.currentRankOutOf}`:"—"}</td></tr>`).join("")||'<tr><td colspan="7">No attempts yet.</td></tr>'}</table></div>
    <div class="buttons"><button onclick="goMistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div></div>`;
}

/* ===================== MY MISTAKES + REVISION ===================== */
async function mistakes(){
  clearExam(); isSubmitting=false;app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">Loading…</p></div>`;const p=store.profile(),res=API?await apiGet("mistakes",{email:p.email}):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">${API?"Could not load mistakes.":"Connect Apps Script first."}</p><button onclick="home()">Back</button></div>`;return;}
  store.setMistakesCache(res.data);renderMistakes(res.data);
}
function renderMistakes(items){
  const now=new Date();
  const due=items.filter(m=>dueDate(m)<=now);
  const next=items.filter(m=>dueDate(m)>now).sort((a,b)=>dueDate(a)-dueDate(b))[0];
  let countdown="";
  if(next){const ms=Math.max(0,dueDate(next)-now);countdown=`<div class="countdown"><b>Next revision test:</b> ${formatCountdown(ms)}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small></div>`;}
  app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="meta">Active mistakes: <b>${items.length}</b> • Due now: <b>${due.length}</b>. A mistake stays here until you answer it correctly.</p>${items.length?`${countdown}<div class="buttons"><button ${due.length?"":"disabled"} onclick="startRevisionTest()">Take Revision Test ${due.length?`(${due.length})`:"(not due yet)"}</button></div>${items.map(m=>{const isDue=dueDate(m)<=now;return `<div class="mistake-card"><div><span class="mistake-tag">${esc(m.subject)}</span> <span class="mistake-tag">${m.mistakeType==="unattempted"?"Unattempted":"Wrong"}</span> <span class="mistake-tag ${isDue?"tag-due":"tag-wait"}">${isDue?"Due now":"Due "+formatDateTime(m.revisionDueIso||m.revisionDueDate)}</span></div><p><b>${esc(m.question)}</b></p>${m.options.map((o,k)=>`<div>${"ABCD"[k]}. ${esc(o)} ${k===m.correctIndex?"<b class='correct'>(correct)</b>":""} ${k===m.selectedIndex?"<i>(last answer)</i>":""}</div>`).join("")}</div>`;}).join("")}`:'<p class="note">No active mistakes — excellent. 🎉</p>'}<div class="buttons"><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div></div>`;
  if(next)setTimeout(()=>mistakeCountdownLoop(),1000);
}
function formatCountdown(ms){let s=Math.ceil(ms/1000);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60),sec=s%60;return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(sec).padStart(2,"0")}s`;}
function mistakeCountdownLoop(){const el=document.querySelector(".countdown");if(!el)return;const items=store.mistakesCache(),next=items.filter(m=>dueDate(m)>new Date()).sort((a,b)=>dueDate(a)-dueDate(b))[0];if(!next){mistakes();return;}el.innerHTML=`<b>Next revision test:</b> ${formatCountdown(dueDate(next)-new Date())}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small>`;setTimeout(mistakeCountdownLoop,1000);}
async function startRevisionTest(){
  const items=store.mistakesCache().filter(m=>dueDate(m)<=new Date()&&!m.revised);
  if(!items.length){mistakes();return;}
  revisionMode=true;
  const saved=store.getProgress("revision"),p=store.profile();
  const byId=new Map(items.map(m=>[String(m.wrongId),m]));
  let selectedItems=items;
  if(saved&&saved.email===p?.email&&saved.left>0&&Array.isArray(saved.revisionIds)&&saved.revisionIds.length===items.length&&saved.revisionIds.every(id=>byId.has(String(id)))) selectedItems=saved.revisionIds.map(id=>byId.get(String(id)));
  const resumeRevision= saved&&saved.email===p?.email&&saved.left>0&&Array.isArray(saved.revisionIds)&&saved.revisionIds.length===items.length&&saved.revisionIds.every(id=>byId.has(String(id)))&&Array.isArray(saved.optionOrders)&&saved.optionOrders.length===selectedItems.length;
  revisionItems=selectedItems.map((m,i)=>{
    if(resumeRevision&&Array.isArray(saved.optionOrders[i])&&saved.optionOrders[i].length===m.options.length){
      const order=saved.optionOrders[i];
      const opts=order.map(x=>m.options[x]);
      if(opts.every(x=>x!==undefined)) return {...m,options:opts,optionOrder:order.slice(),correctIndex:order.indexOf(Number(m.correctIndex))};
    }
    const pairs=shuffle((m.options||[]).map((text,index)=>({text,index}))),order=pairs.map(x=>x.index);
    return {...m,options:pairs.map(x=>x.text),optionOrder:order,correctIndex:order.indexOf(Number(m.correctIndex))};
  });
  test=revisionItems.map(m=>({id:m.wrongId,year:m.year,state:m.state,questionNumber:m.questionNumber,question:m.question,options:m.options,answer:m.correctIndex,wrongId:m.wrongId,optionOrder:m.optionOrder}));
  const resume= saved&&saved.email===p?.email&&saved.left>0&&saved.answers?.length===test.length&&saved.revisionIds?.length===test.length;
  answers=resume?saved.answers:Array(test.length).fill(null);marked=resume&&Array.isArray(saved.marked)?saved.marked:Array(test.length).fill(false);qTime=resume&&Array.isArray(saved.qTime)?saved.qTime:Array(test.length).fill(0);current=resume?Math.max(0,Math.min(test.length-1,saved.current||0)):0;left=resume?saved.left:test.length*TEST_TIME_PER_QUESTION;examStartedAt=resume?saved.examStartedAt:Date.now();examSessionId=resume?(saved.examSessionId||newSessionId()):newSessionId();questionStartedAt=Date.now();isSubmitting=false;saveTick=0;persistRevision();clearInterval(timer);timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el)el.textContent=clock(left);persistRevision();if(left<=0){left=0;submitRevisionTest();}},1000);window.addEventListener("beforeunload",handleRevisionBeforeUnload);window.addEventListener("pagehide",handleRevisionPageHide);renderRevision();
}
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
  persistRevision();
  e.preventDefault();e.returnValue="Exam is in progress. Do you want to go back? Your test will be submitted automatically.";return e.returnValue;
}
function handleRevisionPageHide(){if(!isSubmitting&&revisionMode&&revisionItems.length)persistRevision();}

function renderRevision(){const q=test[current],answered=answers.filter(x=>x!==null).length,unanswered=test.length-answered,reviewed=marked.filter(Boolean).length;app.innerHTML=`<div class="top"><h1>Revision Test — ${esc(activeSubject?.name||"Mistakes")}</h1><div class="timer ${left<=60?"low":""}">${clock(left)}</div></div><div class="card"><div class="meta">Question ${current+1} of ${test.length} • Answered <b>${answered}</b> • Unanswered <b>${unanswered}</b> • Review <b>${reviewed}</b></div><div class="question">${esc(q.question)}</div>${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" name="revisionAnswer" ${answers[current]===k?"checked":""} onchange="revisionChoose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}<button class="review-toggle ${marked[current]?"active":""}" onclick="toggleRevisionReview()">${marked[current]?"★ Marked for review":"☆ Mark for Review"}</button><div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${marked[k]?"review":""} ${k===current?"current":""}" onclick="revisionGo(${k})">${k+1}</button>`).join("")}</div><div class="examfoot"><button onclick="revisionGo(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="toggleRevisionReview()">${marked[current]?"Unmark":"Mark for Review"}</button><button onclick="revisionGo(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="confirmRevisionSubmit()">Submit Test</button></div></div>`;}
function toggleRevisionReview(){marked[current]=!marked[current];persistRevision();renderRevision();}
function confirmRevisionSubmit(){const a=answers.filter(x=>x!==null).length,u=test.length-a;if(confirm(`Before submission: ${a} answered, ${u} unanswered. Do you want to submit this revision test?`))submitRevisionTest();}
function revisionChoose(v){answers[current]=v;persistRevision();renderRevision();}
function persistRevision(){try{store.setProgress("revision",{email:store.profile()?.email,answers,marked,qTime,current,left,examStartedAt,examSessionId,revisionIds:revisionItems.map(x=>x.wrongId),optionOrders:test.map(q=>q.optionOrder||q.options.map((_,i)=>i)),savedAt:Date.now()});}catch(e){console.warn(e);}}
function revisionGo(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();persistRevision();renderRevision();}
async function submitRevisionTest(){
  if(isSubmitting)return;
  isSubmitting=true;clearInterval(timer);window.removeEventListener("beforeunload",handleRevisionBeforeUnload);window.removeEventListener("pagehide",handleRevisionPageHide);commitTime();
  const p=store.profile(),items=revisionItems.map((m,i)=>({wrongId:m.wrongId,selected:answers[i],time:qTime[i]}));
  const totalTime=Math.round((Date.now()-examStartedAt)/1000),answered=answers.filter(x=>x!==null).length,unanswered=test.length-answered;
  app.innerHTML=`<div class="card"><h1>Submitting revision test…</h1><p class="note">Saving your answers. Please wait.</p></div>`;
  const res=await apiPost("submitRevision",{email:p.email,items});
  if(res?.ok){
    store.clearProgress("revision");
    const fresh=await apiGet("mistakes",{email:p.email});store.setMistakesCache(fresh?.data||[]);
    const correct=Number(res.correct)||0,wrong=Number(res.wrong)||0;
    const detail=revisionItems.map((m,i)=>({question:m.question,selected:answers[i],correct:m.correctIndex,options:m.options,time:qTime[i],marked:marked[i]}));
    window._lastResultDetail=detail;
    app.innerHTML=`<div class="card"><h1>Revision Result</h1><div class="stats"><div class="stat"><b>${correct}/${test.length}</b>Score</div><div class="stat"><b>${correct}</b>Correct</div><div class="stat"><b>${wrong}</b>Wrong</div><div class="stat"><b>${unanswered}</b>Unattempted</div><div class="stat"><b>${clock(totalTime)}</b>Total Time</div><div class="stat"><b>${(fresh?.data||[]).length}</b>Active Mistakes</div></div><h2>Question-wise time analysis</h2>${timeChart(detail)}<p class="note">Correct mistakes are removed from My Mistakes. Wrong and unattempted mistakes remain scheduled for revision.</p><div class="buttons"><button onclick="mistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div></div>`;
  }else{
    isSubmitting=false;
    persistRevision();
    app.innerHTML=`<div class="card"><h2>Could not save revision test</h2><p class="note">Your answers are still saved on this device. Check your internet connection and try again.</p><div class="buttons"><button onclick="submitRevisionTest()">Try again</button><button onclick="mistakes()">My Mistakes</button></div></div>`;
  }
}

async function routeFromUrl(){
  const params=new URLSearchParams(location.search),id=params.get("subject"),revision=params.get("revision")==="1";
  if(!subjects.length) subjects=await fetch("subjects.json").then(r=>r.json()).catch(()=>[]);
  if(revision){
    if(!store.profile()){_afterProfile=()=>{mistakes().then(()=>startRevisionTest());};requireProfile(_afterProfile);return;}
    await mistakes();
    startRevisionTest();
    return;
  }
  if(!id){home();return;}
  const i=subjects.findIndex(x=>x.id===id);
  if(i<0||!subjects[i].available){home();return;}
  openPassword(i);
}
routeFromUrl();