#!/usr/bin/env node
// Hilfsskript für den Skill /aendern.
//   node aendern.mjs holen               → offene Änderungen aus der Zwischenablage (noch nicht erledigte)
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

if (cmd === 'erledigt') {
  const ids = rest.filter((x) => /^[a-z0-9]{4,40}$/i.test(x));
  if (ids.length) fs.appendFileSync(DONE, ids.join('\n') + '\n');
  console.log(`${ids.length} als erledigt gemerkt.`);
  process.exit(0);
}

if (cmd !== 'holen') {
  console.log('Aufruf: node aendern.mjs holen | erledigt <id> …');
  process.exit(1);
}

const text = clipboard();
const m = text.match(/<!--aendern-json\s*([\s\S]*?)\s*aendern-json-->/);
if (!m) {
  console.log('KEINE_AENDERUNGEN: In der Zwischenablage sind keine mit „Ändern“ markierten Elemente. '
    + 'Bitte in Chrome auf deiner App unten rechts auf ✎ klicken (oder Alt+E), Element anklicken, Wunsch eingeben, Enter. Danach erneut /aendern.');
  process.exit(0);
}
let data;
try { data = JSON.parse(m[1]); } catch { console.log('FEHLER: Der Inhalt der Zwischenablage ist beschädigt. In Chrome im ✎-Menü „Nochmal kopieren“ klicken.'); process.exit(0); }
const open = (data.items || []).filter((it) => it && it.id && !done.has(it.id));
if (!open.length) {
  console.log('ALLES_ERLEDIGT: Alle markierten Änderungen wurden schon umgesetzt. In Chrome im ✎-Menü „Alle erledigt“ klicken, um die Liste zu leeren.');
  process.exit(0);
}
console.log(`${open.length} offene Änderung(en):\n`);
open.forEach((it, i) => {
  console.log(`--- Änderung ${i + 1} (id: ${it.id}) ---`);
  console.log(`Seite:    ${it.url}`);
  console.log(`Element:  ${it.label}`);
  console.log(`Selektor: ${it.selector}`);
  if (it.text) console.log(`Text:     „${it.text}“`);
  console.log(`HTML:     ${it.html}`);
  console.log(`WUNSCH:   ${it.wish}\n`);
});
