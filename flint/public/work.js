import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import {
  html, S, set, api, safe, toast, send, onMessage, termRegistry, project, persist,
  previewOf, setPreview, rawUrl, sendPrompt, sendQuickEdit, debounce, mod, useDictation,
} from './core.js';
import { Icon } from './icons.js';

// =====================================================================
// Vorschau
// =====================================================================
const DEVICES = { desktop: null, tablet: [820, 1180], mobile: [390, 844] };
const sameOrigin = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    const host = (h) => (h === '127.0.0.1' || h === '0.0.0.0' ? 'localhost' : h);
    return host(x.hostname) === host(y.hostname) && x.port === y.port;
  } catch { return false; }
};

// Das kleine Eingabefeld direkt am angeklickten Element.
const QUICK = ['größer', 'kleiner', 'fetter', 'andere Farbe', 'mehr Abstand', 'entfernen'];

function EditPop({ sel, where, stage, onDone, onClose, sim }) {
  const [text, setText] = useState('');
  const ref = useRef();
  const textRef = useRef(text);
  textRef.current = text;
  const dict = useDictation(() => textRef.current, setText);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 20); }, [sel.key]);

  const submit = (t) => {
    t = (t ?? text).trim();
    if (!t) return;
    dict.stop();
    let prompt;
    if (sim) {
      prompt = `Änderung an der iOS-App. Ich habe im Simulator-Screenshot die Stelle markiert, die ich meine (oranger Kreis): ${sel.image} (bitte mit dem Read-Werkzeug ansehen).\n\nGewünschte Änderung: ${t}\n\nFinde die passende Stelle im Swift/SwiftUI-Code, ändere nur das Nötige, baue die App neu und starte sie wieder im Simulator.`;
    } else {
      prompt = `Änderung an einem Element in der Vorschau (${where}):\nElement: ${sel.label}\nSelektor: ${sel.selector}\n${sel.text ? `Text: „${sel.text}“\n` : ''}HTML-Ausschnitt: ${sel.html}\n\nGewünschte Änderung: ${t}\n\nFinde das Element im Quellcode (es kann aus einer Vorlage, Komponente oder aus Daten stammen) und ändere nur das Nötige.`;
    }
    sendQuickEdit(prompt);
    toast('Änderung an Claude geschickt');
    onDone();
  };

  // Position: unter dem Element, innerhalb der Bühne halten
  const W = 320;
  const sw = stage?.clientWidth || 800, sh = stage?.clientHeight || 600;
  let left = Math.min(Math.max(8, sel.x), sw - W - 8);
  let top = sel.y + sel.h + 8;
  if (top + 150 > sh) top = Math.max(8, sel.y - 158);
  return html`<div class="editpop" style=${`left:${left}px;top:${top}px;width:${W}px`} onMouseDown=${(e) => e.stopPropagation()}>
    <div class="row small" style="margin-bottom:6px"><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="grow">
      ${sim ? 'Markierte Stelle' : html`<b class="mono" style="color:var(--accent-2)">${sel.label}</b>${sel.text ? ` · „${sel.text.slice(0, 40)}“` : ''}`}</span>
      <span class="spacer"></span><button class="icon-btn" onClick=${onClose} title="Schließen (Esc)"><${Icon} n="x" /></button></div>
    <div class="row">
      <input ref=${ref} class="field grow" placeholder="Was soll sich ändern?" value=${text} onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') onClose(); }} />
      ${dict.supported && html`<button class=${'icon-btn mic' + (dict.recording ? ' rec' : '')} style="width:30px;height:30px" title="Sprechen" onClick=${dict.toggle}><${Icon} n="mic" /></button>`}
      <button class="send" style="flex:none" disabled=${!text.trim()} onClick=${() => submit()}><${Icon} n="send" /></button>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">
      ${QUICK.map(q => html`<button class="btn sm" onClick=${() => (q === 'andere Farbe' ? (setText('Farbe: '), ref.current?.focus()) : submit(q))}>${q}</button>`)}
      ${!sim && html`<button class="btn sm ghost" title="Ins Chatfeld übernehmen und dort ausführlich beschreiben" onClick=${() => { set({ composerInsert: { kind: 'element', label: sel.label, selector: sel.selector, text: sel.text, html: sel.html, file: where } }); onClose(); }}>→ Chat</button>`}
    </div>
  </div>`;
}

function Preview({ pid }) {
  const pv = previewOf(pid);
  const frame = useRef();
  const stageRef = useRef();
  const [htmlFiles, setHtmlFiles] = useState([]);
  const [urlInput, setUrlInput] = useState(pv.url || '');
  const [flash, setFlash] = useState(0);
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [sel, setSel] = useState(null);
  const [bridge, setBridge] = useState(null); // null = unbekannt, true/false
  const [sim, setSim] = useState({ img: null, err: null, status: null });
  // Apps mit eigenem Server (npm run dev …)
  const [run, setRun] = useState(null);
  const runRef = useRef(null);
  const [needsServer, setNeedsServer] = useState(false);
  const [down, setDown] = useState(false);
  const [starting, setStarting] = useState(false);
  // Durchreiche für lokale Apps (siehe Server: /api/proxy)
  const [proxy, setProxy] = useState(null);
  const proxyRef = useRef(null);
  // Normal lädt die Vorschau die App direkt (Logins gelten). Nur für die Klick-Auswahl,
  // wenn die App sie nicht selbst mitbringt, läuft sie über Flints Durchreiche.
  const [viaProxy, setViaProxy] = useState(false);
  const viaRef = useRef(false);
  viaRef.current = viaProxy;

  const loadFiles = () => api('GET', `/projects/${pid}/html-files`).then(fs => {
    setHtmlFiles(fs);
    const cur = previewOf(pid);
    // Bei Apps mit eigenem Server nicht einfach index.html zeigen, sondern die App starten lassen.
    if (!cur.mode && fs.length && runRef.current && !runRef.current.server) {
      const pref = fs.find(f => /(^|\/)(dashboard|tool|app)\/index\.html$/.test(f.path)) || fs.find(f => f.path === 'index.html') || fs[0];
      setPreview(pid, { mode: 'file', file: pref.path });
    }
  }).catch(() => { });
  useEffect(() => {
    setUrlInput(previewOf(pid).url || ''); setErrors([]); setSel(null); setNeedsServer(false); setDown(false); setStarting(false);
    runRef.current = null; setRun(null);
    api('GET', `/projects/${pid}/runinfo`).catch(() => ({ server: false })).then(r => { runRef.current = r; setRun(r); loadFiles(); });
  }, [pid]);

  // Antwortet unter dieser Adresse ein Server?
  const isUp = async (url) => !!url && (await api('GET', `/probe?url=${encodeURIComponent(url)}`).catch(() => null))?.up === true;
  const showApp = (url) => {
    setPreview(pid, { mode: 'url', url, waitUrl: false, suggest: null, hmr: !!runRef.current?.hmr, nonce: (previewOf(pid).nonce || 0) + 1 });
    setUrlInput(url); setStarting(false); setDown(false); setNeedsServer(false);
  };

  // App starten: erst prüfen, ob sie schon läuft; nie doppelt starten; dann den Port abfragen.
  const startApp = async () => {
    const r = runRef.current;
    if (await isUp(r?.url)) { showApp(r.url); toast('Die App läuft schon und wird angezeigt.'); return; }
    if (!r?.command) return sendPrompt('Starte die App dieses Projekts als Dev-Server im Hintergrund und nenne mir am Ende die lokale Adresse (http://localhost:…).');
    setStarting(true); setNeedsServer(false); setDown(false);
    setPreview(pid, { waitUrl: true, suggest: null });
    const list = S.terms[pid] || await api('GET', `/projects/${pid}/terminals`).catch(() => []);
    const running = list.find(t => t.title === 'App' && !t.exited);
    if (running) toast('Die App läuft schon in einem Terminal. Ich warte, bis sie antwortet…');
    else {
      const t = await safe(() => api('POST', `/projects/${pid}/terminals`, { title: 'App', command: r.command }));
      if (!t) { setStarting(false); setPreview(pid, { waitUrl: false }); return; }
      set({ terms: { ...S.terms, [pid]: [...list, t] } });
      toast(`App startet (${r.command}) … die Vorschau erscheint, sobald der Server läuft.`);
    }
    // Unabhängig von der Terminal-Ausgabe: bekannten Port abfragen.
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 1500));
      if (!previewOf(pid).waitUrl) return; // schon erkannt
      if (await isUp(r.url)) { showApp(r.url); return; }
    }
    setStarting(false);
    setPreview(pid, { waitUrl: false });
    toast('Der Server antwortet nicht. Schau im Tab „Terminal“ nach, was passiert, oder sag Claude „starte die App“.', 'err');
  };

  const reload = (auto) => {
    setErrors([]);
    setSel(null);
    setBridge(null);
    setNeedsServer(false);
    setPreview(pid, { nonce: (previewOf(pid).nonce || 0) + 1 });
    if (auto) setFlash(f => f + 1);
  };

  // Dateiänderungen und erkannte Server-Adressen
  useEffect(() => {
    let paths = new Set();
    const run = debounce(() => {
      const list = [...paths]; paths = new Set();
      if (list.some(p => /\.html?$/.test(p))) loadFiles();
      const relevant = list.filter(p => !/^(brain\/|\.flint\/|\.git\/)/.test(p) && !/\.(md|log|lock)$/.test(p));
      const cur = previewOf(pid);
      if (!relevant.length || cur.auto === false || !cur.mode || cur.mode === 'sim') return;
      if (cur.mode === 'url' && cur.hmr) return;
      reload(true);
    }, 250);
    return onMessage((m) => {
      if (m.type === 'files:changed' && m.projectId === pid) { m.paths.forEach(p => paths.add(p)); run(); }
      if (m.type === 'preview:url' && m.projectId === pid) {
        const cur = previewOf(pid);
        if (m.guess) {
          // nur eine Vermutung (Port aus der Ausgabe): anzeigen, wenn wir warten und dort wirklich etwas antwortet
          if (cur.waitUrl) isUp(m.url).then(up => { if (up && previewOf(pid).waitUrl) showApp(m.url); });
          return;
        }
        if (!cur.mode || cur.waitUrl) {
          showApp(m.url);
          return;
        }
        // Claude nennt eine Seite derselben App (z. B. …/dashboard?demo): direkt dorthin wechseln.
        if (m.fromText && cur.mode === 'url' && sameOrigin(cur.url, m.url)) {
          if (cur.url !== m.url) { showApp(m.url); setFlash(f => f + 1); }
          return;
        }
        else if (cur.mode !== 'url' || !sameOrigin(cur.url, m.url)) setPreview(pid, { suggest: m.url });
      }
    });
  }, [pid]);

  // Nachrichten aus der Vorschau (bridge.js)
  const allowedOrigin = () => {
    const cur = previewOf(pid);
    if (cur.mode === 'file') return S.info?.previewOrigin;
    if ((viaRef.current || proxyRef.current?.frameBlocked) && proxyRef.current?.for === cur.url && proxyRef.current.proxied) return proxyRef.current.origin;
    try { return new URL(cur.url).origin; } catch { return null; }
  };
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data?.flint || e.source !== frame.current?.contentWindow || e.origin !== allowedOrigin()) return;
      const d = e.data;
      if (d.type === 'ready') {
        setBridge(true); setMissing(false);
        if (previewOf(pid).edit) post({ type: 'pick', on: true });
      }
      if (d.type === 'error') setErrors(list => list.length > 30 ? list : [...list, d]);
      if (d.type === 'picked') {
        const off = frameOffset();
        setSel({ key: Date.now(), label: d.label, selector: d.selector, text: d.text, html: d.html, x: off.x + d.rect.x, y: off.y + d.rect.y, w: d.rect.w, h: d.rect.h });
      }
      if (d.type === 'rect') {
        const off = frameOffset();
        setSel(s => s && { ...s, x: off.x + d.rect.x, y: off.y + d.rect.y, w: d.rect.w, h: d.rect.h });
      }
      if (d.type === 'pick-cancel') { setSel(null); setPreview(pid, { edit: false }); }
      if (d.type === 'needs-server') setNeedsServer(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [pid]);

  const post = (m) => { try { frame.current?.contentWindow?.postMessage({ flint: true, ...m }, '*'); } catch { } };
  const frameOffset = () => {
    const f = frame.current, st = stageRef.current;
    if (!f || !st) return { x: 0, y: 0 };
    const a = f.getBoundingClientRect(), b = st.getBoundingClientRect();
    return { x: a.left - b.left + st.scrollLeft, y: a.top - b.top + st.scrollTop };
  };
  useEffect(() => { if (pv.mode !== 'sim') post({ type: 'pick', on: !!pv.edit }); if (!pv.edit) setSel(null); }, [pv.edit]);

  // Bridge bei Dev-Servern? Nach dem Laden kurz warten.
  const onLoad = async () => {
    const cur = previewOf(pid);
    if (cur.mode === 'file') {
      const r = await api('GET', `/projects/${pid}/exists?path=${encodeURIComponent(cur.file)}`).catch(() => null);
      setMissing(r ? !r.exists : false);
    } else {
      setMissing(false);
      // Läuft der lokale App-Server überhaupt? (Sonst zeigt der Browser nur eine Fehlerseite.)
      const pr = await api('GET', `/probe?url=${encodeURIComponent(cur.url)}`).catch(() => null);
      setDown(pr?.up === false);
    }
    setTimeout(() => setBridge(b => (b === true ? true : false)), 1500);
  };

  // iOS-Simulator: laufend Screenshots holen
  useEffect(() => {
    if (pv.mode !== 'sim') return;
    let alive = true, timer, lastUrl = null, available = null;
    api('GET', '/simulator/status').then(st => { available = st.available; if (alive) setSim(s => ({ ...s, status: st })); }).catch(() => { available = false; }).finally(() => tick());
    const tick = async () => {
      if (!alive) return;
      if (available === false) { timer = setTimeout(tick, 5000); return; }
      if (!document.hidden && S.tab === 'preview' && !sel) {
        try {
          const r = await fetch('/api/simulator/screenshot?t=' + Date.now(), { headers: { 'x-flint-token': window.FLINT_TOKEN } });
          if (r.ok) {
            const url = URL.createObjectURL(await r.blob());
            if (alive) { setSim(s => ({ ...s, img: url, err: null })); if (lastUrl) setTimeout(((u) => () => URL.revokeObjectURL(u))(lastUrl), 2000); lastUrl = url; }
          } else if (r.status !== 429) {
            const j = await r.json().catch(() => ({}));
            if (alive) setSim(s => ({ ...s, err: j.error || 'Kein Simulator' }));
          }
        } catch { }
      }
      timer = setTimeout(tick, 1200);
    };
    return () => { alive = false; clearTimeout(timer); };
  }, [pv.mode, pid, !!sel]);

  // Klick auf den Simulator-Screenshot = Stelle markieren
  const simClick = async (e) => {
    if (!pv.edit) return;
    const img = e.currentTarget;
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    // Screenshot mit Markierung erzeugen und hochladen
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const cx = fx * canvas.width, cy = fy * canvas.height, rad = Math.max(28, canvas.width * 0.06);
    ctx.lineWidth = Math.max(6, canvas.width * 0.008); ctx.strokeStyle = '#f76707';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    const data = canvas.toDataURL('image/png').split(',')[1];
    const up = await safe(() => api('POST', `/projects/${pid}/upload`, { name: 'simulator-markierung.png', data }));
    if (!up) return;
    const st = stageRef.current.getBoundingClientRect();
    setSel({ key: Date.now(), image: up.path, x: e.clientX - st.left - 20, y: e.clientY - st.top - 20, w: 40, h: 40 });
  };

  // Lokale Apps über Flints Durchreiche laden: dann klappt „✎ Ändern“ ohne Eingriff in die App.
  useEffect(() => {
    if (pv.mode !== 'url' || !pv.url) { proxyRef.current = null; setProxy(null); return; }
    let alive = true;
    api('GET', '/proxy?url=' + encodeURIComponent(pv.url))
      .then(r => ({ ...r, for: pv.url }))
      .catch(() => ({ for: pv.url, url: pv.url, proxied: false }))
      .then(r => { if (alive) { proxyRef.current = r; setProxy(r); } });
    return () => { alive = false; };
  }, [pv.mode, pv.url]);
  useEffect(() => {
    if (pv.mode !== 'url' || !pv.edit) { if (viaProxy) { setViaProxy(false); setBridge(null); } return; }
    if (bridge === false && !viaProxy && proxy?.proxied) { setViaProxy(true); setBridge(null); }
  }, [pv.mode, pv.edit, bridge, proxy]);
  useEffect(() => { setViaProxy(false); }, [pv.url]);

  const src = pv.mode === 'file' && pv.file ? rawUrl(pid, pv.file, pv.nonce || 0)
    : pv.mode === 'url' && pv.url ? (proxy?.for !== pv.url ? null : (viaProxy || proxy.frameBlocked) && proxy.proxied ? proxy.url : pv.url) : null;
  const dev = pv.mode === 'sim' ? null : DEVICES[pv.device || 'desktop'];
  const where = pv.mode === 'file' ? pv.file : pv.url;
  const go = () => {
    let u = urlInput.trim();
    if (!u) return;
    if (/^\d+$/.test(u)) u = 'http://localhost:' + u;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?/.test(u)) u = 'http://' + u;
    if (!/^https?:\/\//.test(u)) { setPreview(pid, { mode: 'file', file: u.replace(/^\/+/, ''), suggest: null }); return; }
    setPreview(pid, { mode: 'url', url: u, suggest: null });
  };
  const openExt = () => { if (src) window.open(pv.mode === 'file' ? rawUrl(pid, pv.file) : pv.url, '_blank'); };
  const fixErrors = () => {
    const list = errors.slice(0, 10).map(e => `- ${e.message}${e.source ? ` (${e.source}:${e.line})` : ''}`).join('\n');
    sendPrompt(`In der Vorschau von ${where} treten JavaScript-Fehler auf. Finde die Ursache und behebe sie:\n${list}`);
    setErrors([]);
  };

  return html`<div class="pane">
    <div class="toolbar">
      <select class="mini" title="Was die Vorschau zeigt: eine Projektdatei, eine Adresse (laufende App) oder den iOS-Simulator" style="max-width:240px;min-width:90px;flex:0 1 auto;font-weight:600;color:var(--ink)" value=${pv.mode === 'file' ? 'f:' + pv.file : pv.mode === 'url' ? 'u' : pv.mode === 'sim' ? 's' : ''}
        onChange=${(e) => { const v = e.target.value; setSel(null); if (v.startsWith('f:')) setPreview(pid, { mode: 'file', file: v.slice(2) }); else if (v === 'u') setPreview(pid, { mode: 'url' }); else if (v === 's') setPreview(pid, { mode: 'sim' }); }}>
        <option value="" disabled>Quelle wählen…</option>
        ${htmlFiles.length > 0 && html`<optgroup label="Projektdateien">${htmlFiles.map(f => html`<option value=${'f:' + f.path}>${f.path}</option>`)}</optgroup>`}
        ${pv.mode === 'file' && pv.file && !htmlFiles.find(f => f.path === pv.file) && html`<option value=${'f:' + pv.file}>${pv.file}</option>`}
        <option value="u">Adresse (localhost / Web)</option>
        <option value="s">iOS-Simulator</option>
      </select>
      ${pv.mode !== 'sim' && pv.mode !== 'file' && html`<div class="urlbar">
        <input value=${pv.mode === 'file' ? pv.file : urlInput} placeholder="localhost:5173 oder dashboard/index.html"
          onInput=${(e) => setUrlInput(e.target.value)} onFocus=${(e) => { if (pv.mode === 'file') setUrlInput(pv.file); e.target.select(); }}
          onKeyDown=${(e) => { if (e.key === 'Enter') go(); }} />
      </div>`}
      ${pv.mode === 'file' && html`<span class="grow"></span>`}
      ${pv.mode === 'sim' && html`<span class="grow muted small">${sim.status?.booted?.length ? sim.status.booted.join(', ') : 'iOS-Simulator'}</span>`}
      <button class=${'btn sm' + (pv.edit ? ' primary' : '')} title="Klick auf ein Element und sag, was sich ändern soll (Esc beendet)" disabled=${!pv.mode}
        onClick=${() => setPreview(pid, { edit: !pv.edit })}>✎ ${pv.edit ? 'Ändern aktiv' : 'Ändern'}</button>
      ${pv.mode !== 'sim' && html`
        <button class="icon-btn" title="Vorschau neu laden" onClick=${() => reload(false)}><${Icon} n="refresh" /></button>
        <button class=${'icon-btn' + (pv.auto !== false ? ' on' : '')} title="Automatisch neu laden: Vorschau aktualisiert sich, sobald Dateien geändert werden (an/aus)" onClick=${() => setPreview(pid, { auto: pv.auto === false })}><${Icon} n="zap" /></button>
        <span style="width:4px"></span>
        <button class=${'icon-btn' + ((pv.device || 'desktop') === 'desktop' ? ' on' : '')} title="Ansicht: Desktop" onClick=${() => setPreview(pid, { device: 'desktop' })}><${Icon} n="monitor" /></button>
        <button class=${'icon-btn' + (pv.device === 'tablet' ? ' on' : '')} title="Ansicht: Tablet (820 px)" onClick=${() => setPreview(pid, { device: 'tablet' })}><${Icon} n="tablet" /></button>
        <button class=${'icon-btn' + (pv.device === 'mobile' ? ' on' : '')} title="Ansicht: Handy (390 px)" onClick=${() => setPreview(pid, { device: 'mobile' })}><${Icon} n="phone" /></button>
        <button class="icon-btn" title="In eigenem Browser-Fenster öffnen" onClick=${openExt}><${Icon} n="ext" /></button>`}
      ${run?.server && pv.mode !== 'sim' && (pv.mode !== 'url' || down) && html`<button class="btn sm primary" disabled=${starting}
        title=${`App mit eigenem Server starten: ${run.command}`} onClick=${startApp}>${starting ? html`<span class="spin"></span> Startet…` : html`<${Icon} n="play" /> App starten`}</button>`}
      <button class="icon-btn" title="Veröffentlichen: online stellen mit Railway" onClick=${() => set({ modal: { type: 'publish' } })}><${Icon} n="up" /></button>
    </div>
    ${(needsServer || down) && !starting && html`<div class="suggest"><${Icon} n="play" size="14" />
      <span class="grow">${down ? `Die App unter ${pv.url} läuft gerade nicht.` : 'Diese App braucht ihren eigenen Server, eine einfache Datei-Vorschau reicht nicht.'}</span>
      <button class="btn sm primary" onClick=${startApp}>${run?.command ? `▶ Starten (${run.command.replace(/^.*&& /, '')})` : 'Claude soll sie starten'}</button></div>`}
    ${pv.suggest && html`<div class="suggest"><${Icon} n="zap" size="14" /> Server erkannt: <b class="mono">${pv.suggest}</b><span class="spacer"></span>
      <button class="btn sm primary" onClick=${() => { setPreview(pid, { mode: 'url', url: pv.suggest, suggest: null }); setUrlInput(pv.suggest); }}>Anzeigen</button>
      <button class="icon-btn" title="Hinweis ausblenden" onClick=${() => setPreview(pid, { suggest: null })}><${Icon} n="x" /></button></div>`}
    ${errors.length > 0 && html`<div class="suggest" style="background:rgba(250,82,82,.1)"><span class="st-err">●</span>
      <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=${errors.map(e => e.message).join('\n')}>${errors.length} Fehler in der Seite: ${errors[0].message}</span>
      <button class="btn sm primary" onClick=${fixErrors}>Claude beheben lassen</button>
      <button class="icon-btn" title="Fehler ausblenden" onClick=${() => setErrors([])}><${Icon} n="x" /></button></div>`}
    ${viaProxy && pv.mode === 'url' && html`<div class="suggest" style="font-size:12px"><${Icon} n="target" size="14" />
      <span class="grow">Für die Klick-Auswahl lädt Flint die App gerade über eine eigene Adresse. Ist die App dort nicht angemeldet, nutze z. B. den Demo-Modus. Nach „Ändern“ ist wieder alles wie gewohnt.</span></div>`}
    ${pv.edit && pv.mode === 'url' && proxy && !proxy.proxied && html`<div class="suggest"><${Icon} n="target" size="14" />
      <span class="grow">„Ändern“ per Klick geht bei deinen lokalen Apps (localhost), nicht bei fremden Webseiten.</span></div>`}
    ${pv.edit && !sel && (pv.mode !== 'url' || bridge) && html`<div class="suggest" style="font-size:12px"><${Icon} n="target" size="14" />
      ${pv.mode === 'sim' ? 'Tippe im Simulator-Bild auf die Stelle, die sich ändern soll.' : 'Fahre über die Seite und klick auf das, was sich ändern soll.'} <span class="spacer"></span><span class="muted">Esc beendet</span></div>`}
    ${pv.mode === 'url' && html`<div class="suggest" style="background:transparent;font-size:12px">
      <label class="row muted"><input type="checkbox" checked=${!!pv.hmr} onChange=${(e) => setPreview(pid, { hmr: e.target.checked })} /> Server aktualisiert sich selbst (Vite/Next Hot Reload). Flint lädt dann nicht zusätzlich neu.</label></div>`}
    <div class=${'stage' + (dev ? ' device' : '')} ref=${stageRef} style=${dev ? `--dev-w:${dev[0]}px;--dev-h:${dev[1]}px` : ''}
      onKeyDown=${(e) => { if (e.key === 'Escape') { setSel(null); setPreview(pid, { edit: false }); } }}>
      ${flash > 0 && html`<div class="flash" key=${flash}>aktualisiert</div>`}
      ${pv.mode === 'sim'
        ? (sim.img
          ? html`<img class=${'sim' + (pv.edit ? ' editing' : '')} src=${sim.img} onClick=${simClick} draggable="false" />`
          : html`<div class="empty"><div class="big">📱</div><h3>iOS-Simulator</h3>
              <p>${sim.status && !sim.status.available ? sim.status.reason : sim.err || 'Starte deine App im Simulator, dann erscheint sie hier live.'}</p>
              ${sim.status?.available !== false && html`<button class="btn primary" onClick=${() => sendPrompt('Baue die iOS-App dieses Projekts und starte sie im iOS-Simulator (xcodebuild + xcrun simctl). Öffne vorher den Simulator, falls keiner läuft.')}>Claude: App bauen & starten</button>`}</div>`)
        : src
          ? html`<iframe key=${pv.mode + (pv.mode === 'file' ? pv.file : pv.url) + ':' + (pv.nonce || 0) + (viaProxy ? ':p' : '')} ref=${frame} src=${src} onLoad=${onLoad} allow="clipboard-write; fullscreen"></iframe>`
          : run?.server
            ? html`<div class="empty"><div class="big">▶️</div><h3>${run.framework || 'App'} starten</h3>
                <p>Diese App hat einen eigenen Server. Flint startet ihn im Terminal und zeigt die App hier, sobald sie läuft.</p>
                <p class="mono small">${run.command}</p>
                <button class="btn primary" disabled=${starting} onClick=${startApp}>${starting ? 'Startet…' : '▶ App starten'}</button></div>`
            : html`<div class="empty"><div class="big">👀</div><h3>Live-Vorschau</h3>
              <p>Sobald Claude eine HTML-Datei anlegt oder einen Server startet, erscheint sie hier und aktualisiert sich bei jeder Änderung.</p>
              <p class="small">Oder oben eine Adresse eingeben, z. B. <span class="mono">localhost:3000</span>.</p></div>`}
      ${starting && html`<div class="empty" style="position:absolute;inset:0;background:var(--bg);max-width:none;display:grid;place-content:center">
        <div class="spin" style="margin:0 auto"></div><h3>App startet…</h3><p class="mono small">${run?.command}</p>
        <p class="small">Beim ersten Mal werden Pakete installiert, das kann eine Minute dauern. Fortschritt im Tab „Terminal“.</p></div>`}
      ${missing && html`<div class="empty" style="position:absolute;inset:0;background:var(--bg);max-width:none;display:grid;place-content:center"><div class="spin" style="margin:0 auto"></div><h3>Warte auf ${pv.file}</h3><p>Die Datei existiert noch nicht. Sobald Claude sie schreibt, erscheint sie hier.</p></div>`}
      ${sel && html`<${EditPop} sel=${sel} where=${where} stage=${stageRef.current} sim=${pv.mode === 'sim'}
        onDone=${() => { setSel(null); post({ type: 'clear' }); if (previewOf(pid).edit) post({ type: 'pick', on: true }); }}
        onClose=${() => { setSel(null); post({ type: 'clear' }); if (previewOf(pid).edit) post({ type: 'pick', on: true }); }} />`}
    </div>
  </div>`;
}

// =====================================================================
// Terminal
// =====================================================================
const TERM_THEME = {
  background: '#0b0b0c', foreground: '#e6e6e8', cursor: '#f76707', cursorAccent: '#0b0b0c',
  selectionBackground: 'rgba(247,103,7,.35)', black: '#1b1b1d', red: '#ff6b6b', green: '#69db7c', yellow: '#ffd43b',
  blue: '#74c0fc', magenta: '#e599f7', cyan: '#66d9e8', white: '#e9ecef', brightBlack: '#5c5f66',
};

onMessage((m) => {
  if (m.type === 'term:data' || m.type === 'term:replay') termRegistry.get(m.termId)?.term.write(m.data);
  if (m.type === 'term:exit') {
    const t = termRegistry.get(m.termId);
    if (t) t.term.write(`\r\n\x1b[90m[Prozess beendet (${m.code}). Tab schließen oder neues Terminal öffnen.]\x1b[0m\r\n`);
    // merken, damit „App starten“ weiß, dass hier nichts mehr läuft
    const terms = Object.fromEntries(Object.entries(S.terms).map(([k, list]) => [k, (list || []).map(x => (x.id === m.termId ? { ...x, exited: true } : x))]));
    set({ terms });
  }
});

function getTerm(termId) {
  if (termRegistry.has(termId)) return termRegistry.get(termId);
  const el = document.createElement('div');
  el.style.cssText = 'width:100%;height:100%';
  const term = new window.Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.2,
    cursorBlink: true, theme: TERM_THEME, scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.onData(d => send({ type: 'term:input', termId, data: d }));
  const entry = { term, fit, el, opened: false };
  termRegistry.set(termId, entry);
  send({ type: 'term:attach', termId });
  return entry;
}

export function TermView({ termId, active = true }) {
  const host = useRef();
  useEffect(() => {
    const t = getTerm(termId);
    host.current.appendChild(t.el);
    if (!t.opened) { t.term.open(t.el); t.opened = true; }
    const doFit = () => {
      if (!host.current?.offsetParent) return;
      try { t.fit.fit(); send({ type: 'term:resize', termId, cols: t.term.cols, rows: t.term.rows }); } catch { }
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(doFit));
    ro.observe(host.current);
    setTimeout(doFit, 30);
    if (active) setTimeout(() => t.term.focus(), 50);
    return () => ro.disconnect();
  }, [termId]);
  useEffect(() => {
    if (active) { const t = termRegistry.get(termId); setTimeout(() => { try { t?.fit.fit(); t?.term.focus(); } catch { } }, 30); }
  }, [active]);
  return html`<div class="term-host" ref=${host} hidden=${!active}></div>`;
}

export async function openTerminal(pid, preset, extra = {}) {
  const t = await safe(() => api('POST', `/projects/${pid}/terminals`, { preset, ...extra }));
  if (!t) return null;
  set({ terms: { ...S.terms, [pid]: [...(S.terms[pid] || []), t] }, activeTerm: { ...(S.activeTerm || {}), [pid]: t.id }, tab: 'terminal', showWork: true });
  persist();
  return t;
}

function Terminal({ pid }) {
  const list = S.terms[pid];
  const active = S.activeTerm?.[pid];
  useEffect(() => {
    if (list) return;
    api('GET', `/projects/${pid}/terminals`).then(ts => set({ terms: { ...S.terms, [pid]: ts } })).catch(() => { });
  }, [pid]);
  if (!S.info?.terminal) return html`<div class="pane"><div class="empty"><h3>Terminal nicht verfügbar</h3><p>node-pty konnte nicht geladen werden. Führe im Flint-Ordner <span class="mono">npm install</span> erneut aus.</p></div></div>`;
  const close = async (id) => {
    await safe(() => api('DELETE', `/terminals/${id}`));
    termRegistry.get(id)?.term.dispose(); termRegistry.delete(id);
    const rest = (S.terms[pid] || []).filter(t => t.id !== id);
    set({ terms: { ...S.terms, [pid]: rest }, activeTerm: { ...(S.activeTerm || {}), [pid]: rest[rest.length - 1]?.id } });
  };
  const cur = active && list?.find(t => t.id === active) ? active : list?.[list.length - 1]?.id;
  return html`<div class="pane">
    <div class="toolbar">
      <div class="subtabs grow">${(list || []).map(t => html`
        <span class=${'subtab' + (t.id === cur ? ' active' : '')} key=${t.id} onClick=${() => set({ activeTerm: { ...(S.activeTerm || {}), [pid]: t.id } })}>
          ${t.title}<button class="icon-btn" title="Terminal schließen (beendet, was darin läuft)" style="width:18px;height:18px" onClick=${(e) => { e.stopPropagation(); close(t.id); }}><${Icon} n="x" size="11" /></button></span>`)}
      </div>
      <button class="btn sm" onClick=${() => openTerminal(pid, null, { title: 'Terminal' })}><${Icon} n="plus" /> Terminal</button>
      <button class="btn sm primary" title="Claude Code direkt im Terminal (mit deinem Abo)" onClick=${() => openTerminal(pid, 'claude', { title: 'Claude Code' })}><${Icon} n="spark" /> Claude im Terminal</button>
    </div>
    <div class="term-wrap">
      ${(list || []).map(t => html`<${TermView} key=${t.id} termId=${t.id} active=${t.id === cur} />`)}
      ${list && !list.length && html`<div class="empty" style="position:absolute;inset:0;display:grid;place-content:center">
        <div class="big">⌨️</div><h3>Echtes Terminal im Projektordner</h3>
        <p>Für eigene Befehle, Dev-Server oder Claude Code pur. Schlüssel aus dem Tresor sind als Umgebungsvariablen gesetzt.</p>
        <div class="row" style="justify-content:center;margin-top:10px">
          <button class="btn" onClick=${() => openTerminal(pid, null, { title: 'Terminal' })}>Terminal öffnen</button>
          <button class="btn primary" onClick=${() => openTerminal(pid, 'claude', { title: 'Claude Code' })}>Claude im Terminal</button>
        </div></div>`}
    </div>
  </div>`;
}

// =====================================================================
// Dateien
// =====================================================================
const IMG = /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i;
const DATA = /\.(csv|tsv|json)$/i;

function parseCsv(text, sep) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > 2000) break;
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0]);
}

function toTable(path, text) {
  try {
    if (/\.json$/i.test(path)) {
      let d = JSON.parse(text);
      if (!Array.isArray(d)) d = Object.values(d).find(Array.isArray) || [d];
      const cols = [...new Set(d.slice(0, 500).flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : ['Wert'])))];
      return [cols, ...d.slice(0, 2000).map(r => cols.map(c => {
        const v = r && typeof r === 'object' ? r[c] : r;
        return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }))];
    }
    const first = text.split('\n')[0];
    const sep = /\.tsv$/i.test(path) ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    return parseCsv(text, sep);
  } catch { return null; }
}

function DataTable({ path, text }) {
  const rows = useMemo(() => toTable(path, text), [path, text]);
  if (!rows || !rows.length) return html`<div class="empty"><p>Konnte nicht als Tabelle gelesen werden.</p></div>`;
  const [head, ...body] = rows;
  return html`<div class="datatable"><table>
    <thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead>
    <tbody>${body.slice(0, 1000).map(r => html`<tr>${head.map((_, i) => html`<td title=${r[i]}>${r[i]}</td>`)}</tr>`)}</tbody>
  </table>${body.length > 1000 ? html`<div class="hint" style="padding:8px">Zeige 1000 von ${body.length} Zeilen.</div>` : ''}</div>`;
}

function Files({ pid }) {
  const [tree, setTree] = useState({});
  const [open, setOpen] = useState(() => new Set(['']));
  const [sel, setSel] = useState(null);
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [recent, setRecent] = useState({});
  const [asTable, setAsTable] = useState(true);

  const loadDir = async (dir) => {
    const list = await api('GET', `/projects/${pid}/files?path=${encodeURIComponent(dir)}`).catch(() => []);
    setTree(t => ({ ...t, [dir]: list }));
  };
  useEffect(() => { setTree({}); setOpen(new Set([''])); setSel(null); setFile(null); loadDir(''); }, [pid]);

  const loadFile = async (p) => {
    const f = await safe(() => api('GET', `/projects/${pid}/file?path=${encodeURIComponent(p)}`));
    if (!f) return;
    setFile({ path: p, ...f }); setText(f.text || ''); setDirty(false);
  };

  useEffect(() => onMessage((m) => {
    if (m.type !== 'files:changed' || m.projectId !== pid) return;
    const now = Date.now();
    setRecent(r => { const n = { ...r }; m.paths.forEach(p => { n[p] = now; }); return n; });
    open.forEach(d => loadDir(d));
    if (sel && m.paths.includes(sel) && !dirty) loadFile(sel);
  }), [pid, open, sel, dirty]);

  const toggle = (d) => {
    const n = new Set(open);
    if (n.has(d)) n.delete(d); else { n.add(d); loadDir(d); }
    setOpen(n);
  };
  const save = async () => {
    await safe(() => api('PUT', `/projects/${pid}/file`, { path: file.path, text }), 'Gespeichert');
    setDirty(false);
  };

  const rows = [];
  const walk = (dir, depth) => {
    for (const e of tree[dir] || []) {
      const p = e.path.split('\\').join('/');
      const changed = recent[p] && Date.now() - recent[p] < 15000;
      rows.push(html`<div key=${p} class=${'node' + (sel === p ? ' sel' : '') + (changed ? ' changed' : '')} style=${`padding-left:${6 + depth * 14}px`}
        onClick=${() => { if (e.dir) toggle(p); else { setSel(p); loadFile(p); } }}>
        <span class="ic">${e.dir ? (open.has(p) ? '▾' : '▸') : '·'}</span><span class="nm">${e.name}</span></div>`);
      if (e.dir && open.has(p)) walk(p, depth + 1);
    }
  };
  walk('', 0);

  return html`<div class="pane"><div class="files">
    <div class="tree">${rows.length ? rows : html`<div class="muted small" style="padding:8px">Leerer Ordner</div>`}</div>
    <div class="viewer">
      ${!file && html`<div class="empty"><div class="big">📁</div><h3>Dateien</h3><p>Datei links wählen. Orange markiert, was Claude gerade geändert hat.</p></div>`}
      ${file && html`<div class="toolbar">
        <span class="mono grow" style="overflow:hidden;text-overflow:ellipsis">${file.path}${dirty ? ' •' : ''}</span>
        ${/\.html?$/i.test(file.path) && html`<button class="btn sm" onClick=${() => { setPreview(pid, { mode: 'file', file: file.path }); set({ tab: 'preview' }); persist(); }}><${Icon} n="eye" /> Vorschau</button>`}
        ${DATA.test(file.path) && file.text != null && html`<button class=${'btn sm' + (asTable ? ' on' : '')} onClick=${() => setAsTable(!asTable)}>${asTable ? 'Tabelle' : 'Text'}</button>
          <button class="btn sm" title="Claude soll aus diesen Daten ein Dashboard bauen" onClick=${() => sendPrompt(`Baue aus den Daten in ${file.path} ein übersichtliches Dashboard (dashboard/index.html) mit den wichtigsten Kennzahlen und passenden Diagrammen. Lies die Daten direkt aus der Datei, damit spätere Updates automatisch erscheinen.`)}><${Icon} n="chart" /> Dashboard daraus</button>`}
        ${file.text != null && html`<button class="btn sm primary" disabled=${!dirty} onClick=${save}><${Icon} n="save" /> Speichern</button>`}
      </div>`}
      ${file && IMG.test(file.path) && html`<div style="overflow:auto;flex:1"><img src=${rawUrl(pid, file.path, Date.now())} /></div>`}
      ${file && DATA.test(file.path) && asTable && file.text != null && html`<${DataTable} path=${file.path} text=${text} />`}
      ${file && !IMG.test(file.path) && file.text != null && !(DATA.test(file.path) && asTable) && html`<textarea spellcheck="false" value=${text}
        onInput=${(e) => { setText(e.target.value); setDirty(true); }}
        onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }}></textarea>`}
      ${file && !IMG.test(file.path) && file.text == null && html`<div class="empty"><p>${file.tooLarge ? 'Datei ist zu groß für die Anzeige.' : 'Binärdatei, keine Textansicht.'}</p></div>`}
    </div>
  </div></div>`;
}

// =====================================================================
// Brain & Roadmap
// =====================================================================
function Brain({ pid }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [over, setOver] = useState(null);
  const drag = useRef(null);

  const load = async () => {
    const d = await api('GET', `/projects/${pid}/brain`).catch(() => null);
    setData(d);
    if (d && !dirty) setText(d.brain || '');
  };
  useEffect(() => { setDirty(false); setData(null); load(); }, [pid]);
  useEffect(() => onMessage((m) => {
    if (m.type === 'files:changed' && m.projectId === pid && m.paths.some(p => p.startsWith('brain/'))) load();
  }), [pid, dirty]);

  if (!data) return html`<div class="pane"><div class="empty"><span class="spin"></span></div></div>`;
  if (data.brain == null && data.roadmap == null) {
    return html`<div class="pane"><div class="empty"><div class="big">🧠</div><h3>Projekt-Brain</h3>
      <p>Mission, Regeln, Entscheidungen und eine Roadmap, die alle Agenten kennen, auch Claude in der Desktop App (über CLAUDE.md).</p>
      <div class="row" style="justify-content:center;margin-top:12px">
        <button class="btn" onClick=${async () => { await safe(() => api('POST', `/projects/${pid}/brain/init`)); load(); }}>Leeres Brain anlegen</button>
        <button class="btn primary" onClick=${async () => { await safe(() => api('POST', `/projects/${pid}/brain/init`)); load(); sendPrompt((S.settings.prompts || []).find(p => p.title === 'Projekt-Brain ausfüllen')?.text || 'Fülle brain/BRAIN.md und brain/ROADMAP.md für dieses Projekt aus.'); }}>Von Claude ausfüllen lassen</button>
      </div></div></div>`;
  }
  const cols = data.roadmap || Object.fromEntries((data.columns || []).map(c => [c, []]));
  const saveCols = async (next) => {
    setData({ ...data, roadmap: next });
    await safe(() => api('PUT', `/projects/${pid}/roadmap`, { columns: next }));
  };
  const move = (from, idx, to) => {
    const next = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, [...v]]));
    const [item] = next[from].splice(idx, 1);
    next[to].push(item);
    saveCols(next);
  };
  const saveBrain = async () => { await safe(() => api('PUT', `/projects/${pid}/brain`, { brain: text }), 'Brain gespeichert'); setDirty(false); };

  return html`<div class="pane"><div class="brain">
    <div class="card">
      <div class="card-head">Roadmap <span class="muted small" style="font-weight:400">· brain/ROADMAP.md · Karten ziehen zum Verschieben</span><span class="spacer"></span>
        <button class="btn sm" onClick=${() => sendPrompt('Arbeite die nächste Aufgabe aus brain/ROADMAP.md (Spalte "Backlog") ab: verschiebe sie nach "In Arbeit", erledige sie und verschiebe sie dann nach "Erledigt".')}><${Icon} n="play" /> Nächste Aufgabe abarbeiten</button></div>
      <div class="kanban">${Object.entries(cols).map(([c, items]) => html`
        <div class=${'col' + (over === c ? ' over' : '')} key=${c}
          onDragOver=${(e) => { e.preventDefault(); setOver(c); }} onDragLeave=${() => setOver(null)}
          onDrop=${(e) => { e.preventDefault(); setOver(null); const d = drag.current; if (d && d.col !== c) move(d.col, d.idx, c); drag.current = null; }}>
          <div class="col-head"><span>${c}</span><span>${items.length}</span></div>
          ${items.map((it, i) => html`<div class="kcard" key=${c + i} draggable="true" onDragStart=${() => { drag.current = { col: c, idx: i }; }}>
            <span class="t">${it}</span>
            <button class="icon-btn" title="Claude soll das umsetzen" onClick=${() => sendPrompt(`Setze diese Aufgabe aus der Roadmap um: "${it}". Verschiebe sie in brain/ROADMAP.md nach "In Arbeit" und danach nach "Erledigt".`)}><${Icon} n="play" size="11" /></button>
            <button class="icon-btn" title="Löschen" onClick=${() => saveCols({ ...cols, [c]: items.filter((_, j) => j !== i) })}><${Icon} n="x" size="11" /></button>
          </div>`)}
          <div class="kadd"><input placeholder="+ Karte" onKeyDown=${(e) => {
            if (e.key === 'Enter' && e.target.value.trim()) { saveCols({ ...cols, [c]: [...items, e.target.value.trim()] }); e.target.value = ''; }
          }} /></div>
        </div>`)}</div>
    </div>
    <div class="card">
      <div class="card-head">BRAIN.md <span class="muted small" style="font-weight:400">· Mission, Ziele, Regeln, Stil</span><span class="spacer"></span>
        <button class="btn sm primary" disabled=${!dirty} onClick=${saveBrain}><${Icon} n="save" /> Speichern</button></div>
      <textarea spellcheck="false" value=${text} onInput=${(e) => { setText(e.target.value); setDirty(true); }}
        onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveBrain(); } }}></textarea>
    </div>
  </div></div>`;
}

// =====================================================================
// Git / Versionen
// =====================================================================
function Diff({ text }) {
  return html`<pre class="diff">${String(text).split('\n').map(l => html`<div class=${l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'r' : l.startsWith('@@') ? 'h' : ''}>${l || ' '}</div>`)}</pre>`;
}

function Git({ pid }) {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [diff, setDiff] = useState(null);
  const load = () => api('GET', `/projects/${pid}/git`).then(setSt).catch(e => setSt({ error: e.message }));
  useEffect(() => { setSt(null); setDiff(null); load(); }, [pid]);
  useEffect(() => onMessage(debounce((m) => { if (m.type === 'files:changed' && m.projectId === pid) load(); }, 800)), [pid]);

  if (!st) return html`<div class="pane"><div class="empty"><span class="spin"></span></div></div>`;
  if (st.error) return html`<div class="pane"><div class="empty"><p>${st.error}</p><p class="small">Ist Git installiert? Auf dem Mac: <span class="mono">xcode-select --install</span></p></div></div>`;
  if (!st.repo) return html`<div class="pane"><div class="empty"><div class="big">🕘</div><h3>Versionen</h3>
    <p>Speichere Zwischenstände und spring jederzeit zurück, wenn ein Experiment schiefgeht.</p>
    <button class="btn primary" onClick=${async () => { await safe(() => api('POST', `/projects/${pid}/git/init`), 'Versionierung eingeschaltet'); load(); }}>Versionierung einschalten</button></div></div>`;

  const commit = async () => {
    const ok = await safe(() => api('POST', `/projects/${pid}/git/commit`, { message: msg || 'Zwischenstand' }), 'Sicherungspunkt gespeichert');
    if (ok !== undefined) { setMsg(''); setDiff(null); load(); }
  };
  const discard = async (p) => {
    if (!confirm(`Änderungen an ${p} verwerfen? Das kann nicht rückgängig gemacht werden.`)) return;
    await safe(() => api('POST', `/projects/${pid}/git/discard`, { path: p }), 'Verworfen');
    load();
  };
  const showDiff = async (p) => {
    const d = await safe(() => api('GET', `/projects/${pid}/git/diff?path=${encodeURIComponent(p)}`));
    if (d) setDiff({ path: p, text: d.diff });
  };
  return html`<div class="pane"><div class="git">
    <div class="card">
      <div class="card-head">Änderungen <span class="pill">${st.files.length}</span><span class="muted small" style="font-weight:400">Branch ${st.branch || '–'}</span><span class="spacer"></span>
        <button class="icon-btn" title="Aktualisieren" onClick=${load}><${Icon} n="refresh" /></button></div>
      <div class="card-body" style="display:grid;gap:8px">
        ${st.files.length === 0 && html`<div class="muted small">Alles gesichert. Keine offenen Änderungen.</div>`}
        ${st.files.map(f => html`<div class="gfile" key=${f.path} onClick=${() => showDiff(f.path)}>
          <span class="s">${f.status}</span><span class="p">${f.path}</span>
          <button class="icon-btn" title="Verwerfen" onClick=${(e) => { e.stopPropagation(); discard(f.path); }}><${Icon} n="trash" /></button></div>`)}
        ${diff && html`<div><div class="row small muted" style="margin-bottom:4px">${diff.path}<span class="spacer"></span><button class="icon-btn" title="Änderungsansicht schließen" onClick=${() => setDiff(null)}><${Icon} n="x" /></button></div><${Diff} text=${diff.text} /></div>`}
        ${st.files.length > 0 && html`<div class="row">
          <input class="field grow" placeholder="Was hat sich geändert? (z. B. „Diagramm als Balken“)" value=${msg} onInput=${(e) => setMsg(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') commit(); }} />
          <button class="btn primary" onClick=${commit}><${Icon} n="save" /> Sichern</button>
        </div>
        <button class="btn sm ghost" style="justify-self:start" onClick=${() => sendPrompt('Sieh dir die offenen Git-Änderungen an, fasse sie kurz zusammen und erstelle einen Commit mit einer passenden deutschen Nachricht.')}><${Icon} n="spark" /> Claude soll sichern und beschreiben</button>`}
      </div>
    </div>
    <div class="card">
      <div class="card-head">Verlauf<span class="spacer"></span>
        ${st.ahead != null && html`<button class="btn sm" disabled=${!st.ahead} onClick=${async () => { await safe(() => api('POST', `/projects/${pid}/git/push`), 'Hochgeladen'); load(); }}>↑ ${st.ahead} hochladen</button>`}</div>
      <div class="card-body log">${st.log.length ? st.log.map(l => html`<div>${l}</div>`) : html`<span class="muted">Noch keine Sicherungspunkte.</span>`}</div>
      ${st.log.length > 0 && html`<div class="card-body" style="border-top:1px solid var(--line)"><span class="hint">Zurück zu einem alten Stand? Sag Claude z. B.: „Stell den Stand von vor dem letzten Commit wieder her.“</span></div>`}
    </div>
  </div></div>`;
}

// =====================================================================
// Container
// =====================================================================
const TABS = [
  ['preview', 'Vorschau', 'eye'],
  ['terminal', 'Terminal', 'term'],
  ['files', 'Dateien', 'file'],
  ['brain', 'Brain', 'brain'],
  ['git', 'Versionen', 'git'],
];

export function Work() {
  const pid = S.activePid;
  if (!pid) return html`<div class="work"></div>`;
  const tab = S.tab;
  return html`<div class="work">
    <div class="tabs">
      ${TABS.map(([k, l, i]) => html`<button class=${'tab' + (tab === k ? ' active' : '')} onClick=${() => { set({ tab: k }); persist(); }}><${Icon} n=${i} /> ${l}</button>`)}
      <span class="spacer"></span>
      <button class="icon-btn" title=${`Chat ausblenden (Vorschau groß)`} onClick=${() => { set({ hideChat: !S.hideChat }); }}><${Icon} n="side" /></button>
    </div>
    <div class="pane" hidden=${tab !== 'preview'}><${Preview} key=${pid} pid=${pid} /></div>
    <div class="pane" hidden=${tab !== 'terminal'}><${Terminal} key=${pid} pid=${pid} /></div>
    <div class="pane" hidden=${tab !== 'files'}>${tab === 'files' && html`<${Files} key=${pid} pid=${pid} />`}</div>
    <div class="pane" hidden=${tab !== 'brain'}>${tab === 'brain' && html`<${Brain} key=${pid} pid=${pid} />`}</div>
    <div class="pane" hidden=${tab !== 'git'}>${tab === 'git' && html`<${Git} key=${pid} pid=${pid} />`}</div>
  </div>`;
}
