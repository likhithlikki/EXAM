// Copies ONLY the website's runtime files into ./www so Capacitor packages a lean APK
// (no android-native/, Code.gs, docs, node_modules or old backups).
// Run:  node build-www.js
const fs = require('fs');
const path = require('path');

const OUT = 'www';
const EXCLUDE_ROOT_JSON = new Set(['package.json', 'package-lock.json', 'capacitor.config.json', 'appsscript.json']);
const FILES = [
  'index.html', 'about.html', '404.html', 'fib-admin.html', 'privacy.html', 'terms.html', 'cookies.html', 'refund.html',
  'app.js', 'config.js', 'sw.js', 'practice-rules.js', 'fib-admin-api.js',
  'style.css', 'legal.css', 'fib-admin.css', 'theme.css', 'theme.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'
];
const DIRS = ['data'];

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d); else { copy(s, d); n++; }
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
let count = 0;
for (const f of FILES) if (fs.existsSync(f)) { copy(f, path.join(OUT, f)); count++; } else console.log('skip (not found):', f);
for (const f of fs.readdirSync('.')) {           // the subject question banks (*.json in the root)
  if (f.endsWith('.json') && !EXCLUDE_ROOT_JSON.has(f) && !fs.existsSync(path.join(OUT, f))) { copy(f, path.join(OUT, f)); count++; }
}
for (const d of DIRS) count += copyDir(d, path.join(OUT, d));
console.log('www/ ready:', count, 'files');
