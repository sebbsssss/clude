// Lazy-load pino — SDK users don't need it installed
let _logger: any = null;

function getLogger(): any {
  if (!_logger) {
    try {
      const pino = require('pino');
      const logDestination = process.env.MCP_MODE === '1' ? 2 : 1;
      _logger = pino({
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino/file', options: { destination: logDestination } }
          : undefined,
      });
    } catch {
      // pino not installed (SDK mode) — use console fallback
      _logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: () => {},
        fatal: console.error,
        child: () => _logger,
      };
    }
  }
  return _logger;
}

export const logger = new Proxy({} as any, {
  get(_, prop) {
    return getLogger()[prop];
  },
});

export function createChildLogger(name: string) {
  return getLogger().child({ module: name });
}
