// „Ändern – für Claude“: Elemente der lokalen App anklicken, Wunsch dazuschreiben,
// gesammelt in die Zwischenablage. In der Claude Desktop App dann /aendern.
// Die Oberfläche liegt in einem Shadow DOM, damit sich App-CSS und Erweiterung nicht stören.
(() => {
  if (window.__aendernLoaded || window.top !== window) return;
  window.__aendernLoaded = true;

  const STORE_KEY = 'aendern:items';
  let items = [];
  let picking = false;
  let chosen = null;

  // ---- Oberfläche ------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'aendern-host';
  // Container ohne eigene Fläche: darf keine Klicks der App abfangen (Inhalte sind position:fixed).
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;overflow:visible;display:block;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
    .fab { position: fixed; right: 18px; bottom: 18px; width: 46px; height: 46px; border-radius: 14px; border: 0; cursor: pointer;
      background: #f76707; color: #fff; font-size: 20px; box-shadow: 0 6px 24px rgba(0,0,0,.35); display: grid; place-items: center; }
    .fab.on { background: #fff; color: #f76707; outline: 2px solid #f76707; }
    .fab .n { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #1b1b1d; color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; border: 2px solid #f76707; }
    .box, .tag { position: fixed; pointer-events: none; display: none; }
    .box { border: 2px solid #f76707; background: rgba(247,103,7,.12); border-radius: 4px; }
    .box.sel { background: rgba(247,103,7,.2); }
    .tag { background: #f76707; color: #fff; font: 600 11px/1.6 ui-monospace, Menlo, monospace; padding: 1px 6px; border-radius: 4px; }
    .hint { pointer-events: none; position: fixed; left: 50%; top: 14px; transform: translateX(-50%); background: #1b1b1d; color: #eee; font-size: 13px; padding: 8px 14px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.35); display: none; }
    .pop { position: fixed; width: 330px; background: #1b1b1d; color: #eee; border: 1px solid #f76707; border-radius: 12px; padding: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.45); display: none; }
    .pop .what { font: 600 11.5px ui-monospace, Menlo, monospace; color: #ff8a3d; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
    .pop textarea { width: 100%; min-height: 54px; resize: vertical; background: #111; color: #eee; border: 1px solid #36363c; border-radius: 8px; padding: 7px 9px; font-size: 13.5px; outline: none; }
    .pop textarea:focus { border-color: #f76707; }
    .row { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: 7px; }
    .chip, .btn { border: 1px solid #36363c; background: #242428; color: #ddd; border-radius: 7px; padding: 4px 9px; font-size: 12px; cursor: pointer; }
    .chip:hover, .btn:hover { border-color: #888; }
    .btn.primary { background: #f76707; border-color: #f76707; color: #fff; font-weight: 600; }
    .spacer { flex: 1; }
    .muted { color: #8a8a92; font-size: 11.5px; }
    .panel { position: fixed; right: 18px; bottom: 74px; width: 340px; max-height: 50vh; overflow: auto; background: #1b1b1d; color: #eee; border: 1px solid #36363c; border-radius: 12px; padding: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.45); display: none; }
    .panel h4 { margin: 0 0 6px; font-size: 13px; }
    .item { display: flex; gap: 6px; align-items: flex-start; padding: 6px 0; border-top: 1px solid #2a2a2f; font-size: 12.5px; }
    .item .t { flex: 1; min-width: 0; }
    .item .el { font: 11px ui-monospace, Menlo, monospace; color: #ff8a3d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .x { border: 0; background: transparent; color: #8a8a92; cursor: pointer; font-size: 14px; padding: 0 2px; }
    .x:hover { color: #fff; }
    .toast { position: fixed; right: 76px; bottom: 18px; background: #1b1b1d; color: #eee; border-left: 3px solid #f76707; padding: 8px 12px; border-radius: 9px; font-size: 12.5px; box-shadow: 0 6px 24px rgba(0,0,0,.35); display: none; max-width: 320px; }
  </style>
  <div class="box" id="hover"></div><div class="tag" id="tag"></div>
  <div class="box sel" id="selbox"></div>
  <div class="hint" id="hint">Klick auf das, was sich ändern soll · <b>Esc</b> beendet</div>
  <div class="pop" id="pop">
    <div class="what" id="what"></div>
    <textarea id="wish" placeholder="Was soll sich ändern? (Enter = hinzufügen)"></textarea>
    <div class="row" id="chips"></div>
    <div class="row"><span class="muted">Enter: hinzufügen · ⇧Enter: neue Zeile</span><span class="spacer"></span>
      <button class="btn" id="cancel">Abbrechen</button><button class="btn primary" id="add">Hinzufügen</button></div>
  </div>
  <div class="panel" id="panel"></div>
  <div class="toast" id="toast"></div>
  <button class="fab" id="fab" title="Ändern: Element anklicken (Alt+E)">✎</button>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);

  // ---- Speichern & Zwischenablage ----------------------------------------------
  const save = () => chrome.storage.local.set({ [STORE_KEY]: items });
  const load = () => chrome.storage.local.get(STORE_KEY).then((r) => {
    items = r[STORE_KEY] || [];
    // Übertragene Änderungen nach 1 Stunde aus der Liste nehmen
    const old = items.filter((x) => x.sent && Date.now() - x.sent > 3600e3);
    if (old.length) { items = items.filter((x) => !old.includes(x)); save(); }
    render();
    if (unsent().length) send();
  });
  chrome.storage.onChanged.addListener((c) => { if (c[STORE_KEY]) { items = c[STORE_KEY].newValue || []; render(); } });

  function clipboardText() {
    const lines = items.map((it, i) => `${i + 1}. Seite ${it.path} · Element ${it.label}${it.text ? ` („${it.text.slice(0, 60)}“)` : ''}\n   Wunsch: ${it.wish}`);
    const data = { aendern: 1, items: payload(items) };
    return `Bitte setze diese Änderungen an meiner lokalen App um (markiert mit „Ändern“ in Chrome). Ändere jeweils nur genau das markierte Element, mit dem Edit-Werkzeug, ohne zu testen:\n\n${lines.join('\n')}\n\n<!--aendern-json\n${JSON.stringify(data)}\naendern-json-->`;
  }
  async function copy() {
    if (!items.length) return;
    try { await navigator.clipboard.writeText(clipboardText()); return true; }
    catch {
      // Fallback ohne Clipboard-API
      const ta = document.createElement('textarea');
      ta.value = clipboardText(); ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      return ok;
    }
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); t.innerHTML = msg; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  // ---- Live an Claude schicken ---------------------------------------------------
  // Claude wartet nach einmal /aendern im Live-Modus. Ist er gerade beschäftigt,
  // wird alle 2 s nachgeschickt (nur aus dem sichtbaren Tab, damit nichts doppelt geht).
  const unsent = () => items.filter((x) => !x.sent);
  let sending = false, retryTimer = 0, warnedOffline = false;
  const payload = (list) => list.map(({ id, url, path, label, selector, text, html, wish }) => ({ id, url, path, label, selector, text, html, wish }));
  async function send(fromUser) {
    clearTimeout(retryTimer);
    const list = unsent();
    if (!list.length || sending) return;
    if (!fromUser && document.visibilityState !== 'visible') { retryTimer = setTimeout(send, 2000); return; }
    sending = true;
    let ok = false;
    try { ok = (await chrome.runtime.sendMessage({ type: 'send', items: payload(list) }))?.ok; } catch { }
    sending = false;
    if (ok) {
      const ids = new Set(list.map((x) => x.id));
      const now = Date.now();
      items = items.map((x) => ids.has(x.id) ? { ...x, sent: now } : x);
      save(); render(); warnedOffline = false;
      toast(`✓ An Claude übertragen${list.length > 1 ? ` (${list.length})` : ''}. Weiter anklicken mit Alt+E.`);
    } else {
      if (fromUser || !warnedOffline) {
        await copy();
        toast('Claude wartet gerade nicht. In der Desktop App einmal <b>/aendern</b> eingeben – die Änderung wird dann automatisch nachgeschickt.');
        warnedOffline = true;
      }
      retryTimer = setTimeout(send, 2000);
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && unsent().length) send(); });

  // ---- Liste --------------------------------------------------------------------
  let panelOpen = false;
  function render() {
    const fab = $('fab');
    fab.classList.toggle('on', picking);
    const n = unsent().length;
    fab.innerHTML = '✎' + (n ? `<span class="n">${n}</span>` : '');
    const p = $('panel');
    if (!panelOpen || !items.length) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    p.innerHTML = `<h4>${items.length} Änderung${items.length === 1 ? '' : 'en'}</h4>
      <div class="muted" style="margin-bottom:6px">${n ? `${n} wartet auf Claude. In der Desktop App einmal <b>/aendern</b> eingeben, dann geht alles automatisch.` : 'Alles an Claude übertragen.'}</div>
      ${items.map((it) => `<div class="item"><div class="t"><div class="el">${it.sent ? '✓ ' : '⏳ '}${esc(it.path)} · ${esc(it.label)}</div>${esc(it.wish)}</div><button class="x" data-del="${it.id}" title="Entfernen">×</button></div>`).join('')}
      <div class="row"><button class="btn" id="clear" title="Liste leeren, z. B. wenn Claude alles umgesetzt hat">Alle erledigt</button><span class="spacer"></span>
        <button class="btn" id="more" title="Weiteres Element anklicken">+ Element</button><button class="btn" id="copy" title="Für den Notfall: alles in die Zwischenablage">Kopieren</button></div>`;
    p.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { items = items.filter((x) => x.id !== b.dataset.del); save(); render(); });
    p.querySelector('#clear').onclick = () => { items = []; save(); panelOpen = false; render(); toast('Liste geleert.'); };
    p.querySelector('#copy').onclick = async () => { if (await copy()) toast('Kopiert. Mit ⌘V in Claude einfügen.'); };
    p.querySelector('#more').onclick = () => { panelOpen = false; startPick(); };
  }
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- Element-Beschreibung -----------------------------------------------------
  function label(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  }
  function selector(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 5) {
      if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
      let s = el.tagName.toLowerCase();
      if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.');
      const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  const place = (box, el) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const isOurs = (e) => e.composedPath().includes(host);

  // ---- Auswahl-Modus --------------------------------------------------------------
  function onMove(e) {
    if (isOurs(e)) return;
    const el = e.target;
    if (!el || el === document.documentElement || el === document.body) return;
    place($('hover'), el);
    const r = el.getBoundingClientRect(), tag = $('tag');
    tag.textContent = label(el);
    Object.assign(tag.style, { display: 'block', left: r.left + 'px', top: Math.max(0, r.top - 20) + 'px' });
  }
  function onClick(e) {
    if (isOurs(e)) return;
    e.preventDefault(); e.stopPropagation();
    chosen = e.target;
    stopPick(false);
    openPop(chosen);
  }
  const block = (e) => { if (!isOurs(e)) { e.preventDefault(); e.stopPropagation(); } };
  function startPick() {
    if (picking) return;
    picking = true;
    closePop();
    $('hint').style.display = 'block';
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('mouseup', block, true);
    render();
  }
  function stopPick(full = true) {
    picking = false;
    $('hint').style.display = 'none';
    $('hover').style.display = 'none'; $('tag').style.display = 'none';
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', block, true);
    document.removeEventListener('mouseup', block, true);
    if (full) closePop();
    render();
  }

  // ---- Eingabefeld am Element -------------------------------------------------------
  const QUICK = ['größer', 'kleiner', 'fetter', 'andere Farbe: ', 'mehr Abstand', 'entfernen'];
  function openPop(el) {
    place($('selbox'), el);
    const pop = $('pop'), r = el.getBoundingClientRect();
    $('what').textContent = label(el) + ((el.innerText || '').trim() ? ` · „${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}“` : '');
    const W = 330;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    let top = r.bottom + 8;
    if (top + 170 > window.innerHeight) top = Math.max(8, r.top - 178);
    Object.assign(pop.style, { display: 'block', left: left + 'px', top: top + 'px' });
    const wish = $('wish');
    wish.value = '';
    $('chips').innerHTML = QUICK.map((q) => `<button class="chip" data-q="${q}">${q.replace(': ', '…')}</button>`).join('');
    $('chips').querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
      const q = b.dataset.q;
      if (q.endsWith(': ')) { wish.value = q; wish.focus(); } else { wish.value = q; addItem(); }
    });
    setTimeout(() => wish.focus(), 20);
  }
  function closePop() {
    $('pop').style.display = 'none';
    $('selbox').style.display = 'none';
    chosen = null;
  }
  async function addItem() {
    const wish = $('wish').value.trim();
    if (!wish || !chosen) return;
    const el = chosen;
    items.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: location.href, path: location.pathname + location.search,
      label: label(el), selector: selector(el),
      text: (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 160),
      html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 600),
      wish, ts: Date.now(),
    });
    save();
    closePop();
    render();
    send(true);
  }

  // ---- Bedienung ---------------------------------------------------------------------
  $('fab').onclick = () => { if (picking) stopPick(); else if (items.length && !panelOpen) { panelOpen = true; render(); } else { panelOpen = false; startPick(); } };
  $('fab').oncontextmenu = (e) => { e.preventDefault(); panelOpen = !panelOpen; render(); };
  $('add').onclick = addItem;
  $('cancel').onclick = closePop;
  $('wish').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addItem(); }
    if (e.key === 'Escape') closePop();
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); picking ? stopPick() : startPick(); }
    if (e.key === 'Escape' && (picking || $('pop').style.display === 'block')) { stopPick(); }
  }, true);
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'toggle-pick') { picking ? stopPick() : startPick(); } });
  window.addEventListener('scroll', () => { if (chosen && $('pop').style.display === 'block') place($('selbox'), chosen); }, true);

  load();
})();
