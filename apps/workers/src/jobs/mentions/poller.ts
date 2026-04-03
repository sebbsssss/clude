import { getMentions } from '@clude/shared/core/x-client';
import { dispatchMention, MAX_PER_CYCLE } from './dispatcher';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

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

    // Process oldest first, capped per cycle to avoid burst replying
    const sorted = [...mentions].reverse().slice(0, MAX_PER_CYCLE);
    if (mentions.length > MAX_PER_CYCLE) {
      log.info({ total: mentions.length, processing: MAX_PER_CYCLE }, 'Capping mentions per cycle');
    }

    for (const mention of sorted) {
      await dispatchMention(mention);

      // Delay between processing to pace replies
      await new Promise(resolve => setTimeout(resolve, 3000));
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
