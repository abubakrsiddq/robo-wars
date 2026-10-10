#!/usr/bin/env node
// Guardrail checker for Robo Olympics (dev-only; the game never depends on this).
//   cd tools && node check.js [--fights N] [--update-baseline]
// Exits non-zero on any error. Warnings are printed but do not fail.
// Checks: file list/order, headers, EXPORTS validity, duplicate top-level names, cross-file boundaries,
// forbidden constructs, new magic numbers in gameplay files, and (with --fights) headless autotests.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const BASELINE = path.join(__dirname, 'numbers-baseline.json');
const CANON = ['config', 'parts', 'ai', 'character', 'arena', 'controls', 'combat', 'fx', 'hud', 'builder', 'main'].map(n => `src/${n}.js`);
const TUNABLE_FILES = ['src/ai.js', 'src/character.js', 'src/controls.js', 'src/combat.js'];
const TRIVIAL = new Set(['0', '1', '2', '0.5', '10', '100', '1000', '60']);
const GLOBAL_OK = new Set(['Matter', 'performance', 'localStorage', 'document', 'window', 'location']);
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';

const args = process.argv.slice(2);
const fightsIdx = args.indexOf('--fights');
const FIGHTS = fightsIdx >= 0 ? parseInt(args[fightsIdx + 1], 10) || 10 : 0;
const UPDATE = args.includes('--update-baseline');

const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);

// ---------- tokenizer: blank out comments / strings / regex literals, keep length + newlines ----------
function strip(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const prevSig = i => { for (let k = i - 1; k >= 0; k--) if (!/\s/.test(out[k])) return k; return -1; };
  function scan(i, inTpl) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (c === '/' && n === '/') { let e = src.indexOf('\n', i); if (e < 0) e = src.length; blank(i, e); i = e; continue; }
      if (c === '/' && n === '*') { let e = src.indexOf('*/', i + 2); e = e < 0 ? src.length : e + 2; blank(i, e); i = e; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        blank(i + 1, j); i = j + 1; continue;
      }
      if (c === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== '`') {
          if (src[j] === '\\') { blank(j, j + 2); j += 2; continue; }
          if (src[j] === '$' && src[j + 1] === '{') { j = scan(j + 2, true) + 1; continue; }
          blank(j, j + 1); j++;
        }
        i = j + 1; continue;
      }
      if (c === '/') {
        const p = prevSig(i), pc = p >= 0 ? out[p] : '';
        let isRe = p < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(pc);
        if (!isRe && /\w/.test(pc)) { const m = /([A-Za-z]+)$/.exec(out.slice(Math.max(0, p - 8), p + 1).join('')); isRe = !!m && /^(return|typeof|case)$/.test(m[1]); }
        if (isRe) {
          let j = i + 1, cls = false;
          while (j < src.length && src[j] !== '\n') {
            if (src[j] === '\\') { j += 2; continue; }
            if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
            j++;
          }
          j++; while (/[a-z]/.test(src[j] || '')) j++;
          blank(i, j); i = j; continue;
        }
      }
      if (inTpl) { if (c === '{') depth++; else if (c === '}') { if (depth === 0) return i; depth--; } }
      i++;
    }
    return i;
  }
  scan(0, false);
  return out.join('');
}

// ---------- declarations ----------
function matchClose(s, i) {   // s[i] is an opener; return index of its matching closer
  const open = s[i], close = { '{': '}', '(': ')', '[': ']' }[open];
  let d = 0;
  for (let k = i; k < s.length; k++) { if (s[k] === open) d++; else if (s[k] === close && --d === 0) return k; }
  return s.length - 1;
}
function patternNames(pat) {   // text inside { } or [ ]
  const names = [];
  let d = 0, cur = '';
  const flush = () => {
    let t = cur.trim(); cur = '';
    if (!t) return;
    t = t.replace(/^\.\.\./, '');
    if (t.includes(':') && !t.startsWith('{') && !t.startsWith('[')) t = t.split(':').pop().trim();
    t = t.split('=')[0].trim();
    const m = /^[A-Za-z_$][\w$]*$/.exec(t); if (m) names.push(t);
  };
  for (const ch of pat) { if ('{[('.includes(ch)) d++; if ('}])'.includes(ch)) d--; if (ch === ',' && d === 0) flush(); else cur += ch; }
  flush();
  return names;
}
function declsAt(s, startKw, afterIdx) {   // names declared by const/let/var starting at afterIdx
  const names = [];
  let j = afterIdx;
  for (;;) {
    while (/\s/.test(s[j] || '')) j++;
    if (s[j] === '{' || s[j] === '[') { const e = matchClose(s, j); names.push(...patternNames(s.slice(j + 1, e))); j = e + 1; }
    else { const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(j, j + 80)); if (!m) break; names.push(m[0]); j += m[0].length; }
    let d = 0;   // skip initializer to depth-0 comma / ; / closer
    for (; j < s.length; j++) {
      const ch = s[j];
      if ('{[('.includes(ch)) d++;
      else if ('}])'.includes(ch)) { if (d === 0) return names; d--; }
      else if (d === 0 && (ch === ';' || ch === ',')) break;
    }
    if (s[j] !== ',') break;
    j++;
  }
  return names;
}
function analyse(src) {
  const s = strip(src);
  const depth = new Int32Array(s.length + 1);
  let d = 0;
  for (let i = 0; i < s.length; i++) { depth[i] = d; if ('{[('.includes(s[i])) d++; else if ('}])'.includes(s[i])) d--; }
  const top = new Set(), local = new Set();
  for (const m of s.matchAll(/\b(const|let|var|function|class)\b/g)) {
    if (s[m.index - 1] === '.') continue;
    const after = m.index + m[0].length;
    let names;
    if (m[1] === 'function' || m[1] === 'class') {
      const mm = /^\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(s.slice(after, after + 80));
      names = mm ? [mm[1]] : [];
      if (m[1] === 'function') {   // params are local
        const pm = /^\s*\*?\s*[\w$]*\s*\(([^()]*)\)/.exec(s.slice(after, after + 400));
        if (pm) patternNames(pm[1]).forEach(n => local.add(n));
      }
    } else names = declsAt(s, m.index, after);
    names.forEach(n => local.add(n));
    if (depth[m.index] === 0) names.forEach(n => top.add(n));
  }
  for (const m of s.matchAll(/\(([^()]*)\)\s*=>/g)) patternNames(m[1]).forEach(n => local.add(n));
  for (const m of s.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1]);
  for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) {   // method shorthand, catch(e)
    if (/^(if|for|while|switch|function|return)$/.test(m[1])) continue;
    patternNames(m[2]).forEach(n => local.add(n));
  }
  const used = new Set();
  for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) {
    let p = m.index - 1; while (p >= 0 && /\s/.test(s[p])) p--;
    if (s[p] === '.' && s[p - 1] !== '.') continue;                 // property access (but allow ...spread)
    if (s[p] === '.' && s[p - 1] === '.' && s[p - 2] === '.') { /* spread of identifier: usage */ }
    else if (s[p] === '.') continue;
    let q = m.index + m[0].length; while (q < s.length && /[ \t]/.test(s[q])) q++;
    if (s[q] === ':' && (s[p] === '{' || s[p] === ',') ) continue;   // object key
    used.add(m[0]);
  }
  return { stripped: s, top, local, used };
}

// ---------- load files ----------
const html = fs.existsSync(HTML) ? fs.readFileSync(HTML, 'utf8') : (err('index.html missing'), '');
const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const referenced = [];
for (const t of tags) {
  const sm = /\bsrc\s*=\s*["']([^"']+)["']/.exec(t[1]);
  if (sm) { if (!/^https?:/.test(sm[1])) referenced.push(sm[1]); }
  else if (t[2].trim()) warn('index.html still has an inline <script>; move it into src/ (it is not covered by the checks)');
}

// 1. file list / order
const onDisk = fs.existsSync(path.join(ROOT, 'src')) ? fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f) : [];
onDisk.forEach(f => { if (!referenced.includes(f)) err(`${f} exists but is not referenced by index.html`); });
referenced.forEach(f => { if (!fs.existsSync(path.join(ROOT, f))) err(`index.html references missing file ${f}`); });
CANON.forEach(f => { if (!referenced.includes(f)) err(`canonical file ${f} is not loaded by index.html`); });
referenced.forEach(f => { if (!CANON.includes(f)) err(`${f} is loaded but not in the canonical list in tools/check.js (add it there on purpose)`); });
const refCanon = referenced.filter(f => CANON.includes(f));
if (refCanon.join() !== CANON.filter(f => referenced.includes(f)).join()) err(`script order is wrong.\n    expected: ${CANON.join(' -> ')}\n    actual:   ${referenced.join(' -> ')}`);

const files = {};
for (const f of CANON) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, 'utf8');
  files[f] = { raw, ...analyse(raw) };
}

// 2. headers / exports / duplicates
const defined = {};   // name -> file
for (const [f, F] of Object.entries(files)) {
  if (!/^'use strict';/.test(F.raw)) err(`${f}: must start with 'use strict';`);
  const head = F.raw.split('\n').slice(0, 12).join('\n');
  const grab = k => { const m = new RegExp(`^// ${k}:[ \\t]*(.*)$`, 'm').exec(head); return m ? m[1] : null; };
  const owns = grab('OWNS'), exp = grab('EXPORTS'), reads = grab('READS');
  if (owns === null || exp === null || reads === null) { err(`${f}: header must contain OWNS:, EXPORTS: and READS: lines`); F.exports = new Set(); F.reads = new Set(); }
  else {
    F.exports = new Set(exp.split(/[,\s]+/).filter(Boolean));
    F.reads = new Set((reads.match(/[A-Za-z_$][\w$]*/g) || []));
  }
  for (const n of F.exports) if (!F.top.has(n)) err(`${f}: EXPORTS lists '${n}' but it is not defined at top level in this file`);
  for (const n of F.top) {
    if (defined[n]) err(`top-level name '${n}' defined in both ${defined[n]} and ${f}`); else defined[n] = f;
  }
}

// 3. boundaries
for (const [f, F] of Object.entries(files)) {
  const missingExport = new Map(), missingReads = [];
  for (const n of F.used) {
    const owner = defined[n];
    if (!owner || owner === f || F.top.has(n)) continue;
    if (F.local.has(n)) continue;   // shadowed by a local declaration/param: not a cross-file use
    if (!files[owner].exports.has(n)) missingExport.set(n, owner);
    else if (!F.reads.has(n)) missingReads.push(n);
  }
  for (const [n, owner] of missingExport) err(`${f} uses '${n}' defined in ${owner}, but ${owner} does not list it in EXPORTS`);
  if (missingReads.length) warn(`${f}: add to READS header: ${missingReads.sort().join(', ')}`);
  for (const n of F.reads) if (!defined[n] && !GLOBAL_OK.has(n)) warn(`${f}: READS lists '${n}' which no file defines`);
  for (const n of F.reads) if (defined[n] === f) warn(`${f}: READS lists its own name '${n}'`);
}

// 4. forbidden constructs
const rawAll = { 'index.html': html };
for (const [f, F] of Object.entries(files)) rawAll[f] = F.raw;
for (const [f, raw] of Object.entries(rawAll)) {
  if (/tools[\/\\]/.test(raw)) err(`${f}: references tools/ (the game must never depend on it)`);
  for (const m of raw.matchAll(/matter(?:-js)?[\/@ v-]*(\d+\.\d+\.\d+)/gi)) if (m[1] !== '0.19.0') err(`${f}: Matter version ${m[1]} (must be 0.19.0)`);
}
if (!html.includes(CDN)) err('index.html: exact Matter CDN URL missing: ' + CDN);
for (const [f, F] of Object.entries(files)) {
  const s = F.stripped, lineOf = i => s.slice(0, i).split('\n').length;
  const rules = [
    [/^\s*(import|export)\b/m, 'ES module import/export statement (not allowed; classic scripts only)'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\bfetch\s*\(/, 'fetch( (game must not fetch anything)'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'],
    [/\bMath\.random\s*=[^=]/, 'Math.random override'],
    [/\bsetInterval\s*\(/, 'setInterval (physics must use the fixed step in frame()/step())'],
    [/\brequire\s*\(/, 'require( (browser code)'],
  ];
  for (const [re, msg] of rules) { const m = re.exec(s); if (m) err(`${f}:${lineOf(m.index)}: ${msg}`); }
}

// 5. tunables
const current = {};
for (const f of TUNABLE_FILES) {
  const F = files[f]; if (!F) continue;
  const rawLines = F.raw.split('\n'), sLines = F.stripped.split('\n'), counts = {};
  sLines.forEach((ln, i) => {
    if (/\/\/\s*cfg-ok/.test(rawLines[i])) return;
    for (const m of ln.matchAll(/(?<![\w$.])(\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?![\w$])/gi)) {
      const v = String(Number(m[0]));
      if (TRIVIAL.has(v)) continue;
      (counts[v] = counts[v] || []).push(i + 1);
    }
  });
  current[f] = counts;
}
if (UPDATE) {
  const out = {};
  for (const [f, c] of Object.entries(current)) out[f] = { count: Object.values(c).reduce((a, l) => a + l.length, 0), values: Object.fromEntries(Object.entries(c).map(([v, l]) => [v, l.length])) };
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote ' + BASELINE);
} else if (!fs.existsSync(BASELINE)) err('tools/numbers-baseline.json missing (run: node check.js --update-baseline)');
else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  for (const [f, c] of Object.entries(current)) {
    const b = (base[f] && base[f].values) || {};
    for (const [v, lines] of Object.entries(c)) {
      const extra = lines.length - (b[v] || 0);
      if (extra > 0) err(`${f}: new numeric literal ${v} (x${extra}, line ${lines.slice(-extra).join(', ')}). Move it to CONFIG, or add '// cfg-ok' to the line if it is not a tunable`);
    }
  }
}

// ---------- report ----------
console.log(`check.js: ${Object.keys(files).length} files, ${Object.values(files).reduce((a, F) => a + F.top.size, 0)} top-level names`);
warnings.forEach(w => console.log('WARN  ' + w));
errors.forEach(e => console.log('ERROR ' + e));

// 6. headless fights
if (FIGHTS && !errors.length) {
  for (const mode of ['', 'ai']) {
    const a = ['autotest.js', '../index.html', String(FIGHTS)]; if (mode) a.push(mode);
    console.log(`running: node ${a.join(' ')}`);
    const r = cp.spawnSync(process.execPath, a, { cwd: __dirname, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) err(`autotest ${mode || 'normal'} exited with status ${r.status}`);
    if (/\bERROR\b|UNCAUGHT/.test(out)) err(`autotest ${mode || 'normal'}: ERROR/UNCAUGHT in output:\n` + out.split('\n').filter(l => /ERROR|UNCAUGHT/.test(l)).slice(0, 5).join('\n'));
    if (!/warnings: \[\]/.test(out)) err(`autotest ${mode || 'normal'}: warnings not empty:\n` + (out.split('\n').find(l => l.startsWith('warnings:')) || out.slice(-500)));
    const methods = {};
    for (const m of out.matchAll(/ by (KO|Pit|Flip|Time)\b/g)) methods[m[1]] = (methods[m[1]] || 0) + 1;
    console.log(`  ${mode || 'normal'}: win methods`, methods);
    if (errors.length) console.log(out.slice(-800));
  }
  errors.slice(-4).forEach(e => console.log('ERROR ' + e));
}
console.log(errors.length ? `FAILED: ${errors.length} error(s), ${warnings.length} warning(s)` : `OK (${warnings.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
