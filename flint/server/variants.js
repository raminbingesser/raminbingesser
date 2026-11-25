// Varianten: sichere Experimente per Git-Worktree. Jede Variante ist ein
// eigener Branch in einem eigenen Ordner (unter ~/.flint/varianten) und
// erscheint in Flint als eigenes Projekt mit eigener Vorschau. Danach wird sie
// übernommen (Merge ins Hauptprojekt) oder verworfen.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as store from './store.js';
import { identity } from './files.js';

const run = promisify(execFile);
const git = async (cwd, args) => (await run('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout.trim();

const slugify = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'variante';

async function ensureRepo(dir) {
  try { await git(dir, ['rev-parse', '--is-inside-work-tree']); }
  catch { await git(dir, ['init']); }
  // Ohne Commit gibt es keinen Ausgangspunkt.
  let hasHead = true;
  try { await git(dir, ['rev-parse', 'HEAD']); } catch { hasHead = false; }
  const dirty = (await git(dir, ['status', '--porcelain'])).length > 0;
  if (!hasHead || dirty) {
    await git(dir, ['add', '-A']);
    await git(dir, [...await identity(dir), 'commit', '--allow-empty', '-m', hasHead ? 'Sicherungspunkt vor Variante' : 'Ausgangsstand']);
  }
}

// Ignorierte, aber nötige Dateien (z. B. .env) in die Variante kopieren.
function copyEnvFiles(from, to) {
  for (const f of fs.readdirSync(from)) {
    if (/^\.env/.test(f) && fs.statSync(path.join(from, f)).isFile() && !fs.existsSync(path.join(to, f))) {
      fs.copyFileSync(path.join(from, f), path.join(to, f));
    }
  }
}

export async function createVariant(parentId, name) {
  const parent = store.getProject(parentId);
  if (!parent) throw new Error('Projekt nicht gefunden.');
  if (parent.variantOf) throw new Error('Varianten bitte vom Hauptprojekt aus anlegen.');
  await ensureRepo(parent.path);
  let slug = slugify(name);
  const existing = new Set(store.listProjects().filter(p => p.variantOf === parentId).map(p => p.branch));
  let n = 2;
  while (existing.has(`flint/${slug}`)) slug = `${slugify(name)}-${n++}`;
  const branch = `flint/${slug}`;
  const dir = path.join(store.HOME, 'varianten', parentId, slug);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { await git(parent.path, ['branch', '-D', branch]); } catch { }
  await git(parent.path, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
  copyEnvFiles(parent.path, dir);
  const p = store.addProject({ name: `${parent.name} · ${name}`, dir });
  store.updateProject(p.id, { variantOf: parentId, branch, variantName: name });
  return store.getProject(p.id);
}

async function commitAll(dir, msg) {
  if ((await git(dir, ['status', '--porcelain'])).length === 0) return false;
  await git(dir, ['add', '-A']);
  await git(dir, [...await identity(dir), 'commit', '-m', msg]);
  return true;
}

export async function applyVariant(variantId) {
  const v = store.getProject(variantId);
  const parent = v && store.getProject(v.variantOf);
  if (!v || !parent) throw new Error('Variante nicht gefunden.');
  await commitAll(v.path, `Variante: ${v.variantName}`);
  await commitAll(parent.path, 'Sicherungspunkt vor Übernahme');
  try {
    await git(parent.path, [...await identity(parent.path), 'merge', '--no-ff', v.branch, '-m', `Variante übernommen: ${v.variantName}`]);
  } catch (e) {
    try { await git(parent.path, ['merge', '--abort']); } catch { }
    const err = new Error('Die Variante überschneidet sich mit Änderungen im Hauptprojekt (Konflikt). Lass Claude zusammenführen.');
    err.conflict = true;
    throw err;
  }
  await removeVariant(variantId);
  return parent;
}

export async function removeVariant(variantId) {
  const v = store.getProject(variantId);
  if (!v?.variantOf) throw new Error('Keine Variante.');
  const parent = store.getProject(v.variantOf);
  if (parent) {
    try { await git(parent.path, ['worktree', 'remove', '--force', v.path]); } catch { }
    try { await git(parent.path, ['branch', '-D', v.branch]); } catch { }
    try { await git(parent.path, ['worktree', 'prune']); } catch { }
  }
  fs.rmSync(v.path, { recursive: true, force: true });
  store.removeProject(variantId);
}

export async function variantDiffStat(variantId) {
  const v = store.getProject(variantId);
  const parent = v && store.getProject(v.variantOf);
  if (!v || !parent) return '';
  const base = await git(v.path, ['merge-base', 'HEAD', await git(parent.path, ['rev-parse', 'HEAD'])]).catch(() => null);
  const committed = base ? await git(v.path, ['diff', '--stat', base]).catch(() => '') : '';
  const open = await git(v.path, ['status', '--short']).catch(() => '');
  return [committed, open && `Noch nicht gesichert:\n${open}`].filter(Boolean).join('\n\n') || 'Noch keine Änderungen.';
}
