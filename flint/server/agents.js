// Agenten-Manager: jede Sitzung ist ein eigener Claude-Agent (Claude Agent SDK),
// der im Projektordner arbeitet. Beliebig viele Sitzungen laufen parallel.
import * as store from './store.js';
import { envFor } from './vault.js';
import { systemAddendum } from './brain.js';
import { mockQuery } from './mock.js';

const MOCK = process.env.FLINT_MOCK === '1';
let sdk = null;
async function getSdk() {
  if (!sdk) sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk;
}
async function getQuery() {
  if (MOCK) return mockQuery;
  return (await getSdk()).query;
}

// ---- Chef & Helfer -----------------------------------------------------------
// Jede Hauptsitzung bekommt Werkzeuge, mit denen sie parallele Helfer-Sitzungen
// im selben Projekt starten, beobachten und auswerten kann. Helfer erscheinen
// in der Seitenleiste wie normale Sitzungen.
function lastAnswer(sid) {
  const evs = store.readEvents(sid);
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].type === 'text' && !evs[i].sub) return evs[i].text;
  return null;
}

async function bossServer(boss) {
  const { createSdkMcpServer, tool } = await getSdk();
  const { z } = await import('zod');
  const helpers = () => store.listSessions(boss.projectId).filter(s => s.parentId === boss.id);
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  return createSdkMcpServer({
    name: 'flint',
    version: '1.0.0',
    tools: [
      tool('helfer_starten', 'Startet eine parallele Helfer-Sitzung (eigener Claude-Agent) im selben Projekt mit einem klar abgegrenzten Auftrag. Nutze das für unabhängige Teilaufgaben, die gleichzeitig laufen können (z. B. Daten-Anbindung und Design). Gib dem Helfer alle nötigen Infos, er kennt dieses Gespräch nicht.', {
        titel: z.string().describe('Kurzer Name, z. B. "Designer" oder "Daten-Anbindung"'),
        auftrag: z.string().describe('Vollständiger Auftrag inklusive Dateien, Ziel und Abnahmekriterien'),
      }, async ({ titel, auftrag }) => {
        if (helpers().length >= 6) return text('Es laufen schon 6 Helfer. Warte, bis einer fertig ist.');
        const s = store.addSession(boss.projectId, { title: titel, role: `Helfer von "${boss.title}". Auftrag: ${auftrag.slice(0, 500)}`, model: boss.model, effort: boss.effort, permissionMode: boss.permissionMode });
        store.updateSession(s.id, { parentId: boss.id });
        emit({ type: 'session:updated', session: store.getSession(s.id) });
        enqueue(s.id, auftrag);
        return text(`Helfer "${titel}" gestartet (id: ${s.id}). Frag mit helfer_status nach dem Stand.`);
      }),
      tool('helfer_status', 'Zeigt alle Helfer dieser Sitzung mit Status (arbeitet / wartet auf Freigabe / fertig) und ihrer letzten Antwort.', {}, async () => {
        const list = helpers();
        if (!list.length) return text('Keine Helfer gestartet.');
        return text(list.map(h => {
          const r = runtime(h.id);
          const st = r.status === 'idle' ? (r.queue.length ? 'wartet in Warteschlange' : 'fertig') : r.status === 'waiting' ? 'wartet auf Freigabe durch den Menschen' : 'arbeitet';
          const last = lastAnswer(h.id);
          return `- ${h.title} (id ${h.id}): ${st}${last ? `\n  Letzte Antwort: ${last.slice(0, 1500)}` : ''}`;
        }).join('\n'));
      }),
      tool('helfer_nachricht', 'Schickt einem Helfer eine weitere Anweisung (wird nach seinem aktuellen Schritt bearbeitet).', {
        id: z.string(), text: z.string(),
      }, async ({ id, text: t }) => {
        const h = helpers().find(x => x.id === id);
        if (!h) return text('Unbekannter Helfer.');
        enqueue(h.id, t);
        return text(`Nachricht an "${h.title}" eingereiht.`);
      }),
    ],
  });
}

// Ein kleines Team, an das jeder Agent Teilaufgaben delegieren kann.
const TEAM = {
  'ui-designer': {
    description: 'Gestaltet Oberflächen: Layout, Farben, Typografie und Diagramme für Dashboards und Tools. Für alles Visuelle einsetzen.',
    prompt: 'Du bist UI-Designer. Baue klare, ruhige Oberflächen: Kennzahlen oben, Diagramme darunter, gute Lesbarkeit, Hell- und Dunkelmodus. Ändere nur, was zur Aufgabe gehört, und berichte knapp, was du geändert hast.',
    model: 'inherit',
  },
  'daten-analyst': {
    description: 'Bindet Datenquellen an (CSV, APIs, Datenbanken), bereinigt Daten und berechnet Kennzahlen.',
    prompt: 'Du bist Datenanalyst. Prüfe Datenquellen, bereinige Daten, definiere Kennzahlen sauber und dokumentiere Annahmen. Gib Schlüssel nie aus; sie liegen als Umgebungsvariablen bereit.',
    model: 'inherit',
  },
  'pruefer': {
    description: 'Prüft fertige Arbeit: baut, testet, sucht Fehler und Randfälle, bevor etwas als erledigt gilt.',
    prompt: 'Du bist Prüfer. Führe Build und Tests aus, öffne die Seite wenn möglich, suche Fehler und Randfälle und berichte konkret, was kaputt ist und warum. Repariere nichts ungefragt.',
    model: 'inherit',
  },
};

const rt = new Map(); // sid -> { status, queue, query, pending, abort }
let emit = () => { };
export function setEmitter(fn) { emit = fn; }

function runtime(sid) {
  if (!rt.has(sid)) rt.set(sid, { status: 'idle', queue: [], query: null, pending: new Map() });
  return rt.get(sid);
}

export function snapshot() {
  const out = {};
  for (const [sid, r] of rt) {
    out[sid] = {
      status: r.status,
      queue: r.queue,
      pending: [...r.pending.entries()].map(([reqId, p]) => ({ reqId, toolName: p.toolName, input: p.input, questions: p.questions })),
    };
  }
  return out;
}

function setStatus(sid, status) {
  const r = runtime(sid);
  r.status = status;
  emit({ type: 'session:status', sid, status });
}

function record(sid, ev) {
  ev.ts = Date.now();
  store.appendEvent(sid, ev);
  emit({ type: 'session:event', sid, event: ev });
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}[^\s"'`)\]<>]*/g;
function scanUrls(projectId, text) {
  for (const m of String(text).matchAll(URL_RE)) emit({ type: 'preview:url', projectId, url: m[0].replace(/[.,;:]+$/, '') });
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} Zeichen gekürzt)` : s);

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return JSON.stringify(content);
}

function emitQueue(sid) {
  emit({ type: 'session:queue', sid, queue: runtime(sid).queue });
}

// ---- Öffentliche API -------------------------------------------------------

export function enqueue(sid, text) {
  const r = runtime(sid);
  r.queue.push({ id: store.id(), text, paused: false });
  emitQueue(sid);
  pump(sid);
}

export function queueAction(sid, itemId, action) {
  const r = runtime(sid);
  const i = r.queue.findIndex(q => q.id === itemId);
  if (i < 0) return;
  if (action === 'remove') r.queue.splice(i, 1);
  if (action === 'pause') r.queue[i].paused = !r.queue[i].paused;
  if (action === 'up' && i > 0) [r.queue[i - 1], r.queue[i]] = [r.queue[i], r.queue[i - 1]];
  if (action === 'now') { const [it] = r.queue.splice(i, 1); it.paused = false; r.queue.unshift(it); }
  emitQueue(sid);
  pump(sid);
}

export async function interrupt(sid) {
  const r = runtime(sid);
  for (const [reqId, p] of r.pending) {
    p.resolve({ behavior: 'deny', message: 'Abgebrochen.', interrupt: true });
    r.pending.delete(reqId);
  }
  try { await r.query?.interrupt(); } catch { r.abort?.abort(); }
}

export function answerPermission(sid, reqId, decision, answers) {
  const r = runtime(sid);
  const p = r.pending.get(reqId);
  if (!p) return;
  r.pending.delete(reqId);
  if (decision === 'answer') p.resolve({ behavior: 'allow', updatedInput: { ...p.rawInput, answers: answers || {} } });
  else if (decision === 'deny') p.resolve({ behavior: 'deny', message: 'Der Mensch hat das abgelehnt. Frag nach, was stattdessen gewünscht ist.' });
  else p.resolve({ behavior: 'allow', updatedInput: p.rawInput, ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}) });
  record(sid, { type: 'permission', toolName: p.toolName, decision });
  emit({ type: 'perm:resolved', sid, reqId });
  if (!r.pending.size && r.status === 'waiting') setStatus(sid, 'running');
}

export function isBusy(sid) { return runtime(sid).status !== 'idle'; }

export function forget(sid) {
  interrupt(sid);
  rt.delete(sid);
}

// ---- Ablauf ------------------------------------------------------------------

function pump(sid) {
  const r = runtime(sid);
  if (r.status !== 'idle') return;
  const i = r.queue.findIndex(q => !q.paused);
  if (i < 0) return;
  const [item] = r.queue.splice(i, 1);
  emitQueue(sid);
  runTurn(sid, item.text).finally(() => pump(sid));
}

async function runTurn(sid, text) {
  const s = store.getSession(sid);
  const project = s && store.getProject(s.projectId);
  if (!s || !project) return;
  const r = runtime(sid);
  setStatus(sid, 'running');
  record(sid, { type: 'user', text });
  if (s.title === 'Neue Sitzung') {
    const wish = text.match(/Gewünschte Änderung: (.+)/);
    const t = wish ? 'Ändern: ' + wish[1] : text;
    store.updateSession(sid, { title: t.replace(/\s+/g, ' ').slice(0, 48) });
    emit({ type: 'session:updated', session: store.getSession(sid) });
  }

  const abort = new AbortController();
  r.abort = abort;
  const vaultEnv = envFor(project.id);
  const options = {
    cwd: project.path,
    model: s.model,
    effort: s.effort,
    permissionMode: s.permissionMode,
    allowDangerouslySkipPermissions: s.permissionMode === 'bypassPermissions',
    abortController: abort,
    includePartialMessages: true,
    env: { ...process.env, ...vaultEnv },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAddendum(project, s.role) + (s.parentId || MOCK ? '' : '\n\nDu kannst mit den Werkzeugen helfer_starten, helfer_status und helfer_nachricht parallele Helfer-Agenten im selben Projekt starten. Nutze das nur für wirklich unabhängige Teilaufgaben, die gleichzeitig laufen können, und achte darauf, dass Helfer nicht dieselben Dateien bearbeiten. Kleine Aufgaben erledigst du selbst.') },
    agents: TEAM,
    canUseTool: (toolName, input, { signal, suggestions }) => new Promise(resolve => {
      // Flints eigene Chef/Helfer-Werkzeuge brauchen keine Freigabe.
      if (toolName.startsWith('mcp__flint__')) return resolve({ behavior: 'allow', updatedInput: input });
      const reqId = store.id();
      const shown = clip(JSON.stringify(input, null, 2), 3000);
      const questions = toolName === 'AskUserQuestion' && Array.isArray(input?.questions) ? input.questions : undefined;
      r.pending.set(reqId, { resolve, toolName, input: shown, rawInput: input, suggestions, questions });
      setStatus(sid, 'waiting');
      emit({ type: 'perm:request', sid, reqId, toolName, input: shown, questions });
      signal?.addEventListener('abort', () => {
        if (r.pending.delete(reqId)) {
          resolve({ behavior: 'deny', message: 'Abgebrochen.' });
          emit({ type: 'perm:resolved', sid, reqId });
        }
      });
    }),
  };
  if (s.claudeSessionId) options.resume = s.claudeSessionId;
  if (!MOCK && !s.parentId) {
    try {
      options.mcpServers = { flint: await bossServer(s) };
    } catch (e) { console.warn('[flint] Helfer-Werkzeuge nicht verfügbar:', e.message); }
  }

  let streamed = '';
  try {
    const query = await getQuery();
    const q = query({ prompt: text, options });
    r.query = q;
    for await (const m of q) {
      if (m.session_id && m.session_id !== store.getSession(sid)?.claudeSessionId) {
        store.updateSession(sid, { claudeSessionId: m.session_id });
      }
      if (m.type === 'stream_event') {
        const ev = m.event;
        if (!m.parent_tool_use_id && ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          streamed += ev.delta.text;
          emit({ type: 'session:delta', sid, text: ev.delta.text });
        }
        continue;
      }
      if (m.type === 'assistant') {
        const sub = !!m.parent_tool_use_id;
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text.trim()) {
            record(sid, { type: 'text', text: b.text, sub });
            scanUrls(project.id, b.text);
          } else if (b.type === 'tool_use') {
            record(sid, { type: 'tool_use', id: b.id, name: b.name, input: clip(JSON.stringify(b.input, null, 2), 4000), sub });
          }
        }
        streamed = '';
        emit({ type: 'session:delta-reset', sid });
        if (m.error) record(sid, { type: 'error', message: `API-Fehler: ${m.error}` });
        continue;
      }
      if (m.type === 'user') {
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type !== 'tool_result') continue;
            const t = toolResultText(b.content);
            record(sid, { type: 'tool_result', toolUseId: b.tool_use_id, text: clip(t, 4000), isError: !!b.is_error, sub: !!m.parent_tool_use_id });
            scanUrls(project.id, t);
          }
        }
        continue;
      }
      if (m.type === 'result') {
        const u = m.usage || {};
        const cur = store.getSession(sid).usage || { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 };
        const usage = {
          costUsd: cur.costUsd + (m.total_cost_usd || 0),
          inputTokens: cur.inputTokens + (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          outputTokens: cur.outputTokens + (u.output_tokens || 0),
          turns: cur.turns + (m.num_turns || 0),
        };
        store.updateSession(sid, { usage });
        emit({ type: 'session:updated', session: store.getSession(sid) });
        const failed = m.subtype !== 'success' || m.is_error;
        record(sid, {
          type: 'result',
          isError: failed,
          message: failed ? (m.errors?.join('\n') || m.result || m.subtype) : null,
          costUsd: m.total_cost_usd || 0,
          durationMs: m.duration_ms,
          turns: m.num_turns,
        });
      }
    }
  } catch (e) {
    const msg = String(e?.message || e);
    record(sid, { type: 'error', message: abort.signal.aborted ? 'Abgebrochen.' : explainError(msg) });
  } finally {
    if (streamed) emit({ type: 'session:delta-reset', sid });
    r.query = null;
    r.abort = null;
    for (const [reqId, p] of r.pending) { p.resolve({ behavior: 'deny', message: 'Beendet.' }); emit({ type: 'perm:resolved', sid, reqId }); }
    r.pending.clear();
    setStatus(sid, 'idle');
  }
}

function explainError(msg) {
  if (/auth|login|api key|401|credential/i.test(msg)) {
    return `${msg}\n\nAnmeldung fehlt: Melde dich einmal im Terminal mit \`claude\` an (dein Claude-Abo) oder lege im Tresor einen ANTHROPIC_API_KEY an.`;
  }
  if (/ENOENT|spawn/i.test(msg)) {
    return `${msg}\n\nClaude Code konnte nicht gestartet werden. Prüfe die Installation (npm install) und ob der Projektordner existiert.`;
  }
  return msg;
}
