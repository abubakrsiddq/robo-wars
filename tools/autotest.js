// Headless balance/smoke test: real Matter.js 0.19.0 + stubbed DOM, runs index.html's script in #auto mode.
// Usage: cd tools && npm i && node autotest.js ../index.html 40
const fs = require('fs');
global.Matter = require('matter-js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
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
global.location = { hash: '#auto' + (process.argv[3] || 40) };
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
  if (document.title === 'AUTODONE' || Date.now() - start > 240000) {
    clearInterval(timer);
    console.log(el('autolog').textContent);
    console.log('warnings:', warnings);
    console.log('elapsed', (Date.now() - start) / 1000, 's');
    process.exit(0);
  }
}, 200);
process.on('uncaughtException', e => { console.log('UNCAUGHT', e.stack); process.exit(1); });
