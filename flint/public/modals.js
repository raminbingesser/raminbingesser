import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import {
  html, S, set, api, safe, toast, project, selectSession, selectProject, newSession, sendPrompt, persist,
  MODELS, EFFORTS, PERMS, slug, setPreview, sessionsOf, mod, loadState,
} from './core.js';
import { Icon } from './icons.js';
import { TermView } from './work.js';

const close = () => set({ modal: null });

function Modal({ title, children, foot, wide, onClose = close }) {
  const box = useRef();
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    // autofocus greift bei nachträglich eingefügten Elementen nicht von selbst
    setTimeout(() => box.current?.querySelector('[autofocus]')?.focus(), 30);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'modal' + (wide ? ' wide' : '')} ref=${box}>
      <div class="modal-head">${title}<span class="spacer"></span><button class="icon-btn" onClick=${onClose}><${Icon} n="x" /></button></div>
      <div class="modal-body">${children}</div>
      ${foot && html`<div class="modal-foot">${foot}</div>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Neues Projekt aus Vorlage
// ---------------------------------------------------------------------------
const TEMPLATES = [
  {
    id: 'dashboard', icon: 'chart', title: 'Dashboard', d: 'Kennzahlen, Diagramme, Tabellen', file: 'dashboard/index.html',
    ph: 'z. B. Umsatz pro Monat, Top-10-Kunden, offene Rechnungen. Daten erstmal als Beispiel.',
    prompt: (d) => `Baue ein Dashboard in dashboard/index.html. Technik: eine einzelne HTML-Datei ohne Build-Schritt; Chart.js über ein CDN ist erlaubt. Aufbau: Kennzahlen-Kacheln oben, Diagramme darunter, Tabellen wenn sinnvoll. Klar, modern, Hell- und Dunkelmodus, auch auf dem Handy benutzbar. Wenn noch keine Daten da sind, nimm realistische Beispieldaten aus einer separaten Datei dashboard/data.js, damit wir sie später leicht ersetzen können.\n\nInhalt: ${d}\n\nLege danach in brain/ROADMAP.md sinnvolle nächste Schritte an.`,
  },
  {
    id: 'tool', icon: 'zap', title: 'Internes Tool', d: 'Rechner, Formular, Generator, Verwaltung', file: 'tool/index.html',
    ph: 'z. B. Angebotsrechner mit PDF-Export, oder eine Kundenliste mit Suche und Notizen.',
    prompt: (d) => `Baue ein internes Tool in tool/index.html. Technik: eine einzelne HTML-Datei ohne Build-Schritt, Daten bei Bedarf im localStorage. Bedienung einfach und schnell, klare Beschriftungen auf Deutsch.\n\nDas Tool soll: ${d}\n\nLege danach in brain/ROADMAP.md sinnvolle nächste Schritte an.`,
  },
  {
    id: 'website', icon: 'monitor', title: 'Webseite', d: 'Landingpage, Portfolio, Produktseite', file: 'index.html',
    ph: 'z. B. Landingpage für meinen Service mit Hero, Leistungen, Referenzen, Kontakt.',
    prompt: (d) => `Baue eine Webseite in index.html (mit style.css und script.js daneben, ohne Build-Schritt). Modern, schnell, responsiv, gute Typografie.\n\nInhalt: ${d}\n\nLege danach in brain/ROADMAP.md sinnvolle nächste Schritte an.`,
  },
  {
    id: 'app', icon: 'spark', title: 'App mit Framework', d: 'React/Vite, größere Projekte', file: null,
    ph: 'z. B. CRM mit Login, Supabase-Datenbank und mehreren Seiten.',
    prompt: (d) => `Richte ein neues Projekt mit Vite + React + TypeScript ein (npm), installiere die Abhängigkeiten und starte den Dev-Server im Hintergrund. Nenne mir am Ende die lokale Adresse, damit sie in der Vorschau erscheint.\n\nDie App soll: ${d}\n\nLege danach in brain/ROADMAP.md sinnvolle nächste Schritte an.`,
  },
  {
    id: 'empty', icon: 'folder', title: 'Leeres Projekt', d: 'Ordner + Brain, ohne Start-Auftrag', file: null, ph: '', prompt: null,
  },
];

function NewProject() {
  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const base = S.info?.defaultDir || '~/Flint';
  const dir = `${base}/${slug(name || tpl.title)}`;
  const create = async () => {
    if (!name.trim()) return toast('Gib dem Projekt einen Namen.', 'err');
    setBusy(true);
    const p = await safe(() => api('POST', '/projects', { dir, name: name.trim(), create: true }));
    setBusy(false);
    if (!p) return;
    set({ projects: S.projects.find(x => x.id === p.id) ? S.projects : [...S.projects, p] });
    selectProject(p.id);
    if (tpl.file) setPreview(p.id, { mode: 'file', file: tpl.file });
    set({ tab: 'preview', showWork: true }); persist();
    close();
    if (tpl.prompt) {
      const s = await newSession(p.id, { title: name.trim() });
      if (s) await sendPrompt(tpl.prompt(desc.trim() || 'Schlag mir etwas Sinnvolles vor und frag mich bei Unklarheiten.'), s.id);
    }
  };
  return html`<${Modal} title="Neues Projekt" wide foot=${html`
    <span class="hint grow mono" style="margin:0">${dir}</span>
    <button class="btn" onClick=${close}>Abbrechen</button>
    <button class="btn primary" disabled=${busy} onClick=${create}>${busy ? 'Lege an…' : tpl.prompt ? 'Anlegen & bauen lassen' : 'Anlegen'}</button>`}>
    <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      ${TEMPLATES.map(t => html`<button class="tile" style=${tpl.id === t.id ? 'border-color:var(--accent);background:var(--accent-soft)' : ''} onClick=${() => setTpl(t)}>
        <div class="ti"><${Icon} n=${t.icon} /></div><b>${t.title}</b><span>${t.d}</span></button>`)}
    </div>
    <label class="lbl">Name</label>
    <input class="field" autoFocus placeholder="z. B. Umsatz-Dashboard" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !tpl.prompt) create(); }} />
    ${tpl.prompt && html`<label class="lbl">Was soll es können / zeigen?</label>
      <textarea class="field" rows="4" placeholder=${tpl.ph} value=${desc} onInput=${(e) => setDesc(e.target.value)}></textarea>
      <div class="hint">Claude legt los, sobald das Projekt angelegt ist. Die Vorschau aktualisiert sich live.</div>`}
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Ordner öffnen
// ---------------------------------------------------------------------------
function OpenFolder() {
  const [cur, setCur] = useState(null);
  const [path, setPath] = useState('');
  const [newName, setNewName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const clone = async () => {
    setCloning(true);
    const p = await safe(() => api('POST', '/clone', { url: gitUrl.trim() }));
    setCloning(false);
    if (!p) return;
    set({ projects: S.projects.find(x => x.id === p.id) ? S.projects : [...S.projects, p] });
    selectProject(p.id);
    close();
    toast(`${p.name} geladen`);
  };
  const load = async (p) => {
    const r = await safe(() => api('GET', '/browse?path=' + encodeURIComponent(p || '')));
    if (r) { setCur(r); setPath(r.dir); }
  };
  useEffect(() => { load(''); }, []);
  const open = async (dir, create = false) => {
    const p = await safe(() => api('POST', '/projects', { dir, create }));
    if (!p) return;
    set({ projects: S.projects.find(x => x.id === p.id) ? S.projects : [...S.projects, p] });
    selectProject(p.id);
    close();
    toast(`${p.name} geöffnet`);
  };
  const [tab, setTab] = useState('find');
  return html`<${Modal} title="Projekt öffnen" wide foot=${tab === 'browse' ? html`
    <button class="btn" onClick=${close}>Abbrechen</button>
    <button class="btn primary" disabled=${!cur} onClick=${() => open(cur.dir)}>Diesen Ordner öffnen</button>` : null}>
    <div class="row" style="gap:4px;margin-bottom:12px">
      ${[['find', 'Beschreiben', 'search'], ['browse', 'Ordner wählen', 'folder'], ['git', 'Aus GitHub', 'git']].map(([k, l, i]) =>
        html`<button class=${'btn sm' + (tab === k ? ' on' : '')} onClick=${() => setTab(k)}><${Icon} n=${i} /> ${l}</button>`)}
    </div>
    ${tab === 'find' && html`<${FindProject} onOpen=${open} />`}
    ${tab === 'git' && html`
      <div class="row">
        <input class="field mono grow" autofocus placeholder="https://github.com/name/repo" value=${gitUrl} onInput=${(e) => setGitUrl(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && gitUrl.trim()) clone(); }} />
        <button class="btn primary" disabled=${!gitUrl.trim() || cloning} onClick=${clone}>${cloning ? 'Lade…' : 'Laden'}</button>
      </div>
      <div class="hint">Landet in <span class="mono">${S.info?.defaultDir}/…</span>. Private Repos funktionieren mit deinem Git-Login auf dem Mac.</div>`}
    ${tab === 'browse' && html`
    <div class="row"><input class="field mono" value=${path} onInput=${(e) => setPath(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') load(path); }} />
      <button class="btn" onClick=${() => load(path)}>Gehe zu</button></div>
    <div class="hint">Jeder Ordner auf deinem Mac kann ein Projekt sein, auch einer, an dem du in der Claude Desktop App arbeitest.</div>
    <div class="list" style="margin-top:10px;max-height:320px;overflow:auto">
      ${cur && cur.parent !== cur.dir && html`<div class="list-item click" onClick=${() => load(cur.parent)}><span class="muted">↑</span> ..</div>`}
      ${cur?.entries.map(n => html`<div class="list-item click" key=${n} onClick=${() => load(cur.dir + '/' + n)}><${Icon} n="folder" size="14" /> ${n}</div>`)}
      ${cur && !cur.entries.length && html`<div class="list-item muted">Keine Unterordner</div>`}
    </div>
    <div class="row" style="margin-top:10px">
      <input class="field" placeholder="Neuer Ordner hier…" value=${newName} onInput=${(e) => setNewName(e.target.value)} />
      <button class="btn" disabled=${!newName.trim()} onClick=${() => open(cur.dir + '/' + newName.trim(), true)}>Anlegen & öffnen</button>
    </div>`}
  </${Modal}>`;
}

// Projekt per Beschreibung finden
export function relTime(t) {
  if (!t) return '';
  const d = (Date.now() - t) / 1000;
  if (d < 3600) return 'gerade eben';
  if (d < 86400) return `vor ${Math.round(d / 3600)} Std.`;
  if (d < 86400 * 2) return 'gestern';
  if (d < 86400 * 30) return `vor ${Math.round(d / 86400)} Tagen`;
  if (d < 86400 * 365) return `vor ${Math.round(d / 86400 / 30)} Mon.`;
  return `vor ${Math.round(d / 86400 / 365)} J.`;
}

export async function openProjectPath(dir, existingId) {
  if (existingId && S.projects.find(x => x.id === existingId)) {
    selectProject(existingId); close(); return;
  }
  const p = await safe(() => api('POST', '/projects', { dir }));
  if (!p) return;
  set({ projects: S.projects.find(x => x.id === p.id) ? S.projects : [...S.projects, p] });
  selectProject(p.id);
  close();
  toast(`${p.name} geöffnet`);
}

function FindProject() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const [ai, setAi] = useState(false);
  const [aiTried, setAiTried] = useState(false);
  const inp = useRef();
  const seq = useRef(0);
  useEffect(() => { setTimeout(() => inp.current?.focus(), 40); }, []);
  useEffect(() => {
    const n = ++seq.current;
    setAiTried(false);
    const t = setTimeout(() => {
      api('GET', '/find?q=' + encodeURIComponent(q)).then(r => { if (n === seq.current) { setRes(r); setSel(0); } }).catch(() => setRes([]));
    }, q ? 160 : 0);
    return () => clearTimeout(t);
  }, [q]);
  const askClaude = async () => {
    if (!q.trim()) return;
    setAi(true);
    const r = await safe(() => api('POST', '/find/ai', { q }));
    setAi(false); setAiTried(true);
    if (r) { setRes(r); setSel(0); if (!r.length) toast('Claude hat nichts Passendes gefunden.', 'err'); }
  };
  const list = res || [];
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (list[sel] && (!q || list[sel].score > 0)) openProjectPath(list[sel].path, list[sel].open);
      else askClaude();
    }
  };
  return html`<div>
    <div class="row">
      <input ref=${inp} class="field" style="font-size:15px;padding:10px 12px" placeholder="Welches Projekt? z. B. „umsatz dashboard“ oder „das Tool für die Rechnungen“"
        value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${key} />
      <button class="btn" title="Claude sucht anhand deiner Beschreibung" disabled=${!q.trim() || ai} onClick=${askClaude}>${ai ? html`<span class="spin"></span>` : html`<${Icon} n="spark" />`} Claude fragen</button>
    </div>
    <div class="hint">${q ? 'Enter öffnet den ersten Treffer. Nichts dabei? „Claude fragen“ versteht auch vage Beschreibungen.' : 'Zuletzt benutzt: Ordner aus Claude Code (Terminal & Desktop App), Flint und deinen Projektordnern.'}</div>
    <div class="list" style="margin-top:10px;max-height:380px;overflow:auto">
      ${res === null && html`<div class="list-item"><span class="spin"></span> Suche Projekte auf deinem Mac…</div>`}
      ${res && !list.length && html`<div class="list-item muted">${q ? (aiTried ? 'Nichts gefunden. Versuch es mit anderen Worten oder wähle den Ordner direkt.' : 'Kein direkter Treffer. Drück Enter oder „Claude fragen“.') : 'Keine Projekte gefunden. Wähle den Ordner direkt.'}</div>`}
      ${list.map((p, i) => html`<div key=${p.path} class=${'list-item click' + (i === sel ? ' sel' : '')} style=${i === sel ? 'background:var(--panel-2)' : ''}
          onMouseEnter=${() => setSel(i)} onClick=${() => openProjectPath(p.path, p.open)}>
        <${Icon} n=${p.kinds.includes('iOS/Swift') ? 'phone' : 'folder'} size="16" />
        <div class="grow" style="min-width:0">
          <div class="row" style="gap:6px"><b>${p.name}</b>${p.ai && html`<span class="pill warn">Claude</span>`}${p.open && html`<span class="pill ok">in Flint</span>`}
            ${p.kinds.map(k => html`<span class="pill">${k}</span>`)}<span class="spacer"></span><span class="muted small">${relTime(p.lastUsed)}</span></div>
          ${p.description && html`<div class="small" style="color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.description}</div>`}
          <div class="mono muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.short}</div>
        </div>
      </div>`)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// MCP & Tools
// ---------------------------------------------------------------------------
const MCP_PRESETS = [
  { name: 'playwright', label: 'Playwright (Browser)', transport: 'stdio', target: 'npx -y @playwright/mcp@latest', d: 'Claude öffnet deine Seite selbst im Browser, klickt, prüft und macht Screenshots.' },
  { name: 'higgsfield', label: 'Higgsfield', transport: 'http', target: '', d: 'Bilder und Videos erzeugen. Die MCP-Adresse findest du in deinem Higgsfield-Konto.' },
  { name: 'notion', label: 'Notion', transport: 'http', target: 'https://mcp.notion.com/mcp', d: 'Seiten und Datenbanken lesen und schreiben. Anmeldung per Browser.' },
  { name: 'supabase', label: 'Supabase', transport: 'http', target: 'https://mcp.supabase.com/mcp', d: 'Datenbank, Tabellen, SQL für deine Tools. Anmeldung per Browser.' },
  { name: 'sentry', label: 'Sentry', transport: 'http', target: 'https://mcp.sentry.dev/mcp', d: 'Fehlerberichte deiner Apps.' },
];

function Mcp() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ name: '', transport: 'http', target: '', header: '', scope: 'user' });
  const [busy, setBusy] = useState(false);
  const pid = S.activePid;
  const load = () => { setList(null); api('GET', '/mcp' + (pid ? `?pid=${pid}` : '')).then(setList).catch(e => { setErr(e.message); setList([]); }); };
  useEffect(load, []);
  const add = async () => {
    setBusy(true);
    const ok = await safe(() => api('POST', '/mcp' + (pid ? `?pid=${pid}` : ''), {
      name: form.name.trim(), transport: form.transport, target: form.target.trim(), scope: form.scope,
      headers: form.header ? [form.header.trim()] : [],
    }), `${form.name} verbunden`);
    setBusy(false);
    if (ok !== undefined) { setForm({ name: '', transport: 'http', target: '', header: '', scope: 'user' }); load(); }
  };
  const remove = async (name) => {
    if (!confirm(`${name} entfernen?`)) return;
    await safe(() => api('DELETE', `/mcp/${encodeURIComponent(name)}` + (pid ? `?pid=${pid}` : '')), 'Entfernt');
    load();
  };
  const login = (name) => set({ modal: { type: 'term', title: `Anmelden bei ${name}`, preset: 'mcp-login', name, after: 'mcp' } });
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return html`<${Modal} title="MCP & Tools" wide>
    <p class="muted small" style="margin-top:0">Alles, was du hier verbindest, steht allen Agenten in Flint zur Verfügung, und auch Claude Code im Terminal und in der Desktop App (gleiche Einstellungen).</p>
    <div class="list">
      ${list === null && html`<div class="list-item"><span class="spin"></span> Prüfe Verbindungen…</div>`}
      ${list?.length === 0 && html`<div class="list-item muted">${err || 'Noch keine MCP-Server verbunden.'}</div>`}
      ${list?.map(m => html`<div class="list-item" key=${m.name}>
        <b>${m.name}</b><span class="mono muted small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.target}</span>
        <span class=${'pill ' + (m.ok ? 'ok' : m.needsAuth ? 'warn' : 'bad')}>${m.ok ? 'verbunden' : m.needsAuth ? 'Anmeldung nötig' : 'Fehler'}</span>
        ${!m.ok && html`<button class="btn sm" onClick=${() => login(m.name)}>Anmelden</button>`}
        <button class="icon-btn" title="Entfernen" onClick=${() => remove(m.name)}><${Icon} n="trash" /></button></div>`)}
    </div>
    <label class="lbl" style="margin-top:16px">Vorlagen</label>
    <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${MCP_PRESETS.map(p => html`<button class="tile" style="padding:10px" onClick=${() => setForm({ name: p.name, transport: p.transport, target: p.target, header: '', scope: 'user' })} title=${p.d}>
        <b style="margin:0 0 2px">${p.label}</b><span>${p.d}</span></button>`)}
    </div>
    <label class="lbl" style="margin-top:16px">Neuen Server verbinden</label>
    <div class="row">
      <input class="field" style="max-width:160px" placeholder="Name" value=${form.name} onInput=${f('name')} />
      <select class="field" style="max-width:130px" value=${form.transport} onChange=${f('transport')}>
        <option value="http">HTTP (URL)</option><option value="sse">SSE (URL)</option><option value="stdio">Programm</option>
      </select>
      <input class="field grow mono" placeholder=${form.transport === 'stdio' ? 'npx -y paket-name' : 'https://…/mcp'} value=${form.target} onInput=${f('target')} />
    </div>
    <div class="row" style="margin-top:8px">
      ${form.transport !== 'stdio' && html`<input class="field grow mono" placeholder="Optionaler Header, z. B. Authorization: Bearer …" value=${form.header} onInput=${f('header')} />`}
      <select class="field" style="max-width:210px" value=${form.scope} onChange=${f('scope')}>
        <option value="user">Für alle Projekte</option>
        <option value="project" disabled=${!pid}>Nur dieses Projekt (.mcp.json)</option>
        <option value="local" disabled=${!pid}>Nur dieses Projekt, privat</option>
      </select>
      <button class="btn primary" disabled=${busy || !form.name || !form.target} onClick=${add}>${busy ? 'Verbinde…' : 'Verbinden'}</button>
    </div>
    <div class="hint">Viele Dienste (z. B. Higgsfield, Notion) melden sich per Browser an: nach dem Verbinden auf „Anmelden“ klicken. Neue Server nutzen die Agenten ab ihrer nächsten Nachricht.</div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Terminal-Dialog (Anmeldungen)
// ---------------------------------------------------------------------------
function TermModal({ title, preset, name, after }) {
  const [tid, setTid] = useState(null);
  useEffect(() => {
    api('POST', '/terminals/global', { preset, name }).then(t => setTid(t.id)).catch(e => toast(e.message, 'err'));
    return () => { };
  }, []);
  const done = async () => {
    if (tid) api('DELETE', `/terminals/${tid}`).catch(() => { });
    const st = await api('GET', '/claude/status').catch(() => null);
    if (st) set({ claude: st });
    set({ modal: after ? { type: after } : null });
  };
  return html`<${Modal} title=${title} wide onClose=${done} foot=${html`<span class="hint grow" style="margin:0">Folge den Schritten im Terminal. Ein Browserfenster öffnet sich zur Anmeldung.</span><button class="btn primary" onClick=${done}>Fertig</button>`}>
    <div style="height:340px;position:relative;background:#0b0b0c;border-radius:8px;overflow:hidden">
      ${tid ? html`<${TermView} termId=${tid} active=${true} />` : html`<div class="empty"><span class="spin"></span></div>`}
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Tresor
// ---------------------------------------------------------------------------
function Vault() {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [onlyHere, setOnlyHere] = useState(false);
  const load = () => api('GET', '/vault').then(setList).catch(() => { });
  useEffect(() => { load(); }, []);
  const add = async () => {
    const ok = await safe(() => api('POST', '/vault', { name: name.trim().toUpperCase(), value, projects: onlyHere && S.activePid ? [S.activePid] : null }), 'Gespeichert');
    if (ok !== undefined) { setName(''); setValue(''); load(); }
  };
  return html`<${Modal} title="Schlüsseltresor">
    <p class="muted small" style="margin-top:0">API-Keys liegen verschlüsselt auf deinem Mac und werden nur als Umgebungsvariablen an Agenten und Terminals gegeben, nie in Dateien geschrieben. Sag Claude einfach z. B. „nutze STRIPE_KEY“.</p>
    <div class="list">
      ${list.length === 0 && html`<div class="list-item muted">Noch keine Schlüssel.</div>`}
      ${list.map(s => html`<div class="list-item" key=${s.name}><${Icon} n="key" size="14" /><b class="mono grow">${s.name}</b>
        <span class="muted small">${s.projects ? (s.projects.map(id => S.projects.find(p => p.id === id)?.name || '?').join(', ')) : 'alle Projekte'}</span>
        <span class="mono muted">••••••••</span>
        <button class="icon-btn" onClick=${async () => { if (confirm(`${s.name} löschen?`)) { await safe(() => api('DELETE', `/vault/${s.name}`)); load(); } }}><${Icon} n="trash" /></button></div>`)}
    </div>
    <label class="lbl" style="margin-top:14px">Neuer Schlüssel</label>
    <div class="row">
      <input class="field mono" style="max-width:200px" placeholder="NAME_DES_KEYS" value=${name} onInput=${(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} />
      <input class="field mono grow" type="password" placeholder="Wert" value=${value} onInput=${(e) => setValue(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} />
      <button class="btn primary" disabled=${!name || !value} onClick=${add}>Speichern</button>
    </div>
    ${S.activePid && html`<label class="row small muted" style="margin-top:8px"><input type="checkbox" checked=${onlyHere} onChange=${(e) => setOnlyHere(e.target.checked)} /> Nur für „${project()?.name}“</label>`}
    <div class="hint">Tipp: Ein ANTHROPIC_API_KEY hier würde dein Abo umgehen und über die API abrechnen. Für die Nutzung mit Abo nicht nötig.</div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
function Settings({ section }) {
  const st = S.settings;
  const [prompts, setPrompts] = useState(st.prompts || []);
  const [dirty, setDirty] = useState(false);
  const save = async (patch) => {
    const r = await safe(() => api('PUT', '/settings', patch));
    if (r) set({ settings: r });
  };
  const promptsRef = useRef();
  useEffect(() => { if (section === 'prompts') promptsRef.current?.scrollIntoView(); }, []);
  const c = S.claude;
  return html`<${Modal} title="Einstellungen" wide>
    <label class="lbl">Claude</label>
    <div class="list"><div class="list-item">
      <span class=${'pill ' + (c?.loggedIn ? 'ok' : 'bad')}>${c ? (c.loggedIn ? 'angemeldet' : c.expired ? 'Anmeldung abgelaufen' : 'nicht angemeldet') : '…'}</span>
      <span class="small grow">${c?.loggedIn ? (c.method === 'claude.ai' || /oauth/i.test(c.method || '') ? 'Mit deinem Claude-Abo' : `Methode: ${c.method}`) : 'Melde dich mit deinem Claude-Konto an (Pro/Max).'}</span>
      <button class="btn sm" onClick=${() => set({ modal: { type: 'term', title: 'Bei Claude anmelden', preset: 'login', after: 'settings' } })}>${c?.loggedIn ? 'Konto wechseln' : 'Anmelden'}</button>
    </div>
    <div class="list-item"><span class="muted small">Programm</span><span class="mono small grow" style="overflow:hidden;text-overflow:ellipsis">${c?.bin || '…'}</span></div></div>

    <label class="lbl">Standard für neue Sitzungen</label>
    <div class="row">
      <select class="field" value=${st.defaultModel} onChange=${(e) => save({ defaultModel: e.target.value })}>${MODELS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <select class="field" value=${st.defaultEffort} onChange=${(e) => save({ defaultEffort: e.target.value })}>${EFFORTS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <select class="field" value=${st.defaultPermission} onChange=${(e) => save({ defaultPermission: e.target.value })}>${PERMS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
    </div>
    <div class="hint">Opus 5.5 ist am stärksten. Sonnet 5.5 ist schneller und schont dein Kontingent. Haiku 5.5 für Kleinigkeiten. „Dateien automatisch“ heißt: Claude darf Dateien ändern, fragt aber vor Befehlen.</div>

    <label class="lbl">Darstellung</label>
    <div class="row">
      ${[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'System']].map(([v, l]) => html`<button class=${'btn sm' + (S.theme === v ? ' on' : '')} onClick=${() => { set({ theme: v }); persist(); }}>${l}</button>`)}
      <span class="spacer"></span>
      <label class="row small"><input type="checkbox" checked=${st.notifications !== false} onChange=${(e) => { save({ notifications: e.target.checked }); if (e.target.checked && 'Notification' in window) Notification.requestPermission(); }} /> Benachrichtigen, wenn ein Agent fertig ist oder fragt</label>
    </div>

    <div ref=${promptsRef}></div>
    <label class="lbl" style="margin-top:16px">Eigene Vorlagen <span class="muted">(im Chat über + oder /)</span></label>
    <div style="display:grid;gap:8px">
      ${prompts.map((p, i) => html`<div class="card" key=${i}><div class="card-body" style="display:grid;gap:6px;padding:8px">
        <div class="row"><input class="field" value=${p.title} onInput=${(e) => { const n = [...prompts]; n[i] = { ...p, title: e.target.value }; setPrompts(n); setDirty(true); }} />
          <button class="icon-btn" onClick=${() => { setPrompts(prompts.filter((_, j) => j !== i)); setDirty(true); }}><${Icon} n="trash" /></button></div>
        <textarea class="field" rows="2" value=${p.text} onInput=${(e) => { const n = [...prompts]; n[i] = { ...p, text: e.target.value }; setPrompts(n); setDirty(true); }}></textarea>
      </div></div>`)}
      <div class="row">
        <button class="btn sm" onClick=${() => { setPrompts([...prompts, { title: 'Neue Vorlage', text: '' }]); setDirty(true); }}><${Icon} n="plus" /> Vorlage</button>
        <span class="spacer"></span>
        <button class="btn sm primary" disabled=${!dirty} onClick=${async () => { await save({ prompts }); setDirty(false); toast('Vorlagen gespeichert'); }}>Vorlagen speichern</button>
      </div>
    </div>

    <label class="lbl" style="margin-top:16px">Flint</label>
    <div class="row">
      <button class="btn sm" onClick=${() => set({ modal: { type: 'update' } })}><${Icon} n="refresh" /> Nach Updates suchen</button>
      <button class="btn sm" onClick=${async () => { if (!confirm('Flint beenden? Laufende Agenten werden gestoppt.')) return; await api('POST', '/shutdown').catch(() => { }); document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-family:system-ui;color:#888">Flint wurde beendet. Du kannst dieses Fenster schließen.</div>'; }}>Flint beenden</button>
      <span class="hint" style="margin:0">Daten: <span class="mono">~/.flint</span> · Projekte standardmäßig in <span class="mono">${S.info?.defaultDir}</span></span>
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function Update() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', '/update').then(setSt).catch(e => setSt({ error: e.message })); }, []);
  const run = async () => {
    setBusy(true);
    const r = await safe(() => api('POST', '/update'));
    setBusy(false);
    if (r) { setSt({ ...st, done: true, log: r.log }); }
  };
  return html`<${Modal} title="Flint aktualisieren">
    ${!st && html`<div class="row"><span class="spin"></span> Prüfe…</div>`}
    ${st?.error && html`<div class="err-box">${st.error}</div>`}
    ${st && !st.error && !st.done && html`<p>${st.behind > 0 ? html`Es gibt <b>${st.behind}</b> neue Änderung(en).` : 'Flint ist aktuell.'}</p>
      <p class="muted small mono">${st.branch} · ${st.current}</p>`}
    ${st?.done && html`<p>${st.restarting ? 'Flint startet neu… die Seite lädt gleich von selbst.' : 'Aktualisiert. Jetzt neu starten, damit die neue Version läuft.'}</p><pre class="diff">${st.log}</pre>`}
    <div class="modal-foot" style="padding:10px 0 0">
      <button class="btn" onClick=${close}>Schließen</button>
      ${st?.done && !st.restarting && html`<button class="btn primary" onClick=${() => { setSt({ ...st, restarting: true }); api('POST', '/restart').catch(() => { }); }}><${Icon} n="refresh" /> Jetzt neu starten</button>`}
      ${st && !st.error && !st.done && st.behind > 0 && html`<button class="btn primary" disabled=${busy} onClick=${run}>${busy ? 'Lade…' : 'Jetzt aktualisieren'}</button>`}
      ${st && !st.error && !st.done && !(st.behind > 0) && html`<button class="btn" onClick=${() => { setSt({ ...st, done: true, restarting: true, log: '' }); api('POST', '/restart').catch(() => { }); }}><${Icon} n="refresh" /> Flint neu starten</button>`}
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Befehlspalette
// ---------------------------------------------------------------------------
function Palette() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [onMac, setOnMac] = useState([]);
  // Projekte auf dem Mac, die noch nicht in Flint sind
  useEffect(() => {
    if (q.trim().length < 2) { setOnMac([]); return; }
    const t = setTimeout(() => api('GET', '/find?q=' + encodeURIComponent(q)).then(r => setOnMac(r.filter(p => !p.open).slice(0, 6))).catch(() => { }), 180);
    return () => clearTimeout(t);
  }, [q]);
  const items = useMemo(() => {
    const acts = [
      { label: 'Neues Projekt', d: 'Dashboard, Tool, Webseite…', run: () => set({ modal: { type: 'new' } }) },
      { label: 'Projekt öffnen', d: 'Beschreiben, Ordner wählen oder aus GitHub', k: `${mod}O`, run: () => set({ modal: { type: 'open' } }) },
      S.activePid && { label: 'Neue Sitzung', d: project()?.name, k: `${mod}T`, run: () => { close(); newSession(); } },
      S.activePid && { label: 'Claude im Terminal', d: 'Claude Code direkt', run: async () => { close(); const { openTerminal } = await import('./work.js'); openTerminal(S.activePid, 'claude', { title: 'Claude Code' }); } },
      { label: 'MCP & Tools', d: 'Higgsfield, Playwright, Notion…', run: () => set({ modal: { type: 'mcp' } }) },
      { label: 'Schlüsseltresor', d: 'API-Keys', run: () => set({ modal: { type: 'vault' } }) },
      { label: 'Einstellungen', d: 'Modell, Vorlagen, Anmeldung', run: () => set({ modal: { type: 'settings' } }) },
      { label: 'Hell/Dunkel umschalten', d: '', run: () => { set({ theme: S.theme === 'light' ? 'dark' : 'light', modal: null }); persist(); } },
      ...['preview', 'terminal', 'files', 'brain', 'git'].map((t, n) => ({ label: 'Zeige ' + ['Vorschau', 'Terminal', 'Dateien', 'Brain', 'Versionen'][n], d: '', run: () => { set({ tab: t, showWork: true, modal: null }); persist(); } })),
    ].filter(Boolean).map(a => ({ ...a, sect: 'Aktionen' }));
    const sess = Object.values(S.sessions).sort((a, b) => b.createdAt - a.createdAt).map(s => ({
      sect: 'Sitzungen', label: s.title, d: S.projects.find(p => p.id === s.projectId)?.name, run: () => { close(); selectSession(s.id); },
    }));
    const projs = S.projects.map(p => ({ sect: 'Projekte', label: p.name, d: p.path, run: () => { close(); selectProject(p.id); } }));
    const f = q.toLowerCase().trim();
    const mac = onMac.map(p => ({ sect: 'Auf deinem Mac', label: p.name, d: p.description || p.short, run: () => openProjectPath(p.path, p.open) }));
    const match = (x) => !f || (x.label + ' ' + (x.d || '')).toLowerCase().includes(f);
    // Bei einer Suche zuerst Projekte, dann Sitzungen, dann Aktionen
    return f ? [...projs.filter(match), ...mac, ...sess.filter(match), ...acts.filter(match)] : [...acts, ...sess, ...projs];
  }, [q, onMac]);
  useEffect(() => setI(0), [q]);
  const input = useRef();
  useEffect(() => {
    setTimeout(() => input.current?.focus(), 20);
    const k = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); items[i]?.run(); }
  };
  let last = '';
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal palette">
      <input ref=${input} placeholder="Suche Sitzungen, Projekte, Aktionen…" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${key} />
      <div class="items">
        ${items.length === 0 && html`<div class="menu-item muted">Nichts gefunden</div>`}
        ${items.slice(0, 60).map((it, n) => {
          const head = it.sect !== last ? html`<div class="menu-sect">${it.sect}</div>` : null;
          last = it.sect;
          return html`${head}<div class=${'menu-item' + (n === i ? ' sel' : '')} onMouseEnter=${() => setI(n)} onClick=${it.run}>
            <span class="grow">${it.label} ${it.d && html`<span class="d">· ${it.d}</span>`}</span>${it.k && html`<span class="kbd">${it.k}</span>`}</div>`;
        })}
      </div>
      <div class="row small muted" style="padding:8px 14px;border-top:1px solid var(--line)"><span class="kbd">↑↓</span> wählen <span class="kbd">↵</span> öffnen <span class="kbd">esc</span> schließen</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Ersteinrichtung
// ---------------------------------------------------------------------------
function Setup() {
  const [st, setSt] = useState(null);
  const load = () => api('GET', '/doctor').then(setSt).catch(e => setSt({ error: e.message }));
  useEffect(() => { load(); }, []);
  const row = (ok, title, desc, action) => html`<div class="list-item">
    <span class=${ok ? 'st-ok' : 'st-err'} style="width:16px">${ok ? '✓' : '✕'}</span>
    <div class="grow"><div>${title}</div><div class="muted small">${desc}</div></div>${!ok && action}</div>`;
  const finish = () => { try { localStorage.setItem('wb:setupDone', '1'); } catch { } close(); };
  return html`<${Modal} title="Willkommen bei Flint" wide onClose=${finish} foot=${html`<button class="btn" onClick=${load}>Erneut prüfen</button><button class="btn primary" onClick=${finish}>Los geht's</button>`}>
    <p class="muted" style="margin-top:0">Flint ist deine Werkstatt zum Bauen mit Claude: links sprichst du mit Claude, rechts siehst du live, was entsteht. Kurzer Check, ob alles bereit ist:</p>
    ${!st && html`<div class="row"><span class="spin"></span> Prüfe…</div>`}
    ${st?.error && html`<div class="err-box">${st.error}</div>`}
    ${st && !st.error && html`<div class="list">
      ${row(st.claude.loggedIn, 'Claude-Anmeldung', st.claude.loggedIn ? 'Angemeldet. Flint nutzt dein Claude-Abo, kein API-Key nötig.' : 'Einmal mit deinem Claude-Konto (Pro/Max) anmelden.',
        html`<button class="btn sm primary" onClick=${() => set({ modal: { type: 'term', title: 'Bei Claude anmelden', preset: 'login', after: 'setup' } })}>Anmelden</button>`)}
      ${row(st.git, 'Git (für Versionen)', st.git ? 'Installiert.' : 'Fehlt. Auf dem Mac im Terminal: xcode-select --install', null)}
      ${row(st.terminal, 'Terminal', st.terminal ? 'Bereit.' : 'node-pty fehlt. Im Flint-Ordner npm install ausführen.', null)}
      ${row(st.node, `Node.js ${st.nodeVersion}`, st.node ? 'Passt.' : 'Bitte Node 20 oder neuer installieren.', null)}
    </div>
    <p class="hint">Tipps: ${mod}K öffnet die Suche, ${mod}T eine neue Sitzung. Mikrofon-Knopf im Chat = Spracheingabe. Mit „✎ Ändern“ in der Vorschau klickst du auf ein Element und sagst, was sich ändern soll.</p>`}
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Varianten
// ---------------------------------------------------------------------------
function NewVariant() {
  const p = project();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const vs = await safe(() => api('POST', `/projects/${p.id}/variants`, { name: name.trim() || 'Variante', count, prompt: prompt.trim() }));
    setBusy(false);
    if (!vs) return;
    const known = new Set(S.projects.map(x => x.id));
    set({ projects: [...S.projects, ...vs.filter(v => !known.has(v.id))], expanded: { ...S.expanded, [p.id]: true } });
    // Vorschau der Varianten wie im Hauptprojekt
    const pv = S.preview[p.id];
    if (pv) vs.forEach(v => setPreview(v.id, { ...pv, nonce: 0, edit: false }));
    close();
    const first = vs[0];
    const sess = Object.values(S.sessions).find(s => s.projectId === first.id);
    if (sess) selectSession(sess.id); else selectProject(first.id);
    toast(count > 1 ? `${count} Varianten gestartet` : 'Variante angelegt');
  };
  return html`<${Modal} title="Variante ausprobieren" foot=${html`
    <button class="btn" onClick=${close}>Abbrechen</button>
    <button class="btn primary" disabled=${busy} onClick=${create}>${busy ? 'Lege an…' : count > 1 ? `${count} Varianten starten` : prompt.trim() ? 'Variante starten' : 'Variante anlegen'}</button>`}>
    <p class="muted small" style="margin-top:0">Eine sichere Kopie von „${p?.name}“. Claude probiert dort etwas aus, dein Projekt bleibt unberührt. Danach: <b>Übernehmen</b> oder <b>Verwerfen</b>.</p>
    <label class="lbl">Name</label>
    <input class="field" autoFocus placeholder="z. B. Dunkles Design" value=${name} onInput=${(e) => setName(e.target.value)} />
    <label class="lbl">Was soll ausprobiert werden? (optional)</label>
    <textarea class="field" rows="3" placeholder="z. B. Mach das Dashboard komplett dunkel mit Neon-Akzenten" value=${prompt} onInput=${(e) => setPrompt(e.target.value)}></textarea>
    <label class="lbl">Wie viele Varianten parallel?</label>
    <div class="row">${[1, 2, 3].map(n => html`<button class=${'btn sm' + (count === n ? ' on' : '')} onClick=${() => setCount(n)}>${n}</button>`)}
      <span class="hint" style="margin:0 0 0 6px">${count > 1 ? 'Jede Variante geht eine eigene Richtung. Du vergleichst und nimmst die beste.' : ''}</span></div>
  </${Modal}>`;
}

function VariantActions({ pid }) {
  const v = project(pid);
  const parent = v && project(v.variantOf);
  const [stat, setStat] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', `/projects/${pid}/variant/diff`).then(r => setStat(r.stat)).catch(e => setStat(e.message)); }, [pid]);
  if (!v) return null;
  const apply = async () => {
    setBusy(true);
    const r = await safe(() => api('POST', `/projects/${pid}/variant/apply`));
    setBusy(false);
    if (!r) return;
    if (r.conflict) {
      close();
      toast(r.message, 'err');
      selectProject(r.parentId);
      sendPrompt(`Führe den Git-Branch ${r.branch} (Variante „${v.variantName}“) in den aktuellen Branch zusammen (git merge ${r.branch}) und löse die Konflikte sinnvoll. Lösche den Branch nicht, das erledigt Flint.`);
      toast('Wenn Claude fertig ist: Variante in der Seitenleiste öffnen und „Verwerfen“ wählen. Die Änderungen sind dann schon im Hauptprojekt.');
      return;
    }
    set({ projects: S.projects.filter(x => x.id !== pid), modal: null });
    selectProject(r.parentId);
    toast(`„${v.variantName}“ übernommen`);
  };
  const discard = async () => {
    if (!confirm(`Variante „${v.variantName}“ verwerfen? Alle Änderungen darin gehen verloren.`)) return;
    setBusy(true);
    const ok = await safe(() => api('POST', `/projects/${pid}/variant/discard`));
    setBusy(false);
    if (ok === undefined) return;
    set({ projects: S.projects.filter(x => x.id !== pid), modal: null });
    selectProject(v.variantOf);
    toast('Variante verworfen');
  };
  return html`<${Modal} title=${`Variante „${v.variantName}“`} foot=${html`
    <button class="btn danger" disabled=${busy} onClick=${discard}><${Icon} n="trash" /> Verwerfen</button>
    <span class="spacer"></span>
    <button class="btn" onClick=${close}>Weiter ausprobieren</button>
    <button class="btn primary" disabled=${busy} onClick=${apply}><${Icon} n="check" /> In „${parent?.name}“ übernehmen</button>`}>
    <p class="muted small" style="margin-top:0">Änderungen gegenüber dem Hauptprojekt:</p>
    <pre class="diff">${stat ?? '…'}</pre>
    <p class="hint">Vergleichen: In der Seitenleiste zwischen Hauptprojekt und Variante wechseln. Die Vorschau zeigt jeweils den Stand.</p>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Veröffentlichen (Railway)
// ---------------------------------------------------------------------------
function Publish() {
  const p = project();
  const [st, setSt] = useState(null);
  const load = () => api('GET', '/railway').then(setSt).catch(e => setSt({ error: e.message }));
  useEffect(() => { load(); }, []);
  const ready = st?.installed && (st.user || st.token);
  const go = () => {
    close();
    sendPrompt(`Veröffentliche dieses Projekt auf Railway mit der Railway-CLI.
- Wenn das Projekt noch nicht mit Railway verknüpft ist: lege mit \`railway init\` ein neues Railway-Projekt an (Name: "${p?.name}") bzw. verknüpfe es mit \`railway link\`.
- Für statische Seiten (nur HTML/CSS/JS): sorge für einen minimalen Start, z. B. package.json mit "start": "npx serve -s . -l $PORT" (oder den passenden Ordner), damit Railway es ausliefern kann.
- Für Apps mit Build: prüfe, dass Build- und Start-Befehl stimmen und der Server auf $PORT hört.
- Deploye mit \`railway up --detach\`, erzeuge falls nötig eine öffentliche Domain mit \`railway domain\` und nenne mir am Ende die öffentliche URL.
- Schlüssel aus dem Tresor nicht in Dateien schreiben; benötigte Variablen mit \`railway variables --set\` setzen (vorher fragen).`);
  };
  return html`<${Modal} title="Veröffentlichen mit Railway" foot=${html`<button class="btn" onClick=${close}>Abbrechen</button><button class="btn primary" disabled=${!ready} onClick=${go}><${Icon} n="up" /> Claude veröffentlichen lassen</button>`}>
    <p class="muted small" style="margin-top:0">Claude stellt „${p?.name}“ mit der Railway-CLI online und nennt dir die Adresse. Spätere Änderungen kannst du genauso wieder veröffentlichen.</p>
    ${!st && html`<div class="row"><span class="spin"></span> Prüfe Railway…</div>`}
    ${st?.error && html`<div class="err-box">${st.error}</div>`}
    ${st && !st.error && html`<div class="list">
      <div class="list-item"><span class=${st.installed ? 'st-ok' : 'st-err'}>${st.installed ? '✓' : '✕'}</span><span class="grow">Railway-CLI ${st.version ? html`<span class="muted small mono">${st.version}</span>` : ''}</span>
        ${!st.installed && html`<button class="btn sm" onClick=${() => set({ modal: { type: 'term', title: 'Railway-CLI installieren', preset: 'railway-install', after: 'publish' } })}>Installieren</button>`}</div>
      ${st.installed && html`<div class="list-item"><span class=${st.user || st.token ? 'st-ok' : 'st-err'}>${st.user || st.token ? '✓' : '✕'}</span>
        <span class="grow">${st.user ? `Angemeldet: ${st.user}` : st.token ? 'Token aus dem Tresor' : 'Nicht angemeldet'}</span>
        ${!st.user && html`<button class="btn sm" onClick=${() => set({ modal: { type: 'term', title: 'Bei Railway anmelden', preset: 'railway-login', after: 'publish' } })}>Anmelden</button>`}</div>`}
    </div>
    <div class="hint">Alternativ einen Railway-Token als RAILWAY_TOKEN im Tresor ablegen.</div>`}
  </${Modal}>`;
}

export function Modals() {
  const m = S.modal;
  if (!m) return null;
  if (m.type === 'new') return html`<${NewProject} />`;
  if (m.type === 'open') return html`<${OpenFolder} />`;
  if (m.type === 'mcp') return html`<${Mcp} />`;
  if (m.type === 'vault') return html`<${Vault} />`;
  if (m.type === 'settings') return html`<${Settings} section=${m.section} />`;
  if (m.type === 'palette') return html`<${Palette} />`;
  if (m.type === 'term') return html`<${TermModal} ...${m} />`;
  if (m.type === 'setup') return html`<${Setup} />`;
  if (m.type === 'update') return html`<${Update} />`;
  if (m.type === 'variant') return html`<${NewVariant} />`;
  if (m.type === 'variant-actions') return html`<${VariantActions} pid=${m.pid} />`;
  if (m.type === 'publish') return html`<${Publish} />`;
  return null;
}
