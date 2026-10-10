// apps/web/scripts/generate-sw.mjs
//
// Generates public/sw.js from scripts/sw.template.js by baking in the
// Firebase config. A service worker is served as a static file and cannot
// read process.env / .env files, so the values must be injected at dev/build
// time. Runs automatically via the `predev` / `prebuild` npm hooks.
//
// Config sources (first hit wins per key):
//   1. process.env  — deploy platforms (Render, Vercel, …) inject env vars here
//   2. .env.local    — local development (gitignored)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

// Minimal .env parser (no dotenv dependency needed). Supports KEY=value,
// optional quotes, and ignores blank lines / comments.
function loadDotEnvLocal() {
  const envPath = resolve(root, '.env.local');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = loadDotEnvLocal();
const missing = [];
const values = {};
for (const key of KEYS) {
  values[key] = process.env[key] || fileEnv[key] || '';
  if (!values[key]) missing.push(key);
}

if (missing.length > 0) {
  console.error(
    `[firebase-sw] Missing required config: ${missing.join(', ')}. ` +
      'Set them as environment variables or in apps/web/.env.local (see .env.example).',
  );
  process.exit(1);
}

const template = readFileSync(resolve(root, 'scripts/sw.template.js'), 'utf8');

const output = template
  .replace('__FIREBASE_API_KEY__', values.NEXT_PUBLIC_FIREBASE_API_KEY)
  .replace('__FIREBASE_AUTH_DOMAIN__', values.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
  .replace('__FIREBASE_PROJECT_ID__', values.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  .replace('__FIREBASE_STORAGE_BUCKET__', values.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
  .replace('__FIREBASE_MESSAGING_SENDER_ID__', values.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)
  .replace('__FIREBASE_APP_ID__', values.NEXT_PUBLIC_FIREBASE_APP_ID);

if (output.includes('__FIREBASE_')) {
  console.error('[firebase-sw] Template placeholders left unreplaced — aborting.');
  process.exit(1);
}

writeFileSync(resolve(root, 'public/sw.js'), output);
console.log('[firebase-sw] Generated public/sw.js');
