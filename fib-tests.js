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
