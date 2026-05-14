/**
 * Error class thrown by the PMP SDK. Carries the HTTP status, the provider's
 * machine-readable code, and any optional reason / hint / x402 payload.
 *
 * Catch the base PmpError; switch on .status or .code for specific cases.
 */

import type { ErrorBody, ErrorCode } from './types';

export class PmpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly reason?: string;
  readonly hint?: string;
  /** Raw 402 payload from the provider — pass to x402 client to settle. */
  readonly x402?: unknown;

  constructor(status: number, body: ErrorBody | null, fallbackMessage = 'PMP request failed') {
    const code: ErrorCode = body?.error ?? 'bad_request';
    const parts = [code, body?.reason, body?.hint].filter(Boolean);
    super(parts.length > 0 ? parts.join(' — ') : fallbackMessage);
    this.name = 'PmpError';
    this.status = status;
    this.code = code;
    this.reason = body?.reason;
    this.hint = body?.hint;
    this.x402 = body?.x402;
  }

  /** True iff the server responded with HTTP 402. Caller should drive x402 flow. */
  get isPaymentRequired(): boolean {
    return this.status === 402;
  }

  /** True iff the memory has been revoked / compacted (HTTP 410). */
  get isRevoked(): boolean {
    return this.status === 410;
  }

  /** True iff this is a transient failure worth retrying (429 / 500). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
