import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const fakeWallet = '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';
const fakeConv = '11111111-1111-4111-8111-111111111111';

// Minimal valid 2x2 red PNG (generated via sharp).
const RED_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000970485973000003e8' +
  '000003e801b57b526b0000001149444154789c63f8cfc0f01f8419600c0047ca07f967596eb70000000049454e44ae426082',
  'hex',
);

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ data: { path: 'ok' }, error: null })),
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: 'https://signed.example/x' }, error: null,
        })),
      })),
    },
  }),
}));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import { createChatUploadsRouter } from '../chat-uploads.routes';

function buildApp() {
  const app = express();
  app.use((req, _res, next) => { (req as any).ownerWallet = fakeWallet; next(); });
  app.use('/api/chat/uploads', createChatUploadsRouter());
  return app;
}

describe('POST /api/chat/uploads/image', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when conversation_id missing', async () => {
    const res = await request(buildApp())
      .post('/api/chat/uploads/image')
      .attach('file', RED_PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('rejects when bytes do not match a real image', async () => {
    const res = await request(buildApp())
      .post('/api/chat/uploads/image')
      .field('conversation_id', fakeConv)
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid PNG', async () => {
    const res = await request(buildApp())
      .post('/api/chat/uploads/image')
      .field('conversation_id', fakeConv)
      .attach('file', RED_PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mime: 'image/png',
      url: 'https://signed.example/x',
      width: 2,
      height: 2,
    });
    expect(res.body.storage_path).toMatch(new RegExp(`^${fakeWallet}/${fakeConv}/[a-f0-9-]+\\.png$`));
  });

  it('rejects non-uuid conversation_id', async () => {
    const res = await request(buildApp())
      .post('/api/chat/uploads/image')
      .field('conversation_id', 'not-a-uuid')
      .attach('file', RED_PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});
