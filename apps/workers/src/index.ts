import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('workers');

async function main(): Promise<void> {
  log.info('=== CLUDE WORKERS ===');

  // Initialize OpenRouter (required for inference in workers)
  if (config.openrouter.apiKey) {
    const { initOpenRouter } = require('@clude/shared/core/openrouter-client');
    initOpenRouter({
      apiKey: config.openrouter.apiKey,
      model: config.openrouter.model,
    });
  }

  // Initialize Tavily web search
  if (config.tavily.apiKey) {
    const { initWebSearch } = require('@clude/shared/core/web-search');
    initWebSearch(config.tavily.apiKey);
  }

  // Wire bot personality into the LLM client
  const { _setSystemPromptProvider, _setResponsePostProcessor } = require('@clude/shared/core/claude-client');
  const { getBasePrompt, getRandomCloser } = require('@clude/brain/character/base-prompt');
  _setSystemPromptProvider(getBasePrompt);
  _setResponsePostProcessor((text: string) => {
    const closer = getRandomCloser();
    if (closer && text.length + closer.length + 2 <= 270) {
      return `${text} ${closer}`;
    }
    return text;
  });

  // Initialize database
  const { initDatabase } = require('@clude/shared/core/database');
  await initDatabase();
  log.info('Database initialized');

  // Set owner wallet if configured
  if (config.owner.wallet) {
    const { _setOwnerWallet } = require('@clude/brain/memory');
    _setOwnerWallet(config.owner.wallet);
    log.info({ owner: config.owner.wallet.slice(0, 8) + '...' }, 'Owner wallet configured');
  }

  // Register event handlers (wires webhook events to feature logic)
  const { registerEventHandlers } = require('@clude/brain/events/handlers');
  registerEventHandlers();
  log.info('Event handlers registered');

  // Load bot wallet if configured
  const { getBotWallet } = require('@clude/shared/core/solana-client');
  const { setGuardrailBotAddress } = require('@clude/shared/core/guardrails');
  const wallet = getBotWallet();
  if (wallet) {
    const addr = wallet.publicKey.toBase58();
    log.info({ address: addr }, 'Bot wallet loaded');
    setGuardrailBotAddress(addr);
  } else {
    log.warn('No bot wallet configured — on-chain commits disabled');
  }

  // Recover stalled uploads
  const { recoverStalled, drainPending } = require('@clude/brain/services/upload-processor');
  recoverStalled().then(() => drainPending()).catch((err: any) => log.warn({ err }, 'Upload recovery failed'));

  // Start all background jobs
  const { startAllWorkers, stopAllWorkers } = require('./jobs');
  await startAllWorkers();

  log.info('All workers running.');

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down workers...');
    stopAllWorkers();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  log.fatal({ err }, 'Worker process failed to start');
  process.exit(1);
});
