import 'dotenv/config';
import { loadConfig } from '@packages/core';
import { logger } from '@packages/utils';
import { spawn } from 'node:child_process';

const config = loadConfig();

function run(cmd: string) {
  return new Promise<void>((resolve) => {
    const p = spawn('pnpm', ['--filter', '@apps/cli', cmd], { stdio: 'inherit' });
    p.on('close', () => resolve());
  });
}

async function start() {
  logger.info('worker booted');
  await run('hunt:run');
  await run('scan:run');
  setInterval(() => void run('hunt:run'), config.runtime.scanIntervals.huntMs);
  setInterval(() => void run('scan:run'), config.runtime.scanIntervals.scanMs);
}

start();
