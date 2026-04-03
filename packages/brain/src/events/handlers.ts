import { eventBus } from './event-bus';
import { accumulateImportance } from '../memory/dream/cycle';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('events');

/**
 * Central event handler registration.
 * Called once during startup in index.ts — wires events to feature handlers.
 */
export function registerEventHandlers(): void {
  // Accumulate importance for event-driven reflection triggers (Park et al. 2023)
  eventBus.on('memory:stored', ({ importance, memoryType }) => {
    if (memoryType === 'episodic') {
      accumulateImportance(importance);
    }
  });

  log.info('Event handlers registered');
}
