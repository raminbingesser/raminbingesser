#!/usr/bin/env node
// Hilfsskript für den Skill /aendern.
//   node aendern.mjs holen               → offene Änderungen aus der Zwischenablage (noch nicht erledigte)
//   node aendern.mjs warten              → Live-Modus: wartet auf Änderungen direkt aus Chrome
//   node aendern.mjs erledigt <id> …     → Änderungen als erledigt merken
// Die Chrome-Erweiterung „Ändern“ legt die Änderungen als JSON-Block in die Zwischenablage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = path.join(os.homedir(), '.claude', 'aendern');
const DONE = path.join(DIR, 'erledigt.txt');
fs.mkdirSync(DIR, { recursive: true });
const done = new Set(fs.existsSync(DONE) ? fs.readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : []);

function clipboard() {
  for (const [cmd, args] of [['pbpaste', []], ['xclip', ['-o', '-selection', 'clipboard']], ['wl-paste', []]]) {
    try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { }
  }
  return '';
}

const [cmd, ...rest] = process.argv.slice(2);

// ---- Live-Modus: auf Änderungen aus Chrome warten -------------------------------
// Öffnet kurz einen Empfänger auf 127.0.0.1:47321. Die Chrome-Erweiterung schickt
// Änderungen per POST (nur von chrome-extension://, nicht von Webseiten).
// Gibt die neuen Änderungen aus und beendet sich; nach ~9 Minuten ohne Änderungen
// meldet es KEINE_NEUEN (Claude ruft dann einfach erneut auf).
if (cmd === 'warten') {
  const http = await import('node:http');
  const PORT = 47321;
  const LIMIT_MS = 9 * 60 * 1000;
  let received = [];
  let flushTimer = null;
  const finish = (msg) => {
    srv.close();
    if (msg) { console.log(msg); process.exit(0); }
    const fresh = received.filter((it, i, a) => it?.id && !done.has(it.id) && a.findIndex((x) => x.id === it.id) === i);
    if (!fresh.length) { console.log('KEINE_NEUEN'); process.exit(0); }
    console.log(`${fresh.length} neue Änderung(en) aus Chrome:\n`);
    printItems(fresh);
    process.exit(0);
  };
  const srv = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    const fromExtension = origin.startsWith('chrome-extension://');
    res.setHeader('Access-Control-Allow-Origin', fromExtension ? origin : 'null');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/ping') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (req.method !== 'POST' || req.url !== '/items' || !fromExtension) { res.writeHead(403); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const items = Array.isArray(data.items) ? data.items : [];
        received.push(...items);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, received: items.length }));
        // kurz sammeln, falls gleich weitere Änderungen kommen
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => finish(), 900);
      } catch { res.writeHead(400); res.end(); }
    });
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.log('BELEGT: Eine andere Claude-Sitzung wartet bereits auf Änderungen aus Chrome. Dort weiterarbeiten oder sie beenden.'); process.exit(0); }
    console.log('FEHLER: ' + e.message); process.exit(0);
  });
  srv.listen(PORT, '127.0.0.1');
  setTimeout(() => finish(received.length ? null : 'KEINE_NEUEN'), LIMIT_MS);
}

function printItems(list) {
  list.forEach((it, i) => {
    console.log(`--- Änderung ${i + 1} (id: ${it.id}) ---`);
    console.log(`Seite:    ${it.url}`);
    console.log(`Element:  ${it.label}`);
    console.log(`Selektor: ${it.selector}`);
    if (it.text) console.log(`Text:     „${it.text}“`);
    console.log(`HTML:     ${it.html}`);
    console.log(`WUNSCH:   ${it.wish}\n`);
  });
}

if (cmd === 'erledigt') {
  const ids = rest.filter((x) => /^[a-z0-9]{4,40}$/i.test(x));
  if (ids.length) fs.appendFileSync(DONE, ids.join('\n') + '\n');
  console.log(`${ids.length} als erledigt gemerkt.`);
  process.exit(0);
}

if (cmd !== 'holen' && cmd !== 'warten') {
  console.log('Aufruf: node aendern.mjs holen | warten | erledigt <id> …');
  process.exit(1);
}

if (cmd === 'holen') {
  const text = clipboard();
  const m = text.match(/<!--aendern-json\s*([\s\S]*?)\s*aendern-json-->/);
  if (!m) {
    console.log('KEINE_AENDERUNGEN: Keine offenen Änderungen in der Zwischenablage.');
    process.exit(0);
  }
  let data;
  try { data = JSON.parse(m[1]); } catch { console.log('FEHLER: Der Inhalt der Zwischenablage ist beschädigt. In Chrome im ✎-Menü „Nochmal kopieren“ klicken.'); process.exit(0); }
  const open = (data.items || []).filter((it) => it && it.id && !done.has(it.id));
  if (!open.length) {
    console.log('ALLES_ERLEDIGT: Alle markierten Änderungen wurden schon umgesetzt.');
    process.exit(0);
  }
  console.log(`${open.length} offene Änderung(en):\n`);
  printItems(open);
}
