import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('chat-attachments');

export const ALLOWED_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export interface AttachmentMeta {
  storage_path: string;
  mime: AllowedImageMime;
  width: number;
  height: number;
  size_bytes: number;
}

export interface AttachmentWithUrl extends AttachmentMeta {
  url: string;
}

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function mimeToExt(mime: string): string {
  if (!(mime in MIME_TO_EXT)) {
    throw new Error(`Unsupported image mime: ${mime}`);
  }
  return MIME_TO_EXT[mime as AllowedImageMime];
}

export function validateAttachmentPath(
  storagePath: string,
  ownerWallet: string,
  conversationId: string,
): boolean {
  if (storagePath.includes('..')) return false;
  const expectedPrefix = `${ownerWallet}/${conversationId}/`;
  if (!storagePath.startsWith(expectedPrefix)) return false;
  const tail = storagePath.slice(expectedPrefix.length);
  if (tail.includes('/')) return false;
  return /^[a-f0-9-]{4,}\.(png|jpg|webp|gif)$/i.test(tail);
}

export const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function attachWithSignedUrls(
  attachments: AttachmentMeta[] | null | undefined,
): Promise<AttachmentWithUrl[]> {
  if (!attachments || attachments.length === 0) return [];
  const db = getDb();
  const out: AttachmentWithUrl[] = [];
  await Promise.all(
    attachments.map(async (att, i) => {
      const { data, error } = await db.storage
        .from('cc-images')
        .createSignedUrl(att.storage_path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        log.warn({ err: error, storage_path: att.storage_path }, 'sign url failed');
        out[i] = { ...att, url: '' };
        return;
      }
      out[i] = { ...att, url: data.signedUrl };
    }),
  );
  return out;
}
