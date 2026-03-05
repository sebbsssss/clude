import { eventBus } from './event-bus';
import { flagWhaleSell } from '../core/price-oracle';
import { handleExitInterview } from '../features/exit-interview';
import { accumulateImportance } from '../features/dream-cycle';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('events');

/**
 * Central event handler registration.
 * Called once during startup in index.ts — wires webhook events to feature handlers.
 */
export function registerEventHandlers(): void {
  eventBus.on('whale:sell', ({ wallet, solValue }) => {
    log.info({ wallet, solValue }, 'Whale sell event received');
    flagWhaleSell();
  });

  eventBus.on('holder:exit', ({ wallet, tokenAmount, solValue }) => {
    log.info({ wallet, tokenAmount, solValue }, 'Holder exit event received');
    handleExitInterview(wallet, tokenAmount, solValue).catch(err =>
      log.error({ err, wallet }, 'Exit interview handler failed')
    );
  });

  // Accumulate importance for event-driven reflection triggers (Park et al. 2023)
  eventBus.on('memory:stored', ({ importance, memoryType }) => {
    if (memoryType === 'episodic') {
      accumulateImportance(importance);
    }
  });

  log.info('Event handlers registered');
}
