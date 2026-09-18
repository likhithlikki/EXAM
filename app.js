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
const imgHTML = (url,cls) => url ? `<img src="${esc(url)}" class="${cls||"q-img"}" loading="lazy" onerror="this.style.display='none'">` : "";
const connBannerHTML = () => '<div id="connBanner" class="note" style="margin-bottom:10px">🔄 Connecting… showing your last saved data.</div>';

const store = {
  profile:()=>JSON.parse(localStorage.getItem("ecet_profile")||"null"),
  setProfile:p=>localStorage.setItem("ecet_profile",JSON.stringify(p)),
  progressKey:id=>"ecet_progress_"+id,
  getProgress:id=>JSON.parse(localStorage.getItem(store.progressKey(id))||"null"),
  setProgress:(id,data)=>localStorage.setItem(store.progressKey(id),JSON.stringify(data)),
  clearProgress:id=>localStorage.removeItem(store.progressKey(id)),
  mistakesCache:()=>JSON.parse(localStorage.getItem("ecet_mistakes_cache")||"[]"),
  setMistakesCache:a=>localStorage.setItem("ecet_mistakes_cache",JSON.stringify(a)),
  dashboardCache:()=>JSON.parse(localStorage.getItem("ecet_dashboard_cache")||"null"),
  setDashboardCache:d=>localStorage.setItem("ecet_dashboard_cache",JSON.stringify(d)),
  remindersCache:()=>JSON.parse(localStorage.getItem("ecet_reminders_cache")||"[]"),
  setRemindersCache:a=>localStorage.setItem("ecet_reminders_cache",JSON.stringify(a)),
  customSubjectsCache:()=>JSON.parse(localStorage.getItem("ecet_customsubjects_cache")||"[]"),
  setCustomSubjectsCache:a=>localStorage.setItem("ecet_customsubjects_cache",JSON.stringify(a)),
  profileDataCache:()=>JSON.parse(localStorage.getItem("ecet_profiledata_cache")||"null"),
  setProfileDataCache:d=>localStorage.setItem("ecet_profiledata_cache",JSON.stringify(d))
};

/* ===================== GLOBAL LOADING INDICATOR ===================== */
// Every apiGet/apiPost call already funnels through loadingShow()/loadingHide(),
// so toggling a body-level class here is enough to fade + disable every button
// on screen (even ones re-rendered mid-request) without touching each call site.
let _loadingCount=0;
function loadingShow(){
  _loadingCount++;
  const bar=document.getElementById("loadBar");
  if(bar)bar.classList.add("active");
  document.body.classList.add("app-busy");
}
function loadingHide(){
  _loadingCount=Math.max(0,_loadingCount-1);
  if(_loadingCount===0){
    const bar=document.getElementById("loadBar");
    if(bar)bar.classList.remove("active");
    document.body.classList.remove("app-busy");
  }
}

/* ===================== NETWORK LAYER =====================
   Apps Script backends largely serialize requests rather than truly running
   them in parallel, so firing many GETs "at once" from the browser just makes
   them queue behind each other until each one individually times out. This
   layer fixes that on the client side with three things:
   1. In-flight de-duplication: two callers asking for the same action+params
      at the same time share one network call instead of firing two.
   2. A small concurrency gate (max 2 requests in flight to the backend at a
      time) so bursts (e.g. Home's startup calls) queue client-side instead
      of all hitting Apps Script together and each blowing its own timeout.
   3. Backoff before retrying, instead of retrying instantly into a backend
      that's already behind. */
const _inFlightGET=new Map();
let _activeRequests=0;
const _requestQueue=[];
const MAX_CONCURRENT_REQUESTS=2;
function _runQueued(){
  if(_activeRequests>=MAX_CONCURRENT_REQUESTS||!_requestQueue.length)return;
  _activeRequests++;
  const job=_requestQueue.shift();
  job().finally(()=>{_activeRequests--;_runQueued();});
}
function _enqueue(job){
  return new Promise((resolve)=>{
    _requestQueue.push(()=>job().then(resolve,()=>resolve(null)));
    _runQueued();
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function apiGet(action,params={},timeoutMs=12000,retries=1){
  if(!API)return null;
  const key=action+"?"+new URLSearchParams(params).toString();
  if(_inFlightGET.has(key))return _inFlightGET.get(key); // de-dupe identical concurrent calls
  const promise=_enqueue(()=>_doGet(action,params,timeoutMs,retries))
    .finally(()=>_inFlightGET.delete(key));
  _inFlightGET.set(key,promise);
  return promise;
}
async function _doGet(action,params,timeoutMs,retries){
  for(let attempt=0;attempt<=retries;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    loadingShow();
    try{
      const r=await fetch(API+"?"+new URLSearchParams({action,...params}),{method:"GET",cache:"no-store",signal:controller.signal});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){
      console.warn("GET "+action+" failed (attempt "+(attempt+1)+"/"+(retries+1)+"):",e);
      if(attempt===retries)return null;
      await sleep(600*(attempt+1)); // backoff before retrying into a possibly-overloaded backend
    }finally{clearTimeout(timer);loadingHide();}
  }
}
async function apiPost(action,payload={},timeoutMs=15000){
  if(!API)return null;
  return _enqueue(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    loadingShow();
    try{
      const r=await fetch(API,{method:"POST",body:JSON.stringify({action,...payload}),cache:"no-store",signal:controller.signal});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){console.warn("POST "+action+" failed:",e);return null;}
    finally{clearTimeout(timer);loadingHide();}
  });
}

/* ===================== BACK NAVIGATION STACK =====================
   Every top-level "page" function pushes itself here as it renders. The
   top-left Back button pops the current page, then re-renders whatever
   came before it (which pushes itself again). During an active exam or
   revision test it defers to the same leave-confirmation used by Home. */
let navStack=[];
function pushNav(fn){
  if(navStack[navStack.length-1]!==fn)navStack.push(fn);
  if(navStack.length>40)navStack.shift();
  // Back button visibility is driven explicitly by "is this Home?" rather
  // than stack depth (which was fragile — e.g. depth could be >1 while
  // still logically on Home after certain navigation sequences).
  const btn=document.getElementById("backFab");
  if(btn)btn.style.display=(fn!==home)?"flex":"none";
}
function replaceNav(fn){
  // Like pushNav, but replaces the current top-of-stack entry instead of
  // stacking on top of it — used when a screen (e.g. the admin password
  // prompt) is logically "consumed" by what comes next, so Back skips it.
  if(navStack.length)navStack.pop();
  pushNav(fn);
}
function goBack(){
  const inExam=activeSubject&&test.length&&!isSubmitting&&left>0&&!revisionMode;
  const inRevision=revisionMode&&revisionItems.length&&!isSubmitting;
  if(inExam||inRevision){safeGoHome();return;}
  navStack.pop();
  const prev=navStack.pop();
  (prev||home)();
}

let subjects=[],customSubjects=[],bank=[],test=[],answers=[],marked=[],qTime=[];
let current=0,left=0,timer=null,questionStartedAt=0,examStartedAt=0,activeSubject=null,saveTick=0,isSubmitting=false;
let examSessionId="";
let revisionMode=false, revisionItems=[];
let _afterProfile=null;
let isAdminUnlocked=localStorage.getItem("ecet_admin_unlocked")==="1";
const ADMIN_PANEL_PASSWORD=(window.APP_CONFIG&&window.APP_CONFIG.ADMIN_PANEL_PASSWORD)||"123";

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
function safeGoHome(){
  const inExam=activeSubject&&test.length&&!isSubmitting&&left>0&&!revisionMode;
  const inRevision=revisionMode&&revisionItems.length&&!isSubmitting;
  if(inExam||inRevision){
    const leave=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");
    if(!leave)return;
    if(inRevision)submitRevisionTest();else submit();
    return;
  }
  home();
}
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
    if(!compact || isWrong){ d.question=q.question; d.options=q.options; d.image=q.image||""; d.optionImages=q.optionImages||[]; }
    return d;
  });
  const score=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)===Number(d.correct)).length;
  const wrong=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)!==Number(d.correct)).length;
  const unanswered=detail.filter(d=>d.selected===null||d.selected===undefined).length;
  const percentage=test.length?Math.round(score/test.length*1000)/10:0;
  return {name:p.name,email:p.email,subject:activeSubject.name,subjectId:activeSubject.id,score,total:test.length,percentage,correct:score,wrong,unanswered,totalTime:Math.round((Date.now()-examStartedAt)/1000),startTime:new Date(examStartedAt).toISOString(),testUrl:(window.APP_CONFIG&&window.APP_CONFIG.SITE_URL)||location.href.split("#")[0],detail,examSessionId,autoSubmitted:!!compact};
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
function customSubjectsHTML(){
  return customSubjects.length?customSubjects.map((s,i)=>{
    const unfinished=store.getProgress(s.id);
    const hasQuestions=s.questionCount===undefined?true:s.questionCount>0; // older cached data has no count yet — don't hide it
    if(!hasQuestions){
      return `<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${s.description?esc(s.description):"Question bank coming soon"}</p><button disabled>Coming Soon</button></div>`;
    }
    const best=subjectBest(s.name);
    const meta=`${s.questionCount} Questions • ${s.questionCount} min • Best: ${best!=null?best+"%":"—"}`;
    return `<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${s.description?esc(s.description)+"<br>"+meta:(unfinished?"Test in progress — resume any time<br>"+meta:meta)}</p><button onclick="openCustomPassword(${i})">${unfinished?"Resume Exam":"Open Exam"}</button>${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;
  }).join(""):'<p class="note">No custom tests added yet. An admin can add one from the Admin page.</p>';
}
async function home(){
  pushNav(home);
  clearExam(); revisionMode=false;
  // Render instantly from whatever we already know (static subject list + last cached
  // custom subjects) instead of waiting on the network — the network refresh below then
  // patches the page in place, so clicking Home never looks stuck or "broken".
  if(!subjects.length){try{subjects=await fetch("subjects.json").then(r=>r.json());}catch(e){subjects=subjects||[];}}
  customSubjects=store.customSubjectsCache();
  const p=store.profile();
  app.innerHTML=`<div class="home"><div class="home-titlebar"><h1>Online Mock Test</h1><button id="hardRefreshBtn" onclick="hardRefresh()" title="Clear local cache and reload">⟳ Refresh Data</button></div><p class="subtitle">${homeSubtitle()}</p>
    <div class="home-nav"><button onclick="goDashboard()">My Dashboard</button><button onclick="goMistakes()">My Mistakes</button><button onclick="goReminders()">Request Reminder</button><span id="adminNavSlot"><button onclick="openAdminPassword()">Admin</button></span>${p?`<button onclick="goProfile()">👤 My Profile</button>`:""}</div><div id="serverStatus" class="server-status checking"><span class="server-dot"></span><span>Checking server…</span></div>
    <div class="subject-grid">${subjects.map((s,i)=>{const unfinished=s.available&&store.getProgress(s.id);return `<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${subjectCardMeta(s)}</p><button ${s.available?`onclick="openPassword(${i})"`:"disabled"}>${s.available?(unfinished?"Resume Exam":"Open Exam"):"Coming Soon"}</button>${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;}).join("")}</div>
    <h2 style="margin-top:34px">Practice Tests Added by Admin <button class="icon-btn" onclick="refreshCustomSubjects(true)" title="Refresh practice tests">↻</button></h2>
    <p class="subtitle">Custom subjects created directly from the Admin panel — no code or GitHub changes needed.</p>
    <div class="subject-grid" id="customSubjectGrid">${customSubjectsHTML()}</div>
  </div>`;
  checkServerStatusAndBundle();
  handleRevisionLink();
}
function homeSubtitle(){
  const total=subjects.length+customSubjects.length;
  const hist=store.dashboardCache();
  const practiced=hist?.attempts;
  if(practiced!==undefined&&practiced!==null)return `${total} subjects available • ${practiced} question${practiced===1?"":"s"} practiced so far`;
  return `${total} subjects available — pick one to begin practicing.`;
}
function subjectCardMeta(s){
  const unfinished=s.available&&store.getProgress(s.id);
  if(!s.available)return "Question bank coming soon";
  const count=s.questionCount;
  const mins=count?count:50;
  const best=subjectBest(s.name);
  const bits=[];
  if(count)bits.push(`${count} Questions`);
  bits.push(`${mins} min`);
  bits.push(best!=null?`Best: ${best}%`:"Best: —");
  return unfinished?`Test in progress — resume any time<br>${bits.join(" • ")}`:bits.join(" • ");
}
function subjectBest(name){
  const d=store.dashboardCache();
  const row=d?.subjects?.find(x=>x.subject===name);
  return row?row.best:null;
}
function hardRefresh(){
  if(!confirm("Clear locally cached data and reload fresh from the server?"))return;
  ["ecet_dashboard_cache","ecet_profiledata_cache","ecet_mistakes_cache","ecet_reminders_cache","ecet_customsubjects_cache"].forEach(k=>localStorage.removeItem(k));
  location.reload();
}
async function refreshCustomSubjects(manual){
  if(!API)return;
  const iconBtn=manual?document.querySelector('.icon-btn'):null;
  if(iconBtn){iconBtn.disabled=true;iconBtn.classList.add('spinning');}
  try{
    const cs=await apiGet("customSubjects",{},7000);
    if(cs?.ok&&Array.isArray(cs.data)){
      customSubjects=cs.data;
      store.setCustomSubjectsCache(cs.data);
      const grid=document.getElementById("customSubjectGrid");
      if(grid)grid.innerHTML=customSubjectsHTML();
    }
  }catch(e){console.warn("Custom subjects load failed",e);}
  finally{if(iconBtn){iconBtn.disabled=false;iconBtn.classList.remove('spinning');}}
}
// Replaces the old 3-way burst (ping + isAdmin + customSubjects fired
// separately and concurrently) with one Apps Script execution, so Home
// makes a single round trip instead of piling three onto the backend at once.
// Cached for SERVER_STATUS_TTL_MS so navigating Home <-> Dashboard <-> Mistakes
// repeatedly doesn't re-check the server (and re-flash "Checking server...")
// on every single visit — only the first Home visit in a while pays for it.
let _serverStatusCache=null; // {online,isAdmin,customSubjects,checkedAt}
const SERVER_STATUS_TTL_MS=3*60*1000;
function applyServerStatus_(status,statusEl,slot){
  if(statusEl){statusEl.className='server-status '+(status.online?'online':'offline');statusEl.innerHTML=`<span class="server-dot"></span><span>${status.online?'Server online':'Server offline — retry'}</span>`;}
  if(status.isAdmin&&!isAdminUnlocked&&slot)slot.innerHTML='<button onclick="adminQuestionsPage()">Admin: Add Questions</button>';
  if(Array.isArray(status.customSubjects)){
    customSubjects=status.customSubjects;
    store.setCustomSubjectsCache(customSubjects);
    const grid=document.getElementById("customSubjectGrid");
    if(grid)grid.innerHTML=customSubjectsHTML();
  }
}
async function checkServerStatusAndBundle(force){
  const statusEl=document.getElementById('serverStatus');
  const slot=document.getElementById('adminNavSlot');
  if(!API){if(statusEl){statusEl.className='server-status offline';statusEl.innerHTML='<span class="server-dot"></span><span>Server offline — API not configured</span>';}return;}
  const fresh=_serverStatusCache&&(Date.now()-_serverStatusCache.checkedAt<SERVER_STATUS_TTL_MS);
  if(fresh&&!force){applyServerStatus_(_serverStatusCache,statusEl,slot);return;}
  if(statusEl){statusEl.className='server-status checking';statusEl.innerHTML='<span class="server-dot"></span><span>Checking server…</span>';}
  if(isAdminUnlocked&&slot)slot.innerHTML='<button onclick="adminQuestionsPage()">Admin: Add Questions</button>';
  const p=store.profile();
  const res=await apiGet('homeBundle',p?{email:p.email}:{},7000);
  if(res?.ok){
    _serverStatusCache={online:true,isAdmin:!!res.data?.isAdmin,customSubjects:Array.isArray(res.data?.customSubjects)?res.data.customSubjects:customSubjects,checkedAt:Date.now()};
    applyServerStatus_(_serverStatusCache,statusEl,slot);
  }else{
    _serverStatusCache={online:false,isAdmin:isAdminUnlocked,customSubjects,checkedAt:Date.now()};
    if(statusEl){statusEl.className='server-status offline';statusEl.innerHTML='<span class="server-dot"></span><span>Server offline — retry</span>';}
  }
}
function handleRevisionLink(){
  const params=new URLSearchParams(location.search);
  if(params.get('revision')!=='1')return;
  history.replaceState({},'',location.pathname+location.hash);
  requireProfile(async ()=>{
    await mistakes();
    const items=store.mistakesCache().filter(m=>dueDate(m)<=new Date()&&!m.revised);
    if(items.length)startRevisionTest();
  });
}
function editProfile(){pushNav(editProfile);const p=store.profile()||{name:"",email:""};app.innerHTML=`<div class="card enroll-card"><h1>Your details</h1><label>Name</label><input id="pname" value="${esc(p.name)}"><label>Email</label><input id="pemail" type="email" value="${esc(p.email)}"><div id="pErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div></div>`;}
async function saveProfileEdit(){
  const n=document.getElementById("pname").value.trim(),e=document.getElementById("pemail").value.trim();
  if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("pErr").textContent="Enter a valid name and email.";return;}
  const errEl=document.getElementById("pErr");errEl.textContent="";
  const btn=document.querySelector('.enroll-card .buttons button[onclick="saveProfileEdit()"]');
  if(btn){btn.disabled=true;btn.textContent="Saving…";}
  // Persist to the backend Users sheet too (keyed by email), not just localStorage —
  // otherwise a name change never reaches the account record, so the same email
  // keeps showing the old name everywhere the backend is the source of truth
  // (dashboard, rankings, result emails, admin views).
  const res=API?await apiPost("register",{name:n,email:e}):null;
  if(API&&!res?.ok){
    errEl.textContent=res?.error||"Could not save your details. Please try again.";
    if(btn){btn.disabled=false;btn.textContent="Save";}
    return;
  }
  store.setProfile({name:n,email:e});
  home();
}
function goProfile(){requireProfile(renderProfile);}
function renderProfileBody(d,connecting){
  app.innerHTML=`<div class="card"><h1>My Profile</h1>${connecting?connBannerHTML():""}<p class="meta">${esc(d.name)} • ${esc(d.email)}</p><p class="note">Member since ${d.createdAt?esc(formatDateTime(d.createdAt)):"—"}</p>
    <div class="dash-grid"><div class="dash-tile"><b>${d.attempts}</b><span>Exams attended</span></div><div class="dash-tile"><b>${d.avg}%</b><span>Average marks</span></div><div class="dash-tile"><b>${d.best}%</b><span>Best marks</span></div><div class="dash-tile"><b>${d.attempts}</b><span>Total attempts</span></div></div>
    <div class="dash-grid"><div class="dash-tile"><b>${d.mistakes}</b><span>Mistakes count</span></div><div class="dash-tile"><b>${d.reminders}</b><span>Reminders count</span></div></div>
    <h2>Subject-wise attempts &amp; performance</h2>${d.subjects?.length?d.subjects.map(s=>`<div class="subjbar-row"><div class="subjbar-label">${esc(s.subject)} (${s.attempts})</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${Math.min(100,s.avg)}%"></div></div><div>${s.best}%</div></div>`).join(""):'<p class="note">No attempts yet.</p>'}
    <p class="note">See Dashboard for recent activity and test frequency.</p>
    <div class="buttons"><button onclick="editProfile()">Edit Profile</button><button onclick="goDashboard()">Dashboard</button><button onclick="logoutUser()">Logout</button><button onclick="deleteAccountPrompt()">Delete Account</button><button onclick="home()">Home</button></div></div>`;
}
async function renderProfile(){
  pushNav(renderProfile);
  clearExam();
  const p=store.profile(),cached=store.profileDataCache();
  // Paint instantly with the last known profile stats (if any) instead of a bare
  // "Loading…" card, then quietly refresh from the server.
  if(cached&&cached.email===p.email){renderProfileBody(cached,true);}else{app.innerHTML=`<div class="card"><h1>My Profile</h1><p class="note">Loading…</p></div>`;}
  const res=API?await apiGet("profile",{email:p.email},15000,2):null;
  if(!res?.ok){
    if(cached&&cached.email===p.email){const b=document.getElementById("connBanner");if(b)b.innerHTML=`Could not refresh — showing your last saved data. <button onclick="renderProfile()">Retry</button>`;return;}
    app.innerHTML=`<div class="card"><h1>My Profile</h1><p class="note">${API?"Could not load profile.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="goProfile()">Retry</button><button onclick="home()">Back</button></div></div>`;return;
  }
  const d=res.data;store.setProfileDataCache(d);
  renderProfileBody(d,false);
}
function logoutUser(){
  if(!confirm("Log out? You'll need to re-enter your name and email next time."))return;
  localStorage.removeItem("ecet_profile");localStorage.removeItem("ecet_mistakes_cache");
  Object.keys(localStorage).filter(k=>k.startsWith("ecet_progress_")).forEach(k=>localStorage.removeItem(k));
  home();
}
async function deleteAccountPrompt(){
  if(!confirm("This will permanently delete your account and all your results, mistakes, reminders, and history. This cannot be undone. Continue?"))return;
  const p=store.profile();
  app.innerHTML=`<div class="card"><h1>Deleting account…</h1><p class="note">Please wait.</p></div>`;
  const res=API?await apiPost("deleteAccount",{email:p.email},25000):null;
  if(!res?.ok){app.innerHTML=`<div class="card"><h1>Could not delete account</h1><p class="note">${esc(res?.error||"Please try again.")}</p><div class="buttons"><button onclick="goProfile()">Back</button></div></div>`;return;}
  localStorage.removeItem("ecet_profile");localStorage.removeItem("ecet_mistakes_cache");
  Object.keys(localStorage).filter(k=>k.startsWith("ecet_progress_")).forEach(k=>localStorage.removeItem(k));
  home();
}

/* ===================== ADMIN QUESTION IMPORT ===================== */
function adminSubjectOptions(){
  const staticOpts=subjects.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  const customOpts=customSubjects.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  return `${staticOpts?`<optgroup label="Existing Subjects">${staticOpts}</optgroup>`:""}${customOpts?`<optgroup label="Custom Subjects">${customOpts}</optgroup>`:'<optgroup label="Custom Subjects"><option disabled>None yet — create one above</option></optgroup>'}`;
}
async function adminQuestionsPage(){
  pushNav(adminQuestionsPage);
  requireProfile(async ()=>{
    const p=store.profile();
    const access=isAdminUnlocked?null:(API?await apiGet('isAdmin',{email:p.email},5000):null);
    if(!isAdminUnlocked&&(!access?.ok||!access.isAdmin)){
      app.innerHTML='<div class="card"><h1>Admin access required</h1><p class="note">This page is available only to an authorized administrator. Use the Admin button on the homepage and enter the admin password.</p><div class="buttons"><button onclick="home()">Back</button></div></div>';
      return;
    }
    if(API){try{const cs=await apiGet("customSubjects",{});if(cs?.ok&&Array.isArray(cs.data)){customSubjects=cs.data;store.setCustomSubjectsCache(cs.data);}}catch(e){console.warn("Custom subjects load failed",e);}}
    const curYear=new Date().getFullYear();
    app.innerHTML=`<div class="card"><h1>Admin — Create New Subject</h1>
      <p class="note">Create a brand-new practice test subject with no code or GitHub changes. It appears immediately in "Practice Tests Added by Admin" on the homepage, and below in the Subject dropdown so you can bulk-import its questions.</p>
      <label>Subject Name</label><input id="newSubjectName" placeholder="e.g. Machine Learning Basics">
      <label>Subject Password</label><input id="newSubjectPassword" placeholder="Password students will enter">
      <label>Description (optional)</label><input id="newSubjectDesc" placeholder="Shown as the subject's tagline on the homepage">
      <div id="newSubjectStatus" class="note"></div>
      <div class="buttons"><button onclick="createNewSubject()">Create Subject</button></div>
    </div>
    <div class="card"><h1>Admin — Add Questions</h1>
      <p class="note">Select an existing subject to add its questions, or pick "Create New Subject" to make a brand-new one above first.</p>
      <label>Subject</label><select id="adminSubject" onchange="if(this.value==='__new__'){document.getElementById('newSubjectName').scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('newSubjectName').focus();this.value=this.options[0].value;}refreshAiPrompt();">
        ${adminSubjectOptions()}
        <option value="__new__">➕ Create New Subject…</option>
      </select>
      <label>Exam Year</label><input id="adminYear" type="number" value="${curYear}" placeholder="e.g. 2026" onchange="refreshAiPrompt()">
      <p class="note">Used for any row whose Year column is left blank in the Excel file, and filled into the AI prompt below.</p>

      <h2 style="margin-top:26px">Don't want to type questions by hand? Ask an AI</h2>
      <label>Exam / series name (optional)</label><input id="aiExamName" placeholder="e.g. GATE, ECET, campus placement mock" onchange="refreshAiPrompt()">
      <p class="note">The prompt below now asks the AI to hand back a ready-to-upload Excel (.xlsx) file directly — no copy-pasting rows.</p>
      <p class="note"><b>Mandatory columns:</b> Question, Option A, Option B, Option C, Option D, Correct Answer, Year. &nbsp; <b>Optional:</b> State, Question Number, and all Image URL columns — leave blank if unused.</p>
      <p class="note">Answer these first — the prompt below is generated fresh from your answers each time, not a fixed template.</p>
      <label>Coverage</label><select id="aiScope" onchange="document.getElementById('aiTopicRow').style.display=this.value==='topic'?'':'none';refreshAiPrompt()">
        <option value="subject">Whole subject (broad coverage)</option>
        <option value="topic">Specific topic(s) / subtopic(s)</option>
      </select>
      <div id="aiTopicRow" style="display:none"><label>Topic / Subtopics</label><input id="aiTopic" placeholder="e.g. Boolean Algebra & K-Maps" onchange="refreshAiPrompt()"></div>
      <label>Type of questions</label><select id="aiQType" onchange="refreshAiPrompt()">
        <option value="Conceptual/theory-based">Conceptual / theory-based</option>
        <option value="Numerical/problem-solving">Numerical / problem-solving</option>
        <option value="Mixed" selected>Mixed (concept + numerical)</option>
        <option value="Previous-year exam style">Previous-year exam style</option>
        <option value="Application/scenario-based">Application / scenario-based</option>
      </select>
      <label>Difficulty</label><select id="aiDifficulty" onchange="refreshAiPrompt()"><option value="Easy">Easy</option><option value="Medium" selected>Medium</option><option value="Hard">Hard</option><option value="Super Hard">Super Hard</option><option value="Mixed">Mixed (all levels)</option></select>
      <label>Number of Questions</label><input id="aiCount" type="number" value="20" min="1" max="200" onchange="refreshAiPrompt()">
      <label>Anything else important? (optional)</label><input id="aiExtra" placeholder="e.g. avoid repeats from last year, favor diagrams-based questions" onchange="refreshAiPrompt()">
      <p class="note">Copy the prompt below, paste it into any AI chat, then paste the AI's reply directly into the Excel template starting at cell A2 — it's tab-separated so it lands in the right columns automatically.</p>
      <textarea id="aiPromptBox" readonly rows="13" style="font-family:'SFMono-Regular',Consolas,monospace;font-size:12.5px;white-space:pre;resize:vertical"></textarea>
      <div class="buttons"><button onclick="copyAiPrompt()">📋 Copy Prompt</button><button onclick="downloadQuestionTemplate()">Download Excel Template</button></div>
      <div id="aiCopyStatus" class="note"></div>

      <label style="margin-top:26px">Excel file (filled in from the template above)</label><input id="questionFile" type="file" accept=".xlsx,.xls,.csv" onchange="previewQuestionFile(event)">
      <div id="importStatus" class="note"></div><div id="importPreview"></div>
      <div class="buttons"><button id="importQuestionsBtn" onclick="importPreviewedQuestions()" disabled>Import Questions</button></div>
    </div>
    <div class="card">${questionFormHTML('add',null)}</div>
    <div class="card"><h1>Admin — Manage Questions</h1>
      <p class="note">Edit existing questions in place, or review the audit log of every edit made.</p>
      <div class="buttons"><button onclick="editQuestionsPage()">✏️ Edit Questions</button><button onclick="recentChangesPage()">🕘 Recent Changes</button><button onclick="home()">Back to Home</button></div>
    </div>`;
    refreshAiPrompt();
  });
}

/* ===================== ADMIN — SHARED QUESTION FORM (manual add + edit) ===================== */
function questionFormHTML(mode,q){
  const isEdit=mode==='edit';
  const v=(k,d)=>esc(q&&q[k]!==undefined?q[k]:(d||''));
  return `<h1>Admin — ${isEdit?'Edit Question':'Add a Single Question'}</h1>
    <p class="note">${isEdit?'Editing question <b>'+esc(q.id)+'</b>. Saving updates this exact row — it cannot duplicate or affect another row.':'Fill in one question directly, without an Excel file.'}</p>
    ${isEdit?'':`<label>Subject</label><select id="qfSubject">${adminSubjectOptions()}</select>`}
    <label>Question</label><textarea id="qfQuestion" rows="2">${v('question')}</textarea>
    <label>Option A</label><input id="qfA" value="${q?esc((q.options||[])[0]||''):''}">
    <label>Option B</label><input id="qfB" value="${q?esc((q.options||[])[1]||''):''}">
    <label>Option C</label><input id="qfC" value="${q?esc((q.options||[])[2]||''):''}">
    <label>Option D</label><input id="qfD" value="${q?esc((q.options||[])[3]||''):''}">
    <label>Correct Answer</label><select id="qfCorrect">${['A','B','C','D'].map(l=>`<option value="${l}" ${q&&"ABCD"[q.answer]===l?'selected':''}>${l}</option>`).join('')}</select>
    <label>Year</label><input id="qfYear" value="${v('year',new Date().getFullYear())}">
    <label>State (optional)</label><input id="qfState" value="${v('state','TS')}">
    <label>Question Number (optional)</label><input id="qfQno" value="${v('questionNumber')}">
    <label>Question Image URL (optional)</label><input id="qfQImg" value="${v('image')}">
    <label>Option A/B/C/D Image URLs (optional)</label>
    <input id="qfAImg" placeholder="Option A image" value="${q?esc((q.optionImages||[])[0]||''):''}">
    <input id="qfBImg" placeholder="Option B image" value="${q?esc((q.optionImages||[])[1]||''):''}">
    <input id="qfCImg" placeholder="Option C image" value="${q?esc((q.optionImages||[])[2]||''):''}">
    <input id="qfDImg" placeholder="Option D image" value="${q?esc((q.optionImages||[])[3]||''):''}">
    <div id="qfStatus" class="note"></div>
    <div class="buttons">${isEdit?`<button onclick="editQuestionsPage()">Cancel</button><button onclick="saveQuestionEdit('${esc(q.id)}')">Save Changes</button>`:`<button onclick="saveManualQuestion()">Save Question</button>`}</div>`;
}
function readQuestionForm(){
  return {
    question:document.getElementById('qfQuestion').value.trim(),
    optionA:document.getElementById('qfA').value.trim(),
    optionB:document.getElementById('qfB').value.trim(),
    optionC:document.getElementById('qfC').value.trim(),
    optionD:document.getElementById('qfD').value.trim(),
    correctAnswer:document.getElementById('qfCorrect').value,
    year:document.getElementById('qfYear').value.trim(),
    state:document.getElementById('qfState').value.trim(),
    questionNumber:document.getElementById('qfQno').value.trim(),
    questionImage:document.getElementById('qfQImg').value.trim(),
    optionAImage:document.getElementById('qfAImg').value.trim(),
    optionBImage:document.getElementById('qfBImg').value.trim(),
    optionCImage:document.getElementById('qfCImg').value.trim(),
    optionDImage:document.getElementById('qfDImg').value.trim()
  };
}
async function saveManualQuestion(){
  const statusEl=document.getElementById('qfStatus');
  const sel=document.getElementById('qfSubject'),subject=subjects.find(s=>s.id===sel.value)||customSubjects.find(s=>s.id===sel.value);
  if(!sel.value||sel.value==='__new__'){statusEl.innerHTML='<span class="wronganswer">Pick a subject first.</span>';return;}
  const row=readQuestionForm();
  if(!row.question||!row.optionA||!row.optionB||!row.optionC||!row.optionD||!row.year){statusEl.innerHTML='<span class="wronganswer">Question, all 4 options, and Year are required.</span>';return;}
  statusEl.textContent='Saving…';
  const p=store.profile();
  const res=await apiPost('importQuestions',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",subjectId:sel.value,subject:subject?.name||sel.value,questions:[row]});
  if(res?.ok){statusEl.innerHTML='<span class="correct">Question saved successfully — available immediately in Practice Tests.</span>';['qfQuestion','qfA','qfB','qfC','qfD','qfQno','qfQImg','qfAImg','qfBImg','qfCImg','qfDImg'].forEach(id=>document.getElementById(id).value='');
    refreshCustomSubjects(); // keep home/admin question counts in sync right away, no manual reload needed
  }
  else{statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||(res?.errors?.[0]?.errors?.join(', '))||'Could not save.')}</span>`;}
}

/* ===================== ADMIN — EDIT QUESTIONS ===================== */
let _editQuestionsCache=[],_editSubjectId='';
async function editQuestionsPage(){
  pushNav(editQuestionsPage);
  requireProfile(async ()=>{
    if(!isAdminUnlocked){app.innerHTML='<div class="card"><h1>Admin access required</h1><div class="buttons"><button onclick="home()">Back</button></div></div>';return;}
    if(API&&!customSubjects.length){try{const cs=await apiGet("customSubjects",{});if(cs?.ok&&Array.isArray(cs.data))customSubjects=cs.data;}catch(e){}}
    app.innerHTML=`<div class="card"><h1>Admin — Edit Questions</h1>
      <p class="note">Pick a subject, load its questions, then click Edit on any row.</p>
      <label>Subject</label><select id="editSubject">${adminSubjectOptions()}</select>
      <div class="buttons"><button onclick="loadAdminQuestions()">Load Questions</button><button onclick="adminQuestionsPage()">Back</button></div>
      <div id="editQuestionsList" class="note"></div>
    </div>`;
  });
}
async function loadAdminQuestions(){
  const sel=document.getElementById('editSubject'),listEl=document.getElementById('editQuestionsList');
  if(!sel.value||sel.value==='__new__'){listEl.innerHTML='<span class="wronganswer">Pick a subject.</span>';return;}
  _editSubjectId=sel.value;
  listEl.textContent='Loading…';
  const res=await apiGet('questions',{subjectId:sel.value});
  if(!res?.ok||!Array.isArray(res.data)){listEl.innerHTML='<span class="wronganswer">Could not load questions.</span>';return;}
  _editQuestionsCache=res.data;
  renderEditQuestionsList();
}
function renderEditQuestionsList(){
  const listEl=document.getElementById('editQuestionsList');
  if(!listEl)return;
  if(!_editQuestionsCache.length){listEl.innerHTML='<p class="note">No questions found for this subject.</p>';return;}
  listEl.innerHTML=`<div class="table-scroll"><table class="simple"><tr><th>Question</th><th>Year</th><th></th></tr>
  ${_editQuestionsCache.map(q=>`<tr><td>${esc((q.question||'').slice(0,90))}${(q.question||'').length>90?'…':''}</td><td>${esc(q.year)}</td><td><button onclick="editQuestionRow('${esc(q.id)}')">Edit</button></td></tr>`).join('')}
  </table></div>`;
}
function editQuestionRow(id){
  const q=_editQuestionsCache.find(x=>x.id===id);
  if(!q)return;
  pushNav(()=>editQuestionRow(id));
  app.innerHTML=`<div class="card">${questionFormHTML('edit',q)}</div>`;
}
async function saveQuestionEdit(id){
  const statusEl=document.getElementById('qfStatus');
  const row=readQuestionForm();
  if(!row.question||!row.optionA||!row.optionB||!row.optionC||!row.optionD||!row.year){statusEl.innerHTML='<span class="wronganswer">Question, all 4 options, and Year are required.</span>';return;}
  statusEl.textContent='Saving…';
  const p=store.profile();
  const res=await apiPost('updateQuestion',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",questionId:id,...row});
  if(res?.ok){
    statusEl.innerHTML='<span class="correct">Saved. Updating list…</span>';
    const idx=_editQuestionsCache.findIndex(x=>x.id===id);
    if(idx!==-1)_editQuestionsCache[idx]={...row,id,options:[row.optionA,row.optionB,row.optionC,row.optionD],answer:'ABCD'.indexOf(row.correctAnswer),image:row.questionImage,optionImages:[row.optionAImage,row.optionBImage,row.optionCImage,row.optionDImage]};
    setTimeout(editQuestionsPage,600);
  }else{statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||'Could not save.')}</span>`;}
}

/* ===================== ADMIN — RECENT CHANGES (audit log) ===================== */
async function recentChangesPage(){
  pushNav(recentChangesPage);
  requireProfile(async ()=>{
    if(!isAdminUnlocked){app.innerHTML='<div class="card"><h1>Admin access required</h1><div class="buttons"><button onclick="home()">Back</button></div></div>';return;}
    app.innerHTML=`<div class="card"><h1>Recent Changes</h1><p class="note">Loading…</p></div>`;
    const res=await apiGet('questionChangeLog',{});
    if(!res?.ok||!Array.isArray(res.data)){app.innerHTML=`<div class="card"><h1>Recent Changes</h1><p class="note">Could not load the change log.</p><div class="buttons"><button onclick="recentChangesPage()">Retry</button><button onclick="adminQuestionsPage()">Back</button></div></div>`;return;}
    const rows=res.data;
    app.innerHTML=`<div class="card"><h1>Recent Changes</h1><p class="meta">Last ${rows.length} edit(s) to questions, newest first.</p>
    <div class="table-scroll"><table class="simple"><tr><th>Date</th><th>Subject</th><th>Question</th><th>Edited by</th><th>What changed</th></tr>
    ${rows.map(r=>`<tr><td>${esc(formatDateTime(r.timestamp))}</td><td>${esc(r.subject)}</td><td>${esc(r.questionSnippet.slice(0,60))}${r.questionSnippet.length>60?'…':''}</td><td>${esc(r.editedBy)}</td><td>${esc(r.summary)}</td></tr>`).join('')||'<tr><td colspan="5">No edits recorded yet.</td></tr>'}
    </table></div>
    <div class="buttons"><button onclick="adminQuestionsPage()">Back</button></div></div>`;
  });
}
async function createNewSubject(){
  const p=store.profile();
  const name=document.getElementById("newSubjectName").value.trim();
  const password=document.getElementById("newSubjectPassword").value.trim();
  const description=document.getElementById("newSubjectDesc").value.trim();
  const statusEl=document.getElementById("newSubjectStatus");
  if(!name||!password){statusEl.innerHTML='<span class="wronganswer">Subject name and password are both required.</span>';return;}
  statusEl.textContent="Creating…";
  const res=await apiPost("createSubject",{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",name,password,description});
  if(!res?.ok){statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not create subject.")}</span>`;return;}
  customSubjects.push(res.subject);
  statusEl.innerHTML=`<span class="correct">"${esc(res.subject.name)}" created. It's now on the homepage and in the Subject dropdown below.</span>`;
  document.getElementById("newSubjectName").value="";document.getElementById("newSubjectPassword").value="";document.getElementById("newSubjectDesc").value="";
  const sel=document.getElementById("adminSubject");
  if(sel){sel.innerHTML=adminSubjectOptions();sel.value=res.subject.id;}
}
function buildAiPrompt(){
  // Built fresh from the admin's actual answers each time (coverage, question
  // type, difficulty, count, exam name) — not a single fixed template
  // regardless of input. This version asks the AI to hand back an actual
  // .xlsx file (for AI tools that can generate files) instead of TSV text to
  // paste in — upload the returned file straight into the importer above.
  const year=document.getElementById("adminYear")?.value||new Date().getFullYear();
  const scope=document.getElementById("aiScope")?.value||"subject";
  const sel=document.getElementById("adminSubject"),subjName=sel?.selectedOptions?.[0]?.textContent?.trim()||"the selected subject";
  const topic=document.getElementById("aiTopic")?.value?.trim();
  const qtype=document.getElementById("aiQType")?.value||"Mixed";
  const count=document.getElementById("aiCount")?.value||20;
  const difficulty=document.getElementById("aiDifficulty")?.value||"Medium";
  const extra=document.getElementById("aiExtra")?.value?.trim();
  const examName=document.getElementById("aiExamName")?.value?.trim()||subjName;

  const subtopicsLine=scope==='topic'&&topic
    ? topic
    : scope==='topic'
      ? 'Pick one well-defined, commonly-tested subtopic within '+subjName+' and stay within it.'
      : 'All major topics of '+subjName+' — spread broadly, not just one chapter.';

  const qtypeLines={
    'Conceptual/theory-based':'Focus on conceptual / theory-based questions — test definitions, principles, and understanding rather than heavy calculation.',
    'Numerical/problem-solving':'Focus on numerical / problem-solving questions — most should require a calculation or worked step, with plausible numeric distractors as the wrong options.',
    'Mixed':'Include a balanced mix of conceptual and numerical/problem-solving questions.',
    'Previous-year exam style':'Match the style, phrasing, and difficulty pattern typically seen in previous-year competitive exam papers for this subject.',
    'Application/scenario-based':'Frame questions around a short real-world scenario the student must reason through (application / scenario-based).'
  };

  return [
    'You are creating practice questions for a competitive-exam-style mock test. Generate multiple-choice exam questions in an Excel (.xlsx) file.',
    '',
    'Topic: '+subjName,
    'Subtopics: '+subtopicsLine,
    'Number of questions: '+count,
    'Difficulty level: '+difficulty,
    'Year: '+year,
    'Exam: '+examName,
    '',
    'Excel format — mandatory',
    '',
    'Create an Excel file with exactly 14 columns in this order:',
    '',
    '1. Question',
    '2. Option A',
    '3. Option B',
    '4. Option C',
    '5. Option D',
    '6. Correct Answer',
    '7. Year',
    '8. State',
    '9. Question Number',
    '10. Question Image URL',
    '11. Option A Image URL',
    '12. Option B Image URL',
    '13. Option C Image URL',
    '14. Option D Image URL',
    '',
    'Each question must occupy one row. Include a header row with the 14 column names. Preserve this exact column order and structure.',
    '',
    'Question requirements',
    '',
    '1. Generate exactly '+count+' unique MCQs.',
    '2. '+(qtypeLines[qtype]||qtypeLines['Mixed']),
    '3. Ensure the difficulty is '+difficulty+', suitable for competitive exams.',
    '4. Cover '+(scope==='topic'?'the specified subtopic(s)':'all specified subtopics')+' thoroughly.',
    '5. Do not create duplicate or near-duplicate questions.',
    '6. Every question must have exactly four options: A, B, C, and D.',
    '7. Correct Answer must contain exactly one letter: A, B, C, or D, matching the correct option.',
    '8. Verify every numerical answer, formula, and correct option before finalizing.',
    '9. Use '+year+' in the Year column for every question.',
    '10. Fill Question Number sequentially from 1 to '+count+'.',
    '11. Fill State with the requested state abbreviation, or leave it empty if no state is specified.',
    '12. Leave all image URL columns empty unless image URLs are explicitly requested.',
    '13. Do not invent facts, ambiguous questions, or questions with multiple correct answers.',
    ...(extra?['14. Additional instructions: '+extra]:[]),
    '',
    'Output requirements',
    '',
    '- Return ONLY the completed Excel (.xlsx) file.',
    '- Do not output the questions as plain text, TSV, CSV, or Markdown.',
    '- Do not provide explanations, answers, or any other text outside the Excel file.',
    '- Ensure the file contains exactly '+count+' question rows plus the header row.',
    '- Check that all 14 columns are present and in the correct order.',
    '- Ensure every mandatory field is filled for every question.',
    '- Make the Excel file ready to download and use directly.'
  ].join('\n');
}
function refreshAiPrompt(){
  const box=document.getElementById("aiPromptBox");
  if(box)box.value=buildAiPrompt();
}
function copyAiPrompt(){
  const box=document.getElementById("aiPromptBox"),status=document.getElementById("aiCopyStatus");
  if(!box)return;
  const announce=()=>{if(status)status.innerHTML='<span class="correct">Copied! Paste it into ChatGPT, Claude, or any AI chat.</span>';};
  const fallback=()=>{try{box.focus();box.select();document.execCommand("copy");announce();}catch(e){if(status)status.innerHTML='<span class="wronganswer">Could not copy automatically — select the text above and copy it manually.</span>';}};
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(box.value).then(announce).catch(fallback);}else{fallback();}
}
let _questionImportRows=[];
function downloadQuestionTemplate(){
  if(!window.XLSX){alert("Excel tools are still loading. Please try again.");return;}
  const rows=[['Question','Option A','Option B','Option C','Option D','Correct Answer','Year','State','Question Number','Question Image URL','Option A Image URL','Option B Image URL','Option C Image URL','Option D Image URL'],['Example question?','Option 1','Option 2','Option 3','Option 4','A','2026','TS','101','','','','','']];
  const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Questions');XLSX.writeFile(wb,'ECET-Question-Template.xlsx');
}
function normalizeQuestionRow(r,defaultYear){
  const get=(...keys)=>{for(const k of keys){if(r[k]!==undefined)return r[k];}return '';};
  return {question:String(get('Question','question')||'').trim(),optionA:String(get('Option A','OptionA','optionA')||'').trim(),optionB:String(get('Option B','OptionB','optionB')||'').trim(),optionC:String(get('Option C','OptionC','optionC')||'').trim(),optionD:String(get('Option D','OptionD','optionD')||'').trim(),correctAnswer:String(get('Correct Answer','CorrectAnswer','correctAnswer')||'').trim().toUpperCase(),year:String(get('Year','year')||'').trim()||String(defaultYear||'').trim(),state:String(get('State','state')||'TS').trim(),questionNumber:String(get('Question Number','QuestionNumber','questionNumber')||'').trim(),questionImage:String(get('Question Image URL','QuestionImage','questionImage')||'').trim(),optionAImage:String(get('Option A Image URL','OptionAImage','optionAImage')||'').trim(),optionBImage:String(get('Option B Image URL','OptionBImage','optionBImage')||'').trim(),optionCImage:String(get('Option C Image URL','OptionCImage','optionCImage')||'').trim(),optionDImage:String(get('Option D Image URL','OptionDImage','optionDImage')||'').trim()};
}
function validateImportRows(rows){
  const errs=[],seen=new Set();
  rows.forEach((r,i)=>{const e=[];if(!r.question)e.push('Question');['optionA','optionB','optionC','optionD'].forEach((k,n)=>{if(!r[k])e.push('Option '+"ABCD"[n]);});if(!/^[ABCD]$/.test(r.correctAnswer))e.push('Correct Answer A/B/C/D');if(!r.year)e.push('Year');const key=[r.question.toLowerCase(),r.year,r.state,r.questionNumber].join('|');if(seen.has(key))e.push('Duplicate');seen.add(key);if(e.length)errs.push({row:i+2,errors:e});});return errs;
}
function previewQuestionFile(ev){
  const file=ev.target.files?.[0];if(!file)return;
  if(!window.XLSX){document.getElementById('importStatus').textContent='Excel tools are still loading. Please try again.';return;}
  const reader=new FileReader();reader.onload=e=>{try{const wb=XLSX.read(e.target.result,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],raw=XLSX.utils.sheet_to_json(ws,{defval:''}),defaultYear=document.getElementById('adminYear')?.value||'';_questionImportRows=raw.map(r=>normalizeQuestionRow(r,defaultYear));const errors=validateImportRows(_questionImportRows);const preview=_questionImportRows.slice(0,20);document.getElementById('importStatus').innerHTML=`<b>${_questionImportRows.length}</b> row(s) found. ${errors.length?`<span class="wronganswer">${errors.length} invalid row(s)</span>`:'<span class="correct">All rows passed validation.</span>'}`;document.getElementById('importPreview').innerHTML=`<div class="table-scroll"><table class="simple"><tr><th>Row</th><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Correct</th><th>Year</th><th>Images</th><th>Status</th></tr>${preview.map((r,i)=>{const er=errors.find(x=>x.row===i+2);const imgCount=[r.questionImage,r.optionAImage,r.optionBImage,r.optionCImage,r.optionDImage].filter(Boolean).length;return `<tr><td>${i+2}</td><td>${esc(r.question)}</td><td>${esc(r.optionA)}</td><td>${esc(r.optionB)}</td><td>${esc(r.optionC)}</td><td>${esc(r.optionD)}</td><td>${esc(r.correctAnswer)}</td><td>${esc(r.year)}</td><td>${imgCount?imgCount+' img':'—'}</td><td>${er?`<span class="wronganswer">${esc(er.errors.join(', '))}</span>`:'<span class="correct">OK</span>'}</td></tr>`}).join('')}</table></div>${errors.length?`<div class="error"><b>Import blocked.</b> Fix the invalid rows and upload the corrected file.<br>${errors.slice(0,30).map(x=>`Row ${x.row}: ${esc(x.errors.join(', '))}`).join('<br>')}</div>`:''}`;document.getElementById('importQuestionsBtn').disabled=errors.length>0||!_questionImportRows.length;}catch(err){_questionImportRows=[];document.getElementById('importQuestionsBtn').disabled=true;document.getElementById('importStatus').textContent='Could not read the Excel file. Please use the provided template.';console.warn(err);}};reader.readAsArrayBuffer(file);
}
async function importPreviewedQuestions(){
  const btn=document.getElementById('importQuestionsBtn');if(!_questionImportRows.length||btn.disabled)return;btn.disabled=true;btn.textContent='Importing…';const p=store.profile(),sel=document.getElementById('adminSubject'),subject=subjects.find(s=>s.id===sel.value)||customSubjects.find(s=>s.id===sel.value);const res=await apiPost('importQuestions',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",subjectId:sel.value,subject:subject?.name||sel.value,questions:_questionImportRows});if(res?.ok){document.getElementById('importStatus').innerHTML=`<span class="correct"><b>${res.imported}</b> question(s) imported successfully — available immediately in Practice Tests.</span>`;_questionImportRows=[];document.getElementById('importPreview').innerHTML='';refreshCustomSubjects();/* keep home/admin question counts in sync right away, no manual reload needed */}else{document.getElementById('importStatus').innerHTML=`<span class="wronganswer">${esc(res?.error||'Import failed.')}</span>`;if(res?.errors?.length)document.getElementById('importPreview').innerHTML=`<div class="error">${res.errors.map(x=>`Row ${x.row}: ${esc(x.errors.join(', '))}`).join('<br>')}</div>`;}btn.textContent='Import Questions';btn.disabled=!_questionImportRows.length;
}

/* ===================== ADMIN PASSWORD UNLOCK =====================
   The Admin button is always visible on the homepage. Entering the admin
   password unlocks the admin panel on this device even if the server-side
   isAdmin check (which needs a working backend + a registered admin email)
   is slow or unreachable. */
function openAdminPassword(){
  clearExam();pushNav(openAdminPassword);
  app.innerHTML=`<div class="card password-card"><h1>Admin Access</h1><p>Enter the admin password to manage subjects and questions.</p><input id="adminPass" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')checkAdminPassword()"><div id="adminPassErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkAdminPassword()">Continue</button></div></div>`;
  document.getElementById("adminPass").focus();
}
function checkAdminPassword(){
  const v=document.getElementById("adminPass").value;
  if(v!==ADMIN_PANEL_PASSWORD){document.getElementById("adminPassErr").textContent="Incorrect password.";return;}
  isAdminUnlocked=true;
  localStorage.setItem("ecet_admin_unlocked","1");
  // Replace the password-screen stack entry so Back goes straight Home,
  // instead of pushing the admin page on top of the password screen.
  navStack.pop();
  adminQuestionsPage();
}

/* ===================== PASSWORD ===================== */
let _pwSubject=null;
function openPassword(i){_pwSubject=subjects[i];renderPasswordCard();}
function openCustomPassword(i){_pwSubject=customSubjects[i];renderPasswordCard();}
function renderPasswordCard(){pushNav(renderPasswordCard);const s=_pwSubject;app.innerHTML=`<div class="card password-card"><h1>${esc(s.name)}</h1><p>Enter the subject password.</p><input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword()"><div id="passError" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword()">Continue</button></div></div>`;document.getElementById("password").focus();}
async function checkPassword(){const s=_pwSubject,v=document.getElementById("password").value;if(v!==String(s.password)){document.getElementById("passError").textContent="Incorrect password.";return;}
  // These two are independent — the static question-bank file and the
  // admin-imported questions from the backend — so fetch them in parallel
  // instead of waiting on the file before even starting the API call.
  const [staticBank,imported]=await Promise.all([
    s.file?fetch(s.file).then(r=>r.json()).catch(()=>[]):Promise.resolve([]),
    API?apiGet('questions',{subjectId:s.id}).catch(()=>null):Promise.resolve(null)
  ]);
  bank=Array.isArray(staticBank)?staticBank:[];
  if(imported?.ok&&Array.isArray(imported.data)&&imported.data.length)bank=bank.concat(imported.data);
  if(!bank.length){app.innerHTML=`<div class="card"><h2>Question bank not available.</h2><button onclick="home()">Back</button></div>`;return;}activeSubject=s;enroll();}
function enroll(){pushNav(enroll);const p=store.profile();if(p){confirmExamStart();return;}app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1><p>Enter your name and email.</p><label>Name</label><input id="ename" placeholder="Full name"><label>Email</label><input id="eemail" type="email" placeholder="you@example.com"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitEnroll()">Continue</button></div></div>`;}
function submitEnroll(){const n=document.getElementById("ename").value.trim(),e=document.getElementById("eemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("eErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});confirmExamStart();}
function confirmExamStart(){
  pushNav(confirmExamStart);
  const p=store.profile(),mins=bank.length;
  app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1>${activeSubject.description?`<p class="note">${esc(activeSubject.description)}</p>`:""}
    <div class="dash-grid"><div class="dash-tile"><b>${bank.length}</b><span>Questions</span></div><div class="dash-tile"><b>${mins} min</b><span>Time limit</span></div><div class="dash-tile"><b>1 min</b><span>Per question</span></div><div class="dash-tile"><b>No</b><span>Extra time</span></div></div>
    <p class="note">You'll be entered as <b>${esc(p.name)}</b> (${esc(p.email)}). The timer starts the moment you click Start Exam and keeps running even if you leave the page.</p>
    <div class="buttons"><button onclick="editProfile()">Change details</button><button onclick="home()">Back</button><button onclick="beginExam()">Start Exam</button></div></div>`;
}
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
  const pairs=(q.options||[]).map((text,index)=>({text,index,img:(q.optionImages||[])[index]||""}));
  const shuffled=shuffle(pairs);
  return {...q,options:shuffled.map(x=>x.text),optionImages:shuffled.map(x=>x.img),answer:shuffled.findIndex(x=>x.index===Number(q.answer)),optionOrder:shuffled.map(x=>x.index)};
}
function restoreQuestionOrder(q,order){
  if(!Array.isArray(order)||order.length!==(q.options||[]).length)return randomizeQuestionOptions(q);
  const pairs=order.map(i=>({text:q.options[i],img:(q.optionImages||[])[i]||"",index:i}));
  if(pairs.some(x=>x.text===undefined))return randomizeQuestionOptions(q);
  return {...q,options:pairs.map(x=>x.text),optionImages:pairs.map(x=>x.img),answer:pairs.findIndex(x=>x.index===Number(q.answer)),optionOrder:order.slice()};
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
function render(){const q=test[current],answered=answers.filter(x=>x!==null).length,markedCount=marked.filter(Boolean).length;app.innerHTML=`<div class="top"><h1>ECET ${esc(activeSubject.name)}</h1><div class="timer ${left<=60?"low":""}">${clock(left)}</div></div><div class="card"><div class="meta"><span>Question ${current+1} of ${test.length} • ${esc(q.year)} ${esc(q.state)} • PYQ ${esc(q.questionNumber)}</span><span>Answered ${answered}/${test.length} • Review ${markedCount}</span></div><div class="question">${esc(q.question)}</div>${imgHTML(q.image)}${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" name="answer" ${answers[current]===k?"checked":""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)} ${imgHTML((q.optionImages||[])[k],"opt-img")}</label>`).join("")}<button class="review-toggle ${marked[current]?"active":""}" onclick="toggleReview()">${marked[current]?"★ Marked for review":"☆ Mark for review"}</button><div class="palette-legend"><span>⬜ Unanswered</span><span>🟩 Answered</span><span>🟨 Review</span></div><div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${marked[k]?"review":""} ${k===current?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div><div class="examfoot"><button onclick="go(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="toggleReview()">${marked[current]?"Unmark":"Review"}</button><button onclick="go(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="confirmSubmit()">Submit</button></div></div>`;}

/* ===================== RESULT ===================== */
async function submit(){
  // IMPORTANT: clearExam() also resets isSubmitting=false (it's a general-purpose
  // "leaving an exam context" reset used elsewhere). It must run BEFORE we set
  // isSubmitting=true, not after — otherwise isSubmitting flips back to false the
  // instant this function returns, and the Result page gets treated as an active
  // exam again (stale activeSubject/test/left are all still populated), so the
  // Back button wrongly shows "Exam is in progress..." and can call submit() a
  // second time for the same attempt.
  if(isSubmitting||!test.length)return; clearExam();isSubmitting=true;
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
function requireProfile(next){if(store.profile())return next();_afterProfile=next;pushNav(()=>requireProfile(next));app.innerHTML=`<div class="card enroll-card"><h1>Enter your details</h1><p>Your dashboard and mistakes are tied to your email.</p><label>Name</label><input id="ename"><label>Email</label><input id="eemail" type="email"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitProfileAndContinue()">Continue</button></div></div>`;}
function submitProfileAndContinue(){const n=document.getElementById("ename").value.trim(),e=document.getElementById("eemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("eErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});const next=_afterProfile;_afterProfile=null;if(next)next();}
function renderDashboardBody(d,p,connecting){
  app.innerHTML=`<div class="card"><h1>My Dashboard</h1>${connecting?connBannerHTML():""}<p class="meta">${esc(p.name)} • ${esc(p.email)}</p><div class="dash-grid"><div class="dash-tile"><b>${d.attempts}</b><span>Tests taken</span></div><div class="dash-tile"><b>${d.avg}%</b><span>Average %</span></div><div class="dash-tile"><b>${d.best}%</b><span>Best %</span></div><div class="dash-tile"><b>${d.mistakes}</b><span>Active mistakes</span></div></div>
    ${d.subjects?.length?`<div class="advice"><b>Subject performance</b> is shown below.</div>`:""}
    <h2>Subject-wise performance</h2>${d.subjects.map(s=>`<div class="subjbar-row"><div class="subjbar-label">${esc(s.subject)}</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${Math.min(100,s.avg)}%"></div></div><div>${s.best}%</div></div>`).join("")||'<p class="note">No attempts yet.</p>'}
    <h2>Recent tests</h2><div id="dashRecent" class="note">Loading…</div>
    <h2>Test frequency</h2><div id="dashFreq" class="note">Loading…</div>
    <div class="buttons"><button onclick="goMistakes()">My Mistakes</button><button onclick="goAttemptHistory()">Attempt History</button><button onclick="home()">Subjects</button></div></div>`;
}
async function dashboard(){
  pushNav(dashboard);
  clearExam();const p=store.profile(),cached=store.dashboardCache();
  if(cached){renderDashboardBody(cached,p,true);}else{app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">Loading…</p></div>`;}
  // Fetch dashboard + history in parallel (instead of sequentially) so the
  // full page is roughly twice as fast to settle.
  const [res,hres]=API?await Promise.all([apiGet("dashboard",{email:p.email},25000,1),apiGet("history",{email:p.email},25000,1)]):[null,null];
  if(!res?.ok){
    if(cached){const b=document.getElementById("connBanner");if(b)b.innerHTML=`Could not refresh — showing your last saved data. <button onclick="dashboard()">Retry</button>`;return;}
    app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">${API?"Could not load dashboard.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="dashboard()">Retry</button><button onclick="home()">Back</button></div></div>`;return;
  }
  const d=res.data;store.setDashboardCache(d);
  renderDashboardBody(d,p,false);
  const hist=(hres?.ok&&Array.isArray(hres.data))?hres.data:[];
  const recentEl=document.getElementById("dashRecent");
  if(recentEl){
    const recent=hist.slice(0,5);
    recentEl.innerHTML=recent.length?`<div class="table-scroll"><table class="simple"><thead><tr><th>Date</th><th>Subject</th><th>Score</th><th>%</th></tr></thead><tbody>${recent.map(r=>`<tr><td>${esc(formatDateTime(r.timestamp))}</td><td>${esc(r.subject)}</td><td>${esc(r.correct)}/${esc(r.total)}</td><td>${esc(r.percentage)}%</td></tr>`).join("")}</tbody></table></div>`:'<p class="note">No attempts yet.</p>';
  }
  const freqEl=document.getElementById("dashFreq");
  if(freqEl){
    const now=Date.now(),weekMs=7*24*60*60*1000,monthMs=30*24*60*60*1000;
    const ts=r=>{const d=r.timestamp?new Date(r.timestamp).getTime():NaN;return isNaN(d)?null:d;};
    const thisWeek=hist.filter(r=>{const d=ts(r);return d&&now-d<=weekMs;}).length;
    const thisMonth=hist.filter(r=>{const d=ts(r);return d&&now-d<=monthMs;}).length;
    freqEl.innerHTML=`<div class="dash-grid"><div class="dash-tile"><b>${thisWeek}</b><span>Tests this week</span></div><div class="dash-tile"><b>${thisMonth}</b><span>Tests this month</span></div></div>`;
  }
}

/* ===================== ATTEMPT HISTORY (full list + compare) ===================== */
let _historyCache=[],_compareIds=[];
function goAttemptHistory(){requireProfile(attemptHistory);}
async function attemptHistory(){
  pushNav(attemptHistory);
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
  const rows=[
    ["Subject",esc(a.subject),esc(b.subject),""],
    ["Date",esc(formatDateTime(a.endTime||a.timestamp)),esc(formatDateTime(b.endTime||b.timestamp)),""],
    ["Score",`${a.score}/${a.total}`,`${b.score}/${b.total}`,diff(a.score,b.score)],
    ["%",`${a.percentage}%`,`${b.percentage}%`,diff(a.percentage,b.percentage)+"%"],
    ["Correct",a.correct,b.correct,diff(a.correct,b.correct)],
    ["Wrong",a.wrong,b.wrong,diff(a.wrong,b.wrong)],
    ["Unanswered",a.unanswered,b.unanswered,diff(a.unanswered,b.unanswered)],
    ["Time",clock(a.totalTimeSec),clock(b.totalTimeSec),""]
  ];
  return `<div class="advice ${b.percentage>=a.percentage?"good":"weak"}"><b>Comparing two attempts</b></div>
  <div class="table-scroll"><table class="simple"><tr><th>Metric</th><th>Attempt 1</th><th>Attempt 2</th><th>Change</th></tr>
  ${rows.map(r=>`<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")}
  </table></div>`;
}

/* ===================== REMINDERS (standalone, not test-dependent) ===================== */
const REMINDER_FREQUENCIES=[["once","One-time"],["hourly","Hourly"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]];
let _remindersCache=[];
function goReminders(){requireProfile(remindersPage);}
async function remindersPage(){
  pushNav(remindersPage);
  clearExam();const cached=store.remindersCache();
  if(cached&&cached.length){_remindersCache=cached;renderReminders(null,true);}else{app.innerHTML=`<div class="card"><h1>Reminders</h1><p class="note">Loading…</p></div>`;}
  const p=store.profile(),res=API?await apiGet("reminders",{email:p.email}):null;
  if(!res?.ok){
    if(cached&&cached.length){const b=document.getElementById("connBanner");if(b)b.innerHTML=`Could not refresh — showing your last saved data. <button onclick="remindersPage()">Retry</button>`;return;}
    app.innerHTML=`<div class="card"><h1>Reminders</h1><p class="note">${API?"Could not load reminders.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="remindersPage()">Retry</button><button onclick="home()">Back</button></div></div>`;return;
  }
  _remindersCache=res.data||[];store.setRemindersCache(_remindersCache);renderReminders();
}
function renderReminders(saveError,connecting){
  const p=store.profile();
  const groups={Active:[],Paused:[],Completed:[]};
  _remindersCache.forEach(r=>{const key=r.status==="Paused"?"Paused":r.status==="Completed"?"Completed":"Active";groups[key].push(r);});
  const row=r=>`<div class="mistake-card"><div><span class="mistake-tag ${r.status==="Active"?"tag-due":"tag-wait"}">${esc(r.status)}</span> <span class="mistake-tag">${esc(r.frequency)}</span></div>
    <p><b>${esc(r.name)}</b></p><p>${esc(r.message)}</p>
    ${r.relatedTask?`<p class="note">Task: ${esc(r.relatedTask)}</p>`:""}${r.relatedUrl?`<p class="note"><a href="${esc(r.relatedUrl)}" target="_blank" rel="noopener">${esc(r.relatedUrl)}</a></p>`:""}
    <p class="meta">Next: ${r.nextRunAt?esc(formatDateTime(r.nextRunAt)):"—"}${r.lastSentAt?` • Last sent: ${esc(formatDateTime(r.lastSentAt))}`:""}</p>
    <div class="buttons"><button onclick="openEditReminder('${r.id}')">Edit</button><button onclick="reminderToggle('${r.id}',${!r.enabled})">${r.enabled?"Pause":"Resume"}</button><button onclick="reminderDelete('${r.id}')">Delete</button></div></div>`;
  app.innerHTML=`<div class="card"><h1>Reminders</h1>${connecting?connBannerHTML():""}<p class="meta">Registered email: <b>${esc(p.email)}</b>. Standalone reminders — not tied to any specific test.</p>
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
function openCreateReminder(){pushNav(openCreateReminder);clearExam();app.innerHTML=reminderFormHTML(null);}
function quickRemindLater(subjectId,subjectName){requireProfile(()=>{clearExam();app.innerHTML=reminderFormHTML({name:"Finish "+subjectName,message:"You have an unfinished "+subjectName+" test waiting — come back and finish it.",relatedUrl:location.href.split("#")[0]});});}
function openEditReminder(id){pushNav(()=>openEditReminder(id));clearExam();app.innerHTML=reminderFormHTML(_remindersCache.find(r=>r.id===id));}
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
  _remindersCache=fresh?.data||_remindersCache;store.setRemindersCache(_remindersCache);renderReminders();
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
  pushNav(notificationsPage);
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
  pushNav(mistakes);
  clearExam();const cached=store.mistakesCache();
  if(cached&&cached.length){renderMistakes(cached,true);}else{app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">Loading…</p></div>`;}
  const p=store.profile(),res=API?await apiGet("mistakes",{email:p.email}):null;
  if(!res?.ok){
    if(cached&&cached.length){const b=document.getElementById("connBanner");if(b)b.innerHTML=`Could not refresh — showing your last saved data. <button onclick="mistakes()">Retry</button>`;return;}
    app.innerHTML=`<div class="card"><h1>My Mistakes</h1><p class="note">${API?"Could not load mistakes.":"Connect Apps Script first."}</p><div class="buttons"><button onclick="mistakes()">Retry</button><button onclick="home()">Back</button></div></div>`;return;
  }
  store.setMistakesCache(res.data);renderMistakes(res.data,false);
}
function renderMistakes(items,connecting){
  const now=new Date();
  const due=items.filter(m=>dueDate(m)<=now);
  const next=items.filter(m=>dueDate(m)>now).sort((a,b)=>dueDate(a)-dueDate(b))[0];
  let countdown="";
  if(next){const ms=Math.max(0,dueDate(next)-now);countdown=`<div class="countdown"><b>Next revision test:</b> ${formatCountdown(ms)}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small></div>`;}
  app.innerHTML=`<div class="card"><h1>My Mistakes</h1>${connecting?connBannerHTML():""}<p class="meta">Active mistakes: <b>${items.length}</b> • Due now: <b>${due.length}</b>. A mistake stays here until you answer it correctly.</p>${items.length?`${countdown}<div class="buttons"><button ${due.length?"":"disabled"} onclick="startRevisionTest()">Start revision test ${due.length?`(${due.length})`:"(not due yet)"}</button></div>${items.map(m=>{const isDue=dueDate(m)<=now;return `<div class="mistake-card"><div><span class="mistake-tag">${esc(m.subject)}</span> <span class="mistake-tag ${isDue?"tag-due":"tag-wait"}">${isDue?"Due now":"Due "+formatDateTime(m.revisionDueIso||m.revisionDueDate)}</span></div><p><b>${esc(m.question)}</b></p>${imgHTML(m.image)}${m.options.map((o,k)=>`<div>${"ABCD"[k]}. ${esc(o)} ${imgHTML((m.optionImages||[])[k],"opt-img")} ${k===m.correctIndex?"<b class='correct'>(correct)</b>":""} ${k===m.selectedIndex?"<i>(last answer)</i>":""}</div>`).join("")}</div>`;}).join("")}`:'<p class="note">No active mistakes — excellent. 🎉</p>'}<div class="buttons"><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div></div>`;
  if(next)setTimeout(()=>mistakeCountdownLoop(),1000);
}
function formatCountdown(ms){let s=Math.ceil(ms/1000);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60),sec=s%60;return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(sec).padStart(2,"0")}s`;}
function mistakeCountdownLoop(){const el=document.querySelector(".countdown");if(!el)return;const items=store.mistakesCache(),next=items.filter(m=>dueDate(m)>new Date()).sort((a,b)=>dueDate(a)-dueDate(b))[0];if(!next){mistakes();return;}el.innerHTML=`<b>Next revision test:</b> ${formatCountdown(dueDate(next)-new Date())}<br><small>Due: ${formatDateTime(next.revisionDueIso||next.revisionDueDate)}</small>`;setTimeout(mistakeCountdownLoop,1000);}
async function startRevisionTest(){const items=store.mistakesCache().filter(m=>dueDate(m)<=new Date()&&!m.revised);if(!items.length){mistakes();return;}revisionMode=true;revisionItems=shuffle(items).map(m=>({...m,options:shuffle((m.options||[]).map((text,index)=>({text,index,img:(m.optionImages||[])[index]||""})))}));revisionItems=revisionItems.map(m=>{const order=m.options.map(x=>x.index),opts=m.options.map(x=>x.text),imgs=m.options.map(x=>x.img);return {...m,options:opts,optionImages:imgs,correctIndex:order.indexOf(Number(m.correctIndex)),optionOrder:order};});test=revisionItems.map(m=>({id:m.wrongId,year:m.year,state:m.state,questionNumber:m.questionNumber,question:m.question,options:m.options,image:m.image||"",optionImages:m.optionImages||[],answer:m.correctIndex,wrongId:m.wrongId}));answers=Array(test.length).fill(null);marked=Array(test.length).fill(false);qTime=Array(test.length).fill(0);current=0;left=test.length*60;/* 1 min/question, no extra time */examStartedAt=Date.now();questionStartedAt=Date.now();clearInterval(timer);timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el)el.textContent=clock(left);if(left<=0){left=0;submitRevisionTest();}},1000);window.addEventListener("beforeunload",handleRevisionBeforeUnload);window.addEventListener("pagehide",handleRevisionPageHide);armBackGuard();renderRevision();}
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

function renderRevision(){const q=test[current],answered=answers.filter(x=>x!==null).length;app.innerHTML=`<div class="top"><h1>1-Day Revision Test</h1><div class="timer">${clock(left)}</div></div><div class="card"><div class="meta">Question ${current+1} of ${test.length} • Answered ${answered}/${test.length}</div><div class="question">${esc(q.question)}</div>${imgHTML(q.image)}${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" ${answers[current]===k?"checked":""} onchange="revisionChoose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)} ${imgHTML((q.optionImages||[])[k],"opt-img")}</label>`).join("")}<div class="examfoot"><button onclick="revisionGo(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="revisionGo(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="submitRevisionTest()">Finish revision</button></div></div>`;}
function revisionChoose(v){answers[current]=v;renderRevision();}
function revisionGo(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();renderRevision();}
async function submitRevisionTest(){if(isSubmitting)return;isSubmitting=true;clearInterval(timer);window.removeEventListener("beforeunload",handleRevisionBeforeUnload);window.removeEventListener("pagehide",handleRevisionPageHide);disarmBackGuard();commitTime();const p=store.profile();const items=revisionItems.map((m,i)=>({wrongId:m.wrongId,selected:answers[i],time:qTime[i]}));app.innerHTML=`<div class="card"><h1>Checking revision…</h1><p class="note">Updating your mistakes.</p></div>`;const res=await apiPost("submitRevision",{email:p.email,items});if(res?.ok){const fresh=await apiGet("mistakes",{email:p.email});store.setMistakesCache(fresh?.data||[]);app.innerHTML=`<div class="card"><h1>Revision result</h1><div class="stats"><div class="stat"><b>${res.correct}</b>Correct</div><div class="stat"><b>${res.wrong}</b>Wrong again</div><div class="stat"><b>${res.unanswered}</b>Unanswered</div><div class="stat"><b>${(fresh?.data||[]).length}</b>Active mistakes</div></div><p class="note">Correct answers are removed from My Mistakes. Wrong or unanswered questions are scheduled again for 1 day.</p><div class="buttons"><button onclick="mistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div></div>`;}else{isSubmitting=false;app.innerHTML=`<div class="card"><h2>Could not save revision.</h2><button onclick="mistakes()">Back</button></div>`;}}

home();
