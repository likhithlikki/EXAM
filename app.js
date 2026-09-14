let bank=[],test=[],answers=[],i=0,left=0,timer=null;const app=document.getElementById("app");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function home(){
  const ss=await fetch("subjects.json").then(r=>r.json());
  app.innerHTML=`<div class="card start"><h1>ECET MCQ Test</h1><p>All questions included • 1 minute per question</p>${ss.map(s=>`<button onclick="load('${s.file}')">${esc(s.name)}</button>`).join(" ")}</div>`;
}

async function load(f){
  bank=await fetch(f).then(r=>r.json());
  if(bank.length<1){
    app.innerHTML=`<div class="card"><h2>Question bank not ready</h2><p>This subject's JSON file has no questions yet.</p></div>`;
    return;
  }
  start();
}

function start(){
  test=[...bank];              // every question in the bank, in the original order — no random subset
  answers=Array(test.length).fill(null);
  i=0;
  left=test.length*60;         // 1 minute per question, scales with bank size
  clearInterval(timer);
  timer=setInterval(()=>{left--;clock();if(left<=0){left=0;submit()}},1000);
  render();
}

function clock(){
  const e=document.querySelector(".timer");
  if(e)e.textContent=String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
}

function pick(v){answers[i]=v;render();}
function go(n){i=Math.max(0,Math.min(test.length-1,n));render();}
function clearAns(){answers[i]=null;render();}

function render(){
  const q=test[i];
  app.innerHTML=`<div class="top"><h1>ECET Digital Electronics</h1><div class="timer"></div></div>
  <div class="card">
    <div class="meta">Question ${i+1} of ${test.length}${q.year?` • ${q.year} ${q.state||""}`:""}</div>
    <div class="question">${esc(q.question)}</div>
    ${q.options.map((o,k)=>`<label class="opt"><input type="radio" name="a" ${answers[i]===k?"checked":""} onchange="pick(${k})"><b>${"ABCD"[k]}.</b> ${esc(o)}</label>`).join("")}
    <div class="palette">${test.map((_,k)=>`<button class="num ${answers[k]!==null?"answered":""} ${k===i?"current":""}" onclick="go(${k})">${k+1}</button>`).join("")}</div>
    <div class="buttons">
      <button onclick="go(i-1)" ${i===0?"disabled":""}>Previous</button>
      <button onclick="clearAns()">Clear</button>
      <button onclick="go(i+1)" ${i===test.length-1?"disabled":""}>Next</button>
      <button class="submit" onclick="submit()">Submit</button>
    </div>
  </div>`;
  clock();
}

function submit(){
  clearInterval(timer);
  const answered=answers.filter(x=>x!==null).length, un=test.length-answered;
  const score=test.reduce((s,q,n)=>s+(answers[n]===q.answer?1:0),0);
  app.innerHTML=`<div class="card"><h1>Result</h1>
    <div class="stats">
      <div class="stat"><b>${score} / ${test.length}</b>Score</div>
      <div class="stat"><b>${answered}</b>Answered</div>
      <div class="stat"><b>${un}</b>Unanswered</div>
    </div>
    <br><button onclick="start()">Retry Test</button><button onclick="home()">Change Subject</button>
    <h2>Review</h2>
    ${test.map((q,n)=>{
      const ua=answers[n];
      const status=ua===null?"Unanswered":(ua===q.answer?"Correct":"Wrong");
      return `<div style="padding:12px 0;border-top:1px solid #ddd">
        <b>Q${n+1}</b> — <span>${status}</span><br>
        ${esc(q.question)}<br>
        Your answer: ${ua===null?"Unanswered":"ABCD"[ua]+". "+esc(q.options[ua])}<br>
        Correct answer: ${"ABCD"[q.answer]}. ${esc(q.options[q.answer])}
      </div>`;
    }).join("")}
  </div>`;
}

home();
