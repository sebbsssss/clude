/**
 * export-flow — the register-on-demand control logic the MemoryExportPanel runs when
 * encryption-by-default fails closed. These tests pin the load-bearing behavior WITHOUT a DOM:
 *
 *   - encrypted export 422s with `holder_key_unregistered` → registerOwnerKey() called ONCE → retry
 *     succeeds → returns the retried result.
 *   - registration unavailable (no registerOwnerKey) → throws an actionable message (no plaintext).
 *   - registration FAILS → throws, export NOT retried (never silently downgrades).
 *   - never loops: a second holder-key rejection after register propagates (one retry only).
 *   - a non-holder-key error propagates unchanged; a holder-key error on a PLAINTEXT export propagates.
 */
import { describe, it, expect, vi } from 'vitest';

import { runExportWithRegister, REGISTER_KEY_HINT } from '../export-flow';
import { HolderKeyUnregisteredError } from '../../types';
import type { ExportRequest, ExportResult } from '../../types';

const REQ_ENC: ExportRequest = {
  selection: { scope: 'all' },
  name: 'My pack',
  category: 'personal',
  encrypt: true,
};
const REQ_PLAIN: ExportRequest = { ...REQ_ENC, encrypt: false };

function fakeResult(id: string): ExportResult {
  return {
    artifact: {
      artifact_id: id,
      title: 'My pack',
      record_count: 1,
      merkle_root: 'sha256:deadbeef',
      byte_size: 123,
      created_at: '2026-06-28T00:00:00.000Z',
    },
  };
}

describe('runExportWithRegister — register-on-demand + single retry', () => {
  it('registers ONCE then retries when the first encrypted export is holder_key_unregistered', async () => {
    const result = fakeResult('after-register');
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValueOnce(new HolderKeyUnregisteredError())
      .mockResolvedValueOnce(result);
    const registerOwnerKey = vi.fn<() => Promise<void>>().mockResolvedValue();

    const out = await runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_ENC);

    expect(out).toBe(result);
    expect(registerOwnerKey).toHaveBeenCalledTimes(1);
    expect(exportFn).toHaveBeenCalledTimes(2); // original + one retry
  });

  it('recognizes a plain { code } error object (not only the class instance)', async () => {
    const result = fakeResult('coded');
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValueOnce({ code: 'holder_key_unregistered', message: 'nope' })
      .mockResolvedValueOnce(result);
    const registerOwnerKey = vi.fn<() => Promise<void>>().mockResolvedValue();

    const out = await runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_ENC);
    expect(out).toBe(result);
    expect(registerOwnerKey).toHaveBeenCalledTimes(1);
  });

  it('throws an actionable message (and never retries) when registerOwnerKey is unavailable', async () => {
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValue(new HolderKeyUnregisteredError());

    await expect(runExportWithRegister({ export: exportFn }, REQ_ENC)).rejects.toThrow(
      REGISTER_KEY_HINT,
    );
    expect(exportFn).toHaveBeenCalledTimes(1); // no retry without a way to register
  });

  it('throws (no retry, no plaintext) when registration itself fails', async () => {
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValue(new HolderKeyUnregisteredError());
    const registerOwnerKey = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('user rejected the signature'));

    await expect(
      runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_ENC),
    ).rejects.toThrow(/Couldn’t register your encryption key/);
    expect(registerOwnerKey).toHaveBeenCalledTimes(1);
    expect(exportFn).toHaveBeenCalledTimes(1); // the failed register aborts before any retry
  });

  it('does NOT loop — a second holder-key rejection after register propagates', async () => {
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValue(new HolderKeyUnregisteredError()); // always 422
    const registerOwnerKey = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_ENC),
    ).rejects.toBeInstanceOf(HolderKeyUnregisteredError);
    expect(registerOwnerKey).toHaveBeenCalledTimes(1);
    expect(exportFn).toHaveBeenCalledTimes(2); // original + exactly one retry, then give up
  });

  it('propagates a non-holder-key export error unchanged (no registration attempted)', async () => {
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValue(new Error('Request failed (500)'));
    const registerOwnerKey = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_ENC),
    ).rejects.toThrow('Request failed (500)');
    expect(registerOwnerKey).not.toHaveBeenCalled();
  });

  it('does NOT register for a PLAINTEXT export even if it returns holder_key_unregistered', async () => {
    const exportFn = vi
      .fn<(req: ExportRequest) => Promise<ExportResult>>()
      .mockRejectedValue(new HolderKeyUnregisteredError());
    const registerOwnerKey = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      runExportWithRegister({ export: exportFn, registerOwnerKey }, REQ_PLAIN),
    ).rejects.toBeInstanceOf(HolderKeyUnregisteredError);
    expect(registerOwnerKey).not.toHaveBeenCalled();
    expect(exportFn).toHaveBeenCalledTimes(1);
  });
});
