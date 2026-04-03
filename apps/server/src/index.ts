// SDK exports — available when imported as a library: import { Cortex } from 'clude-bot'
export { Cortex } from '@clude/brain/sdk';
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
} from '@clude/brain/sdk';

// Bot startup — only runs when executed directly, not when imported
if (require.main === module) {
  const { bootstrap } = require('./bootstrap');
  bootstrap().catch((err: any) => {
    const { createChildLogger } = require('@clude/shared/core/logger');
    const log = createChildLogger('main');
    log.fatal({ err }, 'Failed to start. Even booting up is too much effort sometimes.');
    process.exit(1);
  });
}
