import { config } from '../config';

// ============================================================
// MEMORY-MODEL CONFIG (effective, with SDK runtime override)
//
// The memory model (CludeMem) is configured from env at startup
// (config.memoryModel), but the SDK / desktop app needs to enable it
// programmatically AFTER config has frozen — e.g. Cortex "local mode".
// This module provides a single source of truth: env config, optionally
// overridden at runtime via _configureMemoryModel(). Mirrors the
// _configureEmbeddings() override pattern in embeddings.ts.
// ============================================================

export type MemoryModelProvider = '' | 'ollama' | 'anthropic' | 'openrouter';

export interface MemoryModelConfig {
  provider: MemoryModelProvider;
  model: string;
  ollamaUrl: string;
  timeoutMs: number;
}

let _override: Partial<MemoryModelConfig> | null = null;

/**
 * SDK / desktop runtime override for the memory model (e.g. local mode).
 * Pass only the fields you want to change; the rest fall back to env config.
 */
export function _configureMemoryModel(cfg: Partial<MemoryModelConfig>): void {
  _override = cfg;
}

/** @internal Test helper — clears any runtime override. */
export function _resetMemoryModelConfig(): void {
  _override = null;
}

/** The effective memory-model config: runtime override merged over env config. */
export function getMemoryModelConfig(): MemoryModelConfig {
  return {
    provider: (_override?.provider ?? config.memoryModel.provider) as MemoryModelProvider,
    model: _override?.model ?? config.memoryModel.model,
    ollamaUrl: _override?.ollamaUrl ?? config.memoryModel.ollamaUrl,
    timeoutMs: _override?.timeoutMs ?? config.memoryModel.timeoutMs,
  };
}
