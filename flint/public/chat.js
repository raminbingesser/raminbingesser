import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'preact/hooks';
import {
  html, S, set, api, safe, toast, rt, project, md, sendPrompt, newSession, persist,
  MODELS, EFFORTS, PERMS, fmtTokens, fmtDur, mod, previewOf, setPreview, useDictation,
} from './core.js';
import { Icon } from './icons.js';

// ---- Werkzeug-Darstellung -------------------------------------------------
const TOOL_NAMES = {
  Read: 'Liest', Write: 'Schreibt', Edit: 'Ändert', MultiEdit: 'Ändert', NotebookEdit: 'Ändert Notebook',
  Bash: 'Befehl', BashOutput: 'Ausgabe', KillShell: 'Beendet Prozess', Glob: 'Sucht Dateien', Grep: 'Durchsucht',
  WebFetch: 'Lädt Webseite', WebSearch: 'Websuche', Task: 'Delegiert', Agent: 'Delegiert', TodoWrite: 'Plan',
  Skill: 'Skill', ExitPlanMode: 'Plan fertig', AskUserQuestion: 'Frage',
  mcp__flint__helfer_starten: 'Startet Helfer', mcp__flint__helfer_status: 'Fragt Helfer ab', mcp__flint__helfer_nachricht: 'Schreibt Helfer',
};
const toolName = (n) => TOOL_NAMES[n] || (n.startsWith('mcp__') ? n.split('__').slice(1).join(' · ') : n);

function parse(input) { try { return JSON.parse(input); } catch { return null; } }

function toolArg(name, input, root) {
  const i = parse(input);
  if (!i) return '';
  const rel = (p) => (root && p?.startsWith(root + '/') ? p.slice(root.length + 1) : p);
  if (i.file_path) return rel(i.file_path);
  if (i.notebook_path) return rel(i.notebook_path);
  if (i.command) return i.command;
  if (i.pattern) return i.pattern + (i.path ? ` in ${rel(i.path)}` : '');
  if (i.url) return i.url;
  if (i.query) return i.query;
  if (i.description) return i.description;
  if (i.titel) return i.titel;
  if (i.subagent_type) return i.subagent_type;
  const first = Object.values(i).find(v => typeof v === 'string');
  return first ? first.slice(0, 120) : '';
}

function Todo({ input }) {
  const i = parse(input);
  if (!i?.todos) return null;
  return html`<div class="tool-body" style="gap:3px">${i.todos.map(t => html`
    <div class="row small"><span class=${t.status === 'completed' ? 'st-ok' : t.status === 'in_progress' ? 'st-run' : 'muted'}>
      ${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}</span>
      <span style=${t.status === 'completed' ? 'text-decoration:line-through;color:var(--muted)' : ''}>${t.content}</span></div>`)}</div>`;
}

function ToolCall({ ev, result, running, root }) {
  const [open, setOpen] = useState(false);
  const isTodo = ev.name === 'TodoWrite';
  const status = result ? (result.isError ? 'err' : 'ok') : running ? 'run' : 'none';
  return html`<div class=${'tool' + (ev.sub ? ' sub' : '')}>
    <div class="tool-head" onClick=${() => setOpen(!open)}>
      ${status === 'run' ? html`<span class="spin"></span>` : status === 'ok' ? html`<span class="st-ok">✓</span>` : status === 'err' ? html`<span class="st-err">✕</span>` : html`<span class="muted">·</span>`}
      ${ev.sub && html`<span class="sub-tag">Helfer</span>`}
      <span class="name">${toolName(ev.name)}</span>
      <span class="arg">${toolArg(ev.name, ev.input, root)}</span>
      <span class="muted small">${open ? '▾' : '▸'}</span>
    </div>
    ${isTodo && !open && html`<${Todo} input=${ev.input} />`}
    ${open && html`<div class="tool-body">
      <pre>${ev.input}</pre>
      ${result && html`<pre class=${result.isError ? 'st-err' : ''}>${result.text || '(keine Ausgabe)'}</pre>`}
    </div>`}
  </div>`;
}

// Rückfrage von Claude mit Auswahlmöglichkeiten (AskUserQuestion)
function Questions({ sid, p }) {
  const [sel, setSel] = useState({});
  const [other, setOther] = useState({});
  const qs = p.questions || [];
  const toggle = (q, label) => {
    const cur = sel[q.question] || [];
    const next = q.multiSelect ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label];
    setSel({ ...sel, [q.question]: next });
  };
  const answers = Object.fromEntries(qs.map(q => {
    const picked = [...(sel[q.question] || [])];
    if (other[q.question]?.trim()) picked.push(other[q.question].trim());
    return [q.question, picked.join(', ')];
  }));
  const complete = qs.every(q => answers[q.question]);
  const send = () => safe(() => api('POST', `/sessions/${sid}/permission/${p.reqId}`, { decision: 'answer', answers }));
  return html`<div class="perm" style="border-color:var(--info);background:rgba(77,171,247,.06)">
    <div class="perm-title"><span style="color:var(--info)">?</span> Claude hat eine Rückfrage</div>
    ${qs.map(q => html`<div style="margin-bottom:10px">
      ${q.header && html`<div class="qtag" style="margin-bottom:2px">${q.header}</div>`}
      <div style="font-weight:600;margin-bottom:6px">${q.question}</div>
      <div style="display:grid;gap:5px">${q.options.map(o => {
        const on = (sel[q.question] || []).includes(o.label);
        return html`<button class=${'btn' + (on ? ' on' : '')} style="justify-content:flex-start;text-align:left;white-space:normal" onClick=${() => toggle(q, o.label)}>
          <span><b>${o.label}</b>${o.description ? html`<span class="muted small"> · ${o.description}</span>` : ''}</span></button>`;
      })}
        <input class="field" placeholder="Andere Antwort…" value=${other[q.question] || ''} onInput=${(e) => setOther({ ...other, [q.question]: e.target.value })} />
      </div>
    </div>`)}
    <div class="row"><button class="btn primary sm" disabled=${!complete} onClick=${send}>Antworten</button>
      <button class="btn sm" onClick=${() => safe(() => api('POST', `/sessions/${sid}/permission/${p.reqId}`, { decision: 'deny' }))}>Überspringen</button></div>
  </div>`;
}

function Permission({ sid, p }) {
  if (p.questions?.length) return html`<${Questions} sid=${sid} p=${p} />`;
  const answer = (decision) => safe(() => api('POST', `/sessions/${sid}/permission/${p.reqId}`, { decision }));
  return html`<div class="perm">
    <div class="perm-title"><span style="color:var(--warn)">●</span> Claude möchte: ${toolName(p.toolName)}</div>
    <pre>${p.input}</pre>
    <div class="row">
      <button class="btn primary sm" onClick=${() => answer('allow')}>Erlauben</button>
      <button class="btn sm" onClick=${() => answer('always')}>Immer erlauben</button>
      <button class="btn sm danger" onClick=${() => answer('deny')}>Ablehnen</button>
      <span class="spacer"></span>
      <span class="hint" style="margin:0" title="Oben im Chat auf „Dateien automatisch“ oder „Alles erlauben“ stellen, dann fragt Claude seltener.">Weniger Fragen? Oben einstellen</span>
    </div>
  </div>`;
}

function Messages({ sid }) {
  const box = useRef();
  const stick = useRef(true);
  const events = S.events[sid];
  const r = rt(sid);
  const delta = S.deltas[sid];
  const root = project()?.path;

  const results = useMemo(() => {
    const m = {};
    for (const e of events || []) if (e.type === 'tool_result') m[e.toolUseId] = e;
    return m;
  }, [events, events?.length]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = box.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (!events) return html`<div class="msgs"><div class="working"><span class="spin"></span> Lade Verlauf…</div></div>`;
  const running = r.status !== 'idle';
  return html`<div class="msgs" ref=${box} onScroll=${onScroll}>
    ${events.map((e, i) => {
      if (e.type === 'user') return html`<div class="msg user" key=${i}><div class="bubble">${e.text}</div></div>`;
      if (e.type === 'text') return html`<div class="msg assistant" key=${i}>${e.sub && html`<span class="sub-tag">Helfer</span>`}<div class="md" dangerouslySetInnerHTML=${{ __html: md(e.text) }}></div></div>`;
      if (e.type === 'tool_use') return html`<${ToolCall} key=${i} ev=${e} result=${results[e.id]} running=${running} root=${root} />`;
      if (e.type === 'result') return html`<div class="result-line" key=${i}>${e.isError ? html`<span class="st-err">Fehler</span>` : 'fertig'} · ${fmtDur(e.durationMs)}${e.costUsd ? ` · ≈ $${e.costUsd.toFixed(2)}` : ''}</div>${e.isError && e.message ? html`<div class="err-box">${e.message}</div>` : null}`;
      if (e.type === 'error') return html`<div class="err-box" key=${i}>${e.message}</div>`;
      if (e.type === 'permission') return html`<div class="perm-note" key=${i}>${e.decision === 'deny' ? '✕ abgelehnt' : e.decision === 'answer' ? '✓ beantwortet' : '✓ erlaubt'}: ${toolName(e.toolName)}</div>`;
      return null;
    })}
    ${delta && html`<div class="msg assistant"><div class="md typing" dangerouslySetInnerHTML=${{ __html: md(delta) }}></div></div>`}
    ${r.pending?.map(p => html`<${Permission} key=${p.reqId} sid=${sid} p=${p} />`)}
    ${running && !delta && !r.pending?.length && html`<div class="working"><span class="spin"></span> Claude arbeitet…</div>`}
  </div>`;
}

function Queue({ sid }) {
  const q = rt(sid).queue || [];
  if (!q.length) return null;
  const act = (id, action) => safe(() => api('POST', `/sessions/${sid}/queue/${id}`, { action }));
  return html`<div class="queue">${q.map((it, i) => html`
    <div class=${'qitem' + (it.paused ? ' paused' : '')} key=${it.id}>
      <span class="qtag">${it.paused ? 'pausiert' : `#${i + 1} wartet`}</span>
      <span class="t" title=${it.text}>${it.text}</span>
      <button class="icon-btn" title="Als Nächstes" onClick=${() => act(it.id, 'now')}><${Icon} n="up" /></button>
      <button class=${'icon-btn' + (it.paused ? ' on' : '')} title="Pausieren" onClick=${() => act(it.id, 'pause')}><${Icon} n="pause" /></button>
      <button class="icon-btn" title="Entfernen" onClick=${() => act(it.id, 'remove')}><${Icon} n="x" /></button>
    </div>`)}</div>`;
}

// ---- Eingabe ----------------------------------------------------------------

function PlusMenu({ onPick, onClose, filter }) {
  const prompts = S.settings.prompts || [];
  const f = (filter || '').toLowerCase();
  const items = [
    ...prompts.map(p => ({ sect: 'Vorlagen', label: p.title, d: p.text, run: () => onPick({ text: p.text }) })),
    { sect: 'Claude-Code-Befehle', label: '/compact', d: 'Langen Verlauf zusammenfassen, spart Kontingent', run: () => onPick({ text: '/compact', send: true }) },
    { sect: 'Claude-Code-Befehle', label: '/init', d: 'CLAUDE.md für das Projekt erstellen', run: () => onPick({ text: '/init', send: true }) },
    { sect: 'Flint', label: 'Bild oder Datei anhängen', d: 'Screenshot, Entwurf, CSV …', run: () => onPick({ attach: true }) },
    { sect: 'Flint', label: 'Element in der Vorschau wählen', d: 'Klick auf ein Element = „ändere das hier“', run: () => onPick({ pickElement: true }) },
    { sect: 'Flint', label: 'MCP & Tools verbinden', d: 'z. B. Higgsfield, Supabase, Notion', run: () => { onClose(); set({ modal: { type: 'mcp' } }); } },
    { sect: 'Flint', label: 'Schlüssel im Tresor', d: 'API-Keys für deine Agenten', run: () => { onClose(); set({ modal: { type: 'vault' } }); } },
    { sect: 'Flint', label: 'Vorlagen bearbeiten', d: 'Eigene Prompts speichern', run: () => { onClose(); set({ modal: { type: 'settings', section: 'prompts' } }); } },
  ].filter(i => !f || (i.label + ' ' + i.d).toLowerCase().includes(f));
  let last = '';
  return html`<div class="menu" onMouseDown=${(e) => e.preventDefault()}>
    ${items.length === 0 && html`<div class="menu-item muted">Nichts gefunden</div>`}
    ${items.map((it, i) => {
      const head = it.sect !== last ? html`<div class="menu-sect">${it.sect}</div>` : null;
      last = it.sect;
      return html`${head}<div class="menu-item" key=${i} onClick=${it.run}><div class="grow"><div>${it.label}</div><div class="d">${it.d}</div></div></div>`;
    })}
  </div>`;
}

function Composer({ sid }) {
  const [text, setText] = useState(() => (sid && localStorage.getItem('wb:draft:' + sid)) || '');
  const [menu, setMenu] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [drag, setDrag] = useState(false);
  const ta = useRef();
  const fileIn = useRef();
  const textRef = useRef(text);
  textRef.current = text;
  const dict = useDictation(() => textRef.current, setText);
  const r = rt(sid);
  const busy = sid && r.status !== 'idle';
  const pid = S.activePid;

  useEffect(() => { setText((sid && localStorage.getItem('wb:draft:' + sid)) || ''); setAttachments([]); }, [sid]);
  useEffect(() => { if (sid) try { localStorage.setItem('wb:draft:' + sid, text); } catch { } }, [text, sid]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 260) + 'px';
  }, [text]);

  // Element aus der Vorschau übernehmen
  useEffect(() => {
    const ins = S.composerInsert;
    if (!ins) return;
    set({ composerInsert: null });
    setAttachments(a => [...a, ins]);
    ta.current?.focus();
  }, [S.composerInsert]);

  const upload = async (file) => {
    if (!pid) return toast('Erst ein Projekt öffnen.', 'err');
    const data = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const out = await safe(() => api('POST', `/projects/${pid}/upload`, { name: file.name || 'bild.png', data }));
    if (!out) return;
    const isImg = file.type.startsWith('image/');
    setAttachments(a => [...a, { kind: isImg ? 'image' : 'file', label: file.name || 'Bild', path: out.path, thumb: isImg ? URL.createObjectURL(file) : null }]);
  };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); files.forEach(upload); }
  };
  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    [...(e.dataTransfer?.files || [])].forEach(upload);
  };

  const submit = async () => {
    let t = text.trim();
    if (!t && !attachments.length) return;
    const extra = attachments.map(a => {
      if (a.kind === 'element') return `\n\n[Ausgewähltes Element in der Vorschau: ${a.file}]\nSelektor: ${a.selector}\nText: ${a.text}\nHTML: ${a.html}`;
      return `\n\n[Angehängt: ${a.path}${a.kind === 'image' ? ' (Bild, bitte mit dem Read-Werkzeug ansehen)' : ''}]`;
    }).join('');
    if (!t) t = attachments.some(a => a.kind === 'image') ? 'Sieh dir das angehängte Bild an.' : 'Siehe Anhang.';
    setText(''); setAttachments([]); setMenu(false);
    dict.stop();
    await sendPrompt(t + extra, sid);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') setMenu(false);
  };

  const onInput = (e) => {
    const v = e.target.value;
    setText(v);
    if (v.startsWith('/') && !v.includes(' ') && !v.includes('\n')) setMenu(true);
    else if (menu === true && !v.startsWith('/')) { /* Menü über + offen lassen */ }
  };

  const pick = (o) => {
    setMenu(false);
    if (o.attach) return fileIn.current?.click();
    if (o.pickElement) {
      const pv = previewOf(pid);
      if (!pv.mode) return toast('Erst etwas in der Vorschau öffnen.', 'err');
      set({ tab: 'preview', showWork: true }); persist();
      setPreview(pid, { edit: true });
      return toast('Klick in der Vorschau auf das, was sich ändern soll.');
    }
    if (o.send) { sendPrompt(o.text, sid); setText(''); return; }
    setText(o.text);
    setTimeout(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 0);
  };

  const stop = () => safe(() => api('POST', `/sessions/${sid}/interrupt`));
  const canSend = text.trim() || attachments.length;

  return html`<div class="composer">
    <div class=${'composer-box' + (drag ? ' drag' : '')} onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${onDrop}>
      ${menu && html`<${PlusMenu} onPick=${pick} onClose=${() => setMenu(false)} filter=${text.startsWith('/') ? text.slice(1) : ''} />`}
      ${attachments.length > 0 && html`<div class="attach">${attachments.map((a, i) => html`
        <span class="chip" key=${i} title=${a.kind === 'element' ? a.html : a.path}>
          ${a.thumb ? html`<img src=${a.thumb} />` : a.kind === 'element' ? html`<${Icon} n="target" size="13" />` : html`<${Icon} n="file" size="13" />`}
          <span>${a.label}</span>
          <button class="icon-btn" style="width:18px;height:18px" onClick=${() => setAttachments(attachments.filter((_, j) => j !== i))}><${Icon} n="x" size="12" /></button>
        </span>`)}</div>`}
      <textarea ref=${ta} rows="1" value=${text} onInput=${onInput} onKeyDown=${onKey} onPaste=${onPaste}
        placeholder=${busy ? 'Claude arbeitet. Deine Nachricht wird eingereiht…' : 'Sag Claude, was es bauen oder ändern soll… (/ für Vorlagen)'}></textarea>
      <div class="composer-bar">
        <button class=${'icon-btn' + (menu ? ' on' : '')} title="Vorlagen, Anhänge, Verbindungen" onClick=${() => setMenu(!menu)}><${Icon} n="plus" /></button>
        <button class="icon-btn" title="Bild/Datei anhängen (auch einfügen oder hineinziehen)" onClick=${() => fileIn.current?.click()}><${Icon} n="image" /></button>
        <button class=${'icon-btn' + (previewOf(pid).edit ? ' on' : '')} title="Element in der Vorschau wählen" onClick=${() => pick({ pickElement: true })}><${Icon} n="target" /></button>
        ${dict.supported && html`<button class=${'icon-btn mic' + (dict.recording ? ' rec' : '')} title="Spracheingabe (Deutsch)" onClick=${dict.toggle}><${Icon} n="mic" /></button>`}
        <span class="spacer"></span>
        <span class="hint" style="margin:0 6px 0 0">${busy ? 'Enter reiht ein' : '↵ senden · ⇧↵ neue Zeile'}</span>
        ${busy && !canSend
          ? html`<button class="send stop" title="Anhalten" onClick=${stop}><${Icon} n="stop" /></button>`
          : html`<button class="send" disabled=${!canSend} onClick=${submit} title="Senden"><${Icon} n="send" /></button>`}
      </div>
      <input type="file" ref=${fileIn} multiple hidden onChange=${(e) => { [...e.target.files].forEach(upload); e.target.value = ''; }} />
    </div>
  </div>`;
}

// ---- Kopfzeile ---------------------------------------------------------------
function Header({ s }) {
  const [edit, setEdit] = useState(false);
  const p = project(s.projectId);
  const r = rt(s.id);
  const patch = (k, v) => safe(() => api('PATCH', `/sessions/${s.id}`, { [k]: v }));
  const u = s.usage || {};
  return html`<div class="chat-head two">
    <div class="row" style="width:100%;min-width:0">
      ${!S.showSide && html`<button class="icon-btn" title="Seitenleiste" onClick=${() => { set({ showSide: true }); persist(); }}><${Icon} n="side" /></button>`}
      <span class=${'dot ' + r.status}></span>
      ${edit
        ? html`<span class="chat-title"><input ref=${(el) => el && setTimeout(() => el.focus(), 0)} value=${s.title} onBlur=${(e) => { setEdit(false); patch('title', e.target.value || s.title); }} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEdit(false); }} /></span>`
        : html`<span class="chat-title" title="Umbenennen" onClick=${() => setEdit(true)}>${s.title}</span>`}
      <span class="crumb">${p?.variantName ? `${project(p.variantOf)?.name} · ${p.variantName}` : p?.name}${s.parentId ? ' · Helfer' : ''}</span>
      <span class="spacer"></span>
      <button class=${'icon-btn' + (S.showWork ? ' on' : '')} title=${`Arbeitsbereich ein/aus (${mod}J)`} onClick=${() => { set({ showWork: !S.showWork }); persist(); }}><${Icon} n="panel" /></button>
    </div>
    <div class="row" style="width:100%;min-width:0;gap:2px;margin-left:-4px">
      <select class="mini" title="Modell (wirkt ab der nächsten Nachricht)" value=${s.model} onChange=${(e) => patch('model', e.target.value)}>
        ${MODELS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>
      <select class="mini" title="Denktiefe" value=${s.effort} onChange=${(e) => patch('effort', e.target.value)}>
        ${EFFORTS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>
      <select class="mini" title="Was darf Claude ohne Nachfrage?" value=${s.permissionMode} onChange=${(e) => patch('permissionMode', e.target.value)}>
        ${PERMS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>
      <span class="spacer"></span>
      <span class="usage" title="Verbrauch dieser Sitzung. Mit Claude-Abo zahlst du nichts extra; der Dollarwert ist nur der rechnerische API-Wert.">${fmtTokens((u.inputTokens || 0) + (u.outputTokens || 0))} Tok.${u.costUsd ? ` · ≈ $${u.costUsd.toFixed(2)}` : ''}</span>
    </div>
  </div>`;
}

// ---- Leerer Chat (Projekt ohne Sitzung) ----------------------------------------
function EmptyChat() {
  const p = project();
  const prompts = (S.settings.prompts || []).slice(0, 6);
  return html`<div class="msgs"><div class="empty" style="margin-top:8vh">
    <div class="big">💬</div>
    <h3>${p?.name}</h3>
    <p>Schreib unten, was Claude bauen soll. Eine neue Sitzung startet automatisch. Mehrere Sitzungen laufen parallel.</p>
    <div class="row" style="flex-wrap:wrap;justify-content:center;margin-top:14px">
      ${prompts.map(pr => html`<button class="btn sm" onClick=${() => set({ composerPreset: pr.text })}>${pr.title}</button>`)}
    </div>
  </div></div>`;
}

export function Chat() {
  const s = S.sessions[S.activeSid];
  const p = project();
  const [preset, setPreset] = useState(0);
  useEffect(() => {
    if (S.composerPreset != null) {
      const t = S.composerPreset;
      set({ composerPreset: null });
      setTimeout(() => {
        const el = document.querySelector('.composer textarea');
        if (el) { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
      }, 0);
      setPreset(preset + 1);
    }
  }, [S.composerPreset]);
  if (!p) return html`<div class="chat"></div>`;
  return html`<div class="chat">
    ${s ? html`<${Header} s=${s} />` : html`<div class="chat-head">
      ${!S.showSide && html`<button class="icon-btn" onClick=${() => { set({ showSide: true }); persist(); }}><${Icon} n="side" /></button>`}
      <span class="chat-title">${p.name}</span><span class="crumb">${p.path}</span><span class="spacer"></span>
      <button class="btn sm" onClick=${() => newSession()}><${Icon} n="plus" /> Sitzung</button>
      <button class=${'icon-btn' + (S.showWork ? ' on' : '')} onClick=${() => { set({ showWork: !S.showWork }); persist(); }}><${Icon} n="panel" /></button>
    </div>`}
    ${s ? html`<${Messages} sid=${s.id} />` : html`<${EmptyChat} />`}
    ${s && html`<${Queue} sid=${s.id} />`}
    <${Composer} sid=${s?.id || null} />
  </div>`;
}
