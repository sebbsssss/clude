#!/usr/bin/env node
/**
 * CLI: PMP staging smoke test.
 *
 * Hits a running PMP provider and exercises all four verbs end-to-end.
 * Reports pass/fail per verb with timing. Designed for use right after a
 * staging deploy to confirm the migration + routes + tokenisation pipeline
 * are all healthy.
 *
 * Usage:
 *   PMP_BASE_URL=https://cludebot-test-preview.up.railway.app \
 *     pnpm --filter @clude/server tsx src/bin/pmp-smoke-test.ts
 *
 *   # With auth (exercises CONTRIBUTE):
 *   PMP_BASE_URL=... PMP_BEARER_TOKEN=<privy-jwt> \
 *     pnpm --filter @clude/server tsx src/bin/pmp-smoke-test.ts
 *
 * Environment:
 *   PMP_BASE_URL          required, e.g. https://api.pmp.dev
 *   PMP_BEARER_TOKEN      optional. If set, CONTRIBUTE is exercised.
 *   PMP_SMOKE_MEMORY_ID   optional. Specific memory id to RETRIEVE/VERIFY.
 *                         If not set, picks the first one from DISCOVER.
 *
 * Exit code: 0 on all green, 1 on any failure.
 */

import { PmpClient, PmpError } from '@clude/pmp-sdk';

interface Step {
  name: string;
  fn: () => Promise<unknown>;
}

interface StepResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  note?: string;
  error?: string;
}

function formatResult(r: StepResult): string {
  const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '–' : '✗';
  const time = r.status === 'pass' ? `(${r.durationMs}ms)` : '';
  const detail = r.note ? `  → ${r.note}` : r.error ? `  ✗ ${r.error}` : '';
  return `  ${icon} ${r.name} ${time}${detail}`;
}

async function timed(step: Step): Promise<StepResult> {
  const start = Date.now();
  try {
    const note = (await step.fn()) as string | undefined;
    return {
      name: step.name,
      status: 'pass',
      durationMs: Date.now() - start,
      note,
    };
  } catch (err) {
    return {
      name: step.name,
      status: 'fail',
      durationMs: Date.now() - start,
      error: stringifyError(err),
    };
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof PmpError) {
    const e: PmpError = err;
    return '[' + e.status + ' ' + e.code + '] ' + (e.reason ?? e.message);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

async function main(): Promise<void> {
  const baseUrl = process.env.PMP_BASE_URL;
  if (!baseUrl) {
    console.error('PMP_BASE_URL is required');
    process.exit(2);
  }
  const bearer = process.env.PMP_BEARER_TOKEN;
  const explicitId = process.env.PMP_SMOKE_MEMORY_ID;

  console.log(`PMP smoke test against ${baseUrl}`);
  console.log(`  auth: ${bearer ? 'Bearer token configured' : 'unauthenticated (CONTRIBUTE will be skipped)'}`);
  console.log('');

  const client = new PmpClient({ baseUrl, auth: bearer ? { bearer } : undefined });
  const results: StepResult[] = [];

  // Capture a memory id to use across the dependent steps.
  let memoryId: string | null = explicitId ?? null;

  // 1. DISCOVER — always tested.
  results.push(
    await timed({
      name: 'DISCOVER /v1/memories?limit=5',
      fn: async () => {
        const res = await client.discover({ limit: 5 });
        if (!memoryId && res.memories.length > 0) memoryId = res.memories[0]!.id;
        return `${res.count} memor${res.count === 1 ? 'y' : 'ies'} returned`;
      },
    }),
  );

  // 2. RETRIEVE — skipped if no memory id available.
  if (!memoryId) {
    results.push({
      name: 'RETRIEVE /v1/memories/:id',
      status: 'skip',
      durationMs: 0,
      note: 'no memory id available (set PMP_SMOKE_MEMORY_ID or seed DISCOVER results)',
    });
  } else {
    results.push(
      await timed({
        name: `RETRIEVE /v1/memories/${memoryId}`,
        fn: async () => {
          const m = await client.retrieve(memoryId!);
          return `type=${m.type}, attestation=${m.attestation ? 'present' : 'null'}`;
        },
      }),
    );
  }

  // 3. VERIFY — always test if we have an id; public endpoint, no auth needed.
  if (!memoryId) {
    results.push({
      name: 'VERIFY /v1/memories/:id/verify',
      status: 'skip',
      durationMs: 0,
      note: 'no memory id available',
    });
  } else {
    results.push(
      await timed({
        name: `VERIFY /v1/memories/${memoryId}/verify`,
        fn: async () => {
          const v = await client.verify(memoryId!);
          return `verified=${v.verified}, reason=${v.reason}`;
        },
      }),
    );
  }

  // 4. CONTRIBUTE — only if auth is configured.
  if (!bearer) {
    results.push({
      name: 'CONTRIBUTE /v1/memories',
      status: 'skip',
      durationMs: 0,
      note: 'no PMP_BEARER_TOKEN; provide one to exercise this verb',
    });
  } else {
    let contributedId: string | null = null;
    results.push(
      await timed({
        name: 'CONTRIBUTE /v1/memories',
        fn: async () => {
          const r = await client.contribute({
            content: `PMP smoke test ${new Date().toISOString()}`,
            type: 'episodic',
            tags: ['smoke-test'],
            source: 'pmp-smoke-test',
          });
          contributedId = r.id;
          return `id=${r.id}, attestation=${r.attestation ? r.attestation.chain_id : 'null'}`;
        },
      }),
    );

    // 5. VERIFY the just-contributed memory to confirm the full loop.
    if (contributedId) {
      results.push(
        await timed({
          name: `VERIFY (round-trip) /v1/memories/${contributedId}/verify`,
          fn: async () => {
            const v = await client.verify(contributedId!);
            if (!v.verified) {
              throw new Error(`expected verified=true, got verified=${v.verified} reason=${v.reason}`);
            }
            return `verified=${v.verified}`;
          },
        }),
      );
    }
  }

  console.log('Results:');
  for (const r of results) console.log(formatResult(r));
  console.log('');

  const failed = results.filter((r) => r.status === 'fail');
  const passed = results.filter((r) => r.status === 'pass');
  const skipped = results.filter((r) => r.status === 'skip');
  console.log(`  ${passed.length} passed · ${failed.length} failed · ${skipped.length} skipped`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});
