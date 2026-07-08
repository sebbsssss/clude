/**
 * pack-title.routes — public metadata + image for a pack's 1-of-1 title NFT.
 * Covers the privacy gate (no pack_titles row → 404), the Metaplex JSON shape, the image
 * content-types, and DB-error → 500 (fail closed, never leak a pack as untitled on outage).
 * getDb + sharp + logger are mocked; no native rasterise, no live DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Per-table maybeSingle result, settable per test. Each .from(table) returns a chainable that
// resolves to results[table] (defaulting to {data:null,error:null}).
let results: Record<string, { data: any; error: any }>;
const db = {
  from(table: string) {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve(results[table] ?? { data: null, error: null }),
    };
    return q;
  },
};
vi.mock('@clude/shared/core/database', () => ({ getDb: () => db }));

// sharp(svg).png().toBuffer() → a buffer whose first bytes are the PNG signature.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
vi.mock('sharp', () => ({
  default: () => ({ png: () => ({ toBuffer: async () => PNG_SIG }) }),
}));

import { packTitleRoutes } from '../pack-title.routes.js';

function app() {
  const a = express();
  a.use(packTitleRoutes());
  return a;
}

const PACK = 'pack-abcdef12';
function seedTitled() {
  results = {
    pack_titles: { data: { pack_id: PACK, chain: 'solana-devnet', mint_address: 'Mint3333333333333333333333333333333333' }, error: null },
    memory_packs: { data: { name: 'My Memory Pack', created_at: '2026-06-20T00:00:00Z' }, error: null },
    pmp_artifacts: { data: { record_count: 42 }, error: null },
  };
}

describe('GET /api/pack-title/:packId.json', () => {
  beforeEach(() => { results = {}; });

  it('PRIVACY: 404s a pack with no minted title (no pack_titles row)', async () => {
    results = { pack_titles: { data: null, error: null } };
    const res = await request(app()).get(`/api/pack-title/${PACK}.json`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('title_not_found');
  });

  it('returns Metaplex metadata for a titled pack', async () => {
    seedTitled();
    const res = await request(app()).get(`/api/pack-title/${PACK}.json`);
    expect(res.status).toBe(200);
    expect(res.body.name).toContain('My Memory Pack');
    expect(res.body.symbol).toBe('CLUDE');
    expect(res.body.image).toBe(`https://clude.io/api/pack-title/${PACK}.png`);
    expect(res.body.properties.category).toBe('image');
    expect(res.body.attributes).toEqual(
      expect.arrayContaining([{ trait_type: 'Memories', value: 42 }, { trait_type: 'Chain', value: 'solana-devnet' }]),
    );
  });

  it('strips the internal "— title snapshot" suffix so the NFT shows the clean name', async () => {
    seedTitled();
    results.memory_packs = { data: { name: 'Trip Notes — title snapshot', created_at: '2026-06-20T00:00:00Z' }, error: null };
    const res = await request(app()).get(`/api/pack-title/${PACK}.json`);
    expect(res.body.name).toBe('Clude Pack Title: Trip Notes');
  });

  it('honours SOLANA_TITLE_METADATA_BASE_URI for the image host', async () => {
    seedTitled();
    process.env.SOLANA_TITLE_METADATA_BASE_URI = 'https://preview.example.com/api/pack-title/';
    const res = await request(app()).get(`/api/pack-title/${PACK}.json`);
    expect(res.body.image).toBe(`https://preview.example.com/api/pack-title/${PACK}.png`);
    delete process.env.SOLANA_TITLE_METADATA_BASE_URI;
  });

  it('500s on a DB error (fails closed, does not 404 a real pack)', async () => {
    results = { pack_titles: { data: null, error: { message: 'boom' } } };
    const res = await request(app()).get(`/api/pack-title/${PACK}.json`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('render_failed');
  });
});

describe('GET /api/pack-title/:packId.{png,svg}', () => {
  beforeEach(seedTitled);

  it('serves a PNG with the right content-type', async () => {
    const res = await request(app()).get(`/api/pack-title/${PACK}.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG signature
  });

  it('serves the SVG card, with the pack name escaped', async () => {
    results.memory_packs = { data: { name: '</text><script>x</script>', created_at: null }, error: null };
    const res = await request(app()).get(`/api/pack-title/${PACK}.svg`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    // superagent buffers image/svg+xml into res.body; fall back to text for safety.
    const svg = res.text ?? res.body.toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<script>');
  });

  it('404s an unsupported extension', async () => {
    const res = await request(app()).get(`/api/pack-title/${PACK}.gif`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
