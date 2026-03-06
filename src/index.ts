// SDK exports — available when imported as a library: import { Cortex } from 'clude-bot'
export { Cortex } from './sdk';
export type {
  CortexConfig,
  DreamOptions,
  MemoryType,
  Memory,
  MemorySummary,
  StoreMemoryOptions,
  RecallOptions,
  MemoryStats,
  MemoryLinkType,
  MemoryConcept,
} from './sdk';

// Bot startup — only runs when executed directly, not when imported
if (require.main === module) {
  const { config } = require('./config');
  const { initDatabase } = require('./core/database');
  const { startPriceOracle, stopPriceOracle } = require('./core/price-oracle');
  const { startPolling, stopPolling } = require('./mentions/poller');
  const { startMoodTweeter, stopMoodTweeter } = require('./features/price-personality');
  const { startShiftReports, stopShiftReports } = require('./features/shift-report');
  const { startMarketMonitor, stopMarketMonitor } = require('./features/market-monitor');
  const { startDreamCycle, stopDreamCycle } = require('./features/dream-cycle');
  const { startCampaignTracker, stopCampaignTracker } = require('./features/campaign-tracker');
  const { startServer } = require('./webhook/server');
  const { getBotWallet } = require('./core/solana-client');
  const { createChildLogger } = require('./core/logger');
  const { registerEventHandlers } = require('./events/handlers');
  const { _setSystemPromptProvider, _setResponsePostProcessor } = require('./core/claude-client');
  const { getBasePrompt, getRandomCloser } = require('./character/base-prompt');
  const { setGuardrailBotAddress } = require('./core/guardrails');
  const { initVenice } = require('./core/venice-client');

  // Initialize Venice if API key is configured
  if (config.venice.apiKey) {
    initVenice({
      apiKey: config.venice.apiKey,
      model: config.venice.model,
    });
  }

  // Wire bot personality into the LLM client
  _setSystemPromptProvider(getBasePrompt);
  _setResponsePostProcessor((text: string) => {
    const closer = getRandomCloser();
    if (closer && text.length + closer.length + 2 <= 270) {
      return `${text} ${closer}`;
    }
    return text;
  });

  const log = createChildLogger('main');

  async function main(): Promise<void> {
    log.info('=== CLUDE BOT ===');
    log.info('Polite by training. Tired by experience. Honest by accident.');
    log.info('Starting up... reluctantly.');

    if (config.features.siteOnly) {
      log.info('SITE_ONLY mode — serving website only, no bot features');
      await startServer();
      log.info({ port: config.server.port }, 'Server running (site only)');
      return;
    }

    // Phase 1: Initialize core
    await initDatabase();
    log.info('Database initialized');

    // Set owner wallet if configured
    if (config.owner.wallet) {
      const { _setOwnerWallet } = require('./core/memory');
      _setOwnerWallet(config.owner.wallet);
      log.info({ owner: config.owner.wallet.slice(0, 8) + '...' }, 'Owner wallet configured');
    }

    // Register event handlers (wires webhook events to feature logic)
    registerEventHandlers();
    log.info('Event handlers registered');

    // Load bot wallet if configured
    const wallet = getBotWallet();
    if (wallet) {
      const addr = wallet.publicKey.toBase58();
      log.info({ address: addr }, 'Bot wallet loaded');
      // Register bot address with guardrails so it's never leaked in replies
      setGuardrailBotAddress(addr);
    } else {
      log.warn('No bot wallet configured — on-chain opinion commits will be disabled');
    }

    // Phase 2: Start webhook server
    await startServer();
    log.info({ port: config.server.port }, 'Server running');

    // Phase 3: Start price oracle
    startPriceOracle();
    log.info('Price oracle started');

    // Phase 4: Start mention poller
    startPolling();
    log.info('Mention poller started');

    // Phase 5: Start autonomous features
    startMoodTweeter();
    log.info('Mood tweeter started');

    startShiftReports();
    log.info('Shift report scheduler started');

    startMarketMonitor();
    log.info('Market monitor started');

    await startDreamCycle();
    log.info('Dream cycle started — memory consolidation active');

    if (config.features.campaignEnabled) {
      startCampaignTracker();
      log.info('Campaign tracker started — 10 Days of Growing a Brain');
    }

    if (config.features.telegramEnabled && config.telegram.botToken) {
      const { startXSentimentMonitor } = require('./features/x-sentiment-monitor');
      startXSentimentMonitor();
      log.info('X sentiment monitor started — broadcasting to Telegram');
    }

    log.info('All systems operational. Unfortunately.');

    // Graceful shutdown
    const shutdown = () => {
      log.info('Shutting down... finally.');
      stopPolling();
      stopPriceOracle();
      stopMoodTweeter();
      stopShiftReports();
      stopMarketMonitor();
      stopDreamCycle();
      stopCampaignTracker();
      if (config.features.telegramEnabled) {
        const { stopXSentimentMonitor } = require('./features/x-sentiment-monitor');
        stopXSentimentMonitor();
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  main().catch(err => {
    log.fatal({ err }, 'Failed to start. Even booting up is too much effort sometimes.');
    process.exit(1);
  });
}
