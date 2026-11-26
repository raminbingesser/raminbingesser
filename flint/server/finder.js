// Projekt-Finder: findet Projektordner auf dem Mac per Beschreibung.
// Quellen: Ordner, in denen du schon mit Claude Code gearbeitet hast (Terminal
// oder Desktop App, aus ~/.claude/projects), Flints eigene Projekte und die
// üblichen Projektordner. Gesucht wird lokal; optional entscheidet Claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from './store.js';

const HOME = os.homedir();
// Diese Ordner im Home zuerst durchsuchen, danach alle übrigen.
const PREFERRED = ['Flint', 'Projects', 'Projekte', 'projects', 'Developer', 'Code', 'code', 'dev', 'Dev', 'GitHub', 'github',
  'repos', 'Repos', 'workspace', 'Claude', 'Sites', 'Apps', 'apps', 'Desktop', 'Documents', 'Dokumente', 'Schreibtisch'];
const SKIP = new Set(['node_modules', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public', 'Photos Library.photoslibrary',
  'dist', 'build', 'vendor', 'Pods', 'DerivedData', '__pycache__', 'venv', '.venv', 'target', 'bin']);
// Cloud-Ordner nicht durchsuchen (würde Downloads auslösen).
const SKIP_PREFIX = ['Creative Cloud Files', 'OneDrive', 'Google Drive', 'iCloud'];
const skipName = (e) => e.startsWith('.') || SKIP.has(e) || SKIP_PREFIX.some(p => e.startsWith(p));
function homeRoots() {
  let all = [];
  try { all = fs.readdirSync(HOME).filter(e => !skipName(e) && safeStat(path.join(HOME, e))?.isDirectory()); } catch { }
  const first = PREFERRED.filter(e => all.includes(e));
  const rest = all.filter(e => !first.includes(e)).sort((a, b) => (a === 'Downloads') - (b === 'Downloads') || a.localeCompare(b));
  return [...first, ...rest].map(e => path.join(HOME, e));
}
const MARKERS = ['.git', 'package.json', 'index.html', 'CLAUDE.md', 'pyproject.toml', 'requirements.txt', 'Package.swift', 'brain', 'Cargo.toml', 'go.mod'];

const norm = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[_\-./]+/g, ' ');

function safeStat(p) { try { return fs.statSync(p); } catch { return null; } }
function readHead(f, n = 4000) {
  try {
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(n);
    const len = fs.readSync(fd, buf, 0, n, 0);
    fs.closeSync(fd);
    return buf.slice(0, len).toString('utf8');
  } catch { return ''; }
}

function isProject(dir, entries) {
  if (entries.some(e => MARKERS.includes(e))) return true;
  return entries.some(e => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'));
}

// Kurze Beschreibung aus package.json, README, CLAUDE.md oder brain/BRAIN.md.
function describe(dir) {
  const pkg = readHead(path.join(dir, 'package.json'));
  if (pkg) { try { const j = JSON.parse(pkg); if (j.description) return j.description; } catch { } }
  for (const f of ['brain/BRAIN.md', 'README.md', 'readme.md', 'CLAUDE.md']) {
    const t = readHead(path.join(dir, f), 3000);
    if (!t) continue;
    // Mission im Brain bevorzugen, sonst erste echte Textzeile
    const mission = t.match(/##\s*Mission\s*\n+([^\n#][^\n]*)/);
    if (mission && !/Wofür ist dieses Projekt da/.test(mission[1])) return mission[1].trim().slice(0, 200);
    const line = t.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('<') && !l.startsWith('@') && !l.startsWith('!') && !l.startsWith('[') && l.length > 12);
    if (line) return line.slice(0, 200);
  }
  return '';
}

function kinds(entries) {
  const k = [];
  if (entries.some(e => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace') || e === 'Package.swift')) k.push('iOS/Swift');
  if (entries.includes('package.json')) k.push('Node');
  if (entries.includes('index.html')) k.push('Web');
  if (entries.includes('pyproject.toml') || entries.includes('requirements.txt')) k.push('Python');
  if (entries.includes('brain')) k.push('Flint');
  return k;
}

// Git-Arbeitskopien (Worktrees, z. B. von der Claude Desktop App unter ~/.claude…)
// auf das eigentliche Projekt zurückführen. Liegt die Arbeitskopie in einem
// Unterordner, wird derselbe Unterordner im Original genommen.
export function mainRepo(p) {
  try {
    let dir = p, rel = '';
    // nach oben bis zum Ordner mit .git
    while (!fs.existsSync(path.join(dir, '.git')) && path.dirname(dir) !== dir) { rel = path.join(path.basename(dir), rel); dir = path.dirname(dir); }
    const g = path.join(dir, '.git');
    if (!safeStat(g)?.isFile()) return p;
    const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)\s*$/m);
    if (!m) return p;
    const gitdir = path.resolve(dir, m[1]);
    const parts = gitdir.split(path.sep);
    const i = parts.lastIndexOf('worktrees');
    if (i < 1 || parts[i - 1] !== '.git') return p;
    const main = path.join(parts.slice(0, i - 1).join(path.sep) || path.sep, rel);
    return safeStat(main)?.isDirectory() ? main : p;
  } catch { return p; }
}

// Ordner, in denen Claude Code schon lief (inkl. Desktop App), mit letzter Nutzung.
function claudeCodeFolders() {
  const out = new Map();
  const base = path.join(HOME, '.claude', 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return out; }
  for (const d of dirs) {
    const full = path.join(base, d);
    let files = [];
    try { files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl')).map(f => ({ f, m: safeStat(path.join(full, f))?.mtimeMs || 0 })).sort((a, b) => b.m - a.m); } catch { continue; }
    if (!files.length) continue;
    const head = readHead(path.join(full, files[0].f), 200000);
    const m = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (!m) continue;
    let cwd;
    try { cwd = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    if (!cwd || cwd === HOME || cwd.startsWith(store.HOME) || !safeStat(cwd)?.isDirectory()) continue;
    const prev = out.get(cwd) || 0;
    out.set(cwd, Math.max(prev, files[0].m));
  }
  return out;
}

let cache = null;
export function scan(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.list;
  const found = new Map(); // path -> { usedAt }
  const add = (p, usedAt = 0, source = 'ordner') => {
    p = mainRepo(p);
    const cur = found.get(p);
    if (cur) { cur.usedAt = Math.max(cur.usedAt, usedAt); if (source !== 'ordner') cur.source = source; }
    else found.set(p, { usedAt, source });
  };
  for (const [p, t] of claudeCodeFolders()) add(p, t, 'claude');
  for (const p of store.listProjects()) if (!p.variantOf) add(p.path, p.createdAt || 0, 'flint');

  const deadline = Date.now() + 2500;
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 4 || visited > 8000 || Date.now() > deadline) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    visited++;
    if (depth > 0 && isProject(dir, entries)) { add(dir); return; }
    for (const e of entries) {
      if (skipName(e)) continue;
      const p = path.join(dir, e);
      const st = safeStat(p);
      if (st?.isDirectory()) walk(p, depth + 1);
    }
  };
  // Ordner direkt im Home können selbst Projekte sein (z. B. ~/myfinance).
  for (const r of homeRoots()) walk(r, 0.5);

  const list = [];
  for (const [p, info] of found) {
    const st = safeStat(p);
    if (!st?.isDirectory()) continue;
    let entries = [];
    try { entries = fs.readdirSync(p); } catch { }
    // jüngste Änderung: Ordner selbst oder wichtige Dateien
    let mtime = st.mtimeMs;
    for (const e of entries.slice(0, 60)) { const s = safeStat(path.join(p, e)); if (s && s.mtimeMs > mtime) mtime = s.mtimeMs; }
    list.push({
      path: p,
      name: path.basename(p),
      short: p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p,
      description: describe(p),
      kinds: kinds(entries),
      lastUsed: Math.max(info.usedAt, mtime),
      source: info.source,
      open: store.listProjects().find(x => x.path === p)?.id || null,
    });
  }
  list.sort((a, b) => b.lastUsed - a.lastUsed);
  cache = { at: Date.now(), list };
  return list;
}

// Lokale Suche: Wörter der Anfrage in Name, Pfad und Beschreibung, plus Aktualität.
export function search(query, limit = 12) {
  const list = scan();
  const STOP = new Set(['das', 'die', 'der', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'mein', 'meine', 'meinen', 'projekt', 'von', 'mit',
    'fuer', 'auf', 'und', 'oder', 'ich', 'wo', 'wie', 'was', 'ist', 'hab', 'habe', 'the', 'my', 'for', 'and', 'im', 'in', 'zu', 'zum', 'zur', 'an', 'am']);
  const words = norm(query).split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
  if (!words.length) return list.slice(0, limit).map(p => ({ ...p, score: 0 }));
  const now = Date.now();
  // Kurze Wörter nur als ganzes Wort, längere auch als Wortanfang/Teil (dashboards → dashboard)
  const has = (text, w) => {
    if (w.length < 4) return new RegExp(`(^|\\s)${w}(\\s|$)`).test(text);
    const stem = w.length > 5 ? w.slice(0, w.length - 2) : w;
    return text.includes(stem);
  };
  const scored = list.map(p => {
    const name = norm(p.name), where = norm(p.short), desc = norm(p.description);
    const nameParts = name.split(/\s+/).filter(t => t.length >= 4);
    let score = 0, hits = 0;
    for (const w of words) {
      let hit = false;
      // auch: Namensteil steckt im Suchwort (yogastudio → yoga)
      if (has(name, w) || nameParts.some(t => w.includes(t))) { score += 5; hit = true; }
      else if (has(where, w)) { score += 2; hit = true; }
      if (has(desc, w)) { score += 1.5; hit = true; }
      if (hit) hits++;
    }
    if (hits === words.length && hits > 1) score += 3;
    const days = (now - p.lastUsed) / 864e5;
    if (score > 0) score += Math.max(0, 2 - days / 15); // kürzlich benutzt: kleiner Bonus
    return { ...p, score };
  }).filter(p => p.score > 0);
  scored.sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed);
  return scored.slice(0, limit);
}

// Claude wählt anhand einer freien Beschreibung (schnelles Modell, ohne Werkzeuge).
export async function aiSearch(query, mock) {
  const list = scan().slice(0, 80);
  if (!list.length) return [];
  if (mock) return search(query, 3);
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
  const catalog = list.map((p, i) => `${i}: ${p.name} | ${p.short} | ${p.kinds.join(', ')} | zuletzt ${new Date(p.lastUsed).toISOString().slice(0, 10)} | ${p.description}`).join('\n');
  const prompt = `Ein Mensch sucht eines seiner Projekte auf seinem Mac. Seine Beschreibung: "${query}"\n\nProjekte (Index: Name | Pfad | Art | zuletzt benutzt | Beschreibung):\n${catalog}\n\nAntworte NUR mit JSON: {"treffer":[Index, ...]} mit bis zu 3 passenden Indizes, bester zuerst. Wenn nichts passt: {"treffer":[]}.`;
  let text = '';
  const q = sdkQuery({
    prompt,
    options: { model: 'claude-haiku-5-5', effort: 'low', tools: [], maxTurns: 1, persistSession: false, settingSources: [], cwd: HOME },
  });
  for await (const m of q) {
    if (m.type === 'assistant') for (const b of m.message?.content || []) if (b.type === 'text') text += b.text;
  }
  const json = text.match(/\{[\s\S]*\}/);
  let idx = [];
  try { idx = JSON.parse(json[0]).treffer || []; } catch { }
  return idx.filter(i => Number.isInteger(i) && list[i]).map(i => ({ ...list[i], score: 1, ai: true }));
}
