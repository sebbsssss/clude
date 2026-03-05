import { getMentions } from '../core/x-client';
import { dispatchMention } from './dispatcher';
import { config } from '../config';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('poller');

let lastSeenId: string | undefined;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  try {
    const mentions = await getMentions(lastSeenId);

    if (mentions.length === 0) {
      log.debug('No new mentions');
      return;
    }

    log.info({ count: mentions.length }, 'New mentions found');

    // Update last seen ID (mentions come newest first)
    lastSeenId = mentions[0].id;

    // Process oldest first for chronological order
    const sorted = [...mentions].reverse();

    for (const mention of sorted) {
      await dispatchMention(mention);

      // Small delay between processing to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    log.error({ err }, 'Mention polling failed');
  }
}

export function startPolling(): void {
  log.info({ intervalMs: config.intervals.mentionPollMs }, 'Starting mention poller');
  poll(); // Initial poll
  pollTimer = setInterval(poll, config.intervals.mentionPollMs);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
