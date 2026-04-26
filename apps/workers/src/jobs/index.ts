import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('workers');

interface WorkerDef {
  name: string;
  start: () => void | Promise<void>;
  stop: () => void;
  enabled: () => boolean;
}

function buildWorkerList(): WorkerDef[] {
  return [
    {
      name: 'price-oracle',
      start: () => require('./price-oracle-worker').start(),
      stop: () => require('./price-oracle-worker').stop(),
      enabled: () => true,
    },
    {
      name: 'mention-poller',
      start: () => require('./mentions/poller').startPolling(),
      stop: () => require('./mentions/poller').stopPolling(),
      enabled: () => true,
    },
    {
      name: 'mood-tweeter',
      start: () => require('./price-personality').startMoodTweeter(),
      stop: () => require('./price-personality').stopMoodTweeter(),
      enabled: () => true,
    },
    {
      name: 'dream-cycle',
      start: () => require('./dream-worker').start(),
      stop: () => require('./dream-worker').stop(),
      enabled: () => true,
    },
    {
      name: 'hosted-dreams',
      start: () => require('./hosted-dreams-worker').start(),
      stop: () => require('./hosted-dreams-worker').stop(),
      enabled: () => true,
    },
    {
      name: 'active-reflection',
      start: () => require('./reflection-worker').start(),
      stop: () => require('./reflection-worker').stop(),
      enabled: () => true,
    },
    {
      name: 'campaign-tracker',
      start: () => require('./campaign-tracker').startCampaignTracker(),
      stop: () => require('./campaign-tracker').stopCampaignTracker(),
      enabled: () => !!config.features.campaignEnabled,
    },
    {
      name: 'x-sentiment-monitor',
      start: () => require('./x-sentiment-monitor').startXSentimentMonitor(),
      stop: () => require('./x-sentiment-monitor').stopXSentimentMonitor(),
      enabled: () => !!(config.features.telegramEnabled && config.telegram.botToken),
    },
    {
      name: 'compound',
      start: () => require('./compound-worker').start(),
      stop: () => require('./compound-worker').stop(),
      enabled: () => process.env.COMPOUND_ENABLED === 'true',
    },
    {
      name: 'task-executor',
      start: () => require('./task-executor-worker').start(),
      stop: () => require('./task-executor-worker').stop(),
      enabled: () => true,
    },
    {
      name: 'usdc-sink',
      start: () => require('./usdc-sink-worker').start(),
      stop: () => require('./usdc-sink-worker').stop(),
      // Disabled until both env vars are wired (treasury + hot wallet
      // private key). Worker self-detects and no-ops if either is missing,
      // but we'd rather not register it as 'started' in that case.
      enabled: () =>
        !!process.env.SINK_HOT_PRIVATE_KEY && !!process.env.SINK_TREASURY_PUBKEY,
    },
  ];
}

const activeWorkers: WorkerDef[] = [];

export async function startAllWorkers(): Promise<void> {
  const workers = buildWorkerList();

  for (const worker of workers) {
    if (!worker.enabled()) {
      log.info({ worker: worker.name }, 'Worker disabled — skipping');
      continue;
    }

    try {
      await worker.start();
      activeWorkers.push(worker);
      log.info({ worker: worker.name }, 'Worker started');
    } catch (err) {
      log.error({ err, worker: worker.name }, 'Worker failed to start');
    }
  }
}

export function stopAllWorkers(): void {
  for (const worker of activeWorkers) {
    try {
      worker.stop();
      log.info({ worker: worker.name }, 'Worker stopped');
    } catch (err) {
      log.error({ err, worker: worker.name }, 'Worker failed to stop');
    }
  }
  activeWorkers.length = 0;
}
