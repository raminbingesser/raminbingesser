// Echte Terminals (Pseudo-TTY) pro Projekt. Ausgabe wird gepuffert, damit
// ein neu geöffnetes Browserfenster den bisherigen Verlauf sieht.
import os from 'node:os';
import { id } from './store.js';

let pty = null;
try { pty = (await import('@lydell/node-pty')).default; }
catch (e) { console.warn('[flint] node-pty nicht verfügbar, Terminal deaktiviert:', e.message); }

const terms = new Map();
const MAX_BUF = 200_000;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}[^\s"'`)\]\u001b]*/g;

export const available = () => !!pty;

export function listTerminals(projectId) {
  return [...terms.values()].filter(t => t.projectId === projectId).map(t => ({ id: t.id, title: t.title, projectId: t.projectId, exited: t.exited }));
}

export function createTerminal({ projectId, cwd, env, title, emit }) {
  if (!pty) throw new Error('Terminal nicht verfügbar (node-pty fehlt).');
  const shell = process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash');
  const p = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd,
    env: { ...process.env, ...env, TERM: 'xterm-256color', FLINT: '1' },
  });
  const t = { id: id(), projectId, title: title || 'Terminal', pty: p, buf: '', exited: false };
  terms.set(t.id, t);
  p.onData(d => {
    t.buf = (t.buf + d).slice(-MAX_BUF);
    emit({ type: 'term:data', termId: t.id, data: d });
    // Lokale URLs (Dev-Server) erkennen und der Vorschau vorschlagen.
    const clean = d.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
    for (const m of clean.matchAll(URL_RE)) emit({ type: 'preview:url', projectId, url: m[0].replace(/[.,;:]+$/, '') });
    // Server, die nur den Port nennen („listening on port 3333“, „EADDRINUSE …:3333“).
    // Als Vermutung markiert: die Vorschau prüft erst, ob dort wirklich etwas antwortet.
    for (const m of clean.matchAll(/(?:\bport\b|listening on|läuft auf|running on|EADDRINUSE[^\n]*?:)\D{0,12}?(\d{4,5})\b/gi)) {
      const port = Number(m[1]);
      if (port >= 1024 && port <= 65535) emit({ type: 'preview:url', projectId, url: `http://localhost:${port}`, guess: true });
    }
  });
  p.onExit(({ exitCode }) => {
    t.exited = true;
    emit({ type: 'term:exit', termId: t.id, code: exitCode });
  });
  return t;
}

export function getTerminal(tid) { return terms.get(tid); }

export function writeTerminal(tid, data) { terms.get(tid)?.pty.write(data); }

export function resizeTerminal(tid, cols, rows) {
  const t = terms.get(tid);
  if (t && !t.exited && cols > 0 && rows > 0) t.pty.resize(Math.floor(cols), Math.floor(rows));
}

export function killTerminal(tid) {
  const t = terms.get(tid);
  if (!t) return;
  try { if (!t.exited) t.pty.kill(); } catch { }
  terms.delete(tid);
}

export function killAll() { for (const tid of terms.keys()) killTerminal(tid); }

export const defaultCwd = () => os.homedir();
