// Projekt-Brain: brain/BRAIN.md (Mission, Regeln, Kontext) und
// brain/ROADMAP.md (Kanban-Board als Markdown). Beide Dateien werden jedem
// Agenten des Projekts mitgegeben, damit alle mit demselben Wissen arbeiten.
import fs from 'node:fs';
import path from 'node:path';

export const COLUMNS = ['Ideen', 'Backlog', 'In Arbeit', 'Erledigt'];

const brainTemplate = (name) => `# ${name}

## Mission
Wofür ist dieses Projekt da? Für wen? (Ein, zwei Sätze.)

## Ziele
-

## Regeln für Agenten
- Antworte auf Deutsch.
- Halte brain/ROADMAP.md aktuell: neue Aufgaben unter "Backlog", laufende unter "In Arbeit", fertige unter "Erledigt".
- Dashboards: klare Kennzahlen oben, Diagramme darunter, echte Daten statt Platzhalter, wo möglich.
- Keine Schlüssel in Dateien schreiben. Schlüssel kommen als Umgebungsvariablen aus dem Tresor.

## Entscheidungen
-

## Stil
-
`;

const roadmapTemplate = () => `# Roadmap

${COLUMNS.map(c => `## ${c}\n`).join('\n')}`;

export function brainPaths(dir) {
  return { brain: path.join(dir, 'brain', 'BRAIN.md'), roadmap: path.join(dir, 'brain', 'ROADMAP.md') };
}

export function ensureBrain(dir, name) {
  const p = brainPaths(dir);
  fs.mkdirSync(path.dirname(p.brain), { recursive: true });
  if (!fs.existsSync(p.brain)) fs.writeFileSync(p.brain, brainTemplate(name));
  if (!fs.existsSync(p.roadmap)) fs.writeFileSync(p.roadmap, roadmapTemplate());
  linkClaudeMd(dir);
  return p;
}

// CLAUDE.md importiert das Brain, damit auch Claude Code außerhalb von
// Flint (Desktop App, Terminal) Ziele, Regeln und Roadmap kennt.
const IMPORT = '@brain/BRAIN.md\n@brain/ROADMAP.md\n';
function linkClaudeMd(dir) {
  const f = path.join(dir, 'CLAUDE.md');
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (cur == null) fs.writeFileSync(f, `# Projektkontext\n\nZiele, Regeln und Roadmap stehen im Projekt-Brain:\n\n${IMPORT}`);
  else if (!cur.includes('@brain/BRAIN.md')) fs.appendFileSync(f, `\n\n## Projekt-Brain (Flint)\n\n${IMPORT}`);
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

export function readBrain(dir) {
  const p = brainPaths(dir);
  return { brain: read(p.brain), roadmap: read(p.roadmap) };
}

export function writeBrain(dir, text) {
  const p = brainPaths(dir);
  fs.mkdirSync(path.dirname(p.brain), { recursive: true });
  fs.writeFileSync(p.brain, text);
}

export function parseRoadmap(md) {
  const cols = Object.fromEntries(COLUMNS.map(c => [c, []]));
  let cur = null;
  for (const line of (md || '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = h[1];
      if (!cols[cur]) cols[cur] = [];
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/);
    if (item && cur) cols[cur].push(item[1]);
  }
  return cols;
}

export function writeRoadmap(dir, cols) {
  const p = brainPaths(dir);
  fs.mkdirSync(path.dirname(p.roadmap), { recursive: true });
  const md = '# Roadmap\n\n' + Object.entries(cols)
    .map(([c, items]) => `## ${c}\n${items.map(i => `- ${i.replace(/\n/g, ' ')}`).join('\n')}${items.length ? '\n' : ''}`)
    .join('\n');
  fs.writeFileSync(p.roadmap, md);
}

// Zusatz zum System-Prompt jedes Agenten.
export function systemAddendum(project, role) {
  const { brain, roadmap } = readBrain(project.path);
  const parts = [
    `Du arbeitest in Flint, einer lokalen KI-Werkstatt, im Projekt "${project.name}" (${project.path}).`,
    'Der Mensch sieht neben dem Chat eine Live-Vorschau, ein Terminal und einen Dateibaum.',
    'Wenn du einen Dev-Server startest, nenne die URL (z. B. http://localhost:5173), dann erscheint sie in der Vorschau. Starte lang laufende Server im Hintergrund.',
    'Für einfache Dashboards und Tools reicht oft eine einzelne HTML-Datei (z. B. dashboard/index.html); die Vorschau kann Projektdateien direkt anzeigen.',
    'Schlüssel aus dem Tresor stehen dir als Umgebungsvariablen zur Verfügung. Gib ihre Werte nie aus.',
  ];
  if (role) parts.push(`Deine Rolle in diesem Team: ${role}`);
  // Ist das Brain schon über CLAUDE.md eingebunden, lädt Claude Code es selbst.
  const linked = (read(path.join(project.path, 'CLAUDE.md')) || '').includes('@brain/BRAIN.md');
  if (!linked) {
    if (brain) parts.push('--- brain/BRAIN.md ---\n' + brain.slice(0, 12000));
    if (roadmap) parts.push('--- brain/ROADMAP.md ---\n' + roadmap.slice(0, 8000));
  }
  return parts.join('\n\n');
}
