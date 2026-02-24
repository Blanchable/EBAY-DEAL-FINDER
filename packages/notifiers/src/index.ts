import { request } from 'undici';
import type { AppConfig } from '@packages/core';
import { logger } from '@packages/utils';

export async function sendTelegram(config: AppConfig, message: string) {
  if (!config.env.TELEGRAM_BOT_TOKEN || !config.env.TELEGRAM_CHAT_ID) return;
  await request(`https://api.telegram.org/bot${config.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.env.TELEGRAM_CHAT_ID, text: message })
  });
}

export async function sendConsole(message: string) {
  logger.info({ alert: message }, 'alert');
}
