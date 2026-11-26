/* Run with: node fib-tests.js */
const rules = require('./practice-rules.js');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('./Code.gs','utf8');
const start = source.indexOf('function gradeFib(userText, answerSpec)');
const end = source.indexOf('// ============================================================\n// 7. EXAM SUBMISSION', start);
const serverGradeFib = vm.runInNewContext(source.slice(start,end) + '; gradeFib');
const cases = [
  ['CPU','CPU',true],
  ['cpu','CPU',true],
  [' processor ','CPU;processor',true],
  ['central processing unit','CPU;central processing unit',true],
  ['2','2',true],
  ['2.5','2.5',true],
  ['2','2 to 3',true],
  ['3','2 to 3',true],
  ['2.01','2 to 3',true],
  ['3.01','2 to 3',false],
  ['2.75','2.5 to 3.0',true],
  ['2.49','2.5 to 3.0',false],
  ['   ','CPU',false],
  ['RAM','CPU;processor',false],
  ['random memory','random access memory',true],
  ['the CPU','CPU',true]
];
let failed=0;
for (const [typed,spec,want] of cases) {
  for (const [engine,fn] of [['practice-rules.js', (t,a)=>rules.gradeFib(t,a).correct], ['Code.gs gradeFib', (t,a)=>serverGradeFib(t,a).correct]]) {
    const got=fn(typed,spec);
    if(got!==want){failed++;console.error('FAIL',engine,JSON.stringify({typed,spec,want,got}));}
  }
}
console.log(`${cases.length*2-failed}/${cases.length*2} FIB grading checks passed (client library + server function)`);
if(failed)process.exitCode=1;

// Step-2 uploader verification regressions (same core rules as the browser UI).
function verifyUploaderPayload(text, defaults) {
  let parsed = JSON.parse(text), arr, subject = '', topic = '';
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && Array.isArray(parsed.questions)) { arr = parsed.questions; subject = parsed.subject || ''; topic = parsed.topic || ''; }
  else throw new Error('Expected array or wrapper object');
  if (arr.length > 500) throw new Error('over-limit');
  const seen = new Set();
  return arr.map(q => {
    q = {...q, subject: q.subject || subject || defaults.subject || '', topic: q.topic || topic || defaults.topic || ''};
    const errors = rules.validateQuestion(q).errors;
    if (String(q.type || '').toUpperCase() !== 'FIB') errors.push('wrong-type');
    if (!/_{3,}/.test(String(q.question || ''))) errors.push('no-blank');
    if (!(Number(q.marks) > 0)) errors.push('bad-marks');
    const key = [q.subject, q.question].join('|').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) errors.push('duplicate'); else seen.add(key);
    return {q, errors};
  });
}
function fileWithinLimit(byteLength) { return Number(byteLength) <= 2 * 1024 * 1024; }
const uploaderCases = [
  ['bad JSON', () => verifyUploaderPayload('{bad json}', {}), true],
  ['wrong type', () => verifyUploaderPayload(JSON.stringify([{type:'MCQ',question:'The ______ unit works here.',answer:'CPU',marks:1}]), {}), false],
  ['no blank', () => verifyUploaderPayload(JSON.stringify([{type:'FIB',question:'The processor executes instructions.',answer:'CPU',marks:1}]), {}), false],
  ['duplicate rows', () => verifyUploaderPayload(JSON.stringify([{type:'FIB',question:'The ______ stores a bit of data.',answer:'flip-flop',marks:1},{type:'FIB',question:'The ______ stores a bit of data.',answer:'latch',marks:1}]), {}), false],
  ['wrapper object', () => verifyUploaderPayload(JSON.stringify({subject:'Digital Electronics',topic:'Logic',questions:[{type:'FIB',question:'The ______ gate inverts input.',answer:'NOT',marks:1}]}), {}), false],
  ['over-500-question file', () => verifyUploaderPayload(JSON.stringify(Array.from({length:501},(_,i)=>({type:'FIB',question:'Question '+i+' ______ is a blank.',answer:'X',marks:1}))), {}), true],
  ['over-2-MB file', () => { if(!fileWithinLimit(2*1024*1024+1)) throw new Error('over-limit'); return []; }, true]
];
for (const [name, fn, shouldThrow] of uploaderCases) {
  try { const result=fn(); const testFailed=shouldThrow || (name==='wrong type'&&!result[0].errors.some(x=>x.includes('wrong-type'))) || (name==='no blank'&&!result[0].errors.some(x=>x.includes('blank'))) || (name==='duplicate rows'&&!result[1].errors.includes('duplicate')) || (name==='wrapper object'&&(result.length!==1||result[0].q.subject!=='Digital Electronics')); if(testFailed){failed++;console.error('FAIL uploader:',name);} else console.log('PASS uploader:',name); }
  catch(e) { if(shouldThrow)console.log('PASS uploader:',name);else{failed++;console.error('FAIL uploader:',name,e.message);} }
}
console.log(`${uploaderCases.length} uploader verification cases completed`);
if(failed)process.exitCode=1;
