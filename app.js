let bank=[],test=[],answers=[],current=0,left=0,timer=null;
const app=document.getElementById("app");

const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clockText=()=>String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");

async function home(){
  const subjects=await fetch("subjects.json").then(r=>r.json());
  app.innerHTML=`<div class="card start"><h1>ECET Online Test</h1><p>All questions • 1 minute per question + 20 minutes</p>
  ${subjects.map(s=>`<button onclick="loadSubject('${esc(s.file)}','${esc(s.name)}')">${esc(s.name)}</button>`).join("")}</div>`;
}

async function loadSubject(file,name){
  bank=await fetch(file).then(r=>r.json());
  if(!bank.length){app.innerHTML='<div class="card"><h2>No questions found.</h2></div>';return}
  start(name);
}

function start(name){
  clearInterval(timer);
  test=[...bank];
  answers=Array(test.length).fill(null);
  current=0;
  left=test.length*60+20*60;
  timer=setInterval(()=>{
    left--;
    const el=document.querySelector(".timer"); if(el) el.textContent=clockText();
    if(left<=0){left=0;submit()}
  },1000);
  render(name);
}

function choose(v){answers[current]=v;render(window.testName)}
function go(n){current=Math.max(0,Math.min(test.length-1,n));render(window.testName)}

function render(name){
  window.testName=name||window.testName||"Digital Electronics";
  const q=test[current];
  app.innerHTML=`<div class="top"><h1>ECET ${esc(window.testName)}</h1><div class="timer">${clockText()}</div></div>
  <div class="card">
    <div class="meta">Question ${current+1} of ${test.length} • ${q.year} ${q.state} • PYQ ${q.questionNumber}</div>
    <div class="question">${esc(q.question)}</div>
    ${q.options.map((o,k)=>`<label class="option"><input type="radio" name="answer" ${answers[current]===k?"checked":""} onchange="choose(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}
    <div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${k===current?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div>
    <div class="buttons">
      <button onclick="go(current-1)" ${current===0?"disabled":""}>Previous</button>
      <button onclick="go(current+1)" ${current===test.length-1?"disabled":""}>Next</button>
      <button class="submit" onclick="submit()">Submit</button>
    </div>
  </div>`;
}

function submit(){
  clearInterval(timer);
  const answered=answers.filter(x=>x!==null).length;
  const unanswered=test.length-answered;
  const score=test.reduce((s,q,n)=>s+(answers[n]===q.answer?1:0),0);
  app.innerHTML=`<div class="card"><h1>Result</h1>
    <div class="stats">
      <div class="stat"><b>${score}</b>Score / ${test.length}</div>
      <div class="stat"><b>${test.length-score-unanswered}</b>Wrong</div>
      <div class="stat"><b>${unanswered}</b>Unanswered</div>
    </div>
    <button onclick="start(window.testName)">Retry Test</button>
    <h2>Review</h2>
    ${test.map((q,n)=>`<div class="review"><b>Q${n+1} • ${q.year} ${q.state}</b><br>${esc(q.question)}<br>Your answer: ${answers[n]===null?"Unanswered":"ABCD"[answers[n]]} • Correct: <span class="correct">${"ABCD"[q.answer]}</span></div>`).join("")}
  </div>`;
}
home();
