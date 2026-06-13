export { config } from './config';

// Memory-model capability checks (top-level so consumers and the desktop-app
// integration contract can probe without a deep import). The heavy clients stay
// on their deep subpaths, e.g. `@clude/shared/core/ollama-client`.
export { isOllamaEnabled, isMemoryModelEnabled } from './core/inference';
