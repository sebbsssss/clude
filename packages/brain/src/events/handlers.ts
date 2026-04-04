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
  // Exclude external agent sources (e.g. shiro_*) — these are operational writes
  // from autonomous agents running frequent cycles, not genuine interactions.
  // Including them causes dream cycles to trigger far too often.
  eventBus.on('memory:stored', ({ importance, memoryType, source }) => {
    if (memoryType === 'episodic' && !source.startsWith('shiro_')) {
      accumulateImportance(importance);
    }
  });

  log.info('Event handlers registered');
}
