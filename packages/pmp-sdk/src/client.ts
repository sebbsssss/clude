/**
 * PmpClient — thin fetch-based wrapper over the four PMP verbs.
 *
 * Works in Node 18+ (built-in fetch) and any modern browser. Zero runtime
 * dependencies beyond @clude/tokenization (for the canonical content hash
 * used by the standalone verifier).
 */

import { PmpError } from './errors';
import type {
  ContributeOptions,
  ContributeResponse,
  DiscoverOptions,
  DiscoverResponse,
  ErrorBody,
  Memory,
  VerifyResponse,
} from './types';

export type AuthHeader = {
  /** Provider-defined auth. Reference impl uses Privy JWT via `Authorization: Bearer <jwt>`. */
  bearer?: string;
  /** Solana wallet signature for portable auth (X-PMP-Wallet-Signature). */
  walletSignature?: string;
  /** Any additional headers to merge in. */
  extra?: Record<string, string>;
};

export interface PmpClientOptions {
  /** Base URL of a PMP provider, e.g. `https://api.pmp.dev` */
  baseUrl: string;
  /** Bearer / wallet-sig / extra headers to attach to every request. */
  auth?: AuthHeader;
  /** Optional fetch implementation. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export class PmpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  auth: AuthHeader;

  constructor(opts: PmpClientOptions) {
    if (!opts.baseUrl) throw new Error('PmpClient: baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.auth = opts.auth ?? {};
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** DISCOVER — GET /v1/memories?... */
  async discover(opts: DiscoverOptions = {}): Promise<DiscoverResponse> {
    const params = new URLSearchParams();
    if (opts.query) params.set('query', opts.query);
    if (opts.owner) params.set('owner', opts.owner);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    (opts.tags ?? []).forEach((t) => params.append('tags', t));
    (opts.memory_types ?? []).forEach((t) => params.append('memory_types', t));
    return this.request<DiscoverResponse>('GET', `/v1/memories?${params.toString()}`);
  }

  /** RETRIEVE — GET /v1/memories/:id  (throws PmpError on 402 / 410 / 404) */
  async retrieve(id: string): Promise<Memory> {
    return this.request<Memory>('GET', `/v1/memories/${encodeURIComponent(id)}`);
  }

  /** VERIFY — GET /v1/memories/:id/verify  (public, no auth required) */
  async verify(id: string): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('GET', `/v1/memories/${encodeURIComponent(id)}/verify`, {
      skipAuth: true,
    });
  }

  /** CONTRIBUTE — POST /v1/memories */
  async contribute(opts: ContributeOptions): Promise<ContributeResponse> {
    return this.request<ContributeResponse>('POST', '/v1/memories', { body: opts });
  }

  // ─────────── internals ───────────

  private buildHeaders(skipAuth = false): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (!skipAuth) {
      if (this.auth.bearer) headers['Authorization'] = `Bearer ${this.auth.bearer}`;
      if (this.auth.walletSignature) headers['X-PMP-Wallet-Signature'] = this.auth.walletSignature;
    }
    if (this.auth.extra) Object.assign(headers, this.auth.extra);
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; skipAuth?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = this.buildHeaders(opts.skipAuth);
    // Use Parameters<typeof fetch> so we don't depend on the DOM-lib's RequestInit
    // type. Works whether the consumer's tsconfig has DOM or just ES2022.
    type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>;
    const init: FetchInit = { method, headers, signal: controller.signal };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res: Awaited<ReturnType<typeof globalThis.fetch>>;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      clearTimeout(timeout);
      // Network error / abort. Wrap so callers handle PmpError uniformly.
      const message = err instanceof Error ? err.message : String(err);
      throw new PmpError(0, { error: 'bad_request', reason: 'network', hint: message });
    }
    clearTimeout(timeout);

    if (res.status === 204) return undefined as T;

    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: 'bad_request', reason: 'invalid_json', hint: text.slice(0, 200) };
      }
    }

    if (!res.ok) {
      throw new PmpError(res.status, body as ErrorBody | null);
    }
    return body as T;
  }
}
