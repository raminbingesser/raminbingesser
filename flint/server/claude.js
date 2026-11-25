// Anbindung an Claude Code selbst: Anmeldestatus (Abo), MCP-Server verwalten.
// Wir nutzen bevorzugt dein installiertes `claude`, sonst das mit dem
// Agent SDK mitgelieferte Programm. Beides nutzt dieselbe Anmeldung.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const NM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@anthropic-ai');

function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const f = path.join(dir, name + ext);
      try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { }
    }
  }
  return null;
}

function bundled() {
  try {
    for (const d of fs.readdirSync(NM)) {
      if (!d.startsWith('claude-agent-sdk-')) continue;
      for (const n of ['claude', 'claude.exe']) {
        const f = path.join(NM, d, n);
        if (fs.existsSync(f)) return f;
      }
    }
  } catch { }
  return null;
}

export function claudeBin() {
  return process.env.FLINT_CLAUDE || onPath('claude') || bundled() || 'claude';
}

// Shell-Befehl, um Claude Code im Terminal zu starten (mit Anführungszeichen, falls Leerzeichen).
export function claudeCommand(args = '') {
  const b = claudeBin();
  const q = /\s/.test(b) ? `"${b}"` : b;
  return (q + ' ' + args).trim();
}

async function cli(args, cwd) {
  const { stdout } = await run(claudeBin(), args, { cwd, timeout: 60_000, maxBuffer: 5 * 1024 * 1024, env: process.env });
  return stdout;
}

export async function authStatus() {
  try {
    const s = JSON.parse(await cli(['auth', 'status', '--json']));
    return { loggedIn: !!s.loggedIn, method: s.authMethod || null, bin: claudeBin() };
  } catch (e) {
    return { loggedIn: false, method: null, bin: claudeBin(), error: String(e.message || e).split('\n')[0] };
  }
}

// `claude mcp list` liefert Zeilen wie: "name: https://… (HTTP) - ✓ Connected"
export async function mcpList(cwd) {
  const out = await cli(['mcp', 'list'], cwd);
  const servers = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S[^:]*?):\s+(.+?)\s+-\s+(.+)$/);
    if (!m) continue;
    const status = m[3].trim();
    servers.push({
      name: m[1].trim(),
      target: m[2].trim(),
      status,
      ok: /✓|connected/i.test(status) && !/fail|✗|needs/i.test(status),
      needsAuth: /auth/i.test(status),
    });
  }
  return servers;
}

export async function mcpAdd({ name, target, transport = 'http', scope = 'user', headers = [], env = [] }, cwd) {
  if (!/^[\w.-]{1,64}$/.test(name || '')) throw new Error('Name nur aus Buchstaben, Ziffern, -, _ und .');
  if (!target) throw new Error('URL bzw. Befehl fehlt.');
  const args = ['mcp', 'add', '--scope', scope];
  if (transport === 'http' || transport === 'sse') {
    args.push('--transport', transport);
    for (const h of headers.filter(Boolean)) args.push('--header', h);
    args.push(name, target);
  } else {
    for (const e of env.filter(Boolean)) args.push('-e', e);
    const parts = target.match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
    args.push(name, '--', ...parts);
  }
  await cli(args, cwd);
}

export async function mcpRemove(name, scope, cwd) {
  const args = ['mcp', 'remove', name];
  if (scope) args.push('--scope', scope);
  await cli(args, cwd);
}
