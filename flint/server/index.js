#!/usr/bin/env node
// Flint: deine lokale KI-Werkstatt. Startet einen Server auf 127.0.0.1 und
// öffnet die Oberfläche im Browser. Agenten laufen über Claude Code auf deinem
// Rechner, also mit deinem Claude-Abo (claude login) oder optional einem API-Key.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';

import * as store from './store.js';
import * as vault from './vault.js';
import * as agents from './agents.js';
import * as term from './terminal.js';
import * as files from './files.js';
import * as brain from './brain.js';
import * as claude from './claude.js';
import * as variants from './variants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const NM = path.join(ROOT, 'node_modules');
const PORT = Number(process.env.FLINT_PORT || 4317);
const PREVIEW_PORT = Number(process.env.FLINT_PREVIEW_PORT || PORT + 1);
const TOKEN = crypto.randomBytes(24).toString('hex');
const PTOKEN = crypto.randomBytes(16).toString('hex');
const MOCK = process.env.FLINT_MOCK === '1';

// ---- WebSocket-Verteiler --------------------------------------------------
const clients = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
}
agents.setEmitter(broadcast);

// ---- Dateiwächter: Vorschau neu laden, sobald sich etwas ändert ----------
const watchers = new Map();
const IGNORE = /(^|[/\\])(node_modules|\.git|\.next|\.cache|__pycache__|\.venv)([/\\]|$)/;
function watchProject(p) {
  if (watchers.has(p.id) || !fs.existsSync(p.path)) return;
  let timer = null;
  const changed = new Set();
  try {
    const w = fs.watch(p.path, { recursive: true }, (_ev, name) => {
      if (!name || IGNORE.test(name)) return;
      changed.add(name.split(path.sep).join('/'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        broadcast({ type: 'files:changed', projectId: p.id, paths: [...changed] });
        changed.clear();
      }, 150);
    });
    w.on('error', () => { });
    watchers.set(p.id, w);
  } catch (e) {
    console.warn(`[flint] Ordner kann nicht beobachtet werden (${p.path}): ${e.message}`);
  }
}
function unwatchProject(pid) { watchers.get(pid)?.close(); watchers.delete(pid); }
store.listProjects().forEach(watchProject);

// ---- HTTP -------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// Nur localhost (Schutz gegen DNS-Rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.status(403).send('Nur lokal erreichbar.');
  next();
});

const vendor = {
  'preact.js': 'preact/dist/preact.module.js',
  'hooks.js': 'preact/hooks/dist/hooks.module.js',
  'htm.js': 'htm/dist/htm.module.js',
  'marked.js': 'marked/lib/marked.esm.js',
  'xterm.js': '@xterm/xterm/lib/xterm.js',
  'xterm.css': '@xterm/xterm/css/xterm.css',
  'addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  'purify.js': 'dompurify/dist/purify.es.mjs',
};
app.get('/vendor/:f', (req, res) => {
  const rel = vendor[req.params.f];
  if (!rel) return res.sendStatus(404);
  res.sendFile(path.join(NM, rel));
});

app.get('/', (_req, res) => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__FLINT_TOKEN__', TOKEN);
  res.set('Cache-Control', 'no-store').type('html').send(html);
});
app.use('/static', express.static(PUBLIC, { index: false }));

// API: verlangt den Token im Header (fremde Webseiten können ihn nicht lesen).
const api = express.Router();
api.use((req, res, next) => (req.get('x-flint-token') === TOKEN ? next() : res.status(401).json({ error: 'Kein Zugriff.' })));
const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out ?? { ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
const project = (req) => {
  const p = store.getProject(req.params.pid);
  if (!p) throw new Error('Projekt nicht gefunden.');
  return p;
};

api.get('/state', wrap(() => ({
  projects: store.listProjects(),
  sessions: store.listSessions(),
  runtime: agents.snapshot(),
  settings: store.getState().settings,
  terminal: term.available(),
  mock: MOCK,
  home: os.homedir(),
  defaultDir: path.join(os.homedir(), 'Flint'),
  rawBase: `http://localhost:${PREVIEW_PORT}/p/${PTOKEN}`,
  previewOrigin: `http://localhost:${PREVIEW_PORT}`,
})));

api.put('/settings', wrap((req) => store.updateSettings(req.body)));

// Ordnerauswahl (es gibt im Browser keinen nativen Dialog für Pfade).
api.get('/browse', wrap((req) => {
  const dir = path.resolve(String(req.query.path || os.homedir()).replace(/^~(?=$|\/)/, os.homedir()));
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name).sort((a, b) => a.localeCompare(b));
  return { dir, parent: path.dirname(dir), entries };
}));

api.post('/projects', wrap((req) => {
  const { dir, name, create } = req.body;
  if (!dir) throw new Error('Ordner fehlt.');
  const abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
  if (create && fs.existsSync(abs) && fs.readdirSync(abs).length > 0) {
    throw new Error(`Der Ordner ${abs} existiert schon. Wähle einen anderen Namen oder öffne ihn über „Ordner öffnen“.`);
  }
  if (create) fs.mkdirSync(abs, { recursive: true });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('Ordner existiert nicht.');
  const p = store.addProject({ name, dir: abs });
  if (create) {
    brain.ensureBrain(p.path, p.name);
    // Versionierung gleich einschalten, damit Varianten und Sicherungspunkte sofort gehen
    // (nur wenn der neue Ordner nicht schon in einem Repo liegt).
    files.repoInfo(p.path).then(async (info) => {
      if (info) return;
      try {
        await files.gitInit(p.path);
        await files.gitCommit(p.path, 'Projekt angelegt');
      } catch { /* Git fehlt: Versionen-Tab bietet es später an */ }
    });
  }
  watchProject(p);
  broadcast({ type: 'project:added', project: p });
  return p;
}));

// Projekt aus GitHub (oder einer anderen Git-Adresse) laden.
api.post('/clone', wrap(async (req) => {
  const url = String(req.body.url || '').trim();
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(url)) throw new Error('Bitte eine Git-Adresse wie https://github.com/name/repo angeben.');
  const name = (req.body.name || url.split('/').pop().replace(/\.git$/, '')).replace(/[^\w.-]/g, '-');
  const dir = path.join(os.homedir(), 'Flint', name);
  if (fs.existsSync(dir)) throw new Error(`Der Ordner ${dir} existiert schon. Öffne ihn über „Ordner öffnen“.`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await new Promise((res, rej) => execFile('git', ['clone', url, dir], { timeout: 600_000 }, (e, _o, err) => (e ? rej(new Error((err || e.message).trim().split('\n').pop())) : res())));
  const p = store.addProject({ name, dir });
  watchProject(p);
  broadcast({ type: 'project:added', project: p });
  return p;
}));

api.delete('/projects/:pid', wrap(async (req) => {
  const p = project(req);
  // Varianten des Projekts mit entfernen
  for (const v of store.listProjects().filter(x => x.variantOf === p.id)) {
    dropProject(v.id);
    await variants.removeVariant(v.id).catch(() => { });
    broadcast({ type: 'project:removed', projectId: v.id });
  }
  dropProject(p.id);
  if (p.variantOf) await variants.removeVariant(p.id).catch(() => store.removeProject(p.id));
  else store.removeProject(p.id);
  broadcast({ type: 'project:removed', projectId: req.params.pid });
}));

// ---- Varianten ----
function dropProject(pid) {
  for (const s of store.listSessions(pid)) agents.forget(s.id);
  for (const t of term.listTerminals(pid)) term.killTerminal(t.id);
  unwatchProject(pid);
}
api.post('/projects/:pid/variants', wrap(async (req) => {
  const p = project(req);
  const count = Math.max(1, Math.min(3, Number(req.body.count) || 1));
  const name = String(req.body.name || 'Variante').trim();
  const prompt = String(req.body.prompt || '').trim();
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = await variants.createVariant(p.id, count > 1 ? `${name} ${String.fromCharCode(65 + i)}` : name);
    watchProject(v);
    broadcast({ type: 'project:added', project: v });
    if (prompt) {
      const s = store.addSession(v.id, { title: v.variantName });
      broadcast({ type: 'session:updated', session: s });
      const hint = count > 1 ? `\n\n(Das ist Variante ${String.fromCharCode(65 + i)} von ${count}. Es werden mehrere Varianten parallel gebaut; geh bewusst eine eigene, klar unterscheidbare Richtung.)` : '';
      agents.enqueue(s.id, prompt + hint);
    }
    out.push(v);
  }
  return out;
}));
api.get('/projects/:pid/variant/diff', wrap(async (req) => ({ stat: await variants.variantDiffStat(req.params.pid) })));
api.post('/projects/:pid/variant/apply', wrap(async (req) => {
  const v = project(req);
  if (store.listSessions(v.id).some(s => agents.isBusy(s.id))) throw new Error('In der Variante arbeitet noch ein Agent. Warte, bis er fertig ist, oder stoppe ihn.');
  try {
    // Erst zusammenführen; Agenten/Terminals der Variante nur bei Erfolg beenden.
    const parent = await variants.applyVariant(v.id, () => dropProject(v.id));
    broadcast({ type: 'project:removed', projectId: v.id });
    return { parentId: parent.id };
  } catch (e) {
    if (e.conflict) return { conflict: true, branch: v.branch, parentId: v.variantOf, variantId: v.id, message: e.message };
    throw e;
  }
}));
api.post('/projects/:pid/variant/discard', wrap(async (req) => {
  const v = project(req);
  dropProject(v.id);
  await variants.removeVariant(v.id);
  broadcast({ type: 'project:removed', projectId: v.id });
}));

// ---- iOS-Simulator (nur Mac mit Xcode) ----
let simBusy = false;
api.get('/simulator/status', wrap(async () => {
  if (process.platform !== 'darwin') return { available: false, reason: 'Nur auf dem Mac mit Xcode verfügbar.' };
  const out = await new Promise(r => execFile('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: 15000 }, (e, o) => r(e ? null : String(o))));
  if (out == null) return { available: false, reason: 'Xcode fehlt (xcrun simctl nicht gefunden).' };
  let booted = [];
  try { booted = Object.values(JSON.parse(out).devices).flat().filter(d => d.state === 'Booted').map(d => d.name); } catch { }
  return { available: true, booted };
}));
api.get('/simulator/screenshot', async (req, res) => {
  if (process.platform !== 'darwin') return res.status(400).json({ error: 'Nur auf dem Mac.' });
  if (simBusy) return res.status(429).end();
  simBusy = true;
  const f = path.join(os.tmpdir(), `flint-sim-${process.pid}.png`);
  execFile('xcrun', ['simctl', 'io', 'booted', 'screenshot', '--type=png', f], { timeout: 15000 }, (e) => {
    simBusy = false;
    if (e) return res.status(404).json({ error: 'Kein Simulator gestartet.' });
    res.set('Cache-Control', 'no-store').sendFile(f);
  });
});

// ---- Railway (Veröffentlichen) ----
api.get('/railway', wrap(async () => {
  const has = await new Promise(r => execFile('railway', ['--version'], (e, out) => r(e ? null : String(out).trim())));
  if (!has) return { installed: false };
  const who = await new Promise(r => execFile('railway', ['whoami'], { timeout: 15000 }, (e, out) => r(e ? null : String(out).trim())));
  const token = vault.listSecrets().some(s => /^RAILWAY_(API_)?TOKEN$/.test(s.name));
  return { installed: true, version: has, user: who, token };
}));

api.post('/projects/:pid/sessions', wrap((req) => {
  const p = project(req);
  const s = store.addSession(p.id, req.body || {});
  broadcast({ type: 'session:updated', session: s });
  if (req.body?.prompt) agents.enqueue(s.id, req.body.prompt);
  return s;
}));

api.patch('/sessions/:sid', wrap((req) => {
  const allowed = ['title', 'model', 'effort', 'permissionMode', 'role'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const s = store.updateSession(req.params.sid, patch);
  if (!s) throw new Error('Sitzung nicht gefunden.');
  broadcast({ type: 'session:updated', session: s });
  return s;
}));

api.delete('/sessions/:sid', wrap((req) => {
  agents.forget(req.params.sid);
  store.removeSession(req.params.sid);
  broadcast({ type: 'session:removed', sid: req.params.sid });
}));

api.get('/sessions/:sid/events', wrap((req) => store.readEvents(req.params.sid)));
api.post('/sessions/:sid/prompt', wrap((req) => {
  if (!store.getSession(req.params.sid)) throw new Error('Sitzung nicht gefunden.');
  const text = String(req.body.text || '').trim();
  if (!text) throw new Error('Leere Nachricht.');
  agents.enqueue(req.params.sid, text);
}));
api.post('/sessions/:sid/interrupt', wrap((req) => agents.interrupt(req.params.sid)));
api.post('/sessions/:sid/queue/:item', wrap((req) => agents.queueAction(req.params.sid, req.params.item, req.body.action)));
api.post('/sessions/:sid/permission/:req', wrap((req) => agents.answerPermission(req.params.sid, req.params.req, req.body.decision, req.body.answers)));

api.get('/projects/:pid/files', wrap((req) => files.listDir(project(req).path, req.query.path || '')));
api.get('/projects/:pid/file', wrap((req) => files.readFile(project(req).path, req.query.path)));
api.put('/projects/:pid/file', wrap((req) => files.writeFile(project(req).path, req.body.path, req.body.text)));
api.get('/projects/:pid/exists', wrap((req) => {
  const f = files.resolveIn(project(req).path, String(req.query.path || ''));
  return { exists: fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html'))) };
}));
api.get('/projects/:pid/html-files', wrap((req) => {
  // HTML-Dateien für die Vorschau-Auswahl (flach, max. 4 Ebenen tief).
  const root = project(req).path;
  const out = [];
  const walk = (rel, depth) => {
    if (depth > 4 || out.length > 200) return;
    for (const e of files.listDir(root, rel)) {
      if (e.dir) walk(e.path, depth + 1);
      else if (/\.html?$/i.test(e.name)) out.push({ path: e.path.split(path.sep).join('/'), mtime: e.mtime });
    }
  };
  walk('', 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}));

api.post('/projects/:pid/upload', wrap((req) => {
  // Eingefügte Bilder/Dateien landen in .flint/uploads, damit Claude sie lesen kann.
  const p = project(req);
  const name = String(req.body.name || 'bild.png').replace(/[^\w.-]/g, '_').slice(-60);
  const dir = path.join(p.path, '.flint', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const ign = path.join(p.path, '.flint', '.gitignore');
  if (!fs.existsSync(ign)) fs.writeFileSync(ign, '*\n');
  const file = `${Date.now()}-${name}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(String(req.body.data || ''), 'base64'));
  return { path: `.flint/uploads/${file}` };
}));

api.get('/projects/:pid/brain', wrap((req) => {
  const p = project(req);
  const b = brain.readBrain(p.path);
  return { brain: b.brain, roadmap: b.roadmap == null ? null : brain.parseRoadmap(b.roadmap), columns: brain.COLUMNS };
}));
api.post('/projects/:pid/brain/init', wrap((req) => { const p = project(req); brain.ensureBrain(p.path, p.name); }));
api.put('/projects/:pid/brain', wrap((req) => brain.writeBrain(project(req).path, String(req.body.brain ?? ''))));
api.put('/projects/:pid/roadmap', wrap((req) => brain.writeRoadmap(project(req).path, req.body.columns || {})));

api.get('/projects/:pid/git', wrap((req) => files.gitStatus(project(req).path)));
api.get('/projects/:pid/git/diff', wrap(async (req) => ({ diff: await files.gitDiff(project(req).path, req.query.path) })));
api.post('/projects/:pid/git/init', wrap((req) => files.gitInit(project(req).path)));
api.post('/projects/:pid/git/commit', wrap((req) => files.gitCommit(project(req).path, req.body.message)));
api.post('/projects/:pid/git/discard', wrap((req) => files.gitDiscard(project(req).path, req.body.path)));
api.post('/projects/:pid/git/push', wrap((req) => files.gitPush(project(req).path)));

api.get('/projects/:pid/terminals', wrap((req) => term.listTerminals(req.params.pid)));
api.post('/projects/:pid/terminals', wrap((req) => {
  const p = project(req);
  const t = term.createTerminal({ projectId: p.id, cwd: p.path, env: vault.envFor(p.variantOf || p.id), title: req.body?.title, emit: broadcast });
  const presets = {
    claude: () => claude.claudeCommand(),
    login: () => claude.claudeCommand('auth login'),
    'mcp-login': () => claude.claudeCommand('mcp login ' + String(req.body.name || '').replace(/[^\w.-]/g, '')),
  };
  const cmd = presets[req.body?.preset]?.() || req.body?.command;
  if (cmd) setTimeout(() => term.writeTerminal(t.id, cmd + '\r'), 500);
  return { id: t.id, title: t.title, projectId: p.id };
}));
api.delete('/terminals/:tid', wrap((req) => term.killTerminal(req.params.tid)));

api.get('/vault', wrap(() => vault.listSecrets()));
api.post('/vault', wrap((req) => vault.setSecret(String(req.body.name || '').trim(), String(req.body.value || ''), req.body.projects || null)));
api.delete('/vault/:name', wrap((req) => vault.deleteSecret(req.params.name)));

api.get('/claude/status', wrap(() => claude.authStatus()));

// Flint beenden (z. B. aus den Einstellungen).
api.post('/shutdown', wrap(() => { setTimeout(shutdown, 300); return { ok: true }; }));
api.get('/version', wrap(() => ({ version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version })));

// Terminal ohne Projekt (für Anmeldungen), läuft im Home-Ordner.
api.post('/terminals/global', wrap((req) => {
  const presets = {
    login: () => claude.claudeCommand('auth login'),
    claude: () => claude.claudeCommand(),
    'mcp-login': () => claude.claudeCommand('mcp login ' + String(req.body.name || '').replace(/[^\w.-]/g, '')),
    'railway-login': () => 'railway login',
    'railway-install': () => (process.platform === 'darwin' ? 'brew install railway' : 'npm install -g @railway/cli'),
  };
  const t = term.createTerminal({ projectId: '_global', cwd: os.homedir(), env: {}, title: 'Anmeldung', emit: broadcast });
  const cmd = presets[req.body?.preset]?.();
  if (cmd) setTimeout(() => term.writeTerminal(t.id, cmd + '\r'), 500);
  return { id: t.id };
}));

// Systemcheck für die Ersteinrichtung.
api.get('/doctor', wrap(async () => {
  const git = await new Promise(r => execFile('git', ['--version'], (e) => r(!e)));
  const major = Number(process.versions.node.split('.')[0]);
  return { claude: await claude.authStatus(), git, terminal: term.available(), node: major >= 20, nodeVersion: process.versions.node };
}));

// Selbst-Update per git pull (wenn Flint aus einem Git-Klon läuft).
const gitRoot = (args) => new Promise((res, rej) => execFile('git', args, { cwd: ROOT, timeout: 120_000 }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(String(out).trim()))));
api.get('/update', wrap(async () => {
  await gitRoot(['fetch', '--quiet']);
  const branch = await gitRoot(['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = await gitRoot(['log', '-1', '--format=%h %s']);
  let behind = 0;
  try { behind = Number(await gitRoot(['rev-list', '--count', 'HEAD..@{u}'])); } catch { }
  return { branch, current, behind };
}));
api.post('/update', wrap(async () => {
  const pull = await gitRoot(['pull', '--ff-only']);
  const npm = await new Promise((res) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, timeout: 600_000 }, (e, out, err) => res(e ? String(err || e.message) : String(out))));
  return { log: (pull + '\n' + npm).trim().slice(-4000) };
}));
const mcpCwd = (req) => (req.query.pid && store.getProject(req.query.pid)?.path) || os.homedir();
api.get('/mcp', wrap((req) => claude.mcpList(mcpCwd(req))));
api.post('/mcp', wrap((req) => claude.mcpAdd(req.body, mcpCwd(req))));
api.delete('/mcp/:name', wrap((req) => claude.mcpRemove(req.params.name, req.query.scope, mcpCwd(req))));

app.use('/api', api);

// ---- Vorschau-Server (eigener Port = eigener Ursprung) ------------------------
// Projektdateien laufen getrennt von Flint, damit Skripte in deinen Seiten
// (z. B. aus einem CDN) nicht an Flints Zugangsschlüssel kommen.
const preview = express();
preview.disable('x-powered-by');
preview.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.status(403).send('Nur lokal erreichbar.');
  next();
});
preview.get('/__flint/bridge.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(PUBLIC, 'bridge.js')));
const BRIDGE = '<script src="/__flint/bridge.js"></script>';
preview.get(`/p/${PTOKEN}/:pid/*`, (req, res) => {
  const p = store.getProject(req.params.pid);
  if (!p) return res.sendStatus(404);
  try {
    const rel = req.params[0] || ''; // Express hat den Pfad schon dekodiert
    // Versteckte Dateien (.env, .git …) nie an Vorschau-Seiten ausliefern.
    if (rel.split('/').some(seg => seg.startsWith('.') && seg !== '.well-known')) return res.status(404).type('text').send('Datei nicht gefunden.');
    let f = files.resolveIn(p.path, rel);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return res.status(404).type('text').send('Datei nicht gefunden.');
    res.set('Cache-Control', 'no-store');
    if (/\.html?$/i.test(f)) {
      let h = fs.readFileSync(f, 'utf8');
      h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + BRIDGE) : BRIDGE + h;
      return res.type('html').send(h);
    }
    // 'allow', weil Varianten unter ~/.flint liegen; versteckte Pfadteile sind oben schon abgewiesen.
    res.sendFile(f, { dotfiles: 'allow' });
  } catch (e) { res.status(400).send(e.message); }
});
const previewServer = http.createServer(preview);
previewServer.on('error', (e) => console.warn(`[flint] Vorschau-Port ${PREVIEW_PORT} nicht verfügbar: ${e.message}`));
previewServer.listen(PREVIEW_PORT, '127.0.0.1');

// ---- Server + WebSocket ----------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const origin = req.headers.origin || '';
  const okOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== TOKEN || !okOrigin) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'term:input') term.writeTerminal(m.termId, m.data);
    else if (m.type === 'term:resize') term.resizeTerminal(m.termId, m.cols, m.rows);
    else if (m.type === 'term:attach') {
      const t = term.getTerminal(m.termId);
      if (t) ws.send(JSON.stringify({ type: 'term:replay', termId: t.id, data: t.buf }));
    }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Flint läuft bereits auf http://localhost:${PORT}/ (oder der Port ist belegt).\n  Anderen Port wählen: FLINT_PORT=4400 npm start\n`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Flint läuft: ${url}${MOCK ? '  (Demo-Modus, ohne Claude)' : ''}\n  Daten: ${store.HOME}\n  Beenden mit Strg+C\n`);
  if (!process.env.FLINT_NO_OPEN) {
    try { (await import('open')).default(url); } catch { }
  }
});

function shutdown() { term.killAll(); store.flush(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
