/* ECET Quiz Backend - Google Apps Script */
const SPREADSHEET_ID = "1QDu7YTv-MWm9jRuVsmRBGjwuBD6WFtj_4bRqj5B8hds";

const SHEETS = {
  Users:["Timestamp","Name","Email","LastSubject"],
  Results:["ResultId","Timestamp","Name","Email","Subject","SubjectId","Score","Total","Percentage","Correct","Wrong","Unanswered","TotalTimeSec","Rank","RankOutOf"],
  Answers:["ResultId","Email","Subject","QuestionId","Year","State","QuestionNumber","SelectedIndex","CorrectIndex","IsCorrect","TimeSpentSec","MarkedForReview"],
  WrongAnswers:["WrongId","ResultId","Email","Subject","QuestionId","Year","State","QuestionNumber","Question","OptionsJSON","CorrectIndex","SelectedIndex","DateAdded","RevisionDueDate","Revised","ReminderSent"],
  Rankings:["Subject","Email","Name","BestPercentage","BestScore","Total","Attempts","LastAttempt"],
  RevisionHistory:["Email","Subject","QuestionId","ActionDate","Action"],
  EmailQueue:["QueueId","ToEmail","EmailType","Subject","HtmlBody","CreatedAt","SentAt","Status"],
  SubmittedSessions:["ExamSessionId","ResultId","Email","Subject","SubmittedAt"]
};

function getSpreadsheet_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sheet_(name){ return getSpreadsheet_().getSheetByName(name); }
function tz_(){ return Session.getScriptTimeZone() || "Asia/Kolkata"; }
function iso_(d){ return Utilities.formatDate(new Date(d),tz_(),"yyyy-MM-dd'T'HH:mm:ss"); }
function displayDate_(d){ return Utilities.formatDate(new Date(d),tz_(),"dd-MM-yyyy HH:mm"); }
function normEmail_(v){ return String(v||"").trim().toLowerCase(); }
function escapeHtml_(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function jsonOut_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function ensureSheets_(){
  const ss=getSpreadsheet_();
  Object.keys(SHEETS).forEach(name=>{
    let sh=ss.getSheetByName(name);
    if(!sh) sh=ss.insertSheet(name);
    if(sh.getLastRow()===0){
      sh.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  });
  const def=ss.getSheetByName("Sheet1");
  if(def && def.getLastRow()===0 && ss.getSheets().length>1) ss.deleteSheet(def);
}

function rowsToObjects_(sh){
  if(!sh || sh.getLastRow()<2) return [];
  const values=sh.getDataRange().getValues();
  if(values.length<2) return [];
  const headers=values[0];
  return values.slice(1).filter(r=>r.join("")!=="").map(r=>{
    const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o;
  });
}
function appendRow_(sh,headers,obj){
  sh.appendRow(headers.map(h=>obj[h]!==undefined?obj[h]:""));
}
function appendRows_(sh,headers,objs){
  if(!objs || !objs.length) return;
  const matrix=objs.map(o=>headers.map(h=>o[h]!==undefined?o[h]:""));
  sh.getRange(sh.getLastRow()+1,1,matrix.length,headers.length).setValues(matrix);
}

function doGet(e){
  try{
    ensureSheets_();
    const action=String(e.parameter.action||"").trim();
    if(action==="ping") return jsonOut_({ok:true,time:new Date().toISOString()});
    if(action==="dashboard") return jsonOut_({ok:true,data:getDashboard_(e.parameter.email)});
    if(action==="mistakes") return jsonOut_({ok:true,data:getMistakes_(e.parameter.email,e.parameter.subject)});
    return jsonOut_({ok:false,error:"Unknown action"});
  }catch(err){ return jsonOut_({ok:false,error:String(err)}); }
}

function doPost(e){
  try{
    ensureSheets_();
    const body=JSON.parse((e.postData&&e.postData.contents)||"{}");
    if(body.action==="register") return jsonOut_(registerUser_(body));
    if(body.action==="submitExam") return jsonOut_(submitExam_(body));
    if(body.action==="submitRevision") return jsonOut_(submitRevision_(body));
    if(body.action==="markRevised") return jsonOut_(markRevised_(body));
    return jsonOut_({ok:false,error:"Unknown action"});
  }catch(err){ return jsonOut_({ok:false,error:String(err)}); }
}

function registerUser_(body){
  appendRow_(sheet_("Users"),SHEETS.Users,{Timestamp:new Date(),Name:body.name,Email:normEmail_(body.email),LastSubject:body.subject});
  return {ok:true};
}

/* AP ECET reference converted from marks out of 200 to percentage.
   Example: 130/200 = 65%, 120/200 = 60%, etc. */
function expectedRank_(percentage){
  const p=Number(percentage)||0;
  if(p>=65) return "1 – 10";
  if(p>=60) return "11 – 20";
  if(p>=55) return "21 – 40";
  if(p>=50) return "41 – 60";
  if(p>=45) return "61 – 100";
  if(p>=40) return "101 – 200";
  if(p>=35) return "201 – 500";
  if(p>=30) return "501 – 1000";
  return "1001+";
}
function expectedMarks_(percentage){ return Math.round((Number(percentage)||0)*2*10)/10; }

/* Current practice rank: one rank per unique email, using the student's
   best percentage in the subject. Old students therefore move automatically
   whenever new students submit higher scores. Ties receive the same rank. */
function getPracticeRanking_(subject,email,currentPercentage){
  const results=rowsToObjects_(sheet_("Results")).filter(r=>String(r.Subject)===String(subject));
  const best={};
  results.forEach(r=>{
    const em=normEmail_(r.Email); if(!em) return;
    const p=Number(r.Percentage)||0;
    if(best[em]===undefined || p>best[em].percentage) best[em]={percentage:p,name:r.Name||""};
  });
  const me=normEmail_(email), p=Number(currentPercentage)||0;
  if(!best[me] || p>best[me].percentage) best[me]={percentage:p,name:""};
  const users=Object.keys(best).map(em=>({email:em,percentage:best[em].percentage,name:best[em].name}));
  users.sort((a,b)=>b.percentage-a.percentage || a.email.localeCompare(b.email));
  const higher=users.filter(x=>x.percentage>p).length;
  return {rank:higher+1,total:users.length};
}

function submitExam_(body){
  const sessionId=String(body.examSessionId||"").trim();
  if(sessionId){
    const ledger=sheet_("SubmittedSessions"), rows=rowsToObjects_(ledger);
    const existing=rows.find(r=>String(r.ExamSessionId||"")===sessionId);
    if(existing){
      const oldResult=rowsToObjects_(sheet_("Results")).find(r=>String(r.ResultId||"")===String(existing.ResultId||""));
      return {ok:true,duplicate:true,resultId:existing.ResultId,rank:oldResult?oldResult.Rank:null,rankOutOf:oldResult?oldResult.RankOutOf:null,expectedRank:oldResult?expectedRank_(oldResult.Percentage):null,equivalentMarks:oldResult?expectedMarks_(oldResult.Percentage):null,emailStatus:"ALREADY_SENT"};
    }
  }
  const resultId=Utilities.getUuid(), now=new Date();
  const pct=Math.max(0,Math.min(100,Number(body.percentage)||0));
  const email=normEmail_(body.email);
  const ranking=getPracticeRanking_(body.subject,email,pct);

  appendRow_(sheet_("Results"),SHEETS.Results,{
    ResultId:resultId,Timestamp:now,Name:body.name,Email:email,Subject:body.subject,SubjectId:body.subjectId,
    Score:body.score,Total:body.total,Percentage:pct,Correct:body.correct,Wrong:body.wrong,Unanswered:body.unanswered,
    TotalTimeSec:body.totalTime,Rank:ranking.rank,RankOutOf:ranking.total
  });

  const due=iso_(new Date(now.getTime()+1*86400000));
  const answerRows=[],wrongRows=[];
  (body.detail||[]).forEach(d=>{
    const isCorrect=d.selected!==null && d.selected!==undefined && Number(d.selected)===Number(d.correct);
    answerRows.push({
      ResultId:resultId,Email:email,Subject:body.subject,QuestionId:d.id,Year:d.year,State:d.state,QuestionNumber:d.questionNumber,
      SelectedIndex:d.selected===null||d.selected===undefined?"":d.selected,CorrectIndex:d.correct,IsCorrect:isCorrect,
      TimeSpentSec:Math.round(Number(d.time)||0),MarkedForReview:!!d.marked
    });
    if(d.selected!==null && d.selected!==undefined && !isCorrect){
      wrongRows.push({
        WrongId:resultId+"-"+d.id,ResultId:resultId,Email:email,Subject:body.subject,QuestionId:d.id,Year:d.year,State:d.state,
        QuestionNumber:d.questionNumber,Question:d.question,OptionsJSON:JSON.stringify(d.options||[]),CorrectIndex:d.correct,SelectedIndex:d.selected,
        DateAdded:iso_(now),RevisionDueDate:due,Revised:false,ReminderSent:false
      });
    }
  });

  /* One Sheets write for all answers + one for all wrong answers. */
  appendRows_(sheet_("Answers"),SHEETS.Answers,answerRows);
  appendRows_(sheet_("WrongAnswers"),SHEETS.WrongAnswers,wrongRows);
  if(sessionId){
    appendRow_(sheet_("SubmittedSessions"),SHEETS.SubmittedSessions,{ExamSessionId:sessionId,ResultId:resultId,Email:email,Subject:body.subject,SubmittedAt:now});
  }

  upsertRanking_(sheet_("Rankings"),body);
  const advice=getUserSubjectAdvice_(email);
  const emailResult=queueResultEmail_(body,ranking.rank,ranking.total,expectedRank_(pct),expectedMarks_(pct),advice);

  return {
    ok:true,resultId,rank:ranking.rank,rankOutOf:ranking.total,
    expectedRank:expectedRank_(pct),equivalentMarks:expectedMarks_(pct),
    strongest:advice.strongest,weakest:advice.weakest,emailStatus:emailResult.status
  };
}

function upsertRanking_(sh,body){
  const values=sh.getDataRange().getValues();
  if(!values.length) return;
  const headers=values[0], s=headers.indexOf("Subject"), e=headers.indexOf("Email");
  const email=normEmail_(body.email);
  for(let i=1;i<values.length;i++){
    if(String(values[i][s])===String(body.subject) && normEmail_(values[i][e])===email){
      const row=values[i].slice(), bp=headers.indexOf("BestPercentage"), bs=headers.indexOf("BestScore"), a=headers.indexOf("Attempts"), l=headers.indexOf("LastAttempt");
      if(Number(body.percentage)>Number(row[bp]||0)){row[bp]=body.percentage;row[bs]=body.score;}
      row[a]=Number(row[a]||0)+1; row[l]=new Date();
      sh.getRange(i+1,1,1,headers.length).setValues([row]); return;
    }
  }
  appendRow_(sh,SHEETS.Rankings,{Subject:body.subject,Email:email,Name:body.name,BestPercentage:body.percentage,BestScore:body.score,Total:body.total,Attempts:1,LastAttempt:new Date()});
}

function getUserSubjectAdvice_(email){
  const results=rowsToObjects_(sheet_("Results")).filter(r=>normEmail_(r.Email)===normEmail_(email));
  const by={};
  results.forEach(r=>{
    const s=String(r.Subject||""); if(!s) return;
    if(!by[s]) by[s]={subject:s,sum:0,count:0,best:0};
    const p=Number(r.Percentage)||0; by[s].sum+=p; by[s].count++; by[s].best=Math.max(by[s].best,p);
  });
  const arr=Object.values(by).map(x=>({subject:x.subject,avgPercentage:Math.round(x.sum/x.count*10)/10,bestPercentage:x.best,attempts:x.count}));
  arr.sort((a,b)=>b.avgPercentage-a.avgPercentage);
  return {strongest:arr[0]||null,weakest:arr[arr.length-1]||null,subjects:arr};
}

function buildResultEmail_(body,rank,total,expectedRank,equivalentMarks,advice){
  const subject="ECET "+body.subject+" — "+body.percentage+"%";
  let adviceHtml="";
  if(advice&&advice.strongest){
    adviceHtml+="<p><b>Performance advice:</b> You are currently strongest in <b>"+escapeHtml_(advice.strongest.subject)+"</b> ("+advice.strongest.avgPercentage+"% average).";
    if(advice.weakest && advice.weakest.subject!==advice.strongest.subject) adviceHtml+=" Your weakest subject is <b>"+escapeHtml_(advice.weakest.subject)+"</b> ("+advice.weakest.avgPercentage+"% average). Focus more revision there.";
    adviceHtml+="</p>";
  }
  const html="<p>Hi "+escapeHtml_(body.name)+",</p><p>Your <b>"+escapeHtml_(body.subject)+"</b> result:</p><ul>"+
    "<li>Score: "+body.score+" / "+body.total+"</li>"+
    "<li>Percentage: "+body.percentage+"%</li>"+
    "<li>Equivalent AP ECET score: "+equivalentMarks+" / 200</li>"+
    "<li>Expected AP ECET rank: "+expectedRank+"</li>"+
    "<li>Current practice rank: #"+rank+" of "+total+" students</li>"+
    "<li>Correct: "+body.correct+" • Wrong: "+body.wrong+" • Unanswered: "+body.unanswered+"</li>"+
    "<li>Total time: "+Math.round((Number(body.totalTime)||0)/60)+" minutes</li></ul>"+
    adviceHtml+
    "<p>Wrong questions are added to My Mistakes. They become eligible for revision after 1 day.</p>";
  return {subject,html};
}
function queueResultEmail_(body,rank,total,expectedRank,equivalentMarks,advice){
  const x=buildResultEmail_(body,rank,total,expectedRank,equivalentMarks,advice);
  const email=normEmail_(body.email);
  try{
    // Send immediately so the result email does not depend on a trigger.
    MailApp.sendEmail({to:email,subject:x.subject,htmlBody:x.html});
    return {status:"SENT",error:""};
  }catch(err){
    // Keep a retryable copy if immediate sending fails (for example, before
    // the Apps Script owner has granted MailApp permission or after a quota error).
    appendRow_(sheet_("EmailQueue"),SHEETS.EmailQueue,{
      QueueId:Utilities.getUuid(),ToEmail:email,EmailType:"result",Subject:x.subject,
      HtmlBody:x.html,CreatedAt:new Date(),SentAt:"",Status:"PENDING: "+String(err).slice(0,150)
    });
    return {status:"QUEUED",error:String(err)};
  }
}

function processEmailQueue(){
  const sh=sheet_("EmailQueue"), values=sh.getDataRange().getValues(); if(values.length<2)return;
  const h=values[0], c=n=>h.indexOf(n), now=new Date();
  for(let i=1;i<values.length;i++) if(String(values[i][c("Status")]).indexOf("PENDING")===0){
    try{
      MailApp.sendEmail({to:values[i][c("ToEmail")],subject:values[i][c("Subject")],htmlBody:values[i][c("HtmlBody")]});
      sh.getRange(i+1,c("SentAt")+1,1,2).setValues([[now,"SENT"]]);
    }catch(err){ sh.getRange(i+1,c("Status")+1).setValue("FAILED: "+String(err).slice(0,180)); }
  }
}

function getDashboard_(email){
  const em=normEmail_(email);
  const results=rowsToObjects_(sheet_("Results")).filter(r=>normEmail_(r.Email)===em);
  const wrongs=rowsToObjects_(sheet_("WrongAnswers")).filter(r=>normEmail_(r.Email)===em);
  const attempts=results.length;
  const avg=attempts?Math.round(results.reduce((s,r)=>s+(Number(r.Percentage)||0),0)/attempts*10)/10:0;
  const best=attempts?Math.max.apply(null,results.map(r=>Number(r.Percentage)||0)):0;
  const weak=wrongs.filter(w=>!parseBool_(w.Revised)).length;

  const bySubject={};
  results.forEach(r=>{
    const s=String(r.Subject||""); if(!s)return;
    if(!bySubject[s])bySubject[s]={subject:s,sum:0,n:0,best:0};
    const p=Number(r.Percentage)||0; bySubject[s].sum+=p; bySubject[s].n++; bySubject[s].best=Math.max(bySubject[s].best,p);
  });
  const subjectPerformance=Object.values(bySubject).map(s=>({subject:s.subject,avgPercentage:Math.round(s.sum/s.n*10)/10,bestPercentage:s.best,attempts:s.n}));

  /* Recalculate current practice ranks from all students' best percentages,
     so old users' displayed ranks change when new users submit. */
  const all=rowsToObjects_(sheet_("Results"));
  const bestByUser={};
  all.forEach(r=>{
    const sub=String(r.Subject||""), user=normEmail_(r.Email); if(!sub||!user)return;
    if(!bestByUser[sub])bestByUser[sub]={};
    const p=Number(r.Percentage)||0;
    if(bestByUser[sub][user]===undefined || p>bestByUser[sub][user])bestByUser[sub][user]=p;
  });
  const currentRanks={};
  Object.keys(bestByUser).forEach(sub=>{
    const mine=bestByUser[sub][em]; if(mine===undefined)return;
    const arr=Object.values(bestByUser[sub]);
    currentRanks[sub]={rank:1+arr.filter(p=>p>mine).length,total:arr.length};
  });

  const history=results.slice().sort((a,b)=>new Date(b.Timestamp)-new Date(a.Timestamp)).map(r=>({
    date:displayDate_(r.Timestamp),subject:r.Subject,score:r.Score,total:r.Total,percentage:Number(r.Percentage)||0,
    rank:r.Rank,rankOutOf:r.RankOutOf,currentRank:currentRanks[r.Subject]?currentRanks[r.Subject].rank:null,
    currentRankOutOf:currentRanks[r.Subject]?currentRanks[r.Subject].total:null,
    equivalentMarks:expectedMarks_(r.Percentage),expectedRank:expectedRank_(r.Percentage),totalTimeSec:Number(r.TotalTimeSec)||0
  }));
  const strongest=subjectPerformance.slice().sort((a,b)=>b.avgPercentage-a.avgPercentage)[0]||null;
  const weakest=subjectPerformance.slice().sort((a,b)=>a.avgPercentage-b.avgPercentage)[0]||null;
  return {attempts,avgPercentage:avg,bestPercentage:best,weakCount:weak,subjectPerformance,history,strongest,weakest,currentRanks};
}

function parseBool_(v){ return v===true || String(v).toLowerCase()==="true"; }
function getMistakes_(email,subjectFilter){
  const em=normEmail_(email);
  let wrongs=rowsToObjects_(sheet_("WrongAnswers")).filter(r=>normEmail_(r.Email)===em && !parseBool_(r.Revised));
  if(subjectFilter) wrongs=wrongs.filter(r=>String(r.Subject)===String(subjectFilter));
  return wrongs.sort((a,b)=>new Date(b.DateAdded)-new Date(a.DateAdded)).map(r=>({
    wrongId:r.WrongId,subject:r.Subject,question:r.Question,options:JSON.parse(r.OptionsJSON||"[]"),
    correctIndex:Number(r.CorrectIndex),selectedIndex:r.SelectedIndex===""?null:Number(r.SelectedIndex),
    revisionDueDate:displayDate_(r.RevisionDueDate),revisionDueIso:iso_(r.RevisionDueDate),revised:parseBool_(r.Revised),
    year:r.Year,state:r.State,questionNumber:r.QuestionNumber
  }));
}

function markRevised_(body){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues(); if(values.length<2)return {ok:false,error:"Not found"};
  const h=values[0], id=h.indexOf("WrongId"),em=h.indexOf("Email"),rv=h.indexOf("Revised"),subj=h.indexOf("Subject"),q=h.indexOf("QuestionId");
  for(let i=1;i<values.length;i++) if(String(values[i][id])===String(body.wrongId)&&normEmail_(values[i][em])===normEmail_(body.email)){
    sh.getRange(i+1,rv+1).setValue(true);
    appendRow_(sheet_("RevisionHistory"),SHEETS.RevisionHistory,{Email:normEmail_(body.email),Subject:values[i][subj],QuestionId:values[i][q],ActionDate:new Date(),Action:"revised"});
    return {ok:true};
  }
  return {ok:false,error:"Not found"};
}

/* Correct answers disappear from the active list. Wrong/unanswered answers
   remain active and receive another 1-day due date. */
function submitRevision_(body){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues();
  if(values.length<2)return {ok:true,correct:0,wrong:0,unanswered:0};
  const h=values[0], idx=n=>h.indexOf(n), id=idx("WrongId"),em=idx("Email"),rv=idx("Revised"),due=idx("RevisionDueDate"),sel=idx("SelectedIndex"),rem=idx("ReminderSent"),subj=idx("Subject"),q=idx("QuestionId"),ci=idx("CorrectIndex");
  const now=new Date(), nextDue=iso_(new Date(now.getTime()+1*86400000));
  let correct=0,wrong=0,unanswered=0; const history=[]; const wanted={};
  (body.items||[]).forEach(item=>wanted[String(item.wrongId)] = item.selected);

  for(let i=1;i<values.length;i++){
    if(normEmail_(values[i][em])!==normEmail_(body.email))continue;
    const key=String(values[i][id]); if(!Object.prototype.hasOwnProperty.call(wanted,key))continue;
    const chosen=wanted[key];
    if(chosen===null || chosen===undefined || chosen===""){
      unanswered++; values[i][sel]=""; values[i][due]=nextDue; values[i][rem]=false;
      history.push({Email:normEmail_(body.email),Subject:values[i][subj],QuestionId:values[i][q],ActionDate:now,Action:"revision-unanswered"});
    }else if(Number(chosen)===Number(values[i][ci])){
      correct++; values[i][rv]=true;
      history.push({Email:normEmail_(body.email),Subject:values[i][subj],QuestionId:values[i][q],ActionDate:now,Action:"revision-correct"});
    }else{
      wrong++; values[i][sel]=chosen; values[i][due]=nextDue; values[i][rem]=false;
      history.push({Email:normEmail_(body.email),Subject:values[i][subj],QuestionId:values[i][q],ActionDate:now,Action:"revision-wrong"});
    }
  }

  /* One write updates all changed WrongAnswers rows. */
  sh.getRange(1,1,values.length,h.length).setValues(values);
  appendRows_(sheet_("RevisionHistory"),SHEETS.RevisionHistory,history);
  return {ok:true,correct,wrong,unanswered,nextDue:displayDate_(nextDue),nextDueIso:nextDue};
}

function migrateLegacyRevisionDueDates_(){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues();
  if(values.length<2)return;
  const h=values[0], c=n=>h.indexOf(n);
  const dateCol=c("DateAdded"), dueCol=c("RevisionDueDate"), revisedCol=c("Revised");
  let changed=false;
  for(let i=1;i<values.length;i++){
    if(parseBool_(values[i][revisedCol]))continue;
    const added=new Date(values[i][dateCol]), due=new Date(values[i][dueCol]);
    if(isNaN(added)||isNaN(due))continue;
    // Rows created by the old 7-day version are migrated to the new 1-day rule.
    // New rows (and rows rescheduled by a revision attempt) are already ~1 day apart.
    if((due-added)>=5*86400000){
      values[i][dueCol]=iso_(new Date(added.getTime()+86400000));
      values[i][c("ReminderSent")]=false;
      changed=true;
    }
  }
  if(changed)sh.getRange(1,1,values.length,h.length).setValues(values);
}

function sendRevisionReminders(){
  migrateLegacyRevisionDueDates_();
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues(); if(values.length<2)return;
  const h=values[0], c=n=>h.indexOf(n), now=new Date(), due={};
  for(let i=1;i<values.length;i++){
    const d=values[i][c("RevisionDueDate")];
    if(d && new Date(d)<=now && !parseBool_(values[i][c("Revised")]) && !parseBool_(values[i][c("ReminderSent")])){
      const em=normEmail_(values[i][c("Email")]); if(!due[em])due[em]=[];
      due[em].push({subject:values[i][c("Subject")],question:values[i][c("Question")],row:i+1});
    }
  }
  const users=rowsToObjects_(sheet_("Users"));
  Object.keys(due).forEach(email=>{
    const u=users.slice().reverse().find(x=>normEmail_(x.Email)===email);
    let html="<p>Hi "+escapeHtml_(u?u.Name:"")+",</p><p>Your 1-day mistake revision is now due.</p><ul>";
    due[email].slice(0,30).forEach(x=>html+="<li><b>"+escapeHtml_(x.subject)+"</b>: "+escapeHtml_(x.question)+"</li>");
    html+="</ul><p>Open My Mistakes and start the revision test. Correct questions are removed; questions answered incorrectly are scheduled again for 1 day.</p>";
    try{
      MailApp.sendEmail({to:email,subject:"ECET Quiz — revision test is due",htmlBody:html});
      due[email].forEach(x=>sh.getRange(x.row,c("ReminderSent")+1).setValue(true));
    }catch(err){ console.log("Revision reminder failed: "+err); }
  });
}

function ensureAutomationTriggers_(){
  const triggers=ScriptApp.getProjectTriggers();
  const hasQueue=triggers.some(t=>t.getHandlerFunction()==="processEmailQueue");
  const hasRevision=triggers.some(t=>t.getHandlerFunction()==="sendRevisionReminders");
  if(!hasQueue) ScriptApp.newTrigger("processEmailQueue").timeBased().everyHours(1).create();
  if(!hasRevision) ScriptApp.newTrigger("sendRevisionReminders").timeBased().everyHours(1).create();
}

function setup(){
  ensureSheets_();
  migrateLegacyRevisionDueDates_();
  ensureAutomationTriggers_();
  return {ok:true,message:"Sheets and hourly email/revision triggers are ready."};
}
