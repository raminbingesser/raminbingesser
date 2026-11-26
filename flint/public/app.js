import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  html, S, set, useStore, api, safe, toast, connect, onMessage, loadEvents, persist, rt,
  selectSession, selectProject, newSession, sessionsOf, project, notify, mod, isMac, restartFlint,
} from './core.js';
import { Icon } from './icons.js';
import { Chat } from './chat.js';
import { Work, openTerminal } from './work.js';
import { Modals } from './modals.js';

// =====================================================================
// Live-Ereignisse vom Server
// =====================================================================
onMessage((m) => {
  switch (m.type) {
    case 'session:status': {
      const prev = rt(m.sid).status;
      set({ runtime: { ...S.runtime, [m.sid]: { ...rt(m.sid), status: m.status } } });
      const s = S.sessions[m.sid];
      if (s && prev !== 'idle' && m.status === 'idle') notify(`Fertig: ${s.title}`, 'Claude ist mit dem Auftrag fertig.', m.sid);
      if (s && m.status === 'waiting') notify(`Freigabe nötig: ${s.title}`, 'Claude wartet auf deine Erlaubnis.', m.sid);
      break;
    }
    case 'session:event': {
      const list = S.events[m.sid];
      if (list) set({ events: { ...S.events, [m.sid]: [...list, m.event] } });
      if (m.event.type === 'text' || m.event.type === 'tool_use') set({ deltas: { ...S.deltas, [m.sid]: '' } });
      // Erfolgreiche Antwort nach einem Anmeldefehler: Status wieder auffrischen
      if (m.event.type === 'result' && !m.event.isError && S.claude && !S.claude.loggedIn) api('GET', '/claude/status').then(c => set({ claude: c })).catch(() => { });
      break;
    }
    case 'session:delta':
      set({ deltas: { ...S.deltas, [m.sid]: (S.deltas[m.sid] || '') + m.text } });
      break;
    case 'session:delta-reset':
      set({ deltas: { ...S.deltas, [m.sid]: '' } });
      break;
    case 'session:queue':
      set({ runtime: { ...S.runtime, [m.sid]: { ...rt(m.sid), queue: m.queue } } });
      break;
    case 'session:updated':
      set({ sessions: { ...S.sessions, [m.session.id]: m.session } });
      break;
    case 'session:removed': {
      const sessions = { ...S.sessions };
      delete sessions[m.sid];
      set({ sessions, activeSid: S.activeSid === m.sid ? null : S.activeSid });
      break;
    }
    case 'perm:request': {
      const r = rt(m.sid);
      set({ runtime: { ...S.runtime, [m.sid]: { ...r, pending: [...(r.pending || []).filter(p => p.reqId !== m.reqId), { reqId: m.reqId, toolName: m.toolName, input: m.input, questions: m.questions }] } } });
      break;
    }
    case 'perm:resolved': {
      const r = rt(m.sid);
      set({ runtime: { ...S.runtime, [m.sid]: { ...r, pending: (r.pending || []).filter(p => p.reqId !== m.reqId) } } });
      break;
    }
    case 'auth:expired':
      api('GET', '/claude/status').then(c => set({ claude: c })).catch(() => { });
      break;
    case 'project:added':
      if (!S.projects.find(p => p.id === m.project.id)) set({ projects: [...S.projects, m.project] });
      break;
    case 'project:removed': {
      const sessions = Object.fromEntries(Object.entries(S.sessions).filter(([, s]) => s.projectId !== m.projectId));
      const gone = S.activePid === m.projectId;
      set({ projects: S.projects.filter(p => p.id !== m.projectId), sessions, activePid: gone ? (S.projects.find(p => p.id !== m.projectId && !p.variantOf)?.id || null) : S.activePid, activeSid: gone ? null : S.activeSid });
      persist();
      break;
    }
  }
});

// =====================================================================
// Seitenleiste
// =====================================================================
function SessionRow({ s, child }) {
  const r = rt(s.id);
  const active = S.activeSid === s.id;
  const remove = async (e) => {
    e.stopPropagation();
    if (!confirm(`Sitzung „${s.title}“ löschen?`)) return;
    await safe(() => api('DELETE', `/sessions/${s.id}`));
  };
  const st = r.pending?.length ? 'waiting' : r.status;
  return html`<div class=${'sess' + (active ? ' active' : '') + (child ? ' child' : '')} onClick=${() => selectSession(s.id)} title=${s.title}>
    <span class=${'dot ' + st}></span>
    <span class="t">${s.title}</span>
    ${r.queue?.length > 0 && html`<span class="pill">${r.queue.length}</span>`}
    <button class="icon-btn x" title="Löschen" onClick=${remove}><${Icon} n="x" size="12" /></button>
  </div>`;
}

function ProjectBlock({ p }) {
  const open = S.expanded[p.id] !== false;
  const sess = sessionsOf(p.id);
  const roots = sess.filter(s => !s.parentId);
  const variants = S.projects.filter(v => v.variantOf === p.id);
  const active = S.activePid === p.id && !S.activeSid;
  const toggle = () => { set({ expanded: { ...S.expanded, [p.id]: !open } }); persist(); };
  const remove = async (e) => {
    e.stopPropagation();
    if (!confirm(`„${p.name}“ aus Flint entfernen? Die Dateien auf deinem Mac bleiben erhalten.`)) return;
    await safe(() => api('DELETE', `/projects/${p.id}`));
  };
  const busy = sess.some(s => rt(s.id).status !== 'idle');
  return html`<div class="proj">
    <div class=${'proj-head' + (S.activePid === p.id ? ' active' : '')} onClick=${() => { selectProject(p.id); if (!open) toggle(); }}>
      <span class=${'caret' + (open ? ' open' : '')} onClick=${(e) => { e.stopPropagation(); toggle(); }}>▶</span>
      ${p.variantOf ? html`<span class="badge" style="padding:1px 5px">V</span>` : null}
      <span class="name" title=${p.path}>${p.variantName || p.name}</span>
      ${busy && !open && html`<span class="dot running"></span>`}
      <span class="tools">
        <button class="icon-btn" title=${`Neue Sitzung (${mod}T)`} onClick=${(e) => { e.stopPropagation(); newSession(p.id); }}><${Icon} n="plus" size="13" /></button>
        ${p.variantOf
          ? html`<button class="icon-btn" title="Übernehmen oder verwerfen" onClick=${(e) => { e.stopPropagation(); set({ modal: { type: 'variant-actions', pid: p.id } }); }}><${Icon} n="check" size="13" /></button>`
          : html`<button class="icon-btn" title="Variante ausprobieren" onClick=${(e) => { e.stopPropagation(); selectProject(p.id); set({ modal: { type: 'variant' } }); }}><${Icon} n="git" size="13" /></button>
                 <button class="icon-btn" title="Aus Flint entfernen" onClick=${remove}><${Icon} n="x" size="13" /></button>`}
      </span>
    </div>
    ${open && html`<div>
      ${roots.map(s => html`<div key=${s.id}>
        <${SessionRow} s=${s} />
        ${sess.filter(c => c.parentId === s.id).map(c => html`<${SessionRow} key=${c.id} s=${c} child />`)}
      </div>`)}
      ${roots.length === 0 && html`<div class="sess muted" onClick=${() => newSession(p.id)}><span class="dot"></span><span class="t">+ Neue Sitzung</span></div>`}
      ${variants.length > 0 && html`<div style="margin-left:14px;border-left:1px dashed var(--line-2);padding-left:2px">
        ${variants.map(v => html`<${ProjectBlock} key=${v.id} p=${v} />`)}</div>`}
    </div>`}
  </div>`;
}

function Sidebar() {
  const roots = S.projects.filter(p => !p.variantOf);
  const running = Object.values(S.sessions).filter(s => rt(s.id).status !== 'idle').length;
  return html`<aside class="side">
    <div class="brand">
      <img src="/static/logo.svg" width="24" height="24" alt="" />
      Flint
      ${S.info?.mock && html`<span class="badge">Demo</span>`}
      <span class="spacer"></span>
      ${running > 0 && html`<span class="pill" title="Laufende Agenten"><span class="dot running" style="display:inline-block;margin-right:4px"></span>${running}</span>`}
      <button class="icon-btn" title=${`Seitenleiste ausblenden (${mod}B)`} onClick=${() => { set({ showSide: false }); persist(); }}><${Icon} n="side" /></button>
    </div>
    <div class="side-actions">
      <button class="btn primary block" onClick=${() => set({ modal: { type: 'new' } })}><${Icon} n="plus" /> Neues Projekt</button>
      <button class="btn block" onClick=${() => set({ modal: { type: 'open' } })}><${Icon} n="search" /> Projekt öffnen <span class="spacer"></span><span class="kbd" style="color:var(--muted)">${mod}O</span></button>
    </div>
    <div class="side-scroll">
      <div class="sect"><span>Projekte</span></div>
      ${roots.length === 0 && html`<div class="muted small" style="padding:4px 8px">Noch keine Projekte.</div>`}
      ${roots.map(p => html`<${ProjectBlock} key=${p.id} p=${p} />`)}
    </div>
    <div class="side-foot">
      <button class="btn ghost block" onClick=${() => set({ modal: { type: 'palette' } })}><${Icon} n="search" /> Suchen <span class="spacer"></span><span class="kbd">${mod}K</span></button>
      <button class="btn ghost block" onClick=${() => set({ modal: { type: 'mcp' } })}><${Icon} n="plug" /> MCP & Tools</button>
      <button class="btn ghost block" onClick=${() => set({ modal: { type: 'vault' } })}><${Icon} n="key" /> Tresor</button>
      <button class="btn ghost block" onClick=${() => set({ modal: { type: 'settings' } })}><${Icon} n="gear" /> Einstellungen
        <span class="spacer"></span>${S.claude && !S.claude.loggedIn && html`<span class="pill bad">Anmelden</span>`}</button>
    </div>
  </aside>`;
}

// =====================================================================
// Startseite (kein Projekt)
// =====================================================================
function Welcome() {
  const c = S.claude;
  return html`<div class="chat" style="grid-column:1/-1"><div class="welcome">
    <img src="/static/logo.svg" width="64" height="64" alt="" />
    <h1>Sag es. <em>Sieh es entstehen.</em></h1>
    <p class="lead">Flint baut mit Claude deine Dashboards, Tools und Webseiten. Du sprichst oder klickst auf das, was sich ändern soll, und siehst es live.</p>
    <div class="tiles">
      <button class="tile" onClick=${() => set({ modal: { type: 'new' } })}><div class="ti"><${Icon} n="chart" /></div><b>Neues Dashboard oder Tool</b><span>Vorlage wählen, beschreiben, zusehen.</span></button>
      <button class="tile" onClick=${() => set({ modal: { type: 'open' } })}><div class="ti"><${Icon} n="folder" /></div><b>Projekt öffnen</b><span>Einfach beschreiben, z. B. „umsatz dashboard“. Flint findet es.</span></button>
      <button class="tile" onClick=${() => set({ modal: { type: 'mcp' } })}><div class="ti"><${Icon} n="plug" /></div><b>Tools verbinden</b><span>Higgsfield, Playwright, Notion, Supabase …</span></button>
    </div>
    <div class="status-card">
      <span class=${'pill ' + (c?.loggedIn ? 'ok' : c ? 'bad' : '')}>${c ? (c.loggedIn ? 'Claude verbunden' : c.expired ? 'Claude-Anmeldung abgelaufen' : 'Claude nicht angemeldet') : 'prüfe…'}</span>
      <span class="small grow muted">${c?.loggedIn ? 'Flint nutzt dein Claude-Abo. Kein API-Key nötig.' : 'Einmal mit deinem Claude-Konto anmelden (Pro oder Max).'}</span>
      ${c && !c.loggedIn && html`<button class="btn sm primary" onClick=${() => set({ modal: { type: 'term', title: 'Bei Claude anmelden', preset: 'login' } })}>Anmelden</button>`}
    </div>
    <p class="hint" style="margin-top:18px"><span class="kbd">${mod}K</span> Suche · <span class="kbd">${mod}T</span> neue Sitzung · <span class="kbd">${mod}B</span> Seitenleiste · <span class="kbd">${mod}J</span> Arbeitsbereich</p>
  </div></div>`;
}

// =====================================================================
// Variantenleiste über dem Chat
// =====================================================================
function VariantBar() {
  const p = project();
  if (p?.mainPath) {
    // Geöffnet ist nur eine Git-Arbeitskopie (z. B. der Claude Desktop App), nicht das eigentliche Projekt.
    return html`<div class="suggest" style="border-bottom:1px solid var(--line);flex:none;background:rgba(250,176,5,.1)">
      <span class="pill warn">Arbeitskopie</span>
      <span class="grow small">Das ist eine Arbeitskopie (z. B. von der Claude Desktop App). Änderungen landen hier, nicht in deinem eigentlichen Projekt <span class="mono">${p.mainPath.replace(/^\/Users\/[^/]+/, '~')}</span>.</span>
      <button class="btn sm primary" onClick=${async () => {
        const { openProjectPath } = await import('./modals.js');
        await openProjectPath(p.mainPath, S.projects.find(x => x.path === p.mainPath)?.id);
      }}>Original öffnen</button>
    </div>`;
  }
  if (!p?.variantOf) return null;
  const parent = project(p.variantOf);
  return html`<div class="suggest" style="border-bottom:1px solid var(--line);flex:none">
    <span class="badge">Variante</span><span class="grow small">„${p.variantName}“ von <b>${parent?.name}</b>. Dein Hauptprojekt bleibt unberührt.</span>
    <button class="btn sm" onClick=${() => selectProject(p.variantOf)}>Zum Hauptprojekt</button>
    <button class="btn sm primary" onClick=${() => set({ modal: { type: 'variant-actions', pid: p.id } })}>Übernehmen / Verwerfen…</button>
  </div>`;
}

// =====================================================================
// App
// =====================================================================
function App() {
  useStore();
  const mainRef = useRef();
  const [drag, setDrag] = useState(false);

  // Theme
  useEffect(() => {
    const apply = () => {
      const dark = S.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : S.theme !== 'light';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [S.theme]);

  // Fenstertitel mit offenen Freigaben
  const waiting = Object.values(S.runtime).filter(r => r.pending?.length).length;
  const running = Object.values(S.runtime).filter(r => r.status === 'running').length;
  useEffect(() => { document.title = (waiting ? `(${waiting}) ` : running ? '● ' : '') + 'Flint'; }, [waiting, running]);

  // Ersteinrichtung beim ersten Start
  useEffect(() => {
    if (!S.ready) return;
    let done = false;
    try { done = localStorage.getItem('wb:setupDone') === '1'; } catch { }
    if (!done && !S.modal) set({ modal: { type: 'setup' } });
  }, [S.ready]);

  // Tastenkürzel
  useEffect(() => {
    const k = (e) => {
      const m = e.metaKey || e.ctrlKey;
      if (!m) return;
      const key = e.key.toLowerCase();
      if (key === 'k') { e.preventDefault(); set({ modal: S.modal?.type === 'palette' ? null : { type: 'palette' } }); }
      else if (key === 't' && S.activePid) { e.preventDefault(); newSession(); }
      else if (key === 'o') { e.preventDefault(); set({ modal: { type: 'open' } }); }
      else if (key === 'b') { e.preventDefault(); set({ showSide: !S.showSide }); persist(); }
      else if (key === 'j') { e.preventDefault(); set({ showWork: !S.showWork }); persist(); }
      else if (key === 'e' && S.activePid) {
        e.preventDefault();
        const { previewOf, setPreview } = window.__flintCore;
        set({ tab: 'preview', showWork: true }); persist();
        setPreview(S.activePid, { edit: !previewOf(S.activePid).edit });
      }
      else if (/^[1-9]$/.test(e.key) && S.activePid) {
        const list = sessionsOf(S.activePid);
        const s = list[Number(e.key) - 1];
        if (s) { e.preventDefault(); selectSession(s.id); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // Spaltenbreite ziehen
  const startDrag = (e) => {
    e.preventDefault();
    setDrag(true);
    const el = mainRef.current;
    const rect = el.getBoundingClientRect();
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:100;cursor:col-resize';
    document.body.appendChild(shield);
    const move = (ev) => {
      const pct = Math.min(75, Math.max(22, ((ev.clientX - rect.left) / rect.width) * 100));
      el.style.setProperty('--chat-w', pct + '%');
    };
    const up = () => {
      setDrag(false);
      shield.remove();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      try { localStorage.setItem('wb:chatW', el.style.getPropertyValue('--chat-w')); } catch { }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  useEffect(() => {
    try { const w = localStorage.getItem('wb:chatW'); if (w && mainRef.current) mainRef.current.style.setProperty('--chat-w', w); } catch { }
  }, [S.ready]);

  if (!S.ready) {
    return html`<div style="display:grid;place-items:center;height:100%"><div class="row muted"><span class="spin"></span> ${S.connected ? 'Lade…' : 'Verbinde mit Flint…'}</div></div>`;
  }

  const p = project();
  const showWork = S.showWork && p;
  const mainCls = 'main' + (!showWork ? ' no-work' : '') + (S.hideChat && showWork ? ' no-chat' : '');
  return html`<div class=${'shell' + (S.showSide ? '' : ' side-hidden')}>
    <${Sidebar} />
    ${p
      ? html`<div style="display:flex;flex-direction:column;min-width:0;min-height:0;height:100%">
          <${VariantBar} />
          <div class=${mainCls} ref=${mainRef} style="min-height:0;flex:1">
            <${Chat} />
            <div class=${'divider' + (drag ? ' drag' : '')} onMouseDown=${startDrag}></div>
            <${Work} />
          </div>
        </div>`
      : html`<div class="main no-work" ref=${mainRef}><${Welcome} /></div>`}
    ${!S.connected && html`<div class="toasts"><div class="toast err">Verbindung zu Flint unterbrochen. Läuft Flint noch? Ich verbinde neu…</div></div>`}
    ${S.stale && html`<div class="stale-bar"><${Icon} n="refresh" /> <span class="grow">${S.restarting ? 'Flint startet neu…' : 'Flint wurde aktualisiert, läuft aber noch in der alten Version.'}</span>
      ${!S.restarting && html`<button class="btn sm primary" onClick=${() => restartFlint()}>Jetzt neu starten</button>`}</div>`}
    <div class="toasts">${S.toasts.map(t => html`<div class=${'toast ' + t.kind} key=${t.id}>${t.text}</div>`)}</div>
    <${Modals} />
  </div>`;
}

import * as core from './core.js';
window.__flintCore = core;
render(html`<${App} />`, document.getElementById('app'));
connect();
