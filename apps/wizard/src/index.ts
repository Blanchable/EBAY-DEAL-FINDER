import 'dotenv/config';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dbClient, loadConfig } from '@packages/core';

const config = loadConfig();
const PORT = Number(process.env.WIZARD_PORT ?? 4311);
let running = false;
let logs = 'Wizard booted.\n';

function appendLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs += `${line}\n`;
  if (logs.length > 80000) logs = logs.slice(-80000);
}


function ensureEnvFile() {
  const envPath = path.resolve('.env');
  const envExamplePath = path.resolve('.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    appendLog('Created .env from .env.example');
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<number>((resolve) => {
    appendLog(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    child.stdout.on('data', (d) => appendLog(d.toString().trimEnd()));
    child.stderr.on('data', (d) => appendLog(d.toString().trimEnd()));
    child.on('close', (code) => {
      appendLog(`exit code: ${code ?? 0}`);
      resolve(code ?? 0);
    });
  });
}

async function runSetup() {
  if (running) return;
  running = true;
  appendLog('Starting one-click setup sequence...');
  ensureEnvFile();
  const commands: Array<[string, string[]]> = [
    ['pnpm', ['i']],
    ['pnpm', ['db:migrate']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['hunt:run']],
    ['pnpm', ['scan:run']]
  ];
  for (const [cmd, args] of commands) {
    const code = await runCommand(cmd, args);
    if (code !== 0) {
      appendLog(`Setup halted: ${cmd} failed.`);
      running = false;
      return;
    }
  }
  appendLog('One-click setup completed successfully.');
  running = false;
}

async function getOperationalStatus() {
  const dbFile = path.resolve(config.env.DB_PATH);
  const envExists = fs.existsSync(path.resolve('.env'));
  const dbExists = fs.existsSync(dbFile);
  let huntRuns = 0;
  let scans = 0;
  let alerts = 0;
  try {
    const db = dbClient();
    huntRuns = await db.huntRun.count();
    scans = await db.dealScore.count();
    alerts = await db.alert.count();
  } catch {
    // DB may not be initialized yet.
  }
  return {
    running,
    envExists,
    dbExists,
    huntRuns,
    scans,
    alerts,
    operational: envExists && dbExists && huntRuns > 0 && scans > 0
  };
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>eBay Deal Finder Wizard</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; background:#0b1020; color:#e8ecff; }
.card { background:#141b33; border-radius:12px; padding:1rem 1.25rem; margin-bottom:1rem; border:1px solid #27345d; }
button { background:#4f7cff; color:white; border:none; border-radius:8px; padding:.7rem 1rem; cursor:pointer; font-weight:600; }
button:disabled { opacity:0.6; cursor:not-allowed; }
pre { background:#050916; color:#bfe0ff; padding:1rem; border-radius:8px; min-height:300px; max-height:460px; overflow:auto; }
.grid { display:grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap:.75rem; }
.pill { background:#1c274a; padding:.7rem; border-radius:8px; }
small { color:#a7b5df; }
</style>
</head>
<body>
  <h1>eBay Deal Finder • One-Click Wizard</h1>
  <p><small>Use this page to install, migrate, typecheck, run hunt/scan, and verify the bot is operational.</small></p>
  <div class="card">
    <button id="setup">Run One-Click Setup</button>
    <button id="refresh">Refresh Status</button>
  </div>
  <div class="card grid">
    <div class="pill">Env file: <strong id="env">-</strong></div>
    <div class="pill">DB file: <strong id="db">-</strong></div>
    <div class="pill">Operational: <strong id="op">-</strong></div>
    <div class="pill">Hunt runs: <strong id="hunt">0</strong></div>
    <div class="pill">Deal scores: <strong id="scan">0</strong></div>
    <div class="pill">Alerts: <strong id="alerts">0</strong></div>
  </div>
  <div class="card">
    <h3>Wizard Logs</h3>
    <pre id="logs"></pre>
  </div>
<script>
async function refresh() {
  const status = await fetch('/api/status').then(r=>r.json());
  document.getElementById('env').textContent = status.envExists ? 'OK' : 'Missing';
  document.getElementById('db').textContent = status.dbExists ? 'OK' : 'Missing';
  document.getElementById('op').textContent = status.operational ? 'YES' : 'NO';
  document.getElementById('hunt').textContent = status.huntRuns;
  document.getElementById('scan').textContent = status.scans;
  document.getElementById('alerts').textContent = status.alerts;
  document.getElementById('setup').disabled = status.running;
  const logText = await fetch('/api/logs').then(r=>r.text());
  const logEl = document.getElementById('logs');
  logEl.textContent = logText;
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('setup').addEventListener('click', async () => {
  await fetch('/api/setup', { method: 'POST' });
  refresh();
});
document.getElementById('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await getOperationalStatus()));
    return;
  }
  if (req.url === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(logs);
    return;
  }
  if (req.url === '/api/setup' && req.method === 'POST') {
    void runSetup();
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  appendLog(`Wizard listening on http://localhost:${PORT}`);
  console.log(`Wizard UI: http://localhost:${PORT}`);
});
