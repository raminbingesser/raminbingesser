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
  // Symlinks, die aus dem Projekt herauszeigen, ebenfalls ablehnen.
  try {
    if (!inside(fs.realpathSync(root), fs.realpathSync(abs))) throw new Error('Pfad liegt außerhalb des Projekts.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
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

export async function gitStatus(root) {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { repo: false };
  }
  const branch = (await git(root, ['branch', '--show-current']).catch(() => '')).trim();
  const out = await git(root, ['status', '--porcelain=v1', '-uall']);
  const files = out.split('\n').filter(Boolean).map(l => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }));
  const log = (await git(root, ['log', '--oneline', '-n', '15']).catch(() => '')).split('\n').filter(Boolean);
  let ahead = null;
  try { ahead = Number((await git(root, ['rev-list', '--count', '@{u}..HEAD'])).trim()); } catch { }
  return { repo: true, branch, files, log, ahead };
}

export async function gitDiff(root, rel) {
  const f = resolveIn(root, rel);
  const out = await git(root, ['diff', 'HEAD', '--', f]).catch(() => '');
  return out || '(neue, noch nicht versionierte Datei)';
}

export async function gitInit(root) {
  await git(root, ['init']);
}

// Falls auf dem Mac noch kein Git-Name eingerichtet ist, einen Standard setzen.
export async function identity(root) {
  const name = (await git(root, ['config', 'user.name']).catch(() => '')).trim();
  const mail = (await git(root, ['config', 'user.email']).catch(() => '')).trim();
  return [...(name ? [] : ['-c', 'user.name=Flint']), ...(mail ? [] : ['-c', 'user.email=flint@localhost'])];
}

export async function gitCommit(root, message) {
  await git(root, ['add', '-A']);
  await git(root, [...await identity(root), 'commit', '-m', message || 'Änderungen aus Flint']);
}

export async function gitDiscard(root, rel) {
  const f = resolveIn(root, rel);
  try { await git(root, ['checkout', 'HEAD', '--', f]); }
  catch { fs.rmSync(f, { force: true }); }
}

export async function gitPush(root) {
  await git(root, ['push']);
}
