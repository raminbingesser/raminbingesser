// Wird von Flint in jede Vorschau-HTML-Seite eingefügt. Läuft auf einem eigenen
// Port (anderer Ursprung als Flint), spricht nur per postMessage mit Flint.
(function () {
  if (window.__flintBridge || window.parent === window) return;
  window.__flintBridge = true;
  var post = function (m) { try { m.flint = true; window.parent.postMessage(m, '*'); } catch (e) { } };
  var KEY = 'flint-scroll:' + location.pathname;

  // Scrollposition über Neuladen hinweg behalten
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved) {
      var restore = function () { window.scrollTo(saved[0], saved[1]); };
      if (document.readyState === 'complete') restore(); else window.addEventListener('load', function () { restore(); setTimeout(restore, 120); });
    }
  } catch (e) { }
  var t = 0;
  window.addEventListener('scroll', function () {
    clearTimeout(t);
    t = setTimeout(function () { try { sessionStorage.setItem(KEY, JSON.stringify([window.scrollX, window.scrollY])); } catch (e) { } }, 100);
  }, { passive: true });

  // Fehler an Flint melden
  window.addEventListener('error', function (e) {
    post({ type: 'error', message: String(e.message || 'Fehler'), source: (e.filename || '').split('/').slice(-1)[0], line: e.lineno || 0 });
  });
  window.addEventListener('unhandledrejection', function (e) {
    post({ type: 'error', message: 'Unbehandelte Promise-Ablehnung: ' + String(e.reason && e.reason.message || e.reason) });
  });
  var origErr = console.error;
  console.error = function () {
    try { post({ type: 'error', message: [].map.call(arguments, function (a) { return a && a.stack ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ').slice(0, 500) }); } catch (e) { }
    return origErr.apply(console, arguments);
  };

  // Element-Auswahl („Ändern“-Modus)
  var picking = null, chosen = null, selBox = null;
  function label(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [].slice.call(el.classList, 0, 2).join('.') : '');
  }
  function selector(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 5) {
      if (el.id) { parts.unshift('#' + el.id); break; }
      var s = el.tagName.toLowerCase();
      if (el.classList.length) s += '.' + [].slice.call(el.classList, 0, 2).join('.');
      var same = el.parentElement ? [].filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; }) : [];
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function mkBox(color, fill) {
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid ' + color + ';background:' + fill + ';border-radius:4px;transition:all .06s;';
    document.body.appendChild(b);
    return b;
  }
  function place(b, el) { var r = el.getBoundingClientRect(); b.style.left = r.left + 'px'; b.style.top = r.top + 'px'; b.style.width = r.width + 'px'; b.style.height = r.height + 'px'; }
  function clearChosen() { if (selBox) selBox.remove(); selBox = null; chosen = null; }
  function track() { if (chosen && selBox) { place(selBox, chosen); post({ type: 'rect', rect: rectOf(chosen) }); } }
  window.addEventListener('scroll', track, { passive: true, capture: true });
  window.addEventListener('resize', track);

  function startPick() {
    if (picking) return;
    var box = mkBox('#f76707', 'rgba(247,103,7,.10)');
    box.style.left = '-9999px';
    var tag = document.createElement('div');
    tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#f76707;color:#fff;font:600 11px system-ui,sans-serif;padding:2px 6px;border-radius:4px;';
    document.body.appendChild(tag);
    document.documentElement.style.cursor = 'crosshair';
    function move(e) {
      var el = e.target;
      if (!el || el === document.body || el === document.documentElement) return;
      place(box, el);
      var r = el.getBoundingClientRect();
      tag.textContent = label(el); tag.style.left = r.left + 'px'; tag.style.top = Math.max(0, r.top - 20) + 'px';
    }
    function click(e) {
      e.preventDefault(); e.stopPropagation();
      var el = e.target;
      clearChosen();
      chosen = el;
      selBox = mkBox('#f76707', 'rgba(247,103,7,.18)');
      place(selBox, el);
      post({
        type: 'picked', label: label(el), selector: selector(el), rect: rectOf(el),
        text: (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 600),
      });
      stop();
    }
    function block(e) { e.preventDefault(); e.stopPropagation(); }
    function key(e) { if (e.key === 'Escape') { stop(); clearChosen(); post({ type: 'pick-cancel' }); } }
    function stop() {
      document.removeEventListener('mouseover', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('mousedown', block, true);
      document.removeEventListener('keydown', key, true);
      box.remove(); tag.remove();
      document.documentElement.style.cursor = '';
      picking = null;
    }
    document.addEventListener('mouseover', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('keydown', key, true);
    picking = stop;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || !e.data.flint) return;
    if (e.data.type === 'pick') { if (e.data.on) startPick(); else { if (picking) picking(); clearChosen(); } }
    if (e.data.type === 'clear') clearChosen();
  });
  post({ type: 'ready', title: document.title });
})();
