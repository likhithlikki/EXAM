/* ===================== ECET Quiz App ===================== */
const app = document.getElementById("app");
const API = (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_URL) || "";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const clock = sec => { sec=Math.max(0,Math.floor(sec||0)); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return (h?String(h).padStart(2,"0")+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); };
const isoDate = d => { const x=new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const formatDateTime = v => { const d=new Date(v); return isNaN(d)?String(v||"—"):d.toLocaleString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
const formatSeconds = s => { s=Math.max(0,Math.round(Number(s)||0)); return s<60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; };
const formatCooldown = ms => { ms=Math.max(0,ms); const d=Math.floor(ms/86400000),h=Math.floor((ms%86400000)/3600000),m=Math.floor((ms%3600000)/60000); if(d>0)return `${d}d ${h}h`; if(h>0)return `${h}h ${m}m`; return `${m}m`; };
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
  if(examActive){safeGoHome();return;}
  navStack.pop();
  const prev=navStack.pop();
  (prev||home)();
}

let subjects=[],customSubjects=[],bank=[],test=[],answers=[],marked=[],qTime=[];
let current=0,left=0,timer=null,questionStartedAt=0,examStartedAt=0,activeSubject=null,saveTick=0,isSubmitting=false;
let examSessionId="";
let revisionMode=false, revisionItems=[];
/* ===================== STRICT EXAM-ACTIVE STATE =====================
 * BUG THIS FIXES: previously "is an exam running?" was recomputed from
 * activeSubject/test.length/left/isSubmitting/revisionMode every time a
 * guard needed an answer. submit() and submitRevisionTest() only ever
 * reset isSubmitting — they never cleared test/answers/activeSubject/left
 * — so as soon as ANY later navigation (home/dashboard/mistakes) called
 * clearExam() and flipped isSubmitting back to false, those stale
 * leftovers made the guards think an exam was still running. That's why
 * clicking Home (or the back button) after seeing your result could pop
 * "Exam is in progress... submitted automatically" and shove you back
 * into the test, sometimes even re-submitting it.
 *
 * Fix: examActive is the ONLY thing any guard is allowed to check. It is
 * set true in exactly two places (start(), startRevisionTest()) and set
 * false in exactly two places (submit(), submitRevisionTest()) — the
 * instant you click Submit, not after the network call resolves. Once
 * it's false, it STAYS false through any amount of navigation, stale
 * variables, or re-renders, until a brand new exam is explicitly started.
 * This makes "submitted = done, permanently, for this attempt" a hard
 * guarantee instead of something re-derived (and re-breakable) on every
 * navigation.
 */
let examActive=false;
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
  if(examActive){
    const leave=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");
    if(!leave)return;
    if(revisionMode)submitRevisionTest();else submit();
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
  if(!examActive){ disarmBackGuard(); return; }
  const leave=confirm("Exam is in progress. Do you want to go back? Your test will be submitted automatically.");
  if(leave){
    disarmBackGuard();
    if(revisionMode)submitRevisionTest();else submit();
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
    const d={id:q.id,year:q.year,state:q.state,questionNumber:q.questionNumber,topic:q.topic||"",correct:q.answer,selected,marked:marked[n],time:Math.round(qTime[n]||0)};
    // On normal submit keep everything. On tab-close submit, omit question/options
    // for correct/unanswered items to keep the Beacon payload small enough for browsers.
    if(!compact || isWrong){ d.question=q.question; d.options=q.options; d.image=q.image||""; d.optionImages=q.optionImages||[]; }
    return d;
  });
  const score=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)===Number(d.correct)).length;
  const wrong=detail.filter(d=>d.selected!==null&&d.selected!==undefined&&Number(d.selected)!==Number(d.correct)).length;
  const unanswered=detail.filter(d=>d.selected===null||d.selected===undefined).length;
  const percentage=test.length?Math.round(score/test.length*1000)/10:0;
  return {name:p.name,email:p.email,subject:activeSubject.name,subjectId:activeSubject.parentId||activeSubject.id,score,total:test.length,percentage,correct:score,wrong,unanswered,totalTime:Math.round((Date.now()-examStartedAt)/1000),startTime:new Date(examStartedAt).toISOString(),testUrl:(window.APP_CONFIG&&window.APP_CONFIG.SITE_URL)||location.href.split("#")[0],detail,examSessionId,autoSubmitted:!!compact};
}
// NOTE: Closing the tab, refreshing, or losing connectivity must NOT finalize the
// exam — it must only save progress so "Resume Exam" on Home has something to
// restore. (Previously this fired a sendBeacon submitExam on every close/refresh,
// which "succeeds" from the browser's point of view almost immediately regardless
// of whether the backend ever receives it, and then wiped the saved progress — so
// the exam looked auto-submitted and there was nothing left to resume, even though
// Home still advertised "Test in progress — resume any time.") The timer keeps
// counting against the wall clock while you're away (see start()'s elapsed-time
// recompute), so leaving does not let you pause the clock — it just lets you
// actually come back to your answers instead of losing them.
function handleBeforeUnload(e){
  if(!examActive||isSubmitting||revisionMode||!test.length||left<=0)return;
  persist();
  e.preventDefault();
  e.returnValue="Your exam is still in progress. It will be waiting for you to resume when you come back.";
  return e.returnValue;
}
function handlePageHide(){
  if(!examActive||isSubmitting||revisionMode||!test.length||left<=0)return;
  persist();
}


/* ===================== TOPIC-WISE TESTS =====================
 * The same subject can be practised for more than one exam (say Digital
 * Electronics for ECET *and* for GATE), and inside each exam it can have topic
 * tests (Basics, Capacitors & Inductors, Two-Ports …). Every question carries an
 * optional `exam` and `topic`. A question without an exam belongs to its
 * subject's "home" exam: the Exam typed when a custom subject was created, or
 * ECET for the built-in subjects.
 *
 * For each exam of a subject the Home page offers:
 *   • a Full Subject Test (all that exam's questions) — the only row when the
 *     exam has no topics, and
 *   • one numbered topic test per topic.
 *
 * Every test is a "test unit": a copy of the subject with its own name and id.
 * Password, autosave/resume, the wait after an exam, results, rank, mistakes,
 * dashboard and emails all key on that name/id, so each test automatically gets
 * its own attempts, best score and wait. Names stay stable:
 *   home exam  → "Subject"   and  "Subject — Topic"        (what older results used)
 *   other exam → "Subject (GATE)"  and  "Subject (GATE) — Topic"
 * Results go to the backend with the PARENT subject id so reports can group them. */
const TOPIC_SEP=" — ";
const cleanTopic=t=>String(t??"").replace(/\s+/g," ").trim();
const topicKey=t=>cleanTopic(t).toLowerCase();
const topicSlug=t=>topicKey(t).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"topic";
const hashStr=s=>{let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36);};
const readJsonLS=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k)||"null");return v&&typeof v==="object"&&!Array.isArray(v)?v:d;}catch(e){return d;}};
let _serverTopics=readJsonLS("ecet_topic_summary_cache_v2",{}); // {subjectId:{total,exams:[{name,total}],topics:[{name,count,exam}]}}
let _staticTopics=readJsonLS("ecet_static_topics_cache_v2",{}); // same shape, counted from the static JSON banks
let _staticTopicsChecked=false;
let _expandedSubjects=new Set(); // Home cards whose test list is open
let _unlockedSubjects=new Set(); // subjects whose password was entered this visit (so other tests of it don't ask again)

function findSubjectById(id){return subjects.find(s=>s.id===id)||customSubjects.find(s=>s.id===id);}
// The exam a question belongs to when it has none of its own.
function homeExam(s){
  const p=(s&&findSubjectById(s.parentId||s.id))||s;
  if(!p)return "";
  return subjects.some(x=>x.id===p.id)?"ECET":cleanTopic(p.exam);
}
function tallyTopics(list){
  const m=new Map();
  (list||[]).forEach(q=>{const k=topicKey(q&&q.topic);if(!k)return;const e=m.get(k);if(e)e.count++;else m.set(k,{name:cleanTopic(q.topic),count:1});});
  return [...m.values()];
}
// {exams:[{name,total}],topics:[{name,count,exam}]} for a list of questions
function tallyBank(list,home){
  const exams=new Map(),topics=new Map();
  (list||[]).forEach(q=>{
    const ex=cleanTopic(q&&q.exam)||home,ek=topicKey(ex);
    const e=exams.get(ek)||{name:ex,total:0};e.total++;exams.set(ek,e);
    const tk=topicKey(q&&q.topic);if(!tk)return;
    const key=ek+"|"+tk,t=topics.get(key)||{name:cleanTopic(q.topic),exam:ex,count:0};t.count++;topics.set(key,t);
  });
  return {exams:[...exams.values()],topics:[...topics.values()]};
}
function setServerTopics(map){
  if(!map||typeof map!=="object"||Array.isArray(map))return;
  _serverTopics=map;
  try{localStorage.setItem("ecet_topic_summary_cache_v2",JSON.stringify(map));}catch(e){}
}
async function ensureStaticTopics(){
  if(_staticTopicsChecked)return;
  _staticTopicsChecked=true;
  let changed=false;
  await Promise.all(subjects.filter(s=>s.available&&s.file).map(async s=>{
    try{
      const arr=await fetch(s.file).then(r=>r.json());
      if(!Array.isArray(arr))return;
      const next={total:arr.length,...tallyBank(arr,"ECET")};
      if(JSON.stringify(_staticTopics[s.id])!==JSON.stringify(next)){_staticTopics[s.id]=next;changed=true;}
    }catch(e){}
  }));
  if(changed){
    try{localStorage.setItem("ecet_static_topics_cache_v2",JSON.stringify(_staticTopics));}catch(e){}
    refreshSubjectCardStats();
  }
}
// One entry per exam of the subject (home exam first): {exam,examKey,isHome,total,topics:[{name,count}]}
function subjectGroups(s){
  const home=homeExam(s),homeKey=topicKey(home),m=new Map();
  const grp=name=>{const k=topicKey(name);let g=m.get(k);if(!g){g={exam:cleanTopic(name),examKey:k,total:0,topics:[]};m.set(k,g);}return g;};
  [_staticTopics[s.id],_serverTopics[s.id]].forEach(src=>{
    if(!src)return;
    const hasExams=Array.isArray(src.exams)&&src.exams.length>0;
    (src.exams||[]).forEach(x=>{grp(x.name).total+=Number(x.total)||0;});
    (src.topics||[]).forEach(t=>{
      const g=grp(t.exam===undefined?home:t.exam),k=topicKey(t.name),ex=g.topics.find(x=>topicKey(x.name)===k),c=Number(t.count)||0;
      if(ex)ex.count+=c;else g.topics.push({name:cleanTopic(t.name),count:c});
      if(!hasExams)g.total+=c; // older cached summaries had no exam totals
    });
  });
  const list=[...m.values()];
  list.forEach(g=>{g.isHome=g.examKey===homeKey;const t=g.topics.reduce((n,x)=>n+x.count,0);if(g.total<t)g.total=t;});
  return list.sort((a,b)=>(b.isHome?1:0)-(a.isHome?1:0));
}
// Flat topic list, exam list and the question total of a subject.
function subjectTopicInfo(s){
  const groups=subjectGroups(s),st=_staticTopics[s.id],sv=_serverTopics[s.id];
  const topics=[];groups.forEach(g=>g.topics.forEach(t=>topics.push({...t,exam:g.exam,examKey:g.examKey,isHome:g.isHome})));
  const total=s.file
    ?(st?st.total:(s.questionCount||0))+(sv?sv.total:0)
    :(s.questionCount!==undefined?s.questionCount:(sv?sv.total:0));
  return {groups,topics,total,topicCount:topics.length};
}
// A subject gets the expandable test list when it has topic tests or more than one exam.
function hasTestList(s){const i=subjectTopicInfo(s);return i.topicCount>0||i.groups.length>1;}
function fullUnit(parent,g){
  if(g.isHome)return {...parent,exam:g.exam,examKey:g.examKey,questionCount:g.total};
  return {...parent,id:parent.id+"::x-"+topicSlug(g.exam)+"-"+hashStr(g.examKey),name:parent.name+" ("+g.exam+")",parentId:parent.id,parentName:parent.name,exam:g.exam,examKey:g.examKey,description:"Full test — "+g.exam,questionCount:g.total};
}
function topicUnit(parent,g,t){
  const home=g.isHome,base=home?parent.name:parent.name+" ("+g.exam+")";
  const id=home?parent.id+"::"+topicSlug(t.name)+"-"+hashStr(topicKey(t.name))
              :parent.id+"::"+topicSlug(g.exam)+"~"+topicSlug(t.name)+"-"+hashStr(g.examKey+"|"+topicKey(t.name));
  return {...parent,id,name:base+TOPIC_SEP+t.name,parentId:parent.id,parentName:parent.name,exam:g.exam,examKey:g.examKey,topic:t.name,topicKey:topicKey(t.name),description:"Topic test — "+t.name+(g.exam?" ("+g.exam+")":""),questionCount:t.count};
}
// gi = which exam group, ti = -1 for that exam's full test, else the topic index inside the group
function unitFor(sid,gi,ti){
  const parent=findSubjectById(sid);if(!parent)return null;
  const g=subjectGroups(parent)[gi];if(!g)return null;
  if(ti<0)return fullUnit(parent,g);
  const t=g.topics[ti];
  return t?topicUnit(parent,g,t):null;
}
function allUnitsOf(s){
  const out=[];
  subjectGroups(s).forEach(g=>{out.push(fullUnit(s,g));g.topics.forEach(t=>out.push(topicUnit(s,g,t)));});
  if(!out.length)out.push(s);
  return out;
}
// every test name of a subject (used where an admin picks a test, e.g. locks)
function unitNames(s){const n=allUnitsOf(s).map(u=>u.name);if(!n.includes(s.name))n.unshift(s.name);return n;}
// exam shown in the exam header: a test's own exam, or the subject's home exam
function examLabel(s){if(!s)return "";return s.examKey!==undefined?(s.exam||""):homeExam(s);}
// Home card: only how many topic tests the subject has — no exam, no topic names.
function cardTagsHTML(s,showCount){
  if(!showCount)return "";
  const n=subjectTopicInfo(s).topicCount;
  return `<div class="card-tags"><span class="count-pill${n?"":" zero"}">📚 ${n?`${n} topic test${n===1?"":"s"}`:"No topic tests yet"}</span></div>`;
}
function testRowHTML(parent,g,gi,ti){
  const unit=ti<0?fullUnit(parent,g):topicUnit(parent,g,g.topics[ti]);
  const unfinished=store.getProgress(unit.id);
  // A wait never blocks resuming a test already in progress — only starting a new attempt.
  const lock=!unfinished?subjectLockInfo(unit.name):{locked:false};
  const best=subjectBest(unit.name),count=ti<0?g.total:g.topics[ti].count;
  const bits=[];if(count)bits.push(`${count} Q`,`${count} min`);bits.push(`Best: ${best!=null?best+"%":"—"}`);
  const btn=lock.locked?`<button disabled title="You can retake this after the wait">Locked</button>`:`<button onclick="openTestUnit('${esc(parent.id)}',${gi},${ti})">${unfinished?"Resume":"Start"}</button>`;
  const remind=unfinished?`<button class="ghost" onclick="quickRemindUnit('${esc(parent.id)}',${gi},${ti})">Remind me later</button>`:"";
  return `<div class="topic-row${ti<0?" full":""}"><span class="topic-num">${ti<0?"★":ti+1}</span><div class="topic-info"><b>${ti<0?"Full Subject Test":esc(g.topics[ti].name)}</b><small>${bits.join(" • ")}${unfinished?" • In progress":""}</small>${lock.locked?`<div>${lockBadgeHTML(lock.unlockAt)}</div>`:""}</div><div class="topic-actions">${btn}${remind}</div></div>`;
}
// One exam of the subject: a heading with the exam, then its tests. An exam with no topics is
// just its Full Subject Test; an exam with topics lists the Full Subject Test and then 1, 2, 3 …
function groupHTML(s,g,gi,multi){
  const head=(multi||g.exam)?`<div class="topic-panel-head"><span class="exam-badge">${esc(g.exam||"General")}</span>${g.topics.length?`<span>${g.topics.length} topic test${g.topics.length===1?"":"s"}</span>`:""}</div>`:"";
  const rows=testRowHTML(s,g,gi,-1)+g.topics.map((t,ti)=>testRowHTML(s,g,gi,ti)).join("");
  return `<div class="exam-group">${head}${rows}</div>`;
}
function topicCardHTML(s,i){
  const info=subjectTopicInfo(s),open=_expandedSubjects.has(s.id);
  const inProgress=allUnitsOf(s).some(u=>store.getProgress(u.id));
  const panel=open?`<div class="topic-panel">${info.groups.map((g,gi)=>groupHTML(s,g,gi,info.groups.length>1)).join("")}</div>`:"";
  return `<div class="subject-card has-topics${open?" expanded":""}" data-sid="${esc(s.id)}"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2>${cardTagsHTML(s,true)}<p>${s.description?esc(s.description)+"<br>":""}${info.total} Questions${inProgress?"<br>Test in progress — resume any time":""}</p><button onclick="toggleTopics('${esc(s.id)}')" aria-expanded="${open}">${open?"Hide tests ▴":"Choose Test ▾"}</button>${panel}</div>`;
}
function toggleTopics(sid){
  if(_expandedSubjects.has(sid))_expandedSubjects.delete(sid);else _expandedSubjects.add(sid);
  refreshSubjectCardStats();
  if(_expandedSubjects.has(sid)){
    const card=[...document.querySelectorAll('.subject-card')].find(c=>c.dataset.sid===sid);
    if(card)card.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}
function openTestUnit(sid,gi,ti){
  const unit=unitFor(sid,gi,ti);if(!unit)return;
  _pwSubject=unit;
  if(guardSubjectLock_(unit))return;
  // The subject password was already entered this visit → go straight to the test.
  if(_unlockedSubjects.has(unit.parentId||unit.id)){loadBankAndEnroll_(unit);return;}
  renderPasswordCard();
}
function quickRemindUnit(sid,gi,ti){const u=unitFor(sid,gi,ti);if(u)quickRemindLater(u.id,u.name);}
// Per-topic score table, shown on the result page of a test that mixes topics (a full subject test).
function topicBreakdownHTML(detail){
  const m=new Map();
  detail.forEach(d=>{
    const k=topicKey(d.topic);if(!k)return;
    const e=m.get(k)||{name:cleanTopic(d.topic),total:0,correct:0};
    e.total++;
    if(d.selected!==null&&d.selected!==undefined&&Number(d.selected)===Number(d.correct))e.correct++;
    m.set(k,e);
  });
  if(m.size<2)return "";
  const rows=[...m.values()].map(e=>({...e,pct:Math.round(e.correct/e.total*100)})).sort((a,b)=>a.pct-b.pct||b.total-a.total);
  return `<h2>Topic-wise performance</h2><p class="note">Weakest topics first — a good place to focus your next practice.</p>${rows.map(e=>`<div class="subjbar-row"><div class="subjbar-label">${esc(e.name)} (${e.correct}/${e.total})</div><div class="subjbar-track"><div class="subjbar-fill" style="width:${e.pct}%"></div></div><div>${e.pct}%</div></div>`).join("")}`;
}

/* ===================== HOME: SUBJECT SEARCH / JUMP ===================== */
let _jumpActive=-1,_jumpItems=[];
function jumpAllSubjects_(){
  // Every topic test is searchable too ("Networks — Two-Ports"); picking one opens its subject card.
  const out=[];
  const add=(s,soon)=>{out.push({id:s.id,name:s.name,soon});if(!soon)subjectGroups(s).forEach(g=>g.topics.forEach(t=>out.push({id:s.id,name:topicUnit(s,g,t).name,topic:t.name})));};
  subjects.forEach(s=>add(s,!s.available));
  customSubjects.forEach(s=>add(s,s.questionCount===0));
  return out;
}
function renderJumpList(showAll){
  const list=document.getElementById('jumpList'),input=document.getElementById('subjectJump');
  if(!list||!input)return;
  const q=showAll===true?'':input.value.trim().toLowerCase();
  _jumpItems=jumpAllSubjects_().filter(s=>!q||s.name.toLowerCase().includes(q));
  _jumpActive=_jumpItems.length&&q?0:-1;
  list.innerHTML=_jumpItems.length?_jumpItems.map((s,i)=>`<div class="jump-item${i===_jumpActive?' active':''}${s.topic?' is-topic':''}" data-i="${i}" onmousedown="event.preventDefault();jumpToSubject(${i})">${s.topic?'<span class="jump-arrow">↳</span>':''}${esc(s.name)}${s.soon?' <span class="jump-soon">coming soon</span>':''}</div>`).join(''):'<div class="jump-empty">No subject matches your search</div>';
  list.hidden=false;
}
function toggleJumpList(){
  const list=document.getElementById('jumpList');if(!list)return;
  if(list.hidden){document.getElementById('subjectJump').value='';renderJumpList(true);}else list.hidden=true;
}
function jumpKey(ev){
  const list=document.getElementById('jumpList');if(!list)return;
  if(ev.key==='Escape'){list.hidden=true;return;}
  if(list.hidden&&(ev.key==='ArrowDown'))renderJumpList(true);
  if(!_jumpItems.length)return;
  if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){
    ev.preventDefault();
    _jumpActive=(_jumpActive+(ev.key==='ArrowDown'?1:-1)+_jumpItems.length)%_jumpItems.length;
    list.querySelectorAll('.jump-item').forEach((el,i)=>el.classList.toggle('active',i===_jumpActive));
    list.querySelector('.jump-item.active')?.scrollIntoView({block:'nearest'});
  }else if(ev.key==='Enter'){ev.preventDefault();jumpToSubject(_jumpActive>=0?_jumpActive:0);}
}
function jumpToSubject(i){
  const s=_jumpItems[i];if(!s)return;
  const list=document.getElementById('jumpList'),input=document.getElementById('subjectJump');
  if(list)list.hidden=true;
  if(input){input.value=s.name;input.blur();}
  if(s.topic){_expandedSubjects.add(s.id);refreshSubjectCardStats();}
  const card=[...document.querySelectorAll('.subject-card')].find(c=>c.dataset.sid===s.id);
  if(!card)return;
  card.scrollIntoView({behavior:'smooth',block:'center'});
  card.classList.remove('flash');void card.offsetWidth;card.classList.add('flash');
  setTimeout(()=>card.classList.remove('flash'),2600);
  // Put the cursor on the card's main button so Enter opens it straight away.
  const btn=card.querySelector('button:not([disabled])');
  if(btn)setTimeout(()=>btn.focus({preventScroll:true}),450);
}
document.addEventListener('click',e=>{
  const wrap=document.getElementById('subjectJumpWrap'),list=document.getElementById('jumpList');
  if(list&&wrap&&!wrap.contains(e.target))list.hidden=true;
});

/* ===================== HOME ===================== */
function customSubjectsHTML(){
  return customSubjects.length?customSubjects.map((s,i)=>{
    const unfinished=store.getProgress(s.id);
    const hasQuestions=s.questionCount===undefined?true:s.questionCount>0; // older cached data has no count yet — don't hide it
    if(!hasQuestions){
      return `<div class="subject-card" data-sid="${esc(s.id)}"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2>${cardTagsHTML(s,false)}<p>${s.description?esc(s.description):"Question bank coming soon"}</p><button disabled>Coming Soon</button></div>`;
    }
    if(hasTestList(s))return topicCardHTML(s,i);
    const best=subjectBest(s.name);
    const meta=`${s.questionCount} Questions • ${s.questionCount} min • Best: ${best!=null?best+"%":"—"}`;
    // A cooldown never blocks resuming an exam already in progress — only starting a brand-new attempt.
    const lock=!unfinished?subjectLockInfo(s.name):{locked:false};
    const btn=lock.locked?`<button disabled title="You can retake this after the cooldown">Locked</button>`:`<button onclick="openCustomPassword(${i})">${unfinished?"Resume Exam":"Open Exam"}</button>`;
    return `<div class="subject-card" data-sid="${esc(s.id)}"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2>${cardTagsHTML(s,true)}<p>${s.description?esc(s.description)+"<br>"+meta:(unfinished?"Test in progress — resume any time<br>"+meta:meta)}${lock.locked?`<br>${lockBadgeHTML(lock.unlockAt)}`:""}</p>${btn}${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;
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
  app.innerHTML=`<div class="home"><div class="home-titlebar"><h1>Online Mock Test</h1><button id="hardRefreshBtn" onclick="hardRefresh()" title="Clear local cache and reload"><span class="rf-ico" aria-hidden="true">⟳</span><span>Refresh Data</span></button></div>
    ${p?`<div class="home-username">${esc(p.name)}</div>`:""}
    <p class="subtitle">${homeSubtitle()}</p>
    <div class="home-nav"><button onclick="goDashboard()">My Dashboard</button><button onclick="goMistakes()">My Mistakes</button><button onclick="goReminders()">Request Reminder</button><button onclick="location.href='about.html'">ℹ️ About</button><span id="adminNavSlot"><button onclick="openAdminPassword()">Admin</button></span>${p?`<button onclick="goProfile()">👤 My Profile</button>`:""}</div><div id="serverStatus" class="server-status checking"><span class="server-dot"></span><span>Checking server…</span></div>
    <div class="subject-jump" id="subjectJumpWrap"><input id="subjectJump" type="text"  placeholder="Search a subject or topic test…" autocomplete="off" aria-label="Search subjects" oninput="renderJumpList()" onfocus="renderJumpList(true)" onkeydown="jumpKey(event)"><button type="button" class="jump-toggle" onclick="toggleJumpList()" aria-label="Show all subjects" title="Show all subjects">▾</button><div id="jumpList" class="jump-list" hidden></div></div>
    <div class="subject-grid">${subjects.map((s,i)=>subjectCardHTML(s,i)).join("")}</div>
    <h2 style="margin-top:34px">Practice Tests Added by Admin <button class="icon-btn" onclick="refreshCustomSubjects(true)" title="Refresh practice tests">↻</button></h2>
    <p class="subtitle">Custom subjects created directly from the Admin panel — no code or GitHub changes needed.</p>
    <div class="subject-grid" id="customSubjectGrid">${customSubjectsHTML()}</div>
  </div>`;
  checkServerStatusAndBundle();
  handleRevisionLink();
  armCooldownTicker();
  ensureStaticTopics();
}
function homeSubtitle(){
  const total=subjects.length+customSubjects.length;
  const hist=store.dashboardCache();
  const practiced=hist?.subjects?.length;
  if(practiced!==undefined&&practiced!==null)return `${total} subjects available • ${practiced} subject${practiced===1?"":"s"} practiced so far`;
  return `${total} subjects available — pick one to begin practicing.`;
}
function subjectCardHTML(s,i){
  if(s.available&&hasTestList(s))return topicCardHTML(s,i);
  const unfinished=s.available&&store.getProgress(s.id);
  // A cooldown never blocks resuming an exam already in progress — only
  // starting a brand-new attempt.
  const lock=(s.available&&!unfinished)?subjectLockInfo(s.name):{locked:false};
  const btn=!s.available?`<button disabled>Coming Soon</button>`
    :lock.locked?`<button disabled title="You can retake this after the cooldown">Locked</button>`
    :`<button onclick="openPassword(${i})">${unfinished?"Resume Exam":"Open Exam"}</button>`;
  return `<div class="subject-card" data-sid="${esc(s.id)}"><div class="subject-no">${i+1}</div><h2>${esc(s.name)}</h2>${cardTagsHTML(s,s.available)}<p>${subjectCardMeta(s)}${lock.locked?`<br>${lockBadgeHTML(lock.unlockAt)}`:""}</p>${btn}${unfinished?`<button onclick="quickRemindLater('${esc(s.id)}','${esc(s.name)}')">Remind me later</button>`:""}</div>`;
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
// Reads the 1-day cooldown state for a subject straight out of the same
// precomputed dashboard stats already cached locally — no extra request and
// no recalculation, just a lookup + one date comparison. This is only used
// for the *display* of locked cards on Home; the actual gate that stops the
// timer from starting lives in beginExam()/retryExam() below, which always
// re-checks against the live server instead of trusting this cache.
let _defaultCooldownMin=24*60; // the server's default wait; 24 hours unless changed in the Control Centre
function lockInfoFromLastAttempt_(lastAttempt){
  if(!lastAttempt)return{locked:false};
  const unlockAt=new Date(lastAttempt).getTime()+_defaultCooldownMin*60*1000;
  const remaining=unlockAt-Date.now();
  return remaining>0?{locked:true,unlockAt,remaining}:{locked:false};
}
// The server now sends the real unlock time (unlockAt) for every subject,
// which already includes any admin adjustment. Older cached data without it
// falls back to the plain 24-hour rule.
function lockInfoFromRow_(row){
  if(!row)return{locked:false};
  if(row.unlockAt!==undefined){
    if(!row.unlockAt)return{locked:false};
    const unlockAt=new Date(row.unlockAt).getTime(),remaining=unlockAt-Date.now();
    return remaining>0?{locked:true,unlockAt,remaining}:{locked:false};
  }
  return lockInfoFromLastAttempt_(row.lastAttempt);
}
function subjectLockInfo(name){
  const d=store.dashboardCache();
  return lockInfoFromRow_(d?.subjects?.find(x=>x.subject===name));
}
function lockBadgeHTML(unlockAt){
  return `<span class="cooldown-badge" data-unlock="${unlockAt}">Locked — retake in ${formatCooldown(unlockAt-Date.now())}</span>`;
}
// Re-renders just the meta text / lock state on already-painted subject
// cards once fresh precomputed stats arrive from homeBundle, instead of a
// full home() re-render (which would also reset scroll position).
function refreshSubjectCardStats(){
  const grid=document.querySelector('.home .subject-grid');
  if(grid)grid.innerHTML=subjects.map((s,i)=>subjectCardHTML(s,i)).join("");
  const cgrid=document.getElementById('customSubjectGrid');
  if(cgrid)cgrid.innerHTML=customSubjectsHTML();
  armCooldownTicker();
}
let _cooldownTicker=null;
// One shared interval updates every locked card's countdown text in place —
// cheap even with many locked subjects, since it's just formatting a stored
// timestamp difference, not a network call or recompute.
function armCooldownTicker(){
  clearInterval(_cooldownTicker);
  if(!document.querySelector('.cooldown-badge'))return;
  _cooldownTicker=setInterval(()=>{
    const badges=document.querySelectorAll('.cooldown-badge');
    if(!badges.length){clearInterval(_cooldownTicker);return;}
    badges.forEach(b=>{
      const unlockAt=Number(b.dataset.unlock);
      const remaining=unlockAt-Date.now();
      if(remaining<=0){refreshSubjectCardStats();return;}
      b.textContent=`Locked — retake in ${formatCooldown(remaining)}`;
    });
  },30000);
}
function hardRefresh(){
  if(!confirm("Clear locally cached data and reload fresh from the server?"))return;
  ["ecet_dashboard_cache","ecet_profiledata_cache","ecet_mistakes_cache","ecet_reminders_cache","ecet_customsubjects_cache","ecet_topic_summary_cache","ecet_static_topics_cache","ecet_topic_summary_cache_v2","ecet_static_topics_cache_v2"].forEach(k=>localStorage.removeItem(k));
  const b=document.getElementById("hardRefreshBtn");if(b)b.classList.add("busy");
  setTimeout(()=>location.reload(),350);
}
async function refreshCustomSubjects(manual){
  if(!API)return;
  const iconBtn=manual?document.querySelector('.icon-btn'):null;
  if(iconBtn){iconBtn.disabled=true;iconBtn.classList.add('spinning');}
  try{
    const cs=await apiGet("customSubjects",{},SERVER_STATUS_TIMEOUT_MS);
    if(cs?.ok&&Array.isArray(cs.data)){
      customSubjects=cs.data;
      store.setCustomSubjectsCache(cs.data);
      if(cs.topicSummary)setServerTopics(cs.topicSummary);
      refreshSubjectCardStats();
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
// Cold Apps Script containers routinely take 10-11s to answer doGet (see
// execution log), so the status check's timeout has to comfortably clear
// that or the frontend gives up right before the real response lands.
const SERVER_STATUS_TIMEOUT_MS=15000;
let _offlineRetryTimer=null;
// "retry" is a real clickable control, not just static text in the offline
// message — clicking it forces a fresh check instead of waiting for the
// cache TTL or for the user to navigate Home again.
function offlineStatusHTML_(){return 'Server offline — <span class="retry-link" onclick="checkServerStatusAndBundle(true)">retry</span>';}
function applyServerStatus_(status,statusEl,slot){
  if(statusEl){statusEl.className='server-status '+(status.online?'online':'offline');statusEl.innerHTML=`<span class="server-dot"></span><span>${status.online?'Server online':offlineStatusHTML_()}</span>`;}
  if(status.isAdmin&&!isAdminUnlocked&&slot)slot.innerHTML='<button onclick="adminQuestionsPage()">Admin: Add Questions</button>';
  let changed=false;
  if(status.topicSummary){setServerTopics(status.topicSummary);changed=true;}
  if(Array.isArray(status.customSubjects)){
    customSubjects=status.customSubjects;
    store.setCustomSubjectsCache(customSubjects);
    changed=true;
  }
  if(changed)refreshSubjectCardStats(); // re-renders both grids (built-in subjects can have topics too)
}
async function checkServerStatusAndBundle(force){
  const statusEl=document.getElementById('serverStatus');
  const slot=document.getElementById('adminNavSlot');
  if(_offlineRetryTimer){clearTimeout(_offlineRetryTimer);_offlineRetryTimer=null;}
  if(!API){if(statusEl){statusEl.className='server-status offline';statusEl.innerHTML='<span class="server-dot"></span><span>Server offline — API not configured</span>';}return;}
  const fresh=_serverStatusCache&&(Date.now()-_serverStatusCache.checkedAt<SERVER_STATUS_TTL_MS);
  if(fresh&&!force){applyServerStatus_(_serverStatusCache,statusEl,slot);return;}
  if(statusEl){statusEl.className='server-status checking';statusEl.innerHTML='<span class="server-dot"></span><span>Checking server…</span>';}
  if(isAdminUnlocked&&slot)slot.innerHTML='<button onclick="adminQuestionsPage()">Admin: Add Questions</button>';
  const p=store.profile();
  const res=await apiGet('homeBundle',p?{email:p.email}:{},SERVER_STATUS_TIMEOUT_MS);
  if(res?.ok){
    if(Number.isFinite(res.data?.cooldownMinutes))_defaultCooldownMin=res.data.cooldownMinutes;
    _serverStatusCache={online:true,isAdmin:!!res.data?.isAdmin,customSubjects:Array.isArray(res.data?.customSubjects)?res.data.customSubjects:customSubjects,topicSummary:res.data?.topicSummary,checkedAt:Date.now()};
    applyServerStatus_(_serverStatusCache,statusEl,slot);
    // homeBundle already carries the same pre-aggregated stats dashboard_()
    // would return (a single-row UserStats lookup, not a recompute) — cache
    // it here too so subject cards show real Best/Worst/cooldown data on
    // every home visit, not only after the user has opened My Dashboard once.
    if(p&&res.data?.dashboard){store.setDashboardCache(res.data.dashboard);refreshSubjectCardStats();}
  }else{
    _serverStatusCache={online:false,isAdmin:isAdminUnlocked,customSubjects,checkedAt:Date.now()};
    if(statusEl){statusEl.className='server-status offline';statusEl.innerHTML=`<span class="server-dot"></span><span>${offlineStatusHTML_()}</span>`;}
    // Don't just sit on "offline" until the user manually revisits Home —
    // keep quietly re-checking in the background, but only while the status
    // pill is still on screen (stop once the user has navigated away).
    _offlineRetryTimer=setTimeout(()=>{
      _offlineRetryTimer=null;
      if(document.getElementById('serverStatus'))checkServerStatusAndBundle(true);
    },12000);
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
function editProfile(){pushNav(editProfile);const p=store.profile()||{name:"",email:""};
  // Email is intentionally locked here. Every piece of a user's data (dashboard,
  // mistakes, reminders, history, progress) is keyed by email on the backend, so
  // silently letting someone edit it here would look up (or create) a different
  // account and make all their existing data appear to vanish — like a brand new
  // account. Name is just a display label and is always safe to change freely.
  app.innerHTML=`<div class="card enroll-card"><h1>Your details</h1><label>Name</label><input id="pname" value="${esc(p.name)}"><label>Email</label><input id="pemail" type="email" value="${esc(p.email)}" disabled title="To change your email, log out and sign in with the new email."><p class="note">Your data (results, mistakes, reminders, history) is tied to your email. To switch to a different email, log out and sign in again with the new one — it will start as a separate account.</p><div id="pErr" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="saveProfileEdit()">Save</button></div></div>`;}
async function saveProfileEdit(){
  const n=document.getElementById("pname").value.trim();
  const p=store.profile()||{name:"",email:""};
  const e=p.email; // email is locked in this form — never taken from the input
  if(!n){document.getElementById("pErr").textContent="Enter a valid name.";return;}
  const errEl=document.getElementById("pErr");errEl.textContent="";
  const btn=document.querySelector('.enroll-card .buttons button[onclick="saveProfileEdit()"]');
  if(btn){btn.disabled=true;btn.textContent="Saving…";}
  // Persist to the backend Users sheet too (keyed by email), not just localStorage —
  // otherwise a name change never reaches the account record, so the same email
  // keeps showing the old name everywhere the backend is the source of truth
  // (dashboard, rankings, result emails, admin views). Email is always the
  // existing one, so this always updates the SAME account row, never creates
  // a new one.
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
function subjectStatusCellHTML(s){
  const lock=lockInfoFromRow_(s);
  if(!lock.locked)return '<span class="correct">Available</span>';
  return `<span class="cooldown-badge" data-unlock="${lock.unlockAt}">Locked — ${formatCooldown(lock.remaining)}</span>`;
}
function renderProfileBody(d,connecting){
  app.innerHTML=`<div class="card"><h1>My Profile</h1>${connecting?connBannerHTML():""}<p class="meta">${esc(d.name)} • ${esc(d.email)}</p><p class="note">Member since ${d.createdAt?esc(formatDateTime(d.createdAt)):"—"}</p>
    <div class="dash-grid"><div class="dash-tile"><b>${d.attempts}</b><span>Exams attended</span></div><div class="dash-tile"><b>${d.avg}%</b><span>Average marks</span></div><div class="dash-tile"><b>${d.best}%</b><span>Best marks</span></div><div class="dash-tile"><b>${d.attempts}</b><span>Total attempts</span></div></div>
    <div class="dash-grid"><div class="dash-tile"><b>${d.mistakes}</b><span>Mistakes count</span></div><div class="dash-tile"><b>${d.reminders}</b><span>Reminders count</span></div></div>
    <h2>Subjects attended</h2>
    ${d.subjects?.length?`<div class="table-scroll"><table class="simple"><thead><tr><th>Subject</th><th>Times attended</th><th>Best %</th><th>Worst %</th><th>Average %</th><th>Status</th></tr></thead><tbody>${d.subjects.map(s=>`<tr><td>${esc(s.subject)}</td><td>${s.attempts}</td><td>${s.best}%</td><td>${s.worst!=null?s.worst+"%":"—"}</td><td>${s.avg}%</td><td>${subjectStatusCellHTML(s)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">A subject is locked for 1 day after you complete an attempt on it, then unlocks automatically — no email is sent about this.</p>`:'<p class="note">No attempts yet.</p>'}
    <p class="note">See Dashboard for recent activity and test frequency.</p>
    <div class="buttons"><button onclick="editProfile()">Edit Profile</button><button onclick="goDashboard()">Dashboard</button><button onclick="logoutUser()">Logout</button><button onclick="deleteAccountPrompt()">Delete Account</button><button onclick="home()">Home</button></div></div>`;
  armCooldownTicker();
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
/* ===================== ADMIN — TOPIC FIELD (shared) =====================
 * A dropdown of the subject's existing topics, plus "New topic…" which reveals a
 * text box. Used by Add Questions, Add a Single Question, Edit Question and the
 * bulk "move to topic" tool. `pfx` keeps each instance's element ids apart;
 * `cb` is the name of a global function to call whenever the choice changes. */
function topicsForSubjectId(sid,exam){
  const s=findSubjectById(sid);if(!s)return [];
  const key=topicKey(exam||homeExam(s)),g=subjectGroups(s).find(x=>x.examKey===key);
  return g?g.topics:[];
}
// Exam dropdown: the subject's default, exams it already uses, GATE / ECET, or another one.
// current === null (bulk tool only) means "keep each question's current exam".
function examFieldHTML(pfx,sid,current,cb,keepOption){
  const s=findSubjectById(sid),home=s?homeExam(s):"",hk=topicKey(home),seen=new Set(),opts=[];
  [...(s?subjectGroups(s).map(g=>g.exam):[]),"GATE","ECET"].forEach(n=>{const k=topicKey(n);if(!k||k===hk||seen.has(k))return;seen.add(k);opts.push(n);});
  const cur=current===null?null:cleanTopic(current);
  const chosen=cur===null?"__keep__":!cur||topicKey(cur)===hk?"":(opts.find(n=>topicKey(n)===topicKey(cur))||"__new__");
  return `<select id="${pfx}ExamSel" onchange="examSelChanged('${pfx}')">${keepOption?`<option value="__keep__" ${chosen==="__keep__"?"selected":""}>— Keep each question's current exam —</option>`:""}<option value="" ${chosen===""?"selected":""}>Subject default${home?` (${esc(home)})`:" (no exam)"}</option>${opts.map(n=>`<option value="${esc(n)}" ${chosen===n?"selected":""}>${esc(n)}</option>`).join("")}<option value="__new__" ${chosen==="__new__"?"selected":""}>➕ Another exam…</option></select><input id="${pfx}ExamNew" type="text" maxlength="40" placeholder="Exam name, e.g. TS PGECET" value="${chosen==="__new__"?esc(cur):""}" style="${chosen==="__new__"?"":"display:none;"}margin-top:8px" oninput="topicInputChanged('${cb||""}')">`;
}
function topicFieldHTML(pfx,sid,current,cb,exam){
  const topics=topicsForSubjectId(sid,exam),cur=cleanTopic(current);
  const match=cur?topics.find(t=>topicKey(t.name)===topicKey(cur)):null;
  const chosen=!cur?"":match?match.name:"__new__";
  return `<select id="${pfx}TopicSel" onchange="topicSelChanged('${pfx}'${cb?`,'${cb}'`:""})"><option value="">— No topic (general subject question) —</option>${topics.map(t=>`<option value="${esc(t.name)}" ${chosen===t.name?"selected":""}>${esc(t.name)} (${t.count} question${t.count===1?"":"s"})</option>`).join("")}<option value="__new__" ${chosen==="__new__"?"selected":""}>➕ New topic…</option></select><input id="${pfx}TopicNew" type="text" maxlength="80" placeholder="New topic name, e.g. Capacitors &amp; Inductors" value="${chosen==="__new__"?esc(cur):""}" style="${chosen==="__new__"?"":"display:none;"}margin-top:8px" oninput="topicInputChanged(${cb?`'${cb}'`:""})">`;
}
// Both fields together; the topic list follows the chosen exam.
function examTopicHTML(pfx,sid,curExam,curTopic,cb,keepOption){
  const ex=curExam===null?"":cleanTopic(curExam);
  return `<div id="${pfx}ET" data-sid="${esc(sid)}" data-cb="${cb||""}"><label>Exam</label>${examFieldHTML(pfx,sid,curExam,cb,keepOption)}<label>Topic (optional)</label><div id="${pfx}TopicSub">${topicFieldHTML(pfx,sid,curTopic,cb,ex)}</div></div>`;
}
function examSelChanged(pfx){
  const wrap=document.getElementById(pfx+"ET"),sel=document.getElementById(pfx+"ExamSel"),inp=document.getElementById(pfx+"ExamNew");
  if(!wrap||!sel||!inp)return;
  const isNew=sel.value==="__new__";inp.style.display=isNew?"":"none";if(isNew)inp.focus();
  const ex=readExamField(pfx);
  document.getElementById(pfx+"TopicSub").innerHTML=topicFieldHTML(pfx,wrap.dataset.sid,readTopicField(pfx),wrap.dataset.cb,ex==="__keep__"?"":ex);
  const cb=wrap.dataset.cb;if(cb&&typeof window[cb]==="function")window[cb]();
}
function readExamField(pfx){
  const sel=document.getElementById(pfx+"ExamSel");if(!sel)return "";
  if(sel.value==="__new__")return cleanTopic(document.getElementById(pfx+"ExamNew")?.value);
  return sel.value==="__keep__"?"__keep__":cleanTopic(sel.value);
}
function examFieldIncomplete(pfx){
  const sel=document.getElementById(pfx+"ExamSel");
  return !!sel&&sel.value==="__new__"&&!cleanTopic(document.getElementById(pfx+"ExamNew")?.value);
}
function topicSelChanged(pfx,cb){
  const sel=document.getElementById(pfx+"TopicSel"),inp=document.getElementById(pfx+"TopicNew");
  if(!sel||!inp)return;
  const isNew=sel.value==="__new__";
  inp.style.display=isNew?"":"none";
  if(isNew)inp.focus();
  if(cb&&typeof window[cb]==="function")window[cb]();
}
function topicInputChanged(cb){if(cb&&typeof window[cb]==="function")window[cb]();}
function readTopicField(pfx){
  const sel=document.getElementById(pfx+"TopicSel");if(!sel)return "";
  return cleanTopic(sel.value==="__new__"?document.getElementById(pfx+"TopicNew")?.value:sel.value);
}
// "New topic…" chosen but nothing typed yet.
function topicFieldIncomplete(pfx){
  const sel=document.getElementById(pfx+"TopicSel");
  return !!sel&&sel.value==="__new__"&&!cleanTopic(document.getElementById(pfx+"TopicNew")?.value);
}
function refreshAdminTopicField(keep){
  const sel=document.getElementById("adminSubject"),wrap=document.getElementById("adminTopicWrap");
  if(!sel||!wrap)return;
  const e=keep?readExamField("at"):"",t=keep?readTopicField("at"):"";
  wrap.innerHTML=examTopicHTML("at",sel.value,e==="__keep__"?"":e,t,"adminTopicChanged");
}
function adminTopicChanged(){refreshAiPrompt();renderImportPreview();}

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
    if(API){try{const cs=await apiGet("customSubjects",{});if(cs?.ok&&Array.isArray(cs.data)){customSubjects=cs.data;store.setCustomSubjectsCache(cs.data);if(cs.topicSummary)setServerTopics(cs.topicSummary);}}catch(e){console.warn("Custom subjects load failed",e);}}
    const curYear=new Date().getFullYear();
    app.innerHTML=`<div class="card"><h1>Admin — Create New Subject</h1>
      <p class="note">Create a brand-new practice test subject with no code or GitHub changes. It appears immediately in "Practice Tests Added by Admin" on the homepage, and below in the Subject dropdown so you can bulk-import its questions.</p>
      <label>Subject Name</label><input id="newSubjectName" placeholder="e.g. Machine Learning Basics">
      <label>Subject Password</label><input id="newSubjectPassword" placeholder="Password students will enter">
      <label>Exam / category</label><input id="newSubjectExam" list="examChoices" placeholder="GATE, ECET or anything else" autocomplete="off"><datalist id="examChoices"><option value="GATE"><option value="ECET"></datalist>
      <label>Description (optional)</label><input id="newSubjectDesc" placeholder="Shown as the subject's tagline on the homepage">
      <div id="newSubjectStatus" class="note"></div>
      <div class="buttons"><button onclick="createNewSubject()">Create Subject</button></div>
    </div>
    <div class="card"><h1>Admin — Add Questions</h1>
      <p class="note">Select an existing subject to add its questions, or pick "Create New Subject" to make a brand-new one above first.</p>
      <label>Subject</label><select id="adminSubject" onchange="if(this.value==='__new__'){document.getElementById('newSubjectName').scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('newSubjectName').focus();this.value=this.options[0].value;}refreshAdminTopicField();refreshAiPrompt();renderImportPreview();">
        ${adminSubjectOptions()}
        <option value="__new__">➕ Create New Subject…</option>
      </select>
      <label style="margin-top:14px">Exam &amp; topic (optional) — makes a topic-wise test</label>
      <div id="adminTopicWrap"></div>
      <p class="note">The same subject can be used for more than one exam: pick the <b>Exam</b> these questions are for (GATE, ECET or another), and a <b>Topic</b> to make a topic-wise test — for example <b>Networks → GATE → Basics, Capacitors &amp; Inductors, Two-Ports</b>. On the Home page each exam gets its own list inside the subject; an exam with no topics is just its Full Subject Test. An Excel file can also carry its own <b>Topic</b> and <b>Exam</b> columns; rows with a blank value use what is chosen here.</p>
      <label>Exam Year</label><input id="adminYear" type="number" value="${curYear}" placeholder="e.g. 2026" onchange="refreshAiPrompt()">
      <p class="note">Used for any row whose Year column is left blank in the Excel file, and filled into the AI prompt below.</p>

      <h2 style="margin-top:26px">Don't want to type questions by hand? Ask an AI</h2>
      <label>Exam / series name (optional)</label><input id="aiExamName" placeholder="e.g. GATE, ECET, campus placement mock" onchange="refreshAiPrompt()">
      <p class="note">The prompt below now asks the AI to hand back a ready-to-upload Excel (.xlsx) file directly — no copy-pasting rows.</p>
      <p class="note"><b>Mandatory columns:</b> Question, Option A, Option B, Option C, Option D, Correct Answer, Year. &nbsp; <b>Optional:</b> Topic, State, Question Number, and all Image URL columns — leave blank if unused.</p>
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
      <div class="buttons"><button onclick="editQuestionsPage()">✏️ Edit Questions</button><button onclick="recentChangesPage()">🕘 Recent Changes</button><button onclick="openControlCentre()">🎛 Control Centre</button><button onclick="home()">Back to Home</button></div>
    </div>`;
    refreshAdminTopicField();
    refreshAiPrompt();
  });
}


/* ===================== ADMIN — CONTROL CENTRE =====================
 * Opened from the admin page with its own password (checked on the server — the
 * password is never in this file). Tabs:
 *   🔒 Locks & Timers — default wait for everyone + lock/unlock any subject for one student
 *   🔑 Passwords      — every subject password and the admin passwords
 *   🗂 Subjects       — set a subject's exam, select and delete several subjects at once */
let _tcSubjects=[],_tcUsers=[],_controlPw="",_ccTab="locks",_ccData=null,_ccShowPw=false,_ccSel=new Set();
function adminAuth_(){const p=store.profile();return{adminEmail:p?.email||"",adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:""};}
function controlAuth_(){return{...adminAuth_(),controlPassword:_controlPw};}
const DURATION_PRESETS=[["24 hours",1440],["3 days",4320],["7 days",10080],["1 month",43200]];
function fmtMinutes(m){
  m=Math.round(Number(m)||0);
  if(m<=0)return "no wait";
  if(m%43200===0)return m===43200?"1 month":(m/43200)+" months";
  if(m%1440===0){const d=m/1440;return d===1?"24 hours":d+" days";}
  if(m%60===0){const h=m/60;return h+" hour"+(h===1?"":"s");}
  return m+" minutes";
}
// Preset chips (24 hours / 3 days / 7 days / 1 month) + a Custom amount. `pfx` keeps instances apart.
function durationPickerHTML(pfx,minutes){
  const preset=DURATION_PRESETS.some(([,m])=>m===minutes),custom=!preset;
  const unit=preset?1:(minutes%1440===0?1440:minutes%60===0?60:1); // a fresh Custom box starts in minutes, so a typed 221 can't become 221 days
  return `<div class="dur-chips" id="${pfx}Chips" data-sel="${custom?"custom":minutes}">${DURATION_PRESETS.map(([l,m])=>`<button type="button" class="dur-chip${minutes===m?" on":""}" data-min="${m}" onclick="durPick('${pfx}',${m})">${l}</button>`).join("")}<button type="button" class="dur-chip${custom?" on":""}" data-min="custom" onclick="durPick('${pfx}','custom')">Custom</button></div><div class="tc-amount" id="${pfx}Custom" style="${custom?"":"display:none;"}margin-top:10px"><input id="${pfx}Amount" type="number" min="0" step="1" placeholder="e.g. 5" value="${custom&&minutes>0?minutes/unit:""}"><select id="${pfx}Unit"><option value="1" ${unit===1?"selected":""}>minutes</option><option value="60" ${unit===60?"selected":""}>hours</option><option value="1440" ${unit===1440?"selected":""}>days</option></select></div>`;
}
function durPick(pfx,m){
  const chips=document.getElementById(pfx+"Chips");if(!chips)return;
  chips.dataset.sel=String(m);
  chips.querySelectorAll(".dur-chip").forEach(b=>b.classList.toggle("on",b.dataset.min===String(m)));
  const c=document.getElementById(pfx+"Custom");if(c)c.style.display=m==="custom"?"":"none";
}
// minutes chosen in a picker, or null when a custom amount is missing/invalid
function readDuration(pfx){
  const chips=document.getElementById(pfx+"Chips");if(!chips)return null;
  const sel=chips.dataset.sel;
  if(sel!=="custom")return Number(sel);
  const raw=document.getElementById(pfx+"Amount").value,val=Number(raw);
  if(raw===""||!isFinite(val)||val<0)return null;
  return Math.round(val*Number(document.getElementById(pfx+"Unit").value));
}
// A Control Centre call was refused because the password is missing/wrong → ask for it again.
function ccDenied(res){
  if(res&&res.ok===false&&/Control Centre password/i.test(res.error||"")){_controlPw="";_ccData=null;renderControlGate("Please enter the Control Centre password again.");return true;}
  return false;
}
function openControlCentre(){_controlPw="";_ccData=null;_ccShowPw=false;_ccSel=new Set();controlCentrePage();}
function controlCentrePage(){
  pushNav(controlCentrePage);
  if(!isAdminUnlocked){app.innerHTML='<div class="card"><h1>Admin access required</h1><div class="buttons"><button onclick="home()">Back</button></div></div>';return;}
  if(!_controlPw){renderControlGate();return;}
  requireProfile(()=>ccRender());
}
function renderControlGate(msg){
  app.innerHTML=`<div class="card password-card"><h1>🎛 Control Centre</h1><p>Enter the Control Centre password.</p><input id="ccPassword" type="password" inputmode="numeric" placeholder="Password" autocomplete="off" onkeydown="if(event.key==='Enter')controlLogin()"><div id="ccGateError" class="error">${msg?esc(msg):""}</div><div class="buttons"><button onclick="adminQuestionsPage()">Back</button><button onclick="controlLogin()">Unlock</button></div></div>`;
  document.getElementById("ccPassword")?.focus();
}
async function controlLogin(){
  const pw=(document.getElementById("ccPassword")?.value||"").trim(),err=document.getElementById("ccGateError");
  if(!pw){err.textContent="Enter the password.";return;}
  err.textContent="Checking…";
  const res=await apiPost("controlLogin",{...adminAuth_(),controlPassword:pw},20000);
  if(!res?.ok){err.textContent=res?res.error||"Incorrect password.":"Could not reach the server. Check your connection and try again.";return;}
  _controlPw=pw;
  requireProfile(()=>ccRender());
}
function ccRender(){
  const tabs=[["locks","🔒 Locks & Timers"],["passwords","🔑 Passwords"],["subjects","🗂 Subjects"],["tests","🧩 Topic Tests"]];
  app.innerHTML=`<div class="card cc"><h1>🎛 Control Centre</h1><div class="cc-tabs">${tabs.map(([k,l])=>`<button class="${_ccTab===k?"on":""}" data-tab="${k}" onclick="ccTab('${k}')">${l}</button>`).join("")}</div><div id="ccBody"></div><div class="buttons"><button onclick="adminQuestionsPage()">Back</button></div></div>`;
  ccTab(_ccTab);
}
async function ccTab(tab){
  _ccTab=tab;
  document.querySelectorAll(".cc-tabs button").forEach(b=>b.classList.toggle("on",b.dataset.tab===tab));
  const body=document.getElementById("ccBody");if(!body)return;
  if(!_ccData){
    body.innerHTML='<p class="note">Loading…</p>';
    const res=await apiPost("controlData",controlAuth_(),30000);
    if(ccDenied(res))return;
    if(!res?.ok){body.innerHTML=`<p class="wronganswer">${esc(res?.error||"Could not load. Check your connection and try again.")}</p>`;return;}
    _ccData=res;
    if(Array.isArray(res.subjects)){customSubjects=res.subjects;store.setCustomSubjectsCache(res.subjects);}
    if(res.topicSummary)setServerTopics(res.topicSummary);
    _defaultCooldownMin=res.cooldownMinutes;
  }
  if(_ccTab!==tab)return; // the admin clicked another tab while this one was loading
  if(tab==="locks")ccLocksTab();else if(tab==="passwords")ccPasswordsTab();else if(tab==="tests")ccTestsTab();else ccSubjectsTab();
}

/* ---------- 🔒 Locks & Timers ---------- */
function ccLocksTab(){
  const body=document.getElementById("ccBody");if(!body)return;
  _tcSubjects=[];[...subjects,...customSubjects].forEach(s=>unitNames(s).forEach(n=>_tcSubjects.push(n))); // each topic test has its own lock
  body.innerHTML=`<h2>Default wait after an exam</h2>
    <p class="note">A subject stays locked for <b id="ccDefaultLabel">${esc(fmtMinutes(_ccData.cooldownMinutes))}</b> after a student finishes it. Choose a new wait for everyone. Students who finished recently are re-checked against it straight away.</p>
    ${durationPickerHTML("dw",_ccData.cooldownMinutes)}
    <div class="buttons"><button onclick="ccSaveDefault()">Save default wait</button></div><div id="ccDefaultMsg" class="note"></div>
    <hr class="cc-hr">
    <h2>Lock or unlock a subject for one student</h2>
    <label>Student</label>
    <input id="tcFilter" placeholder="Type a name or email to filter…" oninput="tcFilterUsers()" autocomplete="off">
    <select id="tcUser" size="6" onchange="tcLoadStatus()" style="margin-top:8px"><option disabled>Loading students…</option></select>
    <h2 style="margin-top:22px">How long?</h2>
    <p class="note">Used by <b>Lock</b> (locked for exactly this long from now), <b>＋ Add</b> and <b>－ Reduce</b> (change the wait that is left).</p>
    ${durationPickerHTML("tc",1440)}
    <div id="tcMsg" class="note"></div>
    <div id="tcBody"></div>`;
  (async()=>{
    const res=await apiPost("adminCooldownList",{...controlAuth_(),includeUsers:true},30000);
    if(ccDenied(res))return;
    if(!res?.ok){const u=document.getElementById("tcUser");if(u)u.innerHTML="";const m=document.getElementById("tcMsg");if(m)m.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not load students. Check your connection and try again.")}</span>`;return;}
    _tcUsers=res.users||[];tcFilterUsers();
  })();
}
async function ccSaveDefault(){
  const msg=document.getElementById("ccDefaultMsg"),m=readDuration("dw");
  if(m===null){msg.innerHTML='<span class="wronganswer">Enter a valid wait (0 or more) first.</span>';return;}
  if(!confirm(`Lock every subject for ${fmtMinutes(m)} after a student finishes it?`))return;
  msg.textContent="Saving…";
  const res=await apiPost("setDefaultCooldown",{...controlAuth_(),minutes:m},30000);
  if(ccDenied(res))return;
  if(!res?.ok){msg.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not save. Please try again.")}</span>`;return;}
  _ccData.cooldownMinutes=res.cooldownMinutes;_defaultCooldownMin=res.cooldownMinutes;
  document.getElementById("ccDefaultLabel").textContent=fmtMinutes(res.cooldownMinutes);
  msg.innerHTML=`<span class="correct">Saved — subjects now lock for ${esc(fmtMinutes(res.cooldownMinutes))} after an exam.</span>`;
  if(document.getElementById("tcUser")?.value)tcLoadStatus();
}
function tcFilterUsers(){
  const q=(document.getElementById("tcFilter")?.value||"").trim().toLowerCase(),sel=document.getElementById("tcUser");
  if(!sel)return;
  const keep=sel.value;
  const list=_tcUsers.filter(u=>!q||u.name.toLowerCase().includes(q)||u.email.includes(q));
  sel.innerHTML=list.length?list.map(u=>`<option value="${esc(u.email)}" ${u.email===keep?"selected":""}>${esc(u.name||"(no name)")} — ${esc(u.email)}</option>`).join(""):"<option disabled>No student found</option>";
}
async function tcLoadStatus(){
  const email=document.getElementById("tcUser")?.value,body=document.getElementById("tcBody");
  if(!email||!body)return;
  const keepFilter=document.getElementById("tcSubFilter")?.value||""; // the list reloads after every Lock/Unlock — keep what was typed
  body.innerHTML='<p class="note">Loading…</p>';
  const res=await apiPost("adminCooldownList",{...controlAuth_(),targetEmail:email,subjects:_tcSubjects},30000);
  if(ccDenied(res))return;
  if(!res?.ok){body.innerHTML=`<p class="wronganswer">${esc(res?.error||"Could not load this student.")}</p>`;return;}
  const def=fmtMinutes(_ccData.cooldownMinutes);
  const btns=i=>`<button class="lock" onclick="tcAct(${i},'set')">🔒 Lock</button><button onclick="tcAct(${i},'unlock')">🔓 Unlock now</button><button class="ghost" onclick="tcAct(${i},'add')">＋ Add</button><button class="ghost" onclick="tcAct(${i},'sub')">－ Reduce</button><button class="ghost" onclick="tcAct(${i},'default')" title="Remove admin changes — back to the default wait">Normal (${esc(def)})</button>`;
  const rows=(res.statuses||[]).map((s,i)=>`<div class="cc-row" data-name="${esc(s.subject.toLowerCase())}"><div class="cc-row-main"><b>${esc(s.subject)}</b><small>${s.lastAttempt?"Last attempt "+esc(formatDateTime(s.lastAttempt)):"Never attempted"}</small><div>${s.locked?`<span class="cooldown-badge">Locked — ${formatCooldown(s.remainingMinutes*60000)}</span>`:'<span class="correct">Available</span>'}${s.overridden?' <span class="note">adjusted by admin</span>':""}</div></div><div class="tc-btns">${btns(i)}</div></div>`).join("");
  body.innerHTML=`<h2 style="margin-top:22px">Subjects</h2><input id="tcSubFilter" placeholder="Filter subjects or topic tests…" oninput="tcFilterSubjects()" autocomplete="off"><div class="cc-list" id="tcRows"><div class="cc-row all"><div class="cc-row-main"><b>All subjects</b><small>Applies to every subject at once</small></div><div class="tc-btns">${btns(-1)}</div></div>${rows}</div>`;
  const f=document.getElementById("tcSubFilter");
  if(f&&keepFilter){f.value=keepFilter;tcFilterSubjects();}
}
function tcFilterSubjects(){
  const q=(document.getElementById("tcSubFilter")?.value||"").trim().toLowerCase();
  document.querySelectorAll("#tcRows .cc-row[data-name]").forEach(r=>{r.style.display=!q||r.dataset.name.includes(q)?"":"none";});
}
async function tcAct(i,mode){
  const email=document.getElementById("tcUser")?.value,msg=document.getElementById("tcMsg");
  if(!email){msg.innerHTML='<span class="wronganswer">Select a student first.</span>';return;}
  const subject=i<0?"*":_tcSubjects[i];
  let minutes=0,apiMode=mode;
  if(mode==="set"||mode==="add"||mode==="sub"){
    const m=readDuration("tc");
    if(m===null){msg.innerHTML='<span class="wronganswer">Choose how long first (or enter a valid custom amount).</span>';return;}
    minutes=m;
    if(mode==="sub"){minutes=-minutes;apiMode="add";}
  }
  msg.innerHTML='<span class="note">Saving…</span>';
  const res=await apiPost("adminCooldownAdjust",{...controlAuth_(),targetEmail:email,subject,mode:apiMode,minutes},30000);
  if(ccDenied(res))return;
  if(!res?.ok){msg.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not save. Please try again.")}</span>`;return;}
  const what=mode==="set"?`Locked for ${fmtMinutes(minutes)}.`:res.message||"Saved.";
  msg.innerHTML=`<span class="correct">${esc(what)}</span>`;
  tcLoadStatus();
}

/* ---------- 🔑 Passwords ---------- */
function ccTogglePw(){_ccShowPw=!_ccShowPw;ccPasswordsTab();}
function ccPasswordsTab(){
  const body=document.getElementById("ccBody");if(!body)return;
  const show=v=>_ccShowPw?`<code>${esc(v)}</code>`:"••••••";
  const all=[...subjects.map(s=>({name:s.name,exam:homeExam(s),pw:s.password,kind:s.available?"Built-in":"Built-in (coming soon)"})),..._ccData.subjects.map(s=>({name:s.name,exam:homeExam(s),pw:s.password,kind:"Custom"}))];
  body.innerHTML=`<p class="note">These are the passwords students type to open a subject, plus the admin passwords. They stay hidden until you press the button.</p>
    <div class="buttons"><button onclick="ccTogglePw()">${_ccShowPw?"🙈 Hide passwords":"👁 Show passwords"}</button></div>
    <h2>Subject passwords</h2>
    <div class="table-scroll"><table class="simple"><thead><tr><th>#</th><th>Subject</th><th>Default exam</th><th>Type</th><th>Password</th></tr></thead><tbody>${all.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name)}</b></td><td>${r.exam?esc(r.exam):"—"}</td><td>${esc(r.kind)}</td><td>${show(r.pw)}</td></tr>`).join("")}</tbody></table></div>
    <h2>Admin</h2>
    <div class="table-scroll"><table class="simple"><tbody>
      <tr><td><b>Admin panel password</b></td><td>${show(_ccData.adminPanelPassword)}</td></tr>
      <tr><td><b>Control Centre password</b></td><td>${show(_ccData.controlPassword)}</td></tr>
      <tr><td><b>Admin email${(_ccData.adminEmails||[]).length===1?"":"s"}</b></td><td>${(_ccData.adminEmails||[]).length?_ccData.adminEmails.map(esc).join("<br>"):"—"}</td></tr>
    </tbody></table></div>`;
}

/* ---------- 🗂 Subjects: rename, merge, delete, default exam ---------- */
let _ccFlash="",_ccTests=[],_ccTestSel=new Set();
function ccFlashHTML(){const m=_ccFlash;_ccFlash="";return m;}
function ccTargets_(){return [...subjects.map(s=>({id:s.id,name:s.name,builtin:true})),..._ccData.subjects.map(s=>({id:s.id,name:s.name}))];}
function ccTargetOptions_(){return ccTargets_().map(t=>`<option value="${esc(t.id)}">${esc(t.name)}${t.builtin?" (built-in)":""}</option>`).join("");}
function ccMsg_(html){const m=document.getElementById("ccDelMsg");if(m)m.innerHTML=html;}
// reload everything from the server, then show a message on the tab that is open
async function ccReload(flashHTML){_ccFlash=flashHTML||"";_ccData=null;_ccSel=new Set();_ccTestSel=new Set();await ccTab(_ccTab);}
function ccForget_(ids){ids.forEach(id=>{_expandedSubjects.delete(id);_unlockedSubjects.delete(id);});}
function ccSubjectsTab(){
  const body=document.getElementById("ccBody");if(!body)return;
  const custom=_ccData.subjects,n=_ccSel.size;
  body.innerHTML=`<datalist id="examChoices"><option value="GATE"><option value="ECET"></datalist>
    <p class="note">Tick custom subjects to <b>merge</b> them into another subject, or to <b>delete</b> them. Merging moves all their questions (with their topics and exams) into the chosen subject and removes the merged subjects. Deleting removes a subject <b>with all its questions</b>. Past results stay under the old names either way. Built-in subjects come from <code>subjects.json</code> and can be merged <i>into</i>, but not renamed, merged away or deleted here.</p>
    <div class="buttons"><button class="ghost" onclick="ccSelectAll(true)">Select all</button><button class="ghost" onclick="ccSelectAll(false)">Clear</button></div>
    <div class="cc-tools"><label>Merge the ticked subjects into</label><select id="ccMergeTarget">${ccTargetOptions_()}</select>
      <div class="buttons"><button id="ccMergeBtn" onclick="ccMergeSelected()">🔗 Merge selected (${n})</button><button class="danger" id="ccDelBtn" onclick="ccDeleteSelected()">🗑 Delete selected (${n})</button></div></div>
    <div id="ccDelMsg" class="note">${ccFlashHTML()}</div>
    <div class="cc-list">${custom.length?custom.map((s,i)=>{const ti=subjectTopicInfo(s).topicCount;return `<div class="cc-row"><input type="checkbox" class="cc-check" ${_ccSel.has(s.id)?"checked":""} onchange="ccToggle('${esc(s.id)}',this.checked)" aria-label="Select ${esc(s.name)}"><div class="cc-row-main"><b>${i+1}. ${esc(s.name)}</b><small>${s.questionCount||0} questions • ${ti} topic test${ti===1?"":"s"}</small></div><button class="ghost" onclick="ccRenameSubject('${esc(s.id)}')">✏️ Rename</button><input class="cc-exam" list="examChoices" value="${esc(s.exam||"")}" placeholder="Default exam" maxlength="40" autocomplete="off" onchange="ccSetExam('${esc(s.id)}',this.value)" title="Default exam — the exam of this subject's questions that have none of their own"></div>`;}).join(""):'<p class="note">No custom subjects yet.</p>'}
    ${subjects.length?`<h2 style="margin-top:22px">Built-in subjects</h2>${subjects.map((s,i)=>`<div class="cc-row builtin"><input type="checkbox" class="cc-check" disabled><div class="cc-row-main"><b>${i+1}. ${esc(s.name)}</b><small>${s.available?(s.questionCount||0)+" questions":"coming soon"} • ${subjectTopicInfo(s).topicCount} topic tests</small></div></div>`).join("")}`:""}</div>`;
}
function ccToggle(id,on){if(on)_ccSel.add(id);else _ccSel.delete(id);const d=document.getElementById("ccDelBtn"),m=document.getElementById("ccMergeBtn");if(d)d.textContent=`🗑 Delete selected (${_ccSel.size})`;if(m)m.textContent=`🔗 Merge selected (${_ccSel.size})`;}
function ccSelectAll(on){_ccSel=new Set(on?_ccData.subjects.map(s=>s.id):[]);ccSubjectsTab();}
async function ccSetExam(id,val){
  const res=await apiPost("setSubjectExam",{...controlAuth_(),subjectId:id,exam:val.trim()},30000);
  if(ccDenied(res))return;
  if(!res?.ok){ccMsg_(`<span class="wronganswer">${esc(res?.error||"Could not save the exam.")}</span>`);return;}
  [_ccData.subjects.find(s=>s.id===id),customSubjects.find(s=>s.id===id)].forEach(s=>{if(s)s.exam=res.exam;});
  store.setCustomSubjectsCache(customSubjects);
  ccMsg_(`<span class="correct">${esc(res.message||"Saved.")}</span>`);
}
async function ccRenameSubject(id){
  const s=_ccData.subjects.find(x=>x.id===id);if(!s)return;
  const nn=prompt("New name for this subject:",s.name);if(nn===null)return;
  const name=cleanTopic(nn);if(!name||name===s.name)return;
  if(!confirm(`Rename "${s.name}" to "${name}"?\n\nIts questions move with it. Past results stay under the old name, so students' wait for this subject starts fresh.`))return;
  ccMsg_('<span class="note">Renaming…</span>');
  const res=await apiPost("renameSubject",{...controlAuth_(),subjectId:id,newName:name},30000);
  if(ccDenied(res))return;
  if(!res?.ok){ccMsg_(`<span class="wronganswer">${esc(res?.error||"Could not rename. Please try again.")}</span>`);return;}
  await ccReload(`<span class="correct">${esc(res.message||"Renamed.")}</span>`);
}
async function ccMergeSelected(){
  const ids=[..._ccSel],targetId=document.getElementById("ccMergeTarget")?.value;
  if(!ids.length){ccMsg_('<span class="wronganswer">Tick at least one subject to merge first.</span>');return;}
  if(ids.includes(targetId)){ccMsg_('<span class="wronganswer">The subject you merge into cannot also be ticked — untick it or pick another target.</span>');return;}
  const list=ids.map(id=>_ccData.subjects.find(s=>s.id===id)).filter(Boolean),tgt=ccTargets_().find(t=>t.id===targetId);
  if(!tgt)return;
  const qs=list.reduce((n,s)=>n+(s.questionCount||0),0);
  if(!confirm(`Merge ${list.length} subject${list.length===1?"":"s"} into "${tgt.name}"?\n\n${list.map(s=>"• "+s.name+" ("+(s.questionCount||0)+" questions)").join("\n")}\n\nAll ${qs} question${qs===1?"":"s"} move into "${tgt.name}" and keep their topics and exams. The merged subjects disappear. Past results stay under the old names. This cannot be undone.`))return;
  ccMsg_('<span class="note">Merging…</span>');
  const res=await apiPost("mergeSubjects",{...controlAuth_(),targetId,targetName:tgt.name,sourceIds:ids},120000);
  if(ccDenied(res))return;
  if(!res?.ok){ccMsg_(`<span class="wronganswer">${esc(res?.error||"Could not merge. Please try again.")}</span>`);return;}
  ccForget_(res.mergedIds||ids);
  await ccReload(`<span class="correct">${esc(res.message||"Merged.")}</span>`);
}
async function ccDeleteSelected(){
  const ids=[..._ccSel];
  if(!ids.length){ccMsg_('<span class="wronganswer">Tick at least one subject first.</span>');return;}
  const list=ids.map(id=>_ccData.subjects.find(s=>s.id===id)).filter(Boolean);
  const qs=list.reduce((n,s)=>n+(s.questionCount||0),0);
  if(!confirm(`Delete ${list.length} subject${list.length===1?"":"s"}?\n\n${list.map(s=>"• "+s.name+" ("+(s.questionCount||0)+" questions)").join("\n")}\n\nThis permanently deletes ${list.length===1?"it":"them"} and ${qs} question${qs===1?"":"s"}. Students' past results are kept. This cannot be undone.`))return;
  ccMsg_('<span class="note">Deleting…</span>');
  const res=await apiPost("deleteSubjects",{...controlAuth_(),subjectIds:ids},120000);
  if(ccDenied(res))return;
  if(!res?.ok){ccMsg_(`<span class="wronganswer">${esc(res?.error||"Could not delete. Please try again.")}</span>`);return;}
  const gone=new Set(res.deletedIds||ids);
  ccForget_([...gone]);
  gone.forEach(id=>{delete _serverTopics[id];try{Object.keys(localStorage).filter(k=>k==="ecet_progress_"+id||k.startsWith("ecet_progress_"+id+"::")).forEach(k=>localStorage.removeItem(k));}catch(e){}});
  setServerTopics(_serverTopics);
  await ccReload(`<span class="correct">${esc(res.message||"Deleted.")}</span>`);
}

/* ---------- 🧩 Topic Tests: rename, change exam, move to another subject ---------- */
function ccTestsTab(){
  const body=document.getElementById("ccBody");if(!body)return;
  _ccTests=[];
  const sections=ccTargets_().map(sub=>{
    const list=(_serverTopics[sub.id]||{}).topics||[];
    if(!list.length)return "";
    const rows=list.map(t=>{
      const i=_ccTests.length;_ccTests.push({sid:sub.id,sname:sub.name,topic:t.name,exam:t.exam||"",count:t.count});
      return `<div class="cc-row"><input type="checkbox" class="cc-check" ${_ccTestSel.has(i)?"checked":""} onchange="ccTestToggle(${i},this.checked)" aria-label="Select ${esc(t.name)}"><div class="cc-row-main"><b>${esc(t.name)}</b><small>${t.exam?`<span class="exam-badge sm">${esc(t.exam)}</span> `:""}${t.count} question${t.count===1?"":"s"}</small></div><button class="ghost" onclick="ccRenameTest(${i})">✏️ Rename</button></div>`;
    }).join("");
    return `<h2>${esc(sub.name)}</h2><div class="cc-list">${rows}</div>`;
  }).join("");
  body.innerHTML=`<p class="note">Rename a topic test, change the exam it belongs to, or move whole topic tests to another subject. Renaming a test to the name of an existing one (in the same exam) combines them. Only tests made from questions stored in the sheet can be changed here — topics tagged inside <code>subjects.json</code> stay as they are. Past results stay under the old name, so the wait for a renamed or moved test starts fresh.</p>
    <div class="cc-tools"><label>Move the ticked topic tests to</label><select id="ccMoveTarget">${ccTargetOptions_()}</select>
      <div class="buttons"><button id="ccMoveBtn" onclick="ccMoveTests()">➡️ Move ticked (${_ccTestSel.size})</button></div></div>
    <div id="ccDelMsg" class="note">${ccFlashHTML()}</div>
    ${sections||'<p class="note">No topic tests yet. Add questions with a topic in Admin → Add Questions.</p>'}`;
}
function ccTestToggle(i,on){if(on)_ccTestSel.add(i);else _ccTestSel.delete(i);const b=document.getElementById("ccMoveBtn");if(b)b.textContent=`➡️ Move ticked (${_ccTestSel.size})`;}
async function ccRenameTest(i){
  const t=_ccTests[i];if(!t)return;
  const nt=prompt(`Name of this topic test (in ${t.sname}):`,t.topic);if(nt===null)return;
  const newTopic=cleanTopic(nt);if(!newTopic)return;
  const ne=prompt("Exam for this topic test (GATE, ECET or another exam). Leave empty for the subject's default exam:",t.exam);if(ne===null)return;
  const newExam=cleanTopic(ne);
  if(newTopic===t.topic&&newExam===t.exam)return;
  if(!confirm(`Change "${t.topic}"${t.exam?" ("+t.exam+")":""} to "${newTopic}"${newExam?" ("+newExam+")":""}?\n\nPast results stay under the old name, so the wait for this test starts fresh.`))return;
  ccMsg_('<span class="note">Saving…</span>');
  const res=await apiPost("renameTopicTest",{...controlAuth_(),subjectId:t.sid,topic:t.topic,exam:t.exam,newTopic,newExam},30000);
  if(ccDenied(res))return;
  if(!res?.ok){ccMsg_(`<span class="wronganswer">${esc(res?.error||"Could not save. Please try again.")}</span>`);return;}
  await ccReload(`<span class="correct">${esc(res.message||"Saved.")}</span>`);
}
async function ccMoveTests(){
  const picks=[..._ccTestSel].map(i=>_ccTests[i]).filter(Boolean),toId=document.getElementById("ccMoveTarget")?.value;
  if(!picks.length){ccMsg_('<span class="wronganswer">Tick at least one topic test first.</span>');return;}
  const tgt=ccTargets_().find(t=>t.id===toId);if(!tgt)return;
  if(picks.some(p=>p.sid===toId)){ccMsg_('<span class="wronganswer">Some ticked tests are already in that subject — untick them or pick another subject.</span>');return;}
  const qs=picks.reduce((n,p)=>n+p.count,0);
  if(!confirm(`Move ${picks.length} topic test${picks.length===1?"":"s"} to "${tgt.name}"?\n\n${picks.map(p=>"• "+p.topic+(p.exam?" ("+p.exam+")":"")+" — from "+p.sname).join("\n")}\n\n${qs} question${qs===1?"":"s"} move with them and keep their exam. Past results stay under the old names, so the wait for these tests starts fresh.`))return;
  ccMsg_('<span class="note">Moving…</span>');
  const bySubject=new Map();
  picks.forEach(p=>{const l=bySubject.get(p.sid)||[];l.push({topic:p.topic,exam:p.exam});bySubject.set(p.sid,l);});
  const done=[];let failed="";
  for(const [sid,items] of bySubject){
    const res=await apiPost("moveTopicTests",{...controlAuth_(),fromSubjectId:sid,items,toSubjectId:toId,toSubjectName:tgt.name},60000);
    if(ccDenied(res))return;
    if(!res?.ok){failed=res?.error||"Could not move. Please try again.";break;}
    done.push(res.message);
  }
  await ccReload(`${done.map(m=>`<span class="correct">${esc(m)}</span>`).join("<br>")}${failed?`${done.length?"<br>":""}<span class="wronganswer">${esc(failed)}</span>`:""}`);
}

/* ===================== ADMIN — SHARED QUESTION FORM (manual add + edit) ===================== */
function questionFormHTML(mode,q){
  const isEdit=mode==='edit';
  const v=(k,d)=>esc(q&&q[k]!==undefined?q[k]:(d||''));
  return `<h1>Admin — ${isEdit?'Edit Question':'Add a Single Question'}</h1>
    <p class="note">${isEdit?'Editing question <b>'+esc(q.id)+'</b>. Saving updates this exact row — it cannot duplicate or affect another row.':'Fill in one question directly, without an Excel file.'}</p>
    ${isEdit?'':`<label>Subject</label><select id="qfSubject" onchange="qfSubjectChanged()">${adminSubjectOptions()}</select>`}
    <div id="qfTopicWrap">${examTopicHTML('qf',isEdit?_editSubjectId:((subjects[0]||customSubjects[0]||{}).id||''),isEdit?q.exam:'',isEdit?q.topic:'','')}</div>
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
    optionDImage:document.getElementById('qfDImg').value.trim(),
    topic:readTopicField('qf'),
    exam:readExamField('qf')
  };
}
function qfSubjectChanged(){
  const sel=document.getElementById('qfSubject'),wrap=document.getElementById('qfTopicWrap');
  if(sel&&wrap)wrap.innerHTML=examTopicHTML('qf',sel.value,'','','');
}
async function saveManualQuestion(){
  const statusEl=document.getElementById('qfStatus');
  const sel=document.getElementById('qfSubject'),subject=subjects.find(s=>s.id===sel.value)||customSubjects.find(s=>s.id===sel.value);
  if(!sel.value||sel.value==='__new__'){statusEl.innerHTML='<span class="wronganswer">Pick a subject first.</span>';return;}
  const row=readQuestionForm();
  if(!row.question||!row.optionA||!row.optionB||!row.optionC||!row.optionD||!row.year){statusEl.innerHTML='<span class="wronganswer">Question, all 4 options, and Year are required.</span>';return;}
  if(topicFieldIncomplete('qf')||examFieldIncomplete('qf')){statusEl.innerHTML='<span class="wronganswer">Type the new topic name, or choose an existing topic / No topic.</span>';return;}
  statusEl.textContent='Saving…';
  const p=store.profile();
  const res=await apiPost('importQuestions',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",subjectId:sel.value,subject:subject?.name||sel.value,questions:[row]});
  if(res?.ok){statusEl.innerHTML=`<span class="correct">Question saved successfully${row.topic?' under topic “'+esc(row.topic)+'”':''} — available immediately in Practice Tests.</span>`;['qfQuestion','qfA','qfB','qfC','qfD','qfQno','qfQImg','qfAImg','qfBImg','qfCImg','qfDImg'].forEach(id=>document.getElementById(id).value='');
    // Keep home/admin question counts and topic lists in sync right away. The topic just used stays
    // selected, so a run of questions for the same topic needs no re-picking.
    const keepTopic=row.topic;
    await refreshCustomSubjects();
    const wrap=document.getElementById('qfTopicWrap');
    if(wrap)wrap.innerHTML=examTopicHTML('qf',sel.value,row.exam,keepTopic,'');
    refreshAdminTopicField(true);
  }
  else{statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||(res?.errors?.[0]?.errors?.join(', '))||'Could not save.')}</span>`;}
}

/* ===================== ADMIN — EDIT QUESTIONS ===================== */
let _editQuestionsCache=[],_editSubjectId='',_editSelected=new Set();
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
  _editSelected=new Set();
  renderEditQuestionsList();
}
function editExamOf_(q){return cleanTopic(q.exam)||homeExam(findSubjectById(_editSubjectId));}
function renderEditQuestionsList(){
  const listEl=document.getElementById('editQuestionsList');
  if(!listEl)return;
  listEl.className='';
  if(!_editQuestionsCache.length){listEl.className='note';listEl.innerHTML='<p class="note">No questions found for this subject.</p>';return;}
  const combos=new Map();
  _editQuestionsCache.forEach(q=>{const t=cleanTopic(q.topic);if(!t)return;const ex=editExamOf_(q),k=topicKey(ex)+'|'+topicKey(t),e=combos.get(k)||{topic:t,exam:ex,count:0};e.count++;combos.set(k,e);});
  const untagged=_editQuestionsCache.filter(q=>!cleanTopic(q.topic)).length;
  listEl.innerHTML=`<div class="topic-bulk">
    <label>Show</label>
    <select id="editTopicFilter" onchange="renderEditTable()"><option value="">All questions (${_editQuestionsCache.length})</option><option value="__none__">No topic yet (${untagged})</option>${[...combos].map(([k,e])=>`<option value="${esc(k)}">${esc(e.topic)}${e.exam?' — '+esc(e.exam):''} (${e.count})</option>`).join('')}</select>
    <label>Move the ticked questions to an exam / topic</label>
    ${examTopicHTML('bk',_editSubjectId,null,'','',true)}
    <div class="buttons"><button id="bulkTopicBtn" onclick="bulkAssignTopic()">Apply to ticked (0)</button></div>
    <div id="bulkTopicStatus" class="note">Tick questions in the table (or the box in the header to tick everything shown), pick an exam and topic, then apply. Choose “No topic” to take them out of a topic.</div>
  </div><div id="editTableWrap"></div>`;
  renderEditTable();
}
function visibleEditRows_(){
  const f=document.getElementById('editTopicFilter')?.value||'';
  return _editQuestionsCache.filter(q=>{
    if(!f)return true;
    const t=cleanTopic(q.topic);
    if(f==='__none__')return !t;
    return !!t&&(topicKey(editExamOf_(q))+'|'+topicKey(t))===f;
  });
}
function renderEditTable(){
  const wrap=document.getElementById('editTableWrap');if(!wrap)return;
  const rows=visibleEditRows_(),allTicked=rows.length>0&&rows.every(q=>_editSelected.has(q.id));
  wrap.innerHTML=rows.length?`<div class="table-scroll"><table class="simple"><tr><th><input type="checkbox" ${allTicked?'checked':''} onchange="toggleEditAll(this.checked)" title="Tick / untick everything shown"></th><th>Question</th><th>Topic</th><th>Exam</th><th>Year</th><th></th></tr>
  ${rows.map(q=>`<tr><td><input type="checkbox" ${_editSelected.has(q.id)?'checked':''} onchange="toggleEditSel('${esc(q.id)}',this.checked)"></td><td>${esc((q.question||'').slice(0,90))}${(q.question||'').length>90?'…':''}</td><td>${q.topic?esc(q.topic):'—'}</td><td>${editExamOf_(q)?esc(editExamOf_(q)):'—'}</td><td>${esc(q.year)}</td><td><button onclick="editQuestionRow('${esc(q.id)}')">Edit</button></td></tr>`).join('')}
  </table></div>`:'<p class="note">No questions match this filter.</p>';
  updateBulkBtn();
}
function toggleEditAll(on){visibleEditRows_().forEach(q=>{if(on)_editSelected.add(q.id);else _editSelected.delete(q.id);});renderEditTable();}
function toggleEditSel(id,on){if(on)_editSelected.add(id);else _editSelected.delete(id);updateBulkBtn();}
function updateBulkBtn(){const b=document.getElementById('bulkTopicBtn');if(b)b.textContent=`Apply to ticked (${_editSelected.size})`;}
async function bulkAssignTopic(){
  const st=document.getElementById('bulkTopicStatus'),ids=[..._editSelected];
  if(!ids.length){st.innerHTML='<span class="wronganswer">Tick at least one question first.</span>';return;}
  if(topicFieldIncomplete('bk')||examFieldIncomplete('bk')){st.innerHTML='<span class="wronganswer">Type the new name, or choose an existing exam / topic.</span>';return;}
  const topic=readTopicField('bk'),exam=readExamField('bk');
  if(!topic&&!confirm(`Take ${ids.length} question(s) out of their topic?`))return;
  st.textContent='Saving…';
  const payload={...adminAuth_(),subjectId:_editSubjectId,questionIds:ids,topic};
  if(exam!=='__keep__')payload.exam=exam;
  const res=await apiPost('setQuestionTopic',payload,60000);
  if(!res?.ok){st.innerHTML=`<span class="wronganswer">${esc(res?.error||'Could not save. Please check your connection and try again.')}</span>`;return;}
  const finalTopic=res.topic!==undefined?res.topic:topic;
  _editQuestionsCache.forEach(q=>{if(_editSelected.has(q.id)){q.topic=finalTopic;if(exam!=='__keep__')q.exam=res.exam!==undefined?res.exam:exam;}});
  _editSelected=new Set();
  await refreshCustomSubjects(); // Home and the dropdowns pick up the change straight away
  renderEditQuestionsList();
  const st2=document.getElementById('bulkTopicStatus');
  if(st2)st2.innerHTML=`<span class="correct">${esc(res.message||'Saved.')}</span>`;
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
  if(topicFieldIncomplete('qf')||examFieldIncomplete('qf')){statusEl.innerHTML='<span class="wronganswer">Type the new topic name, or choose an existing topic / No topic.</span>';return;}
  statusEl.textContent='Saving…';
  const p=store.profile();
  const res=await apiPost('updateQuestion',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",questionId:id,...row});
  if(res?.ok){
    statusEl.innerHTML='<span class="correct">Saved. Updating list…</span>';
    const idx=_editQuestionsCache.findIndex(x=>x.id===id);
    refreshCustomSubjects(); // topic list on Home / in the dropdowns follows the edit
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
  const exam=document.getElementById("newSubjectExam").value.trim();
  const statusEl=document.getElementById("newSubjectStatus");
  if(!name||!password){statusEl.innerHTML='<span class="wronganswer">Subject name and password are both required.</span>';return;}
  statusEl.textContent="Creating…";
  const res=await apiPost("createSubject",{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",name,password,description,exam});
  if(!res?.ok){statusEl.innerHTML=`<span class="wronganswer">${esc(res?.error||"Could not create subject.")}</span>`;return;}
  customSubjects.push(res.subject);
  statusEl.innerHTML=`<span class="correct">"${esc(res.subject.name)}" created. It's now on the homepage and in the Subject dropdown below.</span>`;
  document.getElementById("newSubjectName").value="";document.getElementById("newSubjectPassword").value="";document.getElementById("newSubjectDesc").value="";document.getElementById("newSubjectExam").value="";
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
  const topicSel=readTopicField("at"); // the topic-wise test these questions will be filed under (may be empty)
  const examSel=readExamField("at");   // the exam they are for (empty = the subject's default exam)
  const examName=document.getElementById("aiExamName")?.value?.trim()||examSel||homeExam(findSubjectById(sel?.value))||subjName;

  const subtopicsLine=scope==='topic'&&topic
    ? (topicSel?topicSel+' — focusing on: '+topic:topic)
    : scope==='topic'
      ? (topicSel?'Everything commonly tested under "'+topicSel+'" in '+subjName:'Pick one well-defined, commonly-tested subtopic within '+subjName+' and stay within it.')
      : topicSel
        ? 'Everything commonly tested under "'+topicSel+'" in '+subjName
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
    ...(topicSel?['Topic (value for the Topic column): '+topicSel]:[]),
    ...(examSel?['Exam (value for the Exam column): '+examSel]:[]),
    'Number of questions: '+count,
    'Difficulty level: '+difficulty,
    'Year: '+year,
    'Exam: '+examName,
    '',
    'Excel format — mandatory',
    '',
    'Create an Excel file with exactly 16 columns in this order:',
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
    '15. Topic',
    '16. Exam',
    '',
    'Each question must occupy one row. Include a header row with the 16 column names. Preserve this exact column order and structure.',
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
    '13. '+(topicSel?'Fill the Topic column with exactly "'+topicSel+'" for every question (same spelling and capitalization).':'Leave the Topic column empty.'),
    '14. '+(examSel?'Fill the Exam column with exactly "'+examSel+'" for every question.':'Leave the Exam column empty.'),
    '15. Do not invent facts, ambiguous questions, or questions with multiple correct answers.',
    ...(extra?['16. Additional instructions: '+extra]:[]),
    '',
    'Output requirements',
    '',
    '- Return ONLY the completed Excel (.xlsx) file.',
    '- Do not output the questions as plain text, TSV, CSV, or Markdown.',
    '- Do not provide explanations, answers, or any other text outside the Excel file.',
    '- Ensure the file contains exactly '+count+' question rows plus the header row.',
    '- Check that all 16 columns are present and in the correct order.',
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
  const rows=[['Question','Option A','Option B','Option C','Option D','Correct Answer','Year','State','Question Number','Question Image URL','Option A Image URL','Option B Image URL','Option C Image URL','Option D Image URL','Topic','Exam'],['Example question?','Option 1','Option 2','Option 3','Option 4','A','2026','TS','101','','','','','','','']];
  const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Questions');XLSX.writeFile(wb,'ECET-Question-Template.xlsx');
}
function normalizeQuestionRow(r,defaultYear){
  const get=(...keys)=>{for(const k of keys){if(r[k]!==undefined)return r[k];}return '';};
  return {question:String(get('Question','question')||'').trim(),optionA:String(get('Option A','OptionA','optionA')||'').trim(),optionB:String(get('Option B','OptionB','optionB')||'').trim(),optionC:String(get('Option C','OptionC','optionC')||'').trim(),optionD:String(get('Option D','OptionD','optionD')||'').trim(),correctAnswer:String(get('Correct Answer','CorrectAnswer','correctAnswer')||'').trim().toUpperCase(),year:String(get('Year','year')||'').trim()||String(defaultYear||'').trim(),state:String(get('State','state')||'TS').trim(),questionNumber:String(get('Question Number','QuestionNumber','questionNumber')||'').trim(),questionImage:String(get('Question Image URL','QuestionImage','questionImage')||'').trim(),optionAImage:String(get('Option A Image URL','OptionAImage','optionAImage')||'').trim(),optionBImage:String(get('Option B Image URL','OptionBImage','optionBImage')||'').trim(),optionCImage:String(get('Option C Image URL','OptionCImage','optionCImage')||'').trim(),optionDImage:String(get('Option D Image URL','OptionDImage','optionDImage')||'').trim(),topic:cleanTopic(get('Topic','topic','Topic Name')),exam:cleanTopic(get('Exam','exam','Exam Name'))};
}
function validateImportRows(rows){
  const errs=[],seen=new Set();
  rows.forEach((r,i)=>{const e=[];if(!r.question)e.push('Question');['optionA','optionB','optionC','optionD'].forEach((k,n)=>{if(!r[k])e.push('Option '+"ABCD"[n]);});if(!/^[ABCD]$/.test(r.correctAnswer))e.push('Correct Answer A/B/C/D');if(!r.year)e.push('Year');if(r.topic&&r.topic.length>80)e.push('Topic longer than 80 characters');if(r.exam&&r.exam.length>40)e.push('Exam longer than 40 characters');const key=[r.question.toLowerCase(),r.year,r.state,r.questionNumber].join('|');if(seen.has(key))e.push('Duplicate');seen.add(key);if(e.length)errs.push({row:i+2,errors:e});});return errs;
}
function previewQuestionFile(ev){
  const file=ev.target.files?.[0];if(!file)return;
  if(!window.XLSX){document.getElementById('importStatus').textContent='Excel tools are still loading. Please try again.';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],raw=XLSX.utils.sheet_to_json(ws,{defval:''}),defaultYear=document.getElementById('adminYear')?.value||'';
      _questionImportRows=raw.map(r=>normalizeQuestionRow(r,defaultYear));
      renderImportPreview();
    }catch(err){
      _questionImportRows=[];
      document.getElementById('importQuestionsBtn').disabled=true;
      document.getElementById('importPreview').innerHTML='';
      document.getElementById('importStatus').textContent='Could not read the Excel file. Please use the provided template.';
      console.warn(err);
    }
  };
  reader.readAsArrayBuffer(file);
}
// The rows as they will actually be saved: a row's own Topic column wins, otherwise the topic picked above.
function effectiveImportRows_(){const t=readTopicField('at'),e=readExamField('at');return _questionImportRows.map(r=>({...r,topic:cleanTopic(r.topic)||t,exam:cleanTopic(r.exam)||e}));}
function renderImportPreview(){
  const statusEl=document.getElementById('importStatus'),prevEl=document.getElementById('importPreview'),btn=document.getElementById('importQuestionsBtn');
  if(!statusEl||!prevEl||!btn||!_questionImportRows.length)return;
  const rows=effectiveImportRows_(),errors=validateImportRows(rows),preview=rows.slice(0,20);
  const tally=new Map();
  rows.forEach(r=>{const k=topicKey(r.exam)+'|'+topicKey(r.topic),e=tally.get(k)||{name:r.topic,exam:r.exam,n:0};e.n++;tally.set(k,e);});
  const topicLine=[...tally.values()].map(e=>`${e.name?esc(e.name):'<i>no topic</i>'}${e.exam?' ('+esc(e.exam)+')':''} × ${e.n}`).join(' • ');
  statusEl.innerHTML=`<b>${rows.length}</b> row(s) found. ${errors.length?`<span class="wronganswer">${errors.length} invalid row(s)</span>`:'<span class="correct">All rows passed validation.</span>'}<br><span class="note">Topic tests in this import: ${topicLine}</span>`;
  prevEl.innerHTML=`<div class="table-scroll"><table class="simple"><tr><th>Row</th><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Correct</th><th>Topic</th><th>Exam</th><th>Year</th><th>Images</th><th>Status</th></tr>${preview.map((r,i)=>{const er=errors.find(x=>x.row===i+2);const imgCount=[r.questionImage,r.optionAImage,r.optionBImage,r.optionCImage,r.optionDImage].filter(Boolean).length;return `<tr><td>${i+2}</td><td>${esc(r.question)}</td><td>${esc(r.optionA)}</td><td>${esc(r.optionB)}</td><td>${esc(r.optionC)}</td><td>${esc(r.optionD)}</td><td>${esc(r.correctAnswer)}</td><td>${r.topic?esc(r.topic):'—'}</td><td>${r.exam?esc(r.exam):'—'}</td><td>${esc(r.year)}</td><td>${imgCount?imgCount+' img':'—'}</td><td>${er?`<span class="wronganswer">${esc(er.errors.join(', '))}</span>`:'<span class="correct">OK</span>'}</td></tr>`}).join('')}</table></div>${errors.length?`<div class="error"><b>Import blocked.</b> Fix the invalid rows and upload the corrected file.<br>${errors.slice(0,30).map(x=>`Row ${x.row}: ${esc(x.errors.join(', '))}`).join('<br>')}</div>`:''}`;
  btn.disabled=errors.length>0||!rows.length||(topicFieldIncomplete('at')||examFieldIncomplete('at'));
}
async function importPreviewedQuestions(){
  const btn=document.getElementById('importQuestionsBtn'),status=document.getElementById('importStatus');
  if(!_questionImportRows.length||btn.disabled)return;
  if((topicFieldIncomplete('at')||examFieldIncomplete('at'))){status.innerHTML='<span class="wronganswer">Type the new topic name, or choose an existing topic / No topic.</span>';return;}
  btn.disabled=true;
  const p=store.profile(),sel=document.getElementById('adminSubject');
  const subject=subjects.find(s=>s.id===sel.value)||customSubjects.find(s=>s.id===sel.value);
  const rows=effectiveImportRows_(),total=rows.length,BATCH=50;
  let done=0,lastRes=null;
  /* Importing is sent in small batches with a long timeout. If the browser stops
     waiting (slow Apps Script) the batch may STILL have been saved, so we never
     report "failed" from silence: we re-send the same batch, and the server
     answers "already imported" if it had gone through the first time. */
  for(let i=0;i<total;i+=BATCH){
    const batch=rows.slice(i,i+BATCH);
    btn.textContent=`Importing ${Math.min(i+BATCH,total)} / ${total}…`;
    let res=null;
    for(let attempt=0;attempt<3&&!res;attempt++){
      if(attempt){status.innerHTML=`<span class="note">Server is slow — confirming the last batch was saved…</span>`;await sleep(4000*attempt);}
      res=await apiPost('importQuestions',{adminEmail:p.email,adminPassword:isAdminUnlocked?ADMIN_PANEL_PASSWORD:"",subjectId:sel.value,subject:subject?.name||sel.value,questions:batch},90000);
    }
    lastRes=res;
    if(!res?.ok)break;
    done+=batch.length;
  }
  if(done===total){
    status.innerHTML=`<span class="correct"><b>${total}</b> question(s) imported successfully — available immediately in Practice Tests.</span>`;
    _questionImportRows=[];document.getElementById('importPreview').innerHTML='';
    await refreshCustomSubjects(); // keep home/admin question counts and topic lists in sync
    refreshAdminTopicField(true);  // a topic created by this import is now selectable, and stays selected
  }else{
    const msg=lastRes?lastRes.error||'Import failed.':'Could not reach the server, so the last batch could not be confirmed. Wait a minute and use “Import Questions” again — questions already saved are detected automatically.';
    status.innerHTML=`<span class="wronganswer">${esc(msg)}</span>${done?`<br><span class="note">${done} of ${total} question(s) were already saved before this happened.</span>`:''}`;
    if(lastRes?.errors?.length)document.getElementById('importPreview').innerHTML=`<div class="error">${lastRes.errors.map(x=>`Row ${x.row}: ${esc(x.errors.join(', '))}`).join('<br>')}</div>`;
  }
  btn.textContent='Import Questions';btn.disabled=!_questionImportRows.length;
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
let _lockCountdownTimer=null;
function openPassword(i){_pwSubject=subjects[i];if(guardSubjectLock_(subjects[i]))return;renderPasswordCard();}
function openCustomPassword(i){_pwSubject=customSubjects[i];if(guardSubjectLock_(customSubjects[i]))return;renderPasswordCard();}
// Defense in depth: the subject cards already hide/disable "Open Exam" while
// locked, but this re-checks the same precomputed lastAttempt right before
// the password screen too, in case a card was rendered before fresh stats
// arrived. Never blocks resuming an in-progress exam. Returns true if blocked.
function guardSubjectLock_(s){
  if(!s||store.getProgress(s.id))return false;
  const lock=subjectLockInfo(s.name);
  if(!lock.locked)return false;
  pushNav(()=>guardSubjectLock_(s));
  app.innerHTML=`<div class="card"><h1>${esc(s.name)} is locked</h1><p class="note">You already attempted this subject recently. You can retake it in <b id="lockCountdown" data-unlock="${lock.unlockAt}">${formatCooldown(lock.remaining)}</b>.</p><div class="buttons"><button onclick="home()">Back to Subjects</button></div></div>`;
  clearInterval(_lockCountdownTimer);
  _lockCountdownTimer=setInterval(()=>{const el=document.getElementById("lockCountdown");if(!el){clearInterval(_lockCountdownTimer);return;}const remaining=Number(el.dataset.unlock)-Date.now();if(remaining<=0){home();return;}el.textContent=formatCooldown(remaining);},30000);
  return true;
}
function renderPasswordCard(){pushNav(renderPasswordCard);const s=_pwSubject;app.innerHTML=`<div class="card password-card"><h1>${esc(s.name)}</h1><p>Enter the subject password.</p><input id="password" type="password" inputmode="numeric" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword()"><div id="passError" class="error"></div><div class="buttons"><button onclick="home()">Back</button><button onclick="checkPassword()">Continue</button></div></div>`;document.getElementById("password").focus();}
async function checkPassword(){const s=_pwSubject,v=document.getElementById("password").value;if(v!==String(s.password)){document.getElementById("passError").textContent="Incorrect password.";return;}
  _unlockedSubjects.add(s.parentId||s.id);
  await loadBankAndEnroll_(s);
}
async function loadBankAndEnroll_(s){
  const parentId=s.parentId||s.id; // a topic test loads its parent subject's questions, then keeps only its topic
  // These two are independent — the static question-bank file and the
  // admin-imported questions from the backend — so fetch them in parallel
  // instead of waiting on the file before even starting the API call.
  const [staticBank,imported]=await Promise.all([
    s.file?fetch(s.file).then(r=>r.json()).catch(()=>[]):Promise.resolve([]),
    API?apiGet('questions',{subjectId:parentId}).catch(()=>null):Promise.resolve(null)
  ]);
  bank=Array.isArray(staticBank)?staticBank:[];
  if(imported?.ok&&Array.isArray(imported.data)&&imported.data.length)bank=bank.concat(imported.data);
  // every question gets its effective exam (its own, else the subject's home exam) so a test can pick its exam
  const home=homeExam(s);
  bank.forEach(q=>{q.exam=cleanTopic(q.exam)||home;});
  if(s.examKey!==undefined)bank=bank.filter(q=>topicKey(q.exam)===s.examKey);
  if(s.topicKey)bank=bank.filter(q=>topicKey(q.topic)===s.topicKey);
  if(!bank.length){app.innerHTML=`<div class="card"><h2>${s.topicKey?"No questions in this topic yet.":"Question bank not available."}</h2><button onclick="home()">Back</button></div>`;return;}activeSubject=s;enroll();}
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
/* ===================== STRICT PRE-START LOCK CHECK =====================
 * BUG THIS FIXES: the "1-day locked" check on Home only ever looked at a
 * locally cached dashboard snapshot (store.dashboardCache()), which can be
 * stale right after a submit. Worse, the Result page's "Retry Test" button
 * called start() directly, skipping the password screen (and therefore
 * guardSubjectLock_()) entirely — so a freshly-submitted, locked subject
 * could still be reopened with a running timer with zero lock check.
 *
 * Fix: start() is only ever reached for a NEW attempt through this one
 * gate. It asks the backend for the live, authoritative lock state for
 * this exact (email, subject) — not the cache — and refuses to render the
 * exam or start the timer if it's still locked. Resuming an in-progress
 * exam is never subject to this (there's nothing "new" being started), so
 * the check is skipped whenever saved progress exists for the subject. */
async function gateStartNewAttempt_(subject){
  if(store.getProgress(subject.id))return true; // resuming — never gated
  if(!API)return true; // no backend configured, nothing to check against
  const p=store.profile();
  const status=await apiGet("subjectStatus",{email:p.email,subject:subject.name},8000,1);
  if(status?.ok&&status.data?.locked){
    showSubjectLockedScreen_(subject.name,status.data.unlockAt);
    return false;
  }
  return true;
}

function showSubjectLockedScreen_(name,unlockAtIso){
  const unlockAt=new Date(unlockAtIso).getTime();
  const remaining=Math.max(0,unlockAt-Date.now());
  pushNav(()=>showSubjectLockedScreen_(name,unlockAtIso));
  app.innerHTML=`<div class="card"><h1>${esc(name)} is locked</h1><p class="note">You already attempted this subject. You can retake it in <b id="lockCountdown" data-unlock="${unlockAt}">${formatCooldown(remaining)}</b>.</p><div class="buttons"><button onclick="home()">Back to Subjects</button></div></div>`;
  clearInterval(_lockCountdownTimer);
  _lockCountdownTimer=setInterval(()=>{
    const el=document.getElementById("lockCountdown");
    if(!el){clearInterval(_lockCountdownTimer);return;}
    const remaining=Number(el.dataset.unlock)-Date.now();
    if(remaining<=0){home();return;}
    el.textContent=formatCooldown(remaining);
  },30000);
}
async function beginExam(){
  const p=store.profile();
  if(!(await gateStartNewAttempt_(activeSubject)))return;
  apiPost("register",{name:p.name,email:p.email,subject:activeSubject.name});
  start();
}
async function retryExam(){
  if(!(await gateStartNewAttempt_(activeSubject)))return;
  start();
}

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
      test=restored;answers=saved.answers;marked=saved.marked;qTime=saved.qTime;current=Math.max(0,Math.min(test.length-1,saved.current||0));examStartedAt=saved.examStartedAt;examSessionId=saved.examSessionId||newSessionId();
      // Recompute the remaining time from the wall clock instead of trusting the
      // frozen "left" that was saved before the tab closed. This is what makes
      // "resume any time" safe to allow: the clock keeps running against real
      // elapsed time while you're away, so closing the tab can't be used to pause
      // it, and if time actually ran out while you were gone, resuming submits
      // whatever was answered instead of reopening an already-expired exam.
      left=Math.max(0,test.length*60-Math.floor((Date.now()-examStartedAt)/1000));
      if(left<=0){
        questionStartedAt=Date.now();isSubmitting=false;saveTick=0;
        submit();
        return;
      }
    } else { startFreshExam(); }
  } else { startFreshExam(); }
  questionStartedAt=Date.now();isSubmitting=false;saveTick=0;
  examActive=true;
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
function render(){const q=test[current],answered=answers.filter(x=>x!==null).length,markedCount=marked.filter(Boolean).length;app.innerHTML=`<div class="top"><h1>${examLabel(activeSubject)&&!activeSubject.name.includes("("+examLabel(activeSubject)+")")?esc(examLabel(activeSubject))+" ":""}${esc(activeSubject.name)}</h1><div class="timer ${left<=60?"low":""}">${clock(left)}</div></div><div class="card"><div class="meta"><span>Question ${current+1} of ${test.length} • ${esc(q.year)} ${esc(q.state)} • PYQ ${esc(q.questionNumber)}${q.topic&&!activeSubject.topic?` • ${esc(q.topic)}`:""}</span><span>Answered ${answered}/${test.length} • Review ${markedCount}</span></div><div class="question">${esc(q.question)}</div>${imgHTML(q.image)}${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" name="answer" ${answers[current]===k?"checked":""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)} ${imgHTML((q.optionImages||[])[k],"opt-img")}</label>`).join("")}<button class="review-toggle ${marked[current]?"active":""}" onclick="toggleReview()">${marked[current]?"★ Marked for review":"☆ Mark for review"}</button><div class="palette-legend"><span>⬜ Unanswered</span><span>🟩 Answered</span><span>🟨 Review</span></div><div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${marked[k]?"review":""} ${k===current?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div><div class="examfoot"><button onclick="go(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="toggleReview()">${marked[current]?"Unmark":"Review"}</button><button onclick="go(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="confirmSubmit()">Submit</button></div></div>`;}

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

  /* STRICT: the instant Submit is clicked, the exam is over — permanently,
   * not just until the next clearExam() call resets isSubmitting. This is
   * what makes it safe for the Result page's Retry/Dashboard/Subjects
   * buttons, and any later Back navigation, to never again ask "exam in
   * progress?" for this attempt. We build the payload FIRST (it captures
   * everything it needs into its own local object), then clear the exam
   * runtime state, so nothing stale is left for a later guard to trip on. */
  const payload=submissionPayload();
  store.clearProgress(activeSubject.id);
  examActive=false;
  test=[];answers=[];marked=[];qTime=[];left=0;current=0;

  const score=payload.score,total=payload.total,percentage=payload.percentage,wrong=payload.wrong,unanswered=payload.unanswered;
  app.innerHTML=`<div class="card"><h1>Saving result…</h1><p class="note">Your result will appear immediately.</p></div>`;
  const resp=await apiPost("submitExam",payload);
  if(!resp?.ok){
    isSubmitting=false;
    if(resp?.cooldown?.locked){
      // This only happens if a fresh attempt somehow got started during the
      // cooldown (the "Open Exam" screen already blocks that normally). The
      // progress isn't restored here since the cooldown means a new attempt
      // shouldn't have been possible in the first place.
      store.clearProgress(activeSubject.id);
      app.innerHTML=`<div class="card"><h1>This subject is locked</h1><p class="note">You already attempted "${esc(activeSubject.name)}" recently. You can retake it after <b>${esc(formatDateTime(resp.cooldown.unlockAt))}</b>.</p><div class="buttons"><button onclick="home()">Subjects</button></div></div>`;
      return;
    }
    // NOTE: since we already cleared test/answers/left above, this retry
    // path can no longer restore progress from those globals — resubmit
    // works off the payload we already built, so just retry sending it.
    app.innerHTML=`<div class="card"><h1>Could not save result</h1><p class="note">Please check your internet connection and try submitting again.</p><div class="buttons"><button onclick="retrySubmit(payload)">Try again</button><button onclick="home()">Subjects</button></div></div>`;
    return;
  }
  // Reflect the new cooldown in the local cache immediately, so Home's
  // subject card (and guardSubjectLock_) shows "Locked" without waiting
  // on the next dashboard refresh. This is a display convenience only —
  // gateStartNewAttempt_() above is what actually enforces the lock.
  const dc=store.dashboardCache();
  if(dc){
    dc.subjects=dc.subjects||[];
    const nowIso=new Date().toISOString();
    let srow=dc.subjects.find(s=>s.subject===activeSubject.name);
    if(srow)srow.lastAttempt=nowIso;
    else dc.subjects.push({subject:activeSubject.name,best:percentage,worst:percentage,avg:percentage,attempts:1,lastAttempt:nowIso});
    store.setDashboardCache(dc);
  }
  renderResult({score,total,percentage,wrong,unanswered,totalTime:payload.totalTime,detail:payload.detail,rank:resp.rank,rankOutOf:resp.rankOutOf,expectedRank:resp.expectedRank,equivalentMarks:resp.equivalentMarks});
}
async function retrySubmit(payload){
  app.innerHTML=`<div class="card"><h1>Saving result…</h1><p class="note">Retrying…</p></div>`;
  const resp=await apiPost("submitExam",payload);
  if(!resp?.ok){
    isSubmitting=false;
    if(resp?.cooldown?.locked){
      store.clearProgress(activeSubject.id);
      app.innerHTML=`<div class="card"><h1>This subject is locked</h1><p class="note">You already attempted "${esc(activeSubject.name)}" recently. You can retake it after <b>${esc(formatDateTime(resp.cooldown.unlockAt))}</b>.</p><div class="buttons"><button onclick="home()">Subjects</button></div></div>`;
      return;
    }
    app.innerHTML=`<div class="card"><h1>Could not save result</h1><p class="note">Please check your internet connection and try submitting again.</p><div class="buttons"><button onclick="retrySubmit(payload)">Try again</button><button onclick="home()">Subjects</button></div></div>`;
    return;
  }
  renderResult({score:payload.score,total:payload.total,percentage:payload.percentage,wrong:payload.wrong,unanswered:payload.unanswered,totalTime:payload.totalTime,detail:payload.detail,rank:resp.rank,rankOutOf:resp.rankOutOf,expectedRank:resp.expectedRank,equivalentMarks:resp.equivalentMarks});
}
function pieHTML(r){const total=Math.max(1,r.total),c=r.score/total*100,w=r.wrong/total*100,u=r.unanswered/total*100;return `<div class="pie-wrap"><div class="pie" style="background:conic-gradient(#1a7f37 0 ${c}%,#b00020 ${c}% ${c+w}%,#d4a72c ${c+w}% 100%)"></div><div class="pie-legend"><span><i class="dot green"></i>Correct ${c.toFixed(1)}%</span><span><i class="dot red"></i>Wrong ${w.toFixed(1)}%</span><span><i class="dot yellow"></i>Unanswered ${u.toFixed(1)}%</span></div></div>`;}
function timeChart(detail){const max=Math.max(60,...detail.map(d=>d.time||0));const ticks=[0,Math.round(max/4),Math.round(max/2),Math.round(max*3/4),max];return `<div class="chart-area"><div class="y-axis">${ticks.slice().reverse().map(v=>`<span>${formatSeconds(v)}</span>`).join("")}</div><div class="chart-main"><div class="gridlines">${ticks.map(()=>`<i></i>`).join("")}</div><div class="bars">${detail.map((d,i)=>{const h=Math.max(3,(d.time/max)*100);return `<button class="bar-col ${d.selected===null?"unansbar":d.selected!==d.correct?"wrongbar":""}" style="height:${h}%" onclick="showQuestionTime(${i})" title="Q${i+1}: ${formatSeconds(d.time)}"><span>${i+1}</span></button>`;}).join("")}</div><div class="x-axis">${detail.map((_,i)=>`<span>${i+1}</span>`).join("")}</div></div></div><div id="timeDetail" class="chart-detail">Click any question bar to see exact time.</div>`;}
function showQuestionTime(i){const d=window._lastResultDetail?.[i];if(!d)return;const el=document.getElementById("timeDetail");if(el)el.innerHTML=`<b>Question ${i+1}</b> — time spent: <b>${formatSeconds(d.time)}</b><br>${esc(d.question)}`;}
function renderResult(r){
  window._lastResultDetail=r.detail;
  const expected=r.expectedRank||"—",eq=r.equivalentMarks??Math.round(r.percentage*2*10)/10;
  app.innerHTML=`<div class="card"><h1>Result — ${esc(activeSubject.name)}</h1><div class="stats"><div class="stat"><b>${r.score}/${r.total}</b>Score</div><div class="stat"><b>${r.percentage}%</b>Percentage</div><div class="stat"><b>${eq}/200</b>Equivalent AP ECET</div><div class="stat"><b>${expected}</b>Expected AP ECET Rank</div><div class="stat"><b>${r.rank?"#"+r.rank:"—"}</b>Practice Rank</div><div class="stat"><b>${r.rankOutOf||"—"}</b>Students</div><div class="stat"><b>${r.wrong}</b>Wrong</div><div class="stat"><b>${r.unanswered}</b>Unanswered</div></div><p class="meta">Total time: <b>${clock(r.totalTime)}</b></p><h2>Result breakdown</h2>${pieHTML(r)}${topicBreakdownHTML(r.detail)}<h2>Time spent per question</h2>${timeChart(r.detail)}<div class="buttons"><button onclick="retryExam()">Retry Test</button><button onclick="goDashboard()">Dashboard</button><button onclick="home()">Subjects</button></div><h2>Question review</h2><div class="filterbar"><button class="active" onclick="filterReview('all',this)">All (${r.detail.length})</button><button onclick="filterReview('wrong',this)">Wrong (${r.wrong})</button><button onclick="filterReview('unanswered',this)">Unanswered (${r.unanswered})</button><button onclick="filterReview('marked',this)">Review (${r.detail.filter(d=>d.marked).length})</button></div><div id="reviewList">${reviewListHTML(r.detail,"all")}</div></div>`;
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
async function startRevisionTest(){const items=store.mistakesCache().filter(m=>dueDate(m)<=new Date()&&!m.revised);if(!items.length){mistakes();return;}revisionMode=true;revisionItems=shuffle(items).map(m=>({...m,options:shuffle((m.options||[]).map((text,index)=>({text,index,img:(m.optionImages||[])[index]||""})))}));revisionItems=revisionItems.map(m=>{const order=m.options.map(x=>x.index),opts=m.options.map(x=>x.text),imgs=m.options.map(x=>x.img);return {...m,options:opts,optionImages:imgs,correctIndex:order.indexOf(Number(m.correctIndex)),optionOrder:order};});test=revisionItems.map(m=>({id:m.wrongId,year:m.year,state:m.state,questionNumber:m.questionNumber,question:m.question,options:m.options,image:m.image||"",optionImages:m.optionImages||[],answer:m.correctIndex,wrongId:m.wrongId}));answers=Array(test.length).fill(null);marked=Array(test.length).fill(false);qTime=Array(test.length).fill(0);current=0;left=test.length*60;/* 1 min/question, no extra time */examStartedAt=Date.now();questionStartedAt=Date.now();clearInterval(timer);timer=setInterval(()=>{left--;const el=document.querySelector(".timer");if(el)el.textContent=clock(left);if(left<=0){left=0;submitRevisionTest();}},1000);examActive=true;window.addEventListener("beforeunload",handleRevisionBeforeUnload);window.addEventListener("pagehide",handleRevisionPageHide);armBackGuard();renderRevision();}
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
  if(!examActive||isSubmitting||!revisionMode||!revisionItems.length)return;
  sendRevisionAutoSubmit();
  e.preventDefault();e.returnValue="Your revision test is still running. It will be submitted automatically.";return e.returnValue;
}
function handleRevisionPageHide(){if(examActive&&!isSubmitting&&revisionMode&&revisionItems.length)sendRevisionAutoSubmit();}

function renderRevision(){const q=test[current],answered=answers.filter(x=>x!==null).length;app.innerHTML=`<div class="top"><h1>1-Day Revision Test</h1><div class="timer">${clock(left)}</div></div><div class="card"><div class="meta">Question ${current+1} of ${test.length} • Answered ${answered}/${test.length}</div><div class="question">${esc(q.question)}</div>${imgHTML(q.image)}${q.options.map((o,k)=>`<label class="option ${answers[current]===k?"selected":""}"><input type="radio" ${answers[current]===k?"checked":""} onchange="revisionChoose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)} ${imgHTML((q.optionImages||[])[k],"opt-img")}</label>`).join("")}<div class="examfoot"><button onclick="revisionGo(current-1)" ${current===0?"disabled":""}>◀ Previous</button><button onclick="revisionGo(current+1)" ${current===test.length-1?"disabled":""}>Next ▶</button><button class="submit" onclick="submitRevisionTest()">Finish revision</button></div></div>`;}
function revisionChoose(v){answers[current]=v;renderRevision();}
function revisionGo(n){commitTime();current=Math.max(0,Math.min(test.length-1,n));questionStartedAt=Date.now();renderRevision();}
async function submitRevisionTest(){if(isSubmitting)return;isSubmitting=true;clearInterval(timer);window.removeEventListener("beforeunload",handleRevisionBeforeUnload);window.removeEventListener("pagehide",handleRevisionPageHide);disarmBackGuard();commitTime();
  /* STRICT: same reasoning as submit() above — revisionMode/revisionItems
   * used to be left populated after finishing, so any later navigation
   * that reset isSubmitting (via clearExam()) made the guards think a
   * revision test was still running. Clearing here makes "finished" final. */
  const p=store.profile();const items=revisionItems.map((m,i)=>({wrongId:m.wrongId,selected:answers[i],time:qTime[i]}));
  examActive=false;
  revisionMode=false;revisionItems=[];test=[];answers=[];marked=[];qTime=[];left=0;current=0;
  app.innerHTML=`<div class="card"><h1>Checking revision…</h1><p class="note">Updating your mistakes.</p></div>`;const res=await apiPost("submitRevision",{email:p.email,items});if(res?.ok){const fresh=await apiGet("mistakes",{email:p.email});store.setMistakesCache(fresh?.data||[]);app.innerHTML=`<div class="card"><h1>Revision result</h1><div class="stats"><div class="stat"><b>${res.correct}</b>Correct</div><div class="stat"><b>${res.wrong}</b>Wrong again</div><div class="stat"><b>${res.unanswered}</b>Unanswered</div><div class="stat"><b>${(fresh?.data||[]).length}</b>Active mistakes</div></div><p class="note">Correct answers are removed from My Mistakes. Wrong or unanswered questions are scheduled again for 1 day.</p><div class="buttons"><button onclick="mistakes()">My Mistakes</button><button onclick="home()">Subjects</button></div></div>`;}else{isSubmitting=false;app.innerHTML=`<div class="card"><h2>Could not save revision.</h2><button onclick="mistakes()">Back</button></div>`;}}

home();
