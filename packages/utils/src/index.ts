import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export async function withRetry<T>(fn: () => Promise<T>, retries = 4) {
  let wait = 300;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) { lastError = e; }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw lastError;
}

export function createTokenBucket(rate: number, perMs: number) {
  let tokens = rate;
  let last = Date.now();
  return {
    async take() {
      while (true) {
        const now = Date.now();
        const elapsed = now - last;
        tokens = Math.min(rate, tokens + (elapsed / perMs) * rate);
        last = now;
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  };
}
