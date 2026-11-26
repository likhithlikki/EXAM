/* FIB-only admin adapter. Uploads directly into the main Questions sheet. */
(function(){'use strict';
  function url(){return (window.APP_CONFIG&&window.APP_CONFIG.APPS_SCRIPT_URL)||'';}
  function adminPw(){try{return sessionStorage.getItem('ecet_admin_pw')||'';}catch(e){return '';}}
  function setAdminPw(v){try{sessionStorage.setItem('ecet_admin_pw',v);}catch(e){}}
  function adminEmail(){try{const p=JSON.parse(localStorage.getItem('ecet_profile')||'null');return p&&p.email||'';}catch(e){return '';}}
  async function get(action,params){const u=new URL(url());u.searchParams.set('action',action);Object.keys(params||{}).forEach(k=>u.searchParams.set(k,params[k]));const r=await fetch(u.toString(),{cache:'no-store'});if(!r.ok)throw new Error('Server returned '+r.status);return r.json();}
  async function post(payload){if(!url())throw new Error('Backend URL is missing in config.js (APPS_SCRIPT_URL).');const r=await fetch(url(),{method:'POST',body:JSON.stringify(Object.assign({action:'importQuestions',adminEmail:adminEmail(),adminPassword:adminPw()},payload||{})),cache:'no-store'});if(!r.ok)throw new Error('Server returned '+r.status);return r.json();}
  async function adminCheck(){const r=await get('isAdmin',{email:adminEmail(),password:adminPw()});return {ok:!!(r&&r.ok&&r.isAdmin)};}
  async function addQuestions(payload){const qs=(payload&&payload.questions)||[];if(!qs.length||qs.some(q=>String(q.type||'').toUpperCase()!=='FIB'))return {ok:false,error:'Only FIB questions can be uploaded here.'};const subject=String(qs[0].subject||'').trim();if(!subject||qs.some(q=>String(q.subject||'').trim().toLowerCase()!==subject.toLowerCase()))return {ok:false,error:'Upload one subject per batch and provide its subject name.'};const questions=qs.map(q=>({type:'FIB',question:q.question,answer:q.answer,marks:Number(q.marks)||1,year:'FIB',state:'',questionNumber:'',topic:q.topic||''}));const r=await post({subject:subject,questions:questions});if(!r||!r.ok)return r||{ok:false,error:'Server did not answer.'};return {ok:true,added:r.imported||0,duplicates:r.alreadyImported||0,rejected:r.errors||[]};}
  async function list(){const subs=await get('customSubjects',{});if(!subs||!subs.ok)return [];const out=[];for(const s of (subs.data||[])){if(!s.questionCount)continue;const r=await get('questions',{subjectId:s.id});if(r&&r.ok)(r.data||[]).filter(q=>q.type==='FIB').forEach(q=>out.push({id:q.id,type:q.type,subject:s.name,topic:q.topic,question:q.question,answer:q.answerText}));}return out;}
  async function deleteQuestions(){return {ok:false,error:'Delete questions from the main admin Control Centre.'};}
  window.FibAdminAPI={list,adminCheck,addQuestions,deleteQuestions,adminPw,setAdminPw};
})();
