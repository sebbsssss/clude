import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadHallucinationData } from '../proof-hallucination.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proof-hallucination-test-'));
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

describe('loadHallucinationData', () => {
  it('loads all three fixture files from a valid directory', () => {
    const dir = makeTmpDir();

    const results = {
      placeholder: false,
      rate: 0.72,
      baselineRate: 0.41,
      n: 100,
      model: 'anthropic/claude-haiku-4.5',
      datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
      runAt: '2025-03-31T00:00:00Z',
      byCategory: { block_time: { n: 50, rate: 0.8 } },
    };

    const examples = [
      { id: 'ex-1', question: 'What is 1?', groundTruth: 'one', clude: { answer: 'one', correct: true }, baseline: { answer: 'two', correct: false } },
    ];

    const qa = {
      datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
      count: 2,
      items: [
        { id: 'block:1::block_time', category: 'block_time', question: 'When?', gold: '2025-01-01T00:00:00Z', sourceRef: 'block:1' },
        { id: 'block:1::block_leader', category: 'block_leader', question: 'Who?', gold: 'ABC123', sourceRef: 'block:1' },
      ],
    };

    writeJson(dir, 'solana-grounding-results.json', results);
    writeJson(dir, 'solana-grounding-examples.json', examples);
    writeJson(dir, 'solana-qa.json', qa);

    const loaded = loadHallucinationData(dir);

    expect(loaded.results).toMatchObject({ rate: 0.72, n: 100 });
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.examples[0]).toMatchObject({ id: 'ex-1' });
    expect(loaded.qa).toHaveLength(2);
    expect(loaded.qa[0]).toMatchObject({ id: 'block:1::block_time', category: 'block_time' });
  });

  it('returns safe defaults when the directory does not exist', () => {
    const dir = '/tmp/definitely-does-not-exist-xyz-abc-123';
    const loaded = loadHallucinationData(dir);
    expect(loaded.results).toBeNull();
    expect(loaded.examples).toEqual([]);
    expect(loaded.qa).toEqual([]);
  });

  it('returns safe defaults for individual corrupted files without throwing', () => {
    const dir = makeTmpDir();
    // Write only results (valid) and corrupt the others
    writeJson(dir, 'solana-grounding-results.json', { placeholder: true, rate: null });
    fs.writeFileSync(path.join(dir, 'solana-grounding-examples.json'), 'NOT JSON{{{{');
    fs.writeFileSync(path.join(dir, 'solana-qa.json'), 'null');

    const loaded = loadHallucinationData(dir);
    // results loaded fine
    expect(loaded.results).toMatchObject({ placeholder: true });
    // corrupted examples → safe default
    expect(loaded.examples).toEqual([]);
    // null parsed → qa falls back to []
    expect(loaded.qa).toEqual([]);
  });
});
