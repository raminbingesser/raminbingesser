// Persistenter Zustand von Flint: Projekte, Sitzungen, Verläufe.
// Alles liegt lokal unter ~/.flint (oder FLINT_HOME).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const HOME = process.env.FLINT_HOME || path.join(os.homedir(), '.flint');
const CONFIG = path.join(HOME, 'config.json');
const TRANSCRIPTS = path.join(HOME, 'sessions');

fs.mkdirSync(TRANSCRIPTS, { recursive: true, mode: 0o700 });

const DEFAULT_PROMPTS = [
  { title: 'Dashboard bauen', text: 'Baue ein Dashboard in dashboard/index.html (eine einzelne HTML-Datei, ohne Build-Schritt; Chart.js vom CDN ist erlaubt). Es soll zeigen: ' },
  { title: 'Internes Tool bauen', text: 'Baue ein kleines internes Tool als einzelne HTML-Datei in tool/index.html. Es soll: ' },
  { title: 'CSV analysieren', text: 'Analysiere die CSV-Datei @ und baue daraus ein übersichtliches Dashboard mit den wichtigsten Kennzahlen.' },
  { title: 'Daten anbinden', text: 'Binde echte Daten an das Dashboard an. Quelle: . Schlüssel liegen als Umgebungsvariablen im Tresor bereit (Namen siehe Tresor).' },
  { title: 'Design verbessern', text: 'Überarbeite das Design: ruhiger, moderner, mehr Weißraum, klare Hierarchie, gute Lesbarkeit im Hell- und Dunkelmodus. Funktion nicht ändern.' },
  { title: 'Mobil-tauglich machen', text: 'Mach die Seite auf dem Handy (390 px Breite) gut benutzbar, ohne die Desktop-Ansicht zu verschlechtern.' },
  { title: 'Prüfen & Fehler finden', text: 'Prüfe das Projekt gründlich: Fehler in der Konsole, kaputte Links, falsche Zahlen, Randfälle. Berichte zuerst, repariere dann nach Rücksprache.' },
  { title: 'Projekt-Brain ausfüllen', text: 'Lies das Projekt und fülle brain/BRAIN.md (Mission, Ziele, Regeln, Stil) und brain/ROADMAP.md (sinnvolle nächste Schritte) aus. Frag mich, wo du unsicher bist.' },
  { title: 'Erkläre mir das Projekt', text: 'Erkläre mir in einfachen Worten, wie dieses Projekt aufgebaut ist und wie ich es starte.' },
];

const empty = () => ({
  projects: [], sessions: {},
  settings: { defaultModel: 'claude-sonnet-5-5', defaultEffort: 'medium', speedDefaults: true, defaultPermission: 'acceptEdits', notifications: true, prompts: DEFAULT_PROMPTS },
});

let state = empty();
try {
  const saved = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const base = empty();
  state = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) } };
  // Einmalig: schnellere Standards (Sonnet 5.5, mittlere Denktiefe). Opus bleibt pro Sitzung wählbar.
  if (!state.settings.speedDefaults) {
    state.settings.defaultModel = 'claude-sonnet-5-5';
    state.settings.defaultEffort = 'medium';
    state.settings.speedDefaults = true;
  }
} catch { /* erster Start */ }

let saveTimer = null;
function writeNow() {
  const tmp = CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG);
}
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 50);
}
// Beim Beenden sofort schreiben, damit nichts verloren geht.
export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeNow(); }
}

// Sitzungs-IDs kommen aus URLs: nur unsere eigenen Hex-IDs zulassen.
const transcript = (sid) => {
  if (!/^[0-9a-f]{12}$/.test(String(sid))) throw new Error('Ungültige Sitzung.');
  return path.join(TRANSCRIPTS, sid + '.jsonl');
};

export const id = () => crypto.randomBytes(6).toString('hex');

export function getState() { return state; }

export function listProjects() { return state.projects; }
export function getProject(pid) { return state.projects.find(p => p.id === pid); }

export function addProject({ name, dir }) {
  const resolved = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
  const existing = state.projects.find(p => p.path === resolved);
  if (existing) return existing;
  const p = { id: id(), name: name || path.basename(resolved), path: resolved, createdAt: Date.now() };
  state.projects.push(p);
  save();
  return p;
}

export function updateProject(pid, patch) {
  const p = state.projects.find(x => x.id === pid);
  if (!p) return null;
  Object.assign(p, patch);
  save();
  return p;
}

export function removeProject(pid) {
  state.projects = state.projects.filter(p => p.id !== pid);
  for (const s of Object.values(state.sessions)) if (s.projectId === pid) delete state.sessions[s.id];
  save();
}

export function listSessions(pid) {
  return Object.values(state.sessions).filter(s => !pid || s.projectId === pid).sort((a, b) => a.createdAt - b.createdAt);
}
export function getSession(sid) { return state.sessions[sid]; }

export function addSession(projectId, opts = {}) {
  const s = {
    id: id(),
    projectId,
    title: opts.title || 'Neue Sitzung',
    role: opts.role || null,
    claudeSessionId: null,
    // Schnellspur (✎ Ändern): schnelles Modell und wenig Denken als Standard
    fast: !!opts.fast,
    model: opts.model || (opts.fast ? (state.settings.fastModel || 'claude-sonnet-5-5') : state.settings.defaultModel),
    effort: opts.effort || (opts.fast ? 'low' : state.settings.defaultEffort),
    permissionMode: opts.permissionMode || (opts.fast && state.settings.defaultPermission === 'default' ? 'acceptEdits' : state.settings.defaultPermission),
    createdAt: Date.now(),
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 },
  };
  state.sessions[s.id] = s;
  save();
  return s;
}

export function updateSession(sid, patch) {
  const s = state.sessions[sid];
  if (!s) return null;
  Object.assign(s, patch);
  save();
  return s;
}

export function removeSession(sid) {
  delete state.sessions[sid];
  fs.rmSync(transcript(sid), { force: true });
  save();
}

// Verlauf: eine JSON-Zeile pro UI-Ereignis.
export function appendEvent(sid, ev) {
  fs.appendFileSync(transcript(sid), JSON.stringify(ev) + '\n', { mode: 0o600 });
}

export function readEvents(sid) {
  try {
    return fs.readFileSync(transcript(sid), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  save();
  return state.settings;
}
