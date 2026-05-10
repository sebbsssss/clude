// apps/server/src/routes/chat-uploads.routes.ts
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import {
  ALLOWED_IMAGE_MIMES,
  type AllowedImageMime,
  mimeToExt,
  SIGNED_URL_TTL_SECONDS,
} from '../lib/chat-attachments';

const log = createChildLogger('chat-uploads');

const MAX_BYTES = 20 * 1024 * 1024;
const DAILY_BYTE_CAP = 200 * 1024 * 1024;

const uuidSchema = z.string().uuid();

interface ChatRequest extends Request { ownerWallet?: string; }

// In-memory rolling 24h byte usage per wallet.
// Single-instance, resets on redeploy. Acceptable per spec.
const usage = new Map<string, { bytes: number; resetAt: number }>();
function recordAndCheck(wallet: string, bytes: number): boolean {
  const now = Date.now();
  const entry = usage.get(wallet);
  if (!entry || entry.resetAt < now) {
    usage.set(wallet, { bytes, resetAt: now + 24 * 60 * 60 * 1000 });
    return true;
  }
  if (entry.bytes + bytes > DAILY_BYTE_CAP) return false;
  entry.bytes += bytes;
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

export function createChatUploadsRouter(): Router {
  const router = Router();

  router.post('/image', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const wallet = chatReq.ownerWallet;
      if (!wallet) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const conversationId = String(req.body?.conversation_id || '');
      const parsed = uuidSchema.safeParse(conversationId);
      if (!parsed.success) { res.status(400).json({ error: 'conversation_id must be a UUID' }); return; }

      if (!req.file) { res.status(400).json({ error: 'file is required' }); return; }

      const detected = await fileTypeFromBuffer(req.file.buffer);
      if (!detected || !ALLOWED_IMAGE_MIMES.includes(detected.mime as AllowedImageMime)) {
        res.status(400).json({ error: 'Unsupported image format' }); return;
      }
      const mime = detected.mime as AllowedImageMime;

      let cleanBuf: Buffer;
      let width = 0;
      let height = 0;
      try {
        const pipeline = sharp(req.file.buffer, { animated: mime === 'image/gif' });
        const meta = await pipeline.metadata();
        if (!meta.width || !meta.height) throw new Error('no dimensions');
        width = meta.width; height = meta.height;
        if (mime === 'image/png') cleanBuf = await pipeline.png().toBuffer();
        else if (mime === 'image/jpeg') cleanBuf = await pipeline.jpeg({ quality: 90 }).toBuffer();
        else if (mime === 'image/webp') cleanBuf = await pipeline.webp({ quality: 90 }).toBuffer();
        else cleanBuf = await pipeline.gif().toBuffer();
      } catch (e) {
        log.warn({ err: e }, 'sharp decode failed');
        res.status(400).json({ error: 'Could not decode image' }); return;
      }

      const sizeBytes = cleanBuf.length;
      if (!recordAndCheck(wallet, sizeBytes)) {
        res.status(429).json({ error: 'Daily upload quota exceeded' }); return;
      }

      const ext = mimeToExt(mime);
      const storagePath = `${wallet}/${conversationId}/${randomUUID()}.${ext}`;

      const db = getDb();
      const { error: upErr } = await db.storage
        .from('cc-images')
        .upload(storagePath, cleanBuf, { contentType: mime, upsert: false });
      if (upErr) {
        log.error({ err: upErr, storagePath }, 'storage upload failed');
        res.status(500).json({ error: 'Upload failed' }); return;
      }

      const { data: signed, error: signErr } = await db.storage
        .from('cc-images')
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (signErr || !signed) {
        log.error({ err: signErr, storagePath }, 'sign url failed');
        res.status(500).json({ error: 'Sign URL failed' }); return;
      }

      res.json({
        url: signed.signedUrl,
        storage_path: storagePath,
        mime, width, height,
        size_bytes: sizeBytes,
      });
    } catch (err) {
      log.error({ err }, 'upload image error');
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
