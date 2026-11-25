// Dateizugriff innerhalb eines Projektordners, plus einfache Git-Funktionen.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HIDDEN = new Set(['node_modules', '.git', '.DS_Store', '.next', 'dist', '.cache', '__pycache__', '.venv', '.flint']);
const MAX_READ = 1024 * 1024;

// Pfad im Projekt auflösen und sicherstellen, dass er das Projekt nicht verlässt.
const inside = (base, p) => {
  const r = path.relative(base, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

export function resolveIn(root, rel = '') {
  const abs = path.resolve(root, String(rel).replace(/^[/\\]+/, ''));
  if (!inside(root, abs)) throw new Error('Pfad liegt außerhalb des Projekts.');
  // Symlinks, die aus dem Projekt herauszeigen, ebenfalls ablehnen. Existiert die
  // Datei (noch) nicht, prüfen wir den nächsten existierenden Elternordner.
  const rootReal = fs.realpathSync(root);
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  if (!inside(rootReal, fs.realpathSync(probe))) throw new Error('Pfad liegt außerhalb des Projekts.');
  return abs;
}

export function listDir(root, rel = '') {
  const dir = resolveIn(root, rel);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !HIDDEN.has(d.name))
    .map(d => {
      const p = path.join(rel, d.name);
      let size = 0, mtime = 0;
      try { const st = fs.statSync(path.join(dir, d.name)); size = st.size; mtime = st.mtimeMs; } catch { }
      return { name: d.name, path: p, dir: d.isDirectory(), size, mtime };
    })
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
}

export function readFile(root, rel) {
  const f = resolveIn(root, rel);
  const st = fs.statSync(f);
  if (st.size > MAX_READ) return { tooLarge: true, size: st.size };
  const buf = fs.readFileSync(f);
  if (buf.includes(0)) return { binary: true, size: st.size };
  return { text: buf.toString('utf8'), size: st.size };
}

export function writeFile(root, rel, text) {
  const f = resolveIn(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

async function git(root, args) {
  const { stdout } = await run('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

// Liegt das Projekt in einem (größeren) Git-Repo? prefix = Unterordner relativ zum Repo.
export async function repoInfo(root) {
  try {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
    return { top, prefix };
  } catch { return null; }
}

// git status nur für den Projektordner, mit Pfaden relativ zum Projekt.
// -z + quotePath=false, damit Umlaute, Leerzeichen und Umbenennungen stimmen.
export async function changedFiles(root) {
  const info = await repoInfo(root);
  if (!info) return null;
  const out = await git(root, ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const status = e.slice(0, 2);
    let p = e.slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++; // nächster Eintrag ist der alte Name
    if (info.prefix && p.startsWith(info.prefix)) p = p.slice(info.prefix.length);
    files.push({ status: status.trim() || '?', path: p });
  }
  return files;
}

export async function gitStatus(root) {
  const files = await changedFiles(root).catch(() => null);
  if (!files) return { repo: false };
  const branch = (await git(root, ['branch', '--show-current']).catch(() => '')).trim();
  const log = (await git(root, ['log', '--oneline', '-n', '15', '--', '.']).catch(() => '')).split('\n').filter(Boolean);
  let ahead = null;
  try { ahead = Number((await git(root, ['rev-list', '--count', '@{u}..HEAD'])).trim()); } catch { }
  return { repo: true, branch, files, log, ahead };
}

export async function gitDiff(root, rel) {
  const f = resolveIn(root, rel);
  const out = await git(root, ['-c', 'core.quotePath=false', 'diff', 'HEAD', '--', f]).catch(() => '');
  return out || '(neue, noch nicht versionierte Datei)';
}

const DEFAULT_IGNORE = 'node_modules/\n.DS_Store\n.env\n.env.*\n.flint/\ndist/\n';
export function ensureGitignore(root) {
  const f = path.join(root, '.gitignore');
  if (!fs.existsSync(f)) fs.writeFileSync(f, DEFAULT_IGNORE);
}

export async function gitInit(root) {
  ensureGitignore(root);
  await git(root, ['init']);
}

// Falls auf dem Mac noch kein Git-Name eingerichtet ist, einen Standard setzen.
export async function identity(root) {
  const name = (await git(root, ['config', 'user.name']).catch(() => '')).trim();
  const mail = (await git(root, ['config', 'user.email']).catch(() => '')).trim();
  return [...(name ? [] : ['-c', 'user.name=Flint']), ...(mail ? [] : ['-c', 'user.email=flint@localhost'])];
}

// Was Flint beim Sichern nie mitnimmt, auch ohne .gitignore: Geheimnisse und Abhängigkeiten.
export const ADD_SPEC = ['--', '.',
  ':(exclude,glob)**/.env', ':(exclude,glob)**/.env.*', ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/.flint/**', ':(exclude,glob)**/.DS_Store'];

// Sichert nur Änderungen im Projektordner (nicht den Rest eines größeren Repos).
export async function gitCommit(root, message) {
  await git(root, ['add', '-A', ...ADD_SPEC]);
  await git(root, [...await identity(root), 'commit', '-m', message || 'Änderungen aus Flint', ...ADD_SPEC]);
}

export async function gitDiscard(root, rel) {
  const f = resolveIn(root, rel);
  try { await git(root, ['checkout', 'HEAD', '--', f]); }
  catch { fs.rmSync(f, { force: true }); }
}

export async function gitPush(root) {
  await git(root, ['push']);
}
