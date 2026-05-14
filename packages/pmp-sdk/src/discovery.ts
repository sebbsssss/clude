/**
 * Cross-provider discovery.
 *
 * Fan out DISCOVER calls to every provider in a registry and aggregate the
 * results. v0.1 uses a static JSON registry hosted alongside the spec; v0.2
 * will move to an on-chain ENS-style resolver but the client API stays the same.
 *
 * Failure semantics: a per-provider failure is recorded in `errors[]` but
 * does not abort the whole call. The caller decides whether to surface a
 * partial result or retry.
 */

import { PmpClient } from './client';
import { PmpError } from './errors';
import type { DiscoverOptions, Memory } from './types';

export interface RegistryProvider {
  name: string;
  endpoint: string;
  chain_id: string;
  verbs_supported: string[];
  spec_version?: string;
  description?: string;
}

export interface Registry {
  schema_version: string;
  spec_version: string;
  updated_at?: string;
  providers: RegistryProvider[];
}

export interface CrossProviderMemory extends Memory {
  /** Which registry provider returned this memory. */
  provider: string;
}

export interface CrossProviderError {
  provider: string;
  endpoint: string;
  message: string;
  status?: number;
}

export interface CrossProviderResult {
  memories: CrossProviderMemory[];
  errors: CrossProviderError[];
  /** Per-provider count, useful for showing where results came from. */
  perProvider: Record<string, number>;
}

export interface DiscoverAcrossProvidersOptions extends DiscoverOptions {
  /** URL to fetch the registry from. Mutually exclusive with `providers`. */
  registryUrl?: string;
  /** Inline registry providers list. Mutually exclusive with `registryUrl`. */
  providers?: RegistryProvider[];
  /** Filter providers by required verb support. Defaults to ['DISCOVER']. */
  requiredVerbs?: string[];
  /** Per-provider request timeout in ms. Defaults to 10s. */
  perProviderTimeoutMs?: number;
  /** Optional fetch implementation (testing). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Fetch the registry, then call DISCOVER on every provider in parallel.
 *
 * Returns a merged result with per-provider attribution and an `errors[]`
 * list of providers that failed (so callers can surface or retry).
 */
export async function discoverAcrossProviders(
  opts: DiscoverAcrossProvidersOptions,
): Promise<CrossProviderResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const requiredVerbs = opts.requiredVerbs ?? ['DISCOVER'];
  const timeoutMs = opts.perProviderTimeoutMs ?? 10_000;

  let providers: RegistryProvider[];
  if (opts.providers) {
    providers = opts.providers;
  } else if (opts.registryUrl) {
    const res = await fetchImpl(opts.registryUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`registry fetch failed: HTTP ${res.status} from ${opts.registryUrl}`);
    }
    const registry = (await res.json()) as Registry;
    providers = registry.providers ?? [];
  } else {
    throw new Error('discoverAcrossProviders: either registryUrl or providers is required');
  }

  // Filter providers that support the verbs we need.
  const eligible = providers.filter((p) =>
    requiredVerbs.every((v) => p.verbs_supported.includes(v)),
  );

  // Strip caller-supplied opts that aren't real DiscoverOptions
  const {
    registryUrl: _r,
    providers: _p,
    requiredVerbs: _v,
    perProviderTimeoutMs: _t,
    fetch: _f,
    ...discoverOpts
  } = opts;

  const memories: CrossProviderMemory[] = [];
  const errors: CrossProviderError[] = [];
  const perProvider: Record<string, number> = {};

  await Promise.all(
    eligible.map(async (p) => {
      const client = new PmpClient({
        baseUrl: p.endpoint,
        fetch: fetchImpl,
        timeoutMs,
      });
      try {
        const res = await client.discover(discoverOpts);
        perProvider[p.name] = res.memories.length;
        for (const m of res.memories) {
          memories.push({ ...m, provider: p.name });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof PmpError ? err.status : undefined;
        errors.push({ provider: p.name, endpoint: p.endpoint, message, status });
      }
    }),
  );

  return { memories, errors, perProvider };
}
