/**
 * pack-title.routes — public, off-chain metadata + image for a pack's 1-of-1 title NFT.
 *
 *   GET /api/pack-title/:packId.json   Metaplex off-chain metadata (the `uri` the mint embeds)
 *   GET /api/pack-title/:packId.png    the title card, rasterised (the metadata `image`)
 *   GET /api/pack-title/:packId.svg     the title card as SVG (handy + a no-fontconfig fallback)
 *
 * These endpoints are intentionally PUBLIC and UNAUTHENTICATED — an NFT's metadata is fetched by
 * wallets, explorers, and marketplaces that hold no Clude session. The privacy boundary is the
 * `pack_titles` existence gate: a pack only resolves here once it has actually been minted as a
 * title. A pack with no `pack_titles` row 404s, so private pack names/counts cannot be enumerated
 * by guessing pack ids. The card itself carries only public facts (name, count, date, mint, chain)
 * — never the owner wallet, memory contents, or any PII.
 *
 * The metadata base is the SAME env the mint uses (SOLANA_TITLE_METADATA_BASE_URI), so the `image`
 * URL the JSON advertises always matches the host the on-chain `uri` points at.
 */
import { Router, type Request, type Response } from 'express';
import sharp from 'sharp';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { renderPackTitleCardSvg, type PackTitleCardInput } from '../lib/pack-title-card.js';

const log = createChildLogger('pack-title-routes');

const ALLOWED_EXT = new Set(['json', 'png', 'svg']);

/** The public base the on-chain `uri` + the JSON `image` share. Trailing slash stripped. */
function metadataBase(): string {
  return (process.env.SOLANA_TITLE_METADATA_BASE_URI ?? 'https://clude.io/api/pack-title').replace(/\/+$/, '');
}

/** Split "pack-abc123.png" → { packId: 'pack-abc123', ext: 'png' }. Null if there is no extension. */
function parseFile(file: string): { packId: string; ext: string } | null {
  const i = file.lastIndexOf('.');
  if (i <= 0 || i === file.length - 1) return null;
  return { packId: file.slice(0, i), ext: file.slice(i + 1).toLowerCase() };
}

interface DbLike {
  from: (t: string) => any;
}

/**
 * Load the public card facts for a pack IFF it has a minted title. Returns null when there is no
 * `pack_titles` row (→ 404, the privacy gate). Throws on a real DB error so the route fails 500
 * rather than leaking a pack as "untitled" during an outage.
 */
export async function loadTitleCardData(db: DbLike, packId: string): Promise<PackTitleCardInput | null> {
  const { data: title, error: tErr } = await db
    .from('pack_titles')
    .select('pack_id, chain, mint_address')
    .eq('pack_id', packId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!title) return null; // not minted as a title → not public

  const { data: pack, error: pErr } = await db
    .from('memory_packs')
    .select('name, created_at')
    .eq('pack_id', packId)
    .maybeSingle();
  if (pErr) throw pErr;

  const { data: art, error: aErr } = await db
    .from('pmp_artifacts')
    .select('record_count')
    .eq('pack_id', packId)
    .maybeSingle();
  if (aErr) throw aErr;

  // The title binds a SNAPSHOT pack named "<name> — title snapshot"; strip that internal suffix so
  // the public NFT shows the clean pack name.
  const rawName = (pack?.name as string | undefined) ?? 'Clude Memory Pack';
  return {
    name: rawName.replace(/\s*[—-]\s*title snapshot\s*$/i, '').trim() || 'Clude Memory Pack',
    memoryCount: Number(art?.record_count ?? 0),
    dateISO: (pack?.created_at as string | undefined) ?? null,
    packId,
    mintAddress: (title.mint_address as string | undefined) ?? null,
    chain: (title.chain as string | undefined) ?? null,
  };
}

/** Build the Metaplex off-chain metadata JSON for a titled pack. */
export function buildTitleMetadata(data: PackTitleCardInput, base: string) {
  const image = `${base}/${data.packId}.png`;
  const attributes: Array<{ trait_type: string; value: string | number }> = [
    { trait_type: 'Memories', value: data.memoryCount },
    { trait_type: 'Edition', value: '1 of 1' },
  ];
  if (data.dateISO) attributes.push({ trait_type: 'Created', value: data.dateISO.slice(0, 10) });
  if (data.chain) attributes.push({ trait_type: 'Chain', value: data.chain });
  return {
    name: `Clude Pack Title: ${data.name}`.slice(0, 64),
    symbol: 'CLUDE',
    description:
      `Ownership title for the Clude memory pack "${data.name}" (${data.memoryCount} memories). ` +
      `A 1-of-1, non-custodial NFT: holding it unlocks the pack's encrypted contents.`,
    image,
    external_url: `https://clude.io/pack/${data.packId}`,
    seller_fee_basis_points: 0,
    attributes,
    properties: { files: [{ uri: image, type: 'image/png' }], category: 'image' },
  };
}

export function packTitleRoutes(): Router {
  const router = Router();

  router.get('/api/pack-title/:file', async (req: Request, res: Response) => {
    const parsed = parseFile(req.params.file);
    if (!parsed || !ALLOWED_EXT.has(parsed.ext)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { packId, ext } = parsed;
    try {
      const data = await loadTitleCardData(getDb() as unknown as DbLike, packId);
      if (!data) {
        res.status(404).json({ error: 'title_not_found' });
        return;
      }

      if (ext === 'json') {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(buildTitleMetadata(data, metadataBase()));
        return;
      }

      const svg = renderPackTitleCardSvg(data);
      if (ext === 'svg') {
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(svg);
        return;
      }

      // png — rasterise the SVG card via sharp (no extra dependency).
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(png);
    } catch (err) {
      log.error({ err, packId, ext }, 'pack-title metadata/image failed');
      res.status(500).json({ error: 'render_failed' });
    }
  });

  return router;
}
