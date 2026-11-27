#!/usr/bin/env node
'use strict';

// Rebuild public static content under data/ from the Apps Script exportAll endpoint.
// Requires Node 18+. EXPORT_KEY must match the Apps Script Script Property.
// APPS_SCRIPT_URL may be supplied as an environment variable; otherwise config.js is read.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const QUESTIONS = path.join(DATA, 'questions');

function appsScriptUrl() {
  if (process.env.APPS_SCRIPT_URL) return process.env.APPS_SCRIPT_URL.trim();
  const configPath = path.join(ROOT, 'config.js');
  if (!fs.existsSync(configPath)) throw new Error('APPS_SCRIPT_URL is missing and config.js was not found.');
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/APPS_SCRIPT_URL\s*:\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('Could not find APPS_SCRIPT_URL in config.js.');
  return match[1].trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function safeId(id) {
  const value = String(id || '');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) throw new Error(`Unsafe subject ID in export: ${value}`);
  return value;
}
function clean(value) { return String(value == null ? '' : value).trim(); }
function key(value) { return clean(value).toLowerCase().replace(/\s+/g, ' '); }
function tally(list, home) {
  const exams = new Map(), topics = new Map();
  for (const q of list) {
    const exam = clean(q.exam) || home || 'ECET';
    const ek = key(exam);
    exams.set(ek, (exams.get(ek) || { name: exam, total: 0 }));
    exams.get(ek).total++;
    const topic = clean(q.topic);
    if (topic) {
      const tk = `${ek}|${key(topic)}`;
      topics.set(tk, (topics.get(tk) || { exam, name: topic, count: 0 }));
      topics.get(tk).count++;
    }
  }
  return { exams: [...exams.values()], topics: [...topics.values()] };
}

async function main() {
  const exportKey = process.env.EXPORT_KEY;
  if (!exportKey) throw new Error('EXPORT_KEY environment variable is required.');
  const endpoint = appsScriptUrl();
  const url = new URL(endpoint);
  url.searchParams.set('action', 'exportAll');
  url.searchParams.set('key', exportKey);

  const response = await fetch(url, { redirect: 'follow', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Apps Script export failed with HTTP ${response.status}.`);
  const exported = await response.json();
  if (!exported || exported.ok !== true) throw new Error(`Apps Script export rejected the request: ${clean(exported && exported.error) || 'invalid response'}`);
  if (!exported.questions || typeof exported.questions !== 'object' || Array.isArray(exported.questions)) {
    throw new Error('Export response is missing the questions object.');
  }

  fs.mkdirSync(QUESTIONS, { recursive: true });
  const expectedQuestionFiles = new Set();
  for (const [rawId, questions] of Object.entries(exported.questions)) {
    const id = safeId(rawId);
    if (!Array.isArray(questions)) throw new Error(`Questions for ${id} are not an array.`);
    const filename = `${id}.json`;
    expectedQuestionFiles.add(filename);
    writeJson(path.join(QUESTIONS, filename), questions);
  }

  // Remove stale exported subject files so deleted/renamed subjects cannot remain public.
  for (const name of fs.readdirSync(QUESTIONS)) {
    if (name.endsWith('.json') && !expectedQuestionFiles.has(name)) fs.unlinkSync(path.join(QUESTIONS, name));
  }

  writeJson(path.join(DATA, 'custom-subjects.json'), Array.isArray(exported.customSubjects) ? exported.customSubjects : []);
  writeJson(path.join(DATA, 'topic-summary.json'), exported.topicSummary && typeof exported.topicSummary === 'object' ? exported.topicSummary : {});

  // Build compact built-in subject metadata from the checked-in subject list and its local banks.
  const builtIns = readJson(path.join(ROOT, 'subjects.json'), []);
  if (!Array.isArray(builtIns)) throw new Error('Root subjects.json must contain an array.');
  const staticSubjects = builtIns.map(subject => {
    const id = safeId(subject.id);
    const questionPath = path.resolve(ROOT, subject.file || `data/questions/static/${id}.json`);
    const questions = readJson(questionPath, []);
    const counts = tally(Array.isArray(questions) ? questions : [], subject.exam || subject.name || 'ECET');
    return {
      id,
      name: subject.name,
      available: !!subject.available,
      file: subject.file || `data/questions/static/${id}.json`,
      total: Array.isArray(questions) ? questions.length : 0,
      exams: counts.exams,
      topics: counts.topics
    };
  });
  writeJson(path.join(DATA, 'subjects.json'), staticSubjects);

  // Hash the actual published payload (excluding the metadata file itself).
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'export-meta.json') files.push(full);
    }
  }
  walk(DATA);
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(DATA, file).replace(/\\/g, '/') + '\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  const nextHash = hash.digest('hex');
  const metaPath = path.join(DATA, 'export-meta.json');
  const previousMeta = readJson(metaPath, {});
  // Timestamp only a real content change. Legacy metadata without generatedAt
  // stays untimestamped on no-change runs rather than claiming a false update.
  const meta = { hash: nextHash, fileCount: files.length };
  if (previousMeta.hash !== nextHash) meta.generatedAt = new Date().toISOString();
  else if (previousMeta.generatedAt) meta.generatedAt = previousMeta.generatedAt;
  writeJson(metaPath, meta);
  console.log(`Sync complete: ${files.length} content files; ${expectedQuestionFiles.size} question banks.`);
}

main().catch(error => {
  console.error(`Sync failed: ${error.message}`);
  process.exitCode = 1;
});
