import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const envPath = '.env';
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

if (!process.env.DATABASE_URL) {
  const dbPath = process.env.DB_PATH || './data/dev.sqlite';
  process.env.DATABASE_URL = `file:${dbPath}`;
}

const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

process.exit(result.status ?? 1);
