// Schlüsseltresor: API-Keys verschlüsselt (AES-256-GCM) auf der Platte.
// Der Schlüssel liegt in ~/.flint/vault.key (nur für dich lesbar).
// Werte werden nie an die Oberfläche zurückgegeben, nur als Umgebungsvariablen
// an Agenten und Terminals weitergereicht.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME } from './store.js';

const KEY_FILE = path.join(HOME, 'vault.key');
const VAULT_FILE = path.join(HOME, 'vault.json');

function key() {
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(KEY_FILE);
}

function load() {
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')); } catch { return {}; }
}

function store(v) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(v, null, 2), { mode: 0o600 });
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(e) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
}

const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function listSecrets() {
  const v = load();
  return Object.entries(v).map(([name, e]) => ({ name, projects: e.projects || null, updatedAt: e.updatedAt }));
}

export function setSecret(name, value, projects = null) {
  if (!NAME.test(name)) throw new Error('Name nur aus Großbuchstaben, Ziffern und _ (z. B. STRIPE_KEY).');
  if (!value) throw new Error('Wert fehlt.');
  const v = load();
  v[name] = { ...encrypt(value), projects, updatedAt: Date.now() };
  store(v);
}

export function deleteSecret(name) {
  const v = load();
  delete v[name];
  store(v);
}

// Umgebungsvariablen für ein Projekt (globale Schlüssel + projektgebundene).
export function envFor(projectId) {
  const out = {};
  for (const [name, e] of Object.entries(load())) {
    if (e.projects && projectId && !e.projects.includes(projectId)) continue;
    try { out[name] = decrypt(e); } catch { /* beschädigter Eintrag */ }
  }
  return out;
}
