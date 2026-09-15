/* ECET Quiz Backend - Google Apps Script */
const SPREADSHEET_ID = "1QDu7YTv-MWm9jRuVsmRBGjwuBD6WFtj_4bRqj5B8hds";

const SHEETS = {
  Users:["Timestamp","Name","Email","LastSubject"],
  Results:["ResultId","Timestamp","Name","Email","Subject","SubjectId","Score","Total","Percentage","Correct","Wrong","Unanswered","TotalTimeSec","Rank","RankOutOf"],
  Answers:["ResultId","Email","Subject","QuestionId","Year","State","QuestionNumber","SelectedIndex","CorrectIndex","IsCorrect","TimeSpentSec","MarkedForReview"],
  WrongAnswers:["WrongId","ResultId","Email","Subject","QuestionId","Year","State","QuestionNumber","Question","OptionsJSON","CorrectIndex","SelectedIndex","DateAdded","RevisionDueDate","Revised","ReminderSent"],
  Rankings:["Subject","Email","Name","BestPercentage","BestScore","Total","Attempts","LastAttempt"],
  RevisionHistory:["Email","Subject","QuestionId","ActionDate","Action"],
  EmailQueue:["QueueId","ToEmail","EmailType","Subject","HtmlBody","CreatedAt","SentAt","Status"]
};

function getSpreadsheet_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }
function ensureSheets_(){
  const ss=getSpreadsheet_();
  Object.keys(SHEETS).forEach(name=>{
    let sh=ss.getSheetByName(name);
    if(!sh) sh=ss.insertSheet(name);
    if(sh.getLastRow()===0){ sh.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight("bold"); sh.setFrozenRows(1); }
  });
  const def=ss.getSheetByName("Sheet1");
  if(def && def.getLastRow()===0 && ss.getSheets().length>1) ss.deleteSheet(def);
}
function sheet_(name){ return getSpreadsheet_().getSheetByName(name); }
function jsonOut_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function rowsToObjects_(sh){
  if(!sh) return [];
  const values=sh.getDataRange().getValues(); if(values.length<2) return [];
  const headers=values[0];
  return values.slice(1).filter(r=>r.join("")!=="").map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; });
}
function appendRow_(sh,headers,obj){ sh.appendRow(headers.map(h=>obj[h]!==undefined?obj[h]:"")); }
function appendRows_(sh,headers,objs){
  if(!objs.length) return;
  const matrix=objs.map(o=>headers.map(h=>o[h]!==undefined?o[h]:""));
  sh.getRange(sh.getLastRow()+1,1,matrix.length,headers.length).setValues(matrix);
}
function tz_(){ return Session.getScriptTimeZone() || "Asia/Kolkata"; }
function iso_(d){ return Utilities.formatDate(d,tz_(),"yyyy-MM-dd'T'HH:mm:ss"); }
function escapeHtml_(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

function doGet(e){
  try{
    ensureSheets_();
    const action=(e.parameter.action||"").trim();
    if(action==="ping") return jsonOut_({ok:true,time:new Date().toISOString()});
    if(action==="dashboard") return jsonOut_({ok:true,data:getDashboard_(String(e.parameter.email||"").trim())});
    if(action==="mistakes") return jsonOut_({ok:true,data:getMistakes_(String(e.parameter.email||"").trim(),String(e.parameter.subject||"").trim())});
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
  appendRow_(sheet_("Users"),SHEETS.Users,{Timestamp:new Date(),Name:body.name,Email:body.email,LastSubject:body.subject});
  return {ok:true};
}

/* AP ECET ECE 2026 reference table supplied by the user.
   Conversion is percentage -> equivalent score out of 200. */
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

/* Dynamic practice rank: one row per unique student, using that student's
   best percentage in the subject. This means old users automatically move
   when new students submit better percentages. */
function getPracticeRanking_(subject,email,currentPercentage){
  const results=rowsToObjects_(sheet_("Results")).filter(r=>r.Subject===subject);
  const best={};
  results.forEach(r=>{
    const em=String(r.Email||"").toLowerCase().trim(); if(!em) return;
    const p=Number(r.Percentage)||0;
    if(best[em]===undefined || p>best[em].percentage) best[em]={percentage:p,name:r.Name||""};
  });
  const me=String(email||"").toLowerCase().trim();
  const p=Number(currentPercentage)||0;
  if(!best[me] || p>best[me].percentage) best[me]={percentage:p,name:""};
  const users=Object.keys(best).map(em=>({email:em,percentage:best[em].percentage,name:best[em].name}));
  users.sort((a,b)=>b.percentage-a.percentage || a.email.localeCompare(b.email));
  const idx=users.findIndex(x=>x.email===me);
  return {rank:idx<0?users.length+1:idx+1,total:users.length};
}

function submitExam_(body){
  const resultId=Utilities.getUuid(), now=new Date();
  const pct=Math.max(0,Math.min(100,Number(body.percentage)||0));
  const ranking=getPracticeRanking_(body.subject,body.email,pct);
  const resultsSheet=sheet_("Results");
  appendRow_(resultsSheet,SHEETS.Results,{
    ResultId:resultId,Timestamp:now,Name:body.name,Email:body.email,Subject:body.subject,SubjectId:body.subjectId,
    Score:body.score,Total:body.total,Percentage:pct,Correct:body.correct,Wrong:body.wrong,Unanswered:body.unanswered,
    TotalTimeSec:body.totalTime,Rank:ranking.rank,RankOutOf:ranking.total
  });

  const due=iso_(new Date(now.getTime()+7*86400000));
  const answerRows=[],wrongRows=[];
  (body.detail||[]).forEach(d=>{
    const isCorrect=d.selected!==null && d.selected===d.correct;
    answerRows.push({ResultId:resultId,Email:body.email,Subject:body.subject,QuestionId:d.id,Year:d.year,State:d.state,QuestionNumber:d.questionNumber,
      SelectedIndex:d.selected===null?"":d.selected,CorrectIndex:d.correct,IsCorrect:isCorrect,TimeSpentSec:d.time,MarkedForReview:!!d.marked});
    if(d.selected!==null && !isCorrect){
      wrongRows.push({WrongId:resultId+"-"+d.id,ResultId:resultId,Email:body.email,Subject:body.subject,QuestionId:d.id,Year:d.year,State:d.state,
        QuestionNumber:d.questionNumber,Question:d.question,OptionsJSON:JSON.stringify(d.options),CorrectIndex:d.correct,SelectedIndex:d.selected,
        DateAdded:iso_(now),RevisionDueDate:due,Revised:false,ReminderSent:false});
    }
  });
  appendRows_(sheet_("Answers"),SHEETS.Answers,answerRows);
  appendRows_(sheet_("WrongAnswers"),SHEETS.WrongAnswers,wrongRows);
  upsertRanking_(sheet_("Rankings"),body);
  queueResultEmail_(body,ranking.rank,ranking.total,expectedRank_(pct),expectedMarks_(pct));
  return {ok:true,resultId,rank:ranking.rank,rankOutOf:ranking.total,expectedRank:expectedRank_(pct),equivalentMarks:expectedMarks_(pct)};
}

function upsertRanking_(sh,body){
  const values=sh.getDataRange().getValues(), headers=values[0];
  const s=headers.indexOf("Subject"), e=headers.indexOf("Email");
  for(let i=1;i<values.length;i++) if(values[i][s]===body.subject && values[i][e]===body.email){
    const row=values[i].slice(), bp=headers.indexOf("BestPercentage"), bs=headers.indexOf("BestScore"), a=headers.indexOf("Attempts"), l=headers.indexOf("LastAttempt");
    if(Number(body.percentage)>Number(row[bp])){row[bp]=body.percentage;row[bs]=body.score;}
    row[a]=Number(row[a]||0)+1; row[l]=new Date(); sh.getRange(i+1,1,1,headers.length).setValues([row]); return;
  }
  appendRow_(sh,SHEETS.Rankings,{Subject:body.subject,Email:body.email,Name:body.name,BestPercentage:body.percentage,BestScore:body.score,Total:body.total,Attempts:1,LastAttempt:new Date()});
}

function buildResultEmail_(body,rank,total,expectedRank,equivalentMarks){
  const subject="ECET "+body.subject+" — "+body.percentage+"%";
  const html="<p>Hi "+escapeHtml_(body.name)+",</p><p>Your <b>"+escapeHtml_(body.subject)+"</b> result:</p><ul>"+
    "<li>Score: "+body.score+" / "+body.total+"</li><li>Percentage: "+body.percentage+"%</li>"+
    "<li>Equivalent AP ECET score: "+equivalentMarks+" / 200</li><li>Expected AP ECET rank: "+expectedRank+"</li>"+
    "<li>Practice rank: #"+rank+" of "+total+" students</li><li>Correct: "+body.correct+" • Wrong: "+body.wrong+" • Unanswered: "+body.unanswered+"</li></ul>";
  return {subject,html};
}
function queueResultEmail_(body,rank,total,expectedRank,equivalentMarks){
  const x=buildResultEmail_(body,rank,total,expectedRank,equivalentMarks);
  appendRow_(sheet_("EmailQueue"),SHEETS.EmailQueue,{QueueId:Utilities.getUuid(),ToEmail:body.email,EmailType:"result",Subject:x.subject,HtmlBody:x.html,CreatedAt:new Date(),SentAt:"",Status:"PENDING"});
}
function processEmailQueue(){
  const sh=sheet_("EmailQueue"), values=sh.getDataRange().getValues(); if(values.length<2)return;
  const h=values[0], c=n=>h.indexOf(n), now=new Date();
  for(let i=1;i<values.length;i++) if(String(values[i][c("Status")])==="PENDING"){
    try{MailApp.sendEmail({to:values[i][c("ToEmail")],subject:values[i][c("Subject")],htmlBody:values[i][c("HtmlBody")]});sh.getRange(i+1,c("SentAt")+1).setValue(now);sh.getRange(i+1,c("Status")+1).setValue("SENT");}
    catch(err){sh.getRange(i+1,c("Status")+1).setValue("FAILED: "+String(err).slice(0,180));}
  }
}

function getDashboard_(email){
  const results=rowsToObjects_(sheet_("Results")).filter(r=>String(r.Email||"").toLowerCase().trim()===String(email).toLowerCase().trim());
  const wrongs=rowsToObjects_(sheet_("WrongAnswers")).filter(r=>String(r.Email||"").toLowerCase().trim()===String(email).toLowerCase().trim());
  const attempts=results.length;
  const avg=attempts?Math.round(results.reduce((s,r)=>s+(Number(r.Percentage)||0),0)/attempts*10)/10:0;
  const best=attempts?Math.max(...results.map(r=>Number(r.Percentage)||0)):0;
  const weak=wrongs.filter(w=>!w.Revised).length;
  const bySubject={};
  results.forEach(r=>{ if(!bySubject[r.Subject])bySubject[r.Subject]={subject:r.Subject,sum:0,n:0}; bySubject[r.Subject].sum+=Number(r.Percentage)||0;bySubject[r.Subject].n++; });
  const subjectPerformance=Object.values(bySubject).map(s=>({subject:s.subject,avgPercentage:Math.round(s.sum/s.n*10)/10}));
  const all=rowsToObjects_(sheet_("Results"));
  const bestByUser={};
  all.forEach(r=>{if(r.Subject!==undefined){const em=String(r.Email||"").toLowerCase().trim();const p=Number(r.Percentage)||0;if(!bestByUser[r.Subject])bestByUser[r.Subject]={};if(!bestByUser[r.Subject][em]||p>bestByUser[r.Subject][em])bestByUser[r.Subject][em]=p;}});
  const currentRanks={};
  Object.keys(bestByUser).forEach(sub=>{const arr=Object.values(bestByUser[sub]).sort((a,b)=>b-a);const mine=bestByUser[sub][String(email).toLowerCase().trim()];if(mine!==undefined)currentRanks[sub]={rank:arr.indexOf(mine)+1,total:arr.length};});
  const history=results.slice().sort((a,b)=>new Date(b.Timestamp)-new Date(a.Timestamp)).map(r=>({
    date:Utilities.formatDate(new Date(r.Timestamp),tz_(),"dd-MM-yyyy HH:mm"),subject:r.Subject,score:r.Score,total:r.Total,percentage:r.Percentage,
    rank:r.Rank,rankOutOf:r.RankOutOf,equivalentMarks:expectedMarks_(r.Percentage),expectedRank:expectedRank_(r.Percentage),
    currentRank:currentRanks[r.Subject]?currentRanks[r.Subject].rank:null,currentRankOutOf:currentRanks[r.Subject]?currentRanks[r.Subject].total:null
  }));
  const strongest=subjectPerformance.slice().sort((a,b)=>b.avgPercentage-a.avgPercentage)[0]||null;
  const weakest=subjectPerformance.slice().sort((a,b)=>a.avgPercentage-b.avgPercentage)[0]||null;
  return {attempts,avgPercentage:avg,bestPercentage:best,weakCount:weak,subjectPerformance,history,strongest,weakest,currentRanks};
}

function parseBool_(v){ return v===true || String(v).toLowerCase()==="true"; }
function getMistakes_(email,subjectFilter){
  let wrongs=rowsToObjects_(sheet_("WrongAnswers")).filter(r=>String(r.Email||"").toLowerCase().trim()===String(email).toLowerCase().trim() && !parseBool_(r.Revised));
  if(subjectFilter) wrongs=wrongs.filter(r=>r.Subject===subjectFilter);
  return wrongs.sort((a,b)=>new Date(b.DateAdded)-new Date(a.DateAdded)).map(r=>({
    wrongId:r.WrongId,subject:r.Subject,question:r.Question,options:JSON.parse(r.OptionsJSON||"[]"),correctIndex:Number(r.CorrectIndex),
    selectedIndex:r.SelectedIndex===""?null:Number(r.SelectedIndex),revisionDueDate:r.RevisionDueDate,revised:parseBool_(r.Revised),
    year:r.Year,state:r.State,questionNumber:r.QuestionNumber
  }));
}

function markRevised_(body){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues(), h=values[0];
  const id=h.indexOf("WrongId"), em=h.indexOf("Email"), rv=h.indexOf("Revised"), subj=h.indexOf("Subject"), q=h.indexOf("QuestionId");
  for(let i=1;i<values.length;i++) if(values[i][id]===body.wrongId && String(values[i][em]).toLowerCase()===String(body.email).toLowerCase()){
    sh.getRange(i+1,rv+1).setValue(true);
    appendRow_(sheet_("RevisionHistory"),SHEETS.RevisionHistory,{Email:body.email,Subject:values[i][subj],QuestionId:values[i][q],ActionDate:new Date(),Action:"revised"});
    return {ok:true};
  }
  return {ok:false,error:"Not found"};
}

/* Revision test: due mistakes are tested again. Correct => remove from active
   mistakes. Wrong => keep the same mistake active and move its due date 7 days. */
function submitRevision_(body){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues(), h=values[0];
  const id=h.indexOf("WrongId"), em=h.indexOf("Email"), rv=h.indexOf("Revised"), due=h.indexOf("RevisionDueDate"), sel=h.indexOf("SelectedIndex"), rem=h.indexOf("ReminderSent"), subj=h.indexOf("Subject"), q=h.indexOf("QuestionId");
  const now=new Date(), nextDue=iso_(new Date(now.getTime()+7*86400000));
  let correct=0,wrong=0,unanswered=0;
  (body.items||[]).forEach(item=>{
    for(let i=1;i<values.length;i++){
      if(values[i][id]!==item.wrongId || String(values[i][em]).toLowerCase()!==String(body.email).toLowerCase())continue;
      const chosen=item.selected;
      if(chosen===null || chosen===undefined){ unanswered++; sh.getRange(i+1,sel+1).setValue(""); sh.getRange(i+1,due+1).setValue(nextDue); sh.getRange(i+1,rem+1).setValue(false); }
      else if(Number(chosen)===Number(values[i][h.indexOf("CorrectIndex")])){ correct++; sh.getRange(i+1,rv+1).setValue(true); appendRow_(sheet_("RevisionHistory"),SHEETS.RevisionHistory,{Email:body.email,Subject:values[i][subj],QuestionId:values[i][q],ActionDate:now,Action:"revision-correct"}); }
      else { wrong++; sh.getRange(i+1,sel+1).setValue(chosen); sh.getRange(i+1,due+1).setValue(nextDue); sh.getRange(i+1,rem+1).setValue(false); appendRow_(sheet_("RevisionHistory"),SHEETS.RevisionHistory,{Email:body.email,Subject:values[i][subj],QuestionId:values[i][q],ActionDate:now,Action:"revision-wrong"}); }
      break;
    }
  });
  return {ok:true,correct,wrong,unanswered,nextDue};
}

function sendRevisionReminders(){
  const sh=sheet_("WrongAnswers"), values=sh.getDataRange().getValues(); if(values.length<2)return;
  const h=values[0], c=n=>h.indexOf(n), now=new Date(), due={};
  for(let i=1;i<values.length;i++){
    const d=values[i][c("RevisionDueDate")];
    if(d && new Date(d)<=now && !parseBool_(values[i][c("Revised")]) && !parseBool_(values[i][c("ReminderSent")])){
      const em=values[i][c("Email")]; if(!due[em])due[em]=[]; due[em].push({subject:values[i][c("Subject")],question:values[i][c("Question")],row:i+1});
    }
  }
  const users=rowsToObjects_(sheet_("Users"));
  Object.keys(due).forEach(email=>{
    const u=users.slice().reverse().find(x=>String(x.Email).toLowerCase()===email.toLowerCase());
    let html="<p>Hi "+escapeHtml_(u?u.Name:"")+",</p><p>Your 7-day mistake revision is now due.</p><ul>";
    due[email].slice(0,30).forEach(x=>html+="<li><b>"+escapeHtml_(x.subject)+"</b>: "+escapeHtml_(x.question)+"</li>");
    html+="</ul><p>Open My Mistakes and start the revision test.</p>";
    try{MailApp.sendEmail({to:email,subject:"ECET Quiz — revision test is due",htmlBody:html});due[email].forEach(x=>sh.getRange(x.row,c("ReminderSent")+1).setValue(true));}
    catch(err){console.log("Revision reminder failed: "+err);}
  });
}
function setup(){ensureSheets_();}
