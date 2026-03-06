import { config } from '../config';
import { createChildLogger } from './logger';

const log = createChildLogger('telegram');

const MAX_MESSAGE_LENGTH = 4096;

interface TelegramResult {
  ok: boolean;
  messageId: number;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * Must escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#\+\-=|{}.!])/g, '\\$1');
}

/**
 * Smart truncate text to fit Telegram's 4096 char limit.
 */
function smartTruncate(text: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
  if (text.length <= maxLength) return text;
  const truncateAt = maxLength - 3;
  let lastSpace = text.lastIndexOf(' ', truncateAt);
  if (lastSpace < truncateAt * 0.5) lastSpace = truncateAt;
  return text.slice(0, lastSpace).trimEnd() + '...';
}

/**
 * Call the Telegram Bot API. Retries once on 429 (rate limit).
 */
async function callTelegramAPI(
  method: string,
  body: Record<string, unknown>
): Promise<any> {
  const token = config.telegram.botToken;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const url = `https://api.telegram.org/bot${token}/${method}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { ok: boolean; result?: any; description?: string; parameters?: { retry_after?: number } };

    if (data.ok) return data;

    // Retry on rate limit (429)
    if (res.status === 429 && attempt === 0) {
      const retryAfter = data.parameters?.retry_after || 5;
      log.warn({ retryAfter }, 'Telegram rate limited, retrying');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    throw new Error(`Telegram API error: ${data.description || res.statusText}`);
  }
}

/**
 * Send a text message to the configured broadcast channel.
 */
export async function sendChannelMessage(
  text: string,
  opts?: { parseMode?: 'MarkdownV2' | 'HTML'; disablePreview?: boolean }
): Promise<TelegramResult> {
  const channelId = config.telegram.channelId;
  if (!channelId) throw new Error('TELEGRAM_CHANNEL_ID not configured');

  const truncated = smartTruncate(text);
  log.info({ length: truncated.length, parseMode: opts?.parseMode || 'none' }, 'Sending channel message');

  const body: Record<string, unknown> = {
    chat_id: channelId,
    text: truncated,
  };
  if (opts?.parseMode) body.parse_mode = opts.parseMode;
  if (opts?.disablePreview) body.disable_web_page_preview = true;

  const data = await callTelegramAPI('sendMessage', body);
  return { ok: true, messageId: data.result.message_id };
}

/**
 * Send a photo with optional caption to the broadcast channel.
 */
export async function sendChannelPhoto(
  photoUrl: string,
  caption?: string
): Promise<TelegramResult> {
  const channelId = config.telegram.channelId;
  if (!channelId) throw new Error('TELEGRAM_CHANNEL_ID not configured');

  log.info({ photoUrl: photoUrl.slice(0, 60) }, 'Sending channel photo');

  const body: Record<string, unknown> = {
    chat_id: channelId,
    photo: photoUrl,
  };
  if (caption) body.caption = smartTruncate(caption, 1024); // Telegram caption limit

  const data = await callTelegramAPI('sendPhoto', body);
  return { ok: true, messageId: data.result.message_id };
}
