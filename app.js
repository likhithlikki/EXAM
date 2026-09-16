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
let _loadingCount=0;
function loadingShow(){
  _loadingCount++;
  const bar=document.getElementById("loadBar");
  if(bar)bar.classList.add("active");
}
function loadingHide(){
  _loadingCount=Math.max(0,_loadingCount-1);
  if(_loadingCount===0){
    const bar=document.getElementById("loadBar");
    if(bar)bar.classList.remove("active");
  }
}

async function apiGet(action,params={},timeoutMs=9000){
  if(!API)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  loadingShow();
  try{
    const r=await fetch(API+"?"+new URLSearchParams({action,...params}),{method:"GET",cache:"no-store",signal:controller.signal});
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){console.warn("GET "+action+" failed:",e);return null;}
  finally{clearTimeout(timer);loadingHide();}
}
async function apiPost(action,payload={},timeoutMs=15000){
  if(!API)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  loadingShow();
  try{
    const r=await fetch(API,{method:"POST",body:JSON.stringify({action,...payload}),cache:"no-store",signal:controller.signal});
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){console.warn("POST "+action+" failed:",e);return null;}
  finally{clearTimeout(timer);loadingHide();}
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
  const btn=document.getElementById("backFab");
  if(btn)btn.style.display=navStack.length>1?"flex":"none";
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
let isAdminUnlocked=false;
const ADMIN_PANEL_PASSWORD="123";

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
  return customSubjects.length?customSubjects.map((s,i)=>{const unfinished=store.getProgress(s.id);return `<div class="subject-card"><h2>${esc(s.name)}</h2><p>${s.description?esc(s.description):(unfinished?"Test in progress — resume any time":"Questions available")}</p><button onclick="openCustomPassword(${i})">${unfinished?"Resume Exam":"Open Exam"}</button>${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;}).join(""):'<p class="note">No custom tests added yet. An admin can add one from the Admin page.</p>';
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
  app.innerHTML=`<div class="home"><h1>ECET Online Test</h1><p class="subtitle">Choose a subject. Each test gets exactly 1 minute per question — no extra time.</p>
    <div class="home-nav"><button onclick="goDashboard()">My Dashboard</button><button onclick="goMistakes()">My Mistakes</button><button onclick="goReminders()">Request Reminder</button><span id="adminNavSlot"><button onclick="openAdminPassword()">Admin</button></span>${p?`<button onclick="goProfile()">${esc(p.name)}</button>`:""}</div><div id="serverStatus" class="server-status checking"><span class="server-dot"></span><span>Checking server…</span></div>
    <div class="subject-grid">${subjects.map((s,i)=>{const unfinished=s.available&&store.getProgress(s.id);return `<div class="subject-card"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2><p>${s.available?(unfinished?"Test in progress — resume any time":"Questions available"):"Question bank coming soon"}</p><button ${s.available?`onclick="openPassword(${i})"`:"disabled"}>${s.available?(unfinished?"Resume Exam":"Open Exam"):"Coming Soon"}</button>${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;}).join("")}</div>
    <h2 style="margin-top:34px">Practice Tests Added by Admin</h2>
    <p class="subtitle">Custom subjects created directly from the Admin panel — no code or GitHub changes needed.</p>
    <div class="subject-grid" id="customSubjectGrid">${customSubjectsHTML()}</div>
  </div>`;
  checkServerStatus();
  checkAdminAccess();
  handleRevisionLink();
  refreshCustomSubjects();
}
async function refreshCustomSubjects(){
  if(!API)return;
  try{
    const cs=await apiGet("customSubjects",{},7000);
    if(cs?.ok&&Array.isArray(cs.data)){
      customSubjects=cs.data;
      store.setCustomSubjectsCache(cs.data);
      const grid=document.getElementById("customSubjectGrid");
      if(grid)grid.innerHTML=customSubjectsHTML();
    }
  }catch(e){console.warn("Custom subjects load failed",e);}
}
async function checkServerStatus(){
  const el=document.getElementById('serverStatus');
  if(!el)return;
  el.className='server-status checking';
  el.innerHTML='<span class="server-dot"></span><span>Checking server…</span>';
  if(!API){el.className='server-status offline';el.innerHTML='<span class="server-dot"></span><span>Server offline — API not configured</span>';return;}
  const res=await apiGet('ping',{},5000);
  if(res?.ok){el.className='server-status online';el.innerHTML='<span class="server-dot"></span><span>Server online</span>';}
  else{el.className='server-status offline';el.innerHTML='<span class="server-dot"></span><span>Server offline — retry</span>';}
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
async function checkAdminAccess(){
  const slot=document.getElementById('adminNavSlot');
  const p=store.profile();
  if(!slot||!p||!API)return;
  const res=await apiGet('isAdmin',{email:p.email},5000);
  if(res?.ok&&res.isAdmin) slot.innerHTML='<button onclick="adminQuestionsPage()">Admin: Add Questions</button>';
}
function editProfile(){pushNav(editProfile);const p=store.profile()||{name:"",email:""};app.innerHTML=`<div class="card enroll-card"><h1>Your details</h1><label>Name</label><input id="pname" value="${esc(p.name)}"><label>Email</label><input id="pemail" type="email" value="${esc(p.email)}"><div id="pErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div></div>`;}
function saveProfileEdit(){const n=document.getElementById("pname").value.trim(),e=document.getElementById("pemail").value.trim();if(!n||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){document.getElementById("pErr").textContent="Enter a valid name and email.";return;}store.setProfile({name:n,email:e});home();}
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
  const res=API?await apiGet("profile",{email:p.email}):null;
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
  const res=API?await apiPost("deleteAccount",{email:p.email}):null;
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
    const access=API?await apiGet('isAdmin',{email:p.email},5000):null;
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
      <label>Subject</label><select id="adminSubject" onchange="if(this.value==='__new__'){document.getElementById('newSubjectName').scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('newSubjectName').focus();this.value=this.options[0].value;}">
        ${adminSubjectOptions()}
        <option value="__new__">➕ Create New Subject…</option>
      </select>
      <label>Exam Year</label><input id="adminYear" type="number" value="${curYear}" placeholder="e.g. 2026">
      <p class="note">Used for any row whose Year column is left blank in the Excel file.</p>
      <label>Excel file</label><input id="questionFile" type="file" accept=".xlsx,.xls,.csv" onchange="previewQuestionFile(event)">
      <div class="buttons"><button onclick="downloadQuestionTemplate()">Download Excel Template</button><button onclick="home()">Back</button></div>
      <div id="importStatus" class="note"></div><div id="importPreview"></div>
      <div class="buttons"><button id="importQuestionsBtn" onclick="importPreviewedQuestions()" disabled>Import Questions</button></div>
    </div>`;
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
  const res=await apiPost("createSubject",{adminEmail:p.email,name,password,description});
  if(!res?.ok){statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not create subject.")}</span>`;return;}
  customSubjects.push(res.subject);
  statusEl.innerHTML=`<span class="correct">"${esc(res.subject.name)}" created. It's now on the homepage and in the Subject dropdown below.</span>`;
  document.getElementById("newSubjectName").value="";document.getElementById("newSubjectPassword").value="";document.getElementById("newSubjectDesc").value="";
  const sel=document.getElementById("adminSubject");
  if(sel){sel.innerHTML=adminSubjectOptions();sel.value=res.subject.id;}
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
  const btn=document.getElementById('importQuestionsBtn');if(!_questionImportRows.length||btn.disabled)return;btn.disabled=true;btn.textContent='Importing…';const p=store.profile(),sel=document.getElementById('adminSubject'),subject=subjects.find(s=>s.id===sel.value)||customSubjects.find(s=>s.id===sel.value);const res=await apiPost('importQuestions',{adminEmail:p.email,subjectId:sel.value,subject:subject?.name||sel.value,questions:_questionImportRows});if(res?.ok){document.getElementById('importStatus').innerHTML=`<span class="correct"><b>${res.imported}</b> question(s) imported successfully.</span>`;_questionImportRows=[];document.getElementById('importPreview').innerHTML='';}else{document.getElementById('importStatus').innerHTML=`<span class="wronganswer">${esc(res?.error||'Import failed.')}</span>`;if(res?.errors?.length)document.getElementById('importPreview').innerHTML=`<div class="error">${res.errors.map(x=>`Row ${x.row}: ${esc(x.errors.join(', '))}`).join('<br>')}</div>`;}btn.textContent='Import Questions';btn.disabled=!_questionImportRows.length;
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
  adminQuestionsPage();
}

/* ===================== PASSWORD ===================== */
let _pwSubject=null;
function openPassword(i){_pwSubject=subjects[i];renderPasswordCard();}
function openCustomPassword(i){_pwSubject=customSubjects[i];renderPasswordCard();}
function renderPasswordCard(){pushNav(renderPasswordCard);const s=_pwSubject;app.innerHTML=`<div class="card password-card"><h1>${esc(s.name)}</h1><p>Enter the subject password.</p><input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword()"><div id="passError" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword()">Continue</button></div></div>`;document.getElementById("password").focus();}
async function checkPassword(){const s=_pwSubject,v=document.getElementById("password").value;if(v!==String(s.password)){document.getElementById("passError").textContent="Incorrect password.";return;}bank=[];if(s.file){try{bank=await fetch(s.file).then(r=>r.json());}catch(e){bank=[];}}try{const imported=API?await apiGet('questions',{subjectId:s.id}):null;if(imported?.ok&&Array.isArray(imported.data)&&imported.data.length)bank=bank.concat(imported.data);}catch(e){console.warn('Imported question load failed',e);}if(!bank.length){app.innerHTML=`<div class="card"><h2>Question bank not available.</h2><button onclick="home()">Back</button></div>`;return;}activeSubject=s;enroll();}
function enroll(){pushNav(enroll);const p=store.profile();if(p){app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1><p>Continue as <b>${esc(p.name)}</b> (${esc(p.email)})?</p><div class="buttons"><button onclick="editProfile()">Change details</button><button onclick="beginExam()">Start Exam</button></div></div>`;return;}app.innerHTML=`<div class="card enroll-card"><h1>${esc(activeSubject.name)}</h1><p>Enter your name and email.</p><label>Name</label><input id="ename" placeholder="Full name"><label>Email</label><input id="eemail" type="email" placeholder="you@example.com"><div id="eErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="submitEnroll()">Start Exam</button></div></div>`;}
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
  const res=API?await apiGet("dashboard",{email:p.email}):null;
  if(!res?.ok){
    if(cached){const b=document.getElementById("connBanner");if(b)b.innerHTML=`Could not refresh — showing your last saved data. <button onclick="dashboard()">Retry</button>`;return;}
    app.innerHTML=`<div class="card"><h1>My Dashboard</h1><p class="note">${API?"Could not load dashboard.":"Connect Apps Script in config.js first."}</p><div class="buttons"><button onclick="dashboard()">Retry</button><button onclick="home()">Back</button></div></div>`;return;
  }
  const d=res.data;store.setDashboardCache(d);
  renderDashboardBody(d,p,false);
  const hres=API?await apiGet("history",{email:p.email}):null;
  const hist=(hres?.ok&&Array.isArray(hres.data))?hres.data:[];
  const recentEl=document.getElementById("dashRecent");
  if(recentEl){
    const recent=hist.slice(0,5);
    recentEl.innerHTML=recent.length?`<table class="simple"><thead><tr><th>Date</th><th>Subject</th><th>Score</th><th>%</th></tr></thead><tbody>${recent.map(r=>`<tr><td>${esc(formatDateTime(r.timestamp))}</td><td>${esc(r.subject)}</td><td>${esc(r.correct)}/${esc(r.total)}</td><td>${esc(r.percentage)}%</td></tr>`).join("")}</tbody></table>`:'<p class="note">No attempts yet.</p>';
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
  return `<div class="advice ${b.percentage>=a.percentage?"good":"weak"}"><b>Comparing:</b> ${esc(a.subject)} on ${esc(formatDateTime(a.endTime||a.timestamp))} → ${esc(b.subject)} on ${esc(formatDateTime(b.endTime||b.timestamp))}<br>
  Score: ${a.score}/${a.total} → ${b.score}/${b.total} (${diff(a.score,b.score)}) • Percentage: ${a.percentage}% → ${b.percentage}% (${diff(a.percentage,b.percentage)}%) • Wrong: ${a.wrong} → ${b.wrong} • Unattempted: ${a.unanswered} → ${b.unanswered}</div>`;
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
