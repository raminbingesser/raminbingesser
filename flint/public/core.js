// Gemeinsamer Zustand, API-Zugriff, WebSocket und kleine Helfer.
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const html = htm.bind(h);
const TOKEN = window.FLINT_TOKEN;

// ---- Store -----------------------------------------------------------------
const ls = {
  get(k, d) { try { const v = localStorage.getItem('wb:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wb:' + k, JSON.stringify(v)); } catch { } },
};
export { ls };

export const S = {
  ready: false,
  connected: false,
  projects: [],
  sessions: {},
  runtime: {},
  settings: {},
  events: {},
  deltas: {},
  terms: {},
  activePid: ls.get('activePid', null),
  activeSid: ls.get('activeSid', null),
  expanded: ls.get('expanded', {}),
  tab: ls.get('tab', 'preview'),
  preview: ls.get('preview', {}),
  showSide: ls.get('showSide', true),
  showWork: ls.get('showWork', true),
  theme: ls.get('theme', 'dark'),
  modal: null,
  toasts: [],
  claude: null,
  recent: {},
  ticks: {},
  composerInsert: null,
};

const subs = new Set();
let raf = 0;
export function set(patch) {
  Object.assign(S, typeof patch === 'function' ? patch(S) : patch);
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; subs.forEach(f => f()); });
}
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return S;
}

export function persist() {
  ls.set('activePid', S.activePid);
  ls.set('activeSid', S.activeSid);
  ls.set('expanded', S.expanded);
  ls.set('tab', S.tab);
  ls.set('preview', S.preview);
  ls.set('showSide', S.showSide);
  ls.set('showWork', S.showWork);
  ls.set('theme', S.theme);
}

// ---- API ---------------------------------------------------------------------
export async function api(method, url, body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-flint-token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export function toast(text, kind = '') {
  const id = Math.random().toString(36).slice(2);
  set({ toasts: [...S.toasts, { id, text, kind }] });
  setTimeout(() => set({ toasts: S.toasts.filter(t => t.id !== id) }), kind === 'err' ? 7000 : 3500);
}

export async function safe(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, 'err'); return undefined; }
}

// ---- Terminal-Registry (xterm-Instanzen leben außerhalb von Preact) --------
export const termRegistry = new Map();

// ---- WebSocket ---------------------------------------------------------------
let ws = null;
const listeners = new Set();
export function onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

export function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?token=${TOKEN}`);
  ws.onopen = async () => { set({ connected: true }); await loadState(); };
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(async () => {
      // Wurde Flint neu gestartet (neuer Zugangsschlüssel)? Dann Seite neu laden.
      try {
        const r = await fetch('/', { cache: 'no-store' });
        const tok = r.ok && (await r.text()).match(/FLINT_TOKEN = "([0-9a-f]+)"/)?.[1];
        if (tok && tok !== TOKEN) { location.reload(); return; }
      } catch { }
      connect();
    }, 1500);
  };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    for (const fn of listeners) fn(m);
  };
}

export async function loadState() {
  const st = await api('GET', '/state');
  const sessions = Object.fromEntries(st.sessions.map(s => [s.id, s]));
  let { activePid, activeSid } = S;
  if (activeSid && !sessions[activeSid]) activeSid = null;
  if (activePid && !st.projects.find(p => p.id === activePid)) activePid = null;
  if (!activePid && st.projects.length) activePid = st.projects[0].id;
  set({ ready: true, projects: st.projects, sessions, runtime: st.runtime, settings: st.settings, info: st, activePid, activeSid, events: {} });
  if (activeSid) loadEvents(activeSid);
  api('GET', '/claude/status').then(c => set({ claude: c })).catch(() => { });
}

export async function loadEvents(sid) {
  const evs = await api('GET', `/sessions/${sid}/events`).catch(() => []);
  set({ events: { ...S.events, [sid]: evs } });
}

// ---- Auswahl ---------------------------------------------------------------
export function selectSession(sid) {
  const s = S.sessions[sid];
  if (!s) return;
  set({ activeSid: sid, activePid: s.projectId, expanded: { ...S.expanded, [s.projectId]: true } });
  persist();
  if (!S.events[sid]) loadEvents(sid);
}
export function selectProject(pid) {
  const keep = S.sessions[S.activeSid]?.projectId === pid;
  set({ activePid: pid, activeSid: keep ? S.activeSid : null, expanded: { ...S.expanded, [pid]: true } });
  persist();
}
export const rt = (sid) => S.runtime[sid] || { status: 'idle', queue: [], pending: [] };
export const project = (pid = S.activePid) => S.projects.find(p => p.id === pid);
export const sessionsOf = (pid) => Object.values(S.sessions).filter(s => s.projectId === pid).sort((a, b) => a.createdAt - b.createdAt);

export async function newSession(pid = S.activePid, opts = {}) {
  if (!pid) return null;
  const s = await safe(() => api('POST', `/projects/${pid}/sessions`, opts));
  if (s) {
    set({ sessions: { ...S.sessions, [s.id]: s }, events: { ...S.events, [s.id]: [] } });
    selectSession(s.id);
  }
  return s;
}

export async function sendPrompt(text, sid = S.activeSid) {
  text = text.trim();
  if (!text) return;
  if (!sid) {
    // Letzte Sitzung des Projekts weiterverwenden, sonst neue anlegen.
    const last = sessionsOf(S.activePid).filter(s => !s.parentId).pop();
    if (last) { sid = last.id; selectSession(sid); }
    else {
      const s = await newSession(S.activePid);
      if (!s) return;
      sid = s.id;
    }
  }
  ensureNotifyPermission();
  await safe(() => api('POST', `/sessions/${sid}/prompt`, { text }));
}

// ---- Vorschau ---------------------------------------------------------------
export function previewOf(pid) {
  return S.preview[pid] || { mode: null, file: '', url: '', device: 'desktop', auto: true, nonce: 0 };
}
export function setPreview(pid, patch) {
  set({ preview: { ...S.preview, [pid]: { ...previewOf(pid), ...patch } } });
  persist();
}

// ---- Benachrichtigungen -----------------------------------------------------
export function ensureNotifyPermission() {
  if (!S.settings.notifications || !('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => { });
}
export function notify(title, body, sid) {
  if (!S.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && sid === S.activeSid) return;
  try {
    const n = new Notification(title, { body, tag: sid, silent: false });
    n.onclick = () => { window.focus(); selectSession(sid); n.close(); };
  } catch { }
}

// ---- Markdown ---------------------------------------------------------------
marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});
export function md(text) {
  return DOMPurify.sanitize(marked.parse(String(text || '')), { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] });
}

// ---- Sonstiges --------------------------------------------------------------
export const MODELS = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-fable-5-2', 'Fable 5.2'],
];
export const EFFORTS = [['low', 'Denken: niedrig'], ['medium', 'Denken: mittel'], ['high', 'Denken: hoch'], ['xhigh', 'Denken: sehr hoch'], ['max', 'Denken: maximal']];
export const PERMS = [
  ['default', 'Bei allem fragen'],
  ['acceptEdits', 'Dateien automatisch'],
  ['auto', 'Automatisch (geprüft)'],
  ['bypassPermissions', 'Alles erlauben'],
  ['plan', 'Nur planen'],
];
export const modelName = (id) => (MODELS.find(m => m[0] === id) || [id, id])[1];

export function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
export function fmtDur(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
export function slug(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projekt';
}
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Strg+';
export function rawUrl(pid, file, v) {
  const enc = String(file).split('/').map(encodeURIComponent).join('/');
  return `${S.info?.rawBase}/${pid}/${enc}${v != null ? `?v=${v}` : ''}`;
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function bump(key) {
  set({ ticks: { ...S.ticks, [key]: (S.ticks[key] || 0) + 1 } });
}

// ---- Spracheingabe (Diktat, Deutsch) -----------------------------------------
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
import { useRef as _useRef, useState as _useState, useEffect as _useEffect } from 'preact/hooks';
export function useDictation(getText, setText) {
  const [rec, setRec] = _useState(null);
  const base = _useRef('');
  _useEffect(() => () => rec?.stop(), [rec]);
  const toggle = () => {
    if (!SpeechRec) return;
    if (rec) { rec.stop(); return; }
    const sr = new SpeechRec();
    sr.lang = 'de-DE';
    sr.continuous = true;
    sr.interimResults = true;
    const t = getText();
    base.current = t ? t.replace(/\s*$/, ' ') : '';
    sr.onresult = (e) => {
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      if (fin) base.current += fin.trim() + ' ';
      setText(base.current + interim);
    };
    sr.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Spracheingabe: ' + (e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : e.error), 'err'); };
    sr.onend = () => setRec(null);
    sr.start();
    setRec(sr);
  };
  return { recording: !!rec, toggle, stop: () => rec?.stop(), supported: !!SpeechRec };
}
