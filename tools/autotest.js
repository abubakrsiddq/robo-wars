// Headless balance/smoke test: real Matter.js 0.19.0 + stubbed DOM, runs index.html's script in #auto mode.
// Usage: cd tools && npm i && node autotest.js ../index.html 40
//        node autotest.js ../index.html 60 ai       (AI vs AI, CONFIG.ai builds, prints a win-rate matrix)
//        node autotest.js ../index.html 60 aisame   (AI vs AI, both on the same random build: brains only)
const MODE = process.argv[4] || '';
const N = +(process.argv[3] || 40);
const fs = require('fs');
global.Matter = require('matter-js');
const html = fs.readFileSync(process.argv[2], 'utf8');
// Concatenate src/*.js (in <script src> order, CDN ignored) + any remaining inline script, then eval as one program.
const path = require('path');
const base = path.dirname(path.resolve(process.argv[2]));
const parts = [];
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  const src = /\bsrc\s*=\s*["']([^"']+)["']/.exec(m[1]);
  if (src) { if (!/^https?:/.test(src[1])) parts.push(fs.readFileSync(path.join(base, src[1]), 'utf8')); }
  else if (m[2].trim()) parts.push(m[2]);
}
const script = parts.join('\n');
const noop = () => {};
const ctxStub = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k.startsWith('create') ? () => ({ addColorStop: noop }) : noop), set: (t, k, v) => (t[k] = v, true) });
const els = {};
function el(id) {
  if (!els[id]) els[id] = { id, style: {}, textContent: '', innerHTML: '', value: '', dataset: {}, disabled: false,
    classList: { toggle: noop, contains: () => false, add: noop },
    getContext: () => ctxStub, addEventListener: noop, click() { (this._click || noop)(); },
    querySelector: sel => el(id + ' ' + sel), querySelectorAll: () => [] };
  return els[id];
}
global.document = { getElementById: el, querySelector: sel => el(sel), body: el('body'), title: '' };
global.location = { hash: '#auto' + N + MODE };
global.window = { addEventListener: (t, f) => { if (t === 'error') global.__onerr = f; } };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = noop; global.cancelAnimationFrame = noop;
// capture click handlers for randomMatchBtn
const origEl = el;
let warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));
// patch addEventListener to remember click handler
const proto = el('randomMatchBtn');
proto.addEventListener = (t, f) => { if (t === 'click') proto._click = f; };
el('fightBtn').addEventListener = (t, f) => {};
const start = Date.now();
try { eval(script); } catch (e) { console.log('BOOT ERROR', e.stack); process.exit(1); }
const timer = setInterval(() => {
  if (document.title === 'AUTODONE' || Date.now() - start > Math.max(240000, N * 8000)) {
    clearInterval(timer);
    const log = el('autolog').textContent;
    console.log(log);
    if (MODE.startsWith('ai')) aiSummary(log);
    console.log('warnings:', warnings);
    console.log('elapsed', (Date.now() - start) / 1000, 's');
    process.exit(0);
  }
}, 200);
process.on('uncaughtException', e => { console.log('UNCAUGHT', e.stack); process.exit(1); });

function aiSummary(log) {
  const W = {}, methods = {};
  for (const m of log.matchAll(/^AI (\w+) vs (\w+) -> (\w+) by (\w+)/gm)) {
    const [, a, b, w, how] = m;
    methods[how] = (methods[how] || 0) + 1;
    for (const [x, y] of [[a, b], [b, a]]) {
      const k = x + '>' + y; W[k] = W[k] || { win: 0, n: 0 };
      W[k].n++; if (w === x) W[k].win++;
    }
  }
  const models = ['haiku', 'sonnet', 'opus'];
  console.log('win-rate matrix (row beats column, wins/games):');
  console.log('        ' + models.map(m => m.padEnd(10)).join(''));
  for (const a of models) console.log(a.padEnd(8) + models.map(b => {
    const c = W[a + '>' + b]; return (a === b || !c ? '-' : `${c.win}/${c.n} ${Math.round(c.win / c.n * 100)}%`).padEnd(10);
  }).join(''));
  console.log('methods:', methods);
}
