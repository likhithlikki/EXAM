#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const subjects = JSON.parse(fs.readFileSync(path.join(root, 'subjects.json'), 'utf8'));
const rows = [];
for (const subject of subjects) {
  const file = path.join(root, subject.file || '');
  const row = { id: subject.id, name: subject.name, status: '', count: 0, expected: Number(subject.questionCount || 0), issues: [], figureIds: [] };
  if (!fs.existsSync(file)) { row.status = 'MISSING'; row.issues.push('file missing'); rows.push(row); continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { row.status = 'INVALID'; row.issues.push('invalid JSON: ' + e.message); rows.push(row); continue; }
  if (!Array.isArray(data)) { row.status = 'INVALID'; row.issues.push('not an array'); rows.push(row); continue; }
  row.count = data.length;
  if (!data.length) { row.status = 'EMPTY'; if (row.expected !== 0) row.issues.push(`questionCount says ${row.expected}, file is empty`); rows.push(row); continue; }
  const seen = new Set();
  data.forEach((q, i) => {
    const label = `row ${i + 1}`;
    if (!q || typeof q !== 'object' || Array.isArray(q)) { row.issues.push(`${label}: not an object`); return; }
    if (q.id === undefined || q.id === null || String(q.id).trim() === '') row.issues.push(`${label}: missing id`);
    else if (seen.has(String(q.id))) row.issues.push(`${label}: duplicate id ${q.id}`);
    else seen.add(String(q.id));
    if (typeof q.question !== 'string' || !q.question.trim()) row.issues.push(`${label}: missing question`);
    if (!Array.isArray(q.options) || q.options.length !== 4) row.issues.push(`${label}: options must contain exactly 4 entries`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) row.issues.push(`${label}: answer must be integer 0-3`);
    if (/shown|figure|diagram|circuit\s+shown|shown\s+circuit/i.test(String(q.question || '')) && !q.image) row.figureIds.push(q.id == null ? `row-${i + 1}` : q.id);
  });
  if (row.count !== row.expected) row.issues.push(`questionCount mismatch: expected ${row.expected}, found ${row.count}`);
  row.status = row.issues.length ? 'FAIL' : 'OK';
  rows.push(row);
}
const pad = (v, n) => String(v).padEnd(n);
console.log(`${pad('SUBJECT', 42)} ${pad('STATUS', 8)} ${pad('COUNT', 7)} ${pad('EXPECTED', 9)} ISSUES`);
console.log('-'.repeat(115));
for (const r of rows) console.log(`${pad((r.id || '').slice(0, 41), 42)} ${pad(r.status, 8)} ${pad(r.count, 7)} ${pad(r.expected, 9)} ${r.issues.join('; ')}`);
for (const r of rows.filter(x => x.figureIds.length)) console.log(`FIGURE WITHOUT IMAGE — ${r.id}: ${r.figureIds.join(', ')}`);
const failed = rows.some(r => ['MISSING', 'INVALID', 'FAIL'].includes(r.status));
if (failed) process.exitCode = 1;
