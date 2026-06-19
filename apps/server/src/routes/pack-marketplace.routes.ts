/**
 * Marketplace listing endpoints — COPY-license only, compliance-gated.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 6 (spec §3D).
 *
 *   POST   /v1/listings              Create a draft from an owned pack (copy-only)
 *   PATCH  /v1/listings/:id          Edit draft fields (NEVER status/category/pack_id)
 *   POST   /v1/listings/:id/publish  draft → listed, ONLY if the compliance gate passes
 *   POST   /v1/listings/:id/delist   listed → delisted
 *   GET    /v1/listings/:id          Full listing
 *   GET    /v1/listings/mine         Seller's own listings
 *   GET    /v1/listings/:id/preview  Sealed-safe preview (reuses pack-preview.ts)
 *   GET    /v1/listings              Browse (only status='listed', filter category/tags)
 *
 * Fail-closed design (design §00 + founder):
 *   - `content_category` and `sale_mode` are read SERVER-SIDE from `memory_packs`
 *     (set at attest time, never client-set at listing). The client may not set or
 *     change them via create or PATCH.
 *   - `license_type` is forced to 'copy'; a `title` listing is refused (422) in this slice.
 *   - publish requires `evaluateGate() == passed` AND a non-flagged `pack_moderation`
 *     row AND a known, non-personal category. A pack containing secrets, a personal
 *     pack, an unclassified (NULL category) pack, or an un-scanned pack CANNOT reach
 *     status='listed' by any path.
 *   - `status` only ever moves via publish/delist — PATCH cannot touch it.
 *
 * Owner-scoping: every query filters by the caller wallet (`seller_wallet` for
 * listings, `author_wallet` for the backing pack). `ownerFromReq()` mirrors the
 * pattern in `pmp-packs.routes.ts:45`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { createChildLogger } from '@clude/shared/core/logger';
import { evaluateGate, type GateInput, type GateBlockingReason } from '../lib/compliance-gate.js';
import { buildPackPreview, type PreviewMemoryBody } from '../lib/pack-preview.js';
import { randomBytes } from 'node:crypto';

const log = createChildLogger('pack-marketplace-routes');

const TOS_DOC_ID = 'marketplace_tos';
const PREVIEW_MAX_REVEAL = 10;

// Moderation statuses that block publishing (anything not provably clean).
const FLAGGED_MODERATION_STATUSES = new Set(['flagged', 'quarantined', 'rejected', 'taken_down', 'suspended']);

// Listing statuses a draft may publish FROM.
const PUBLISHABLE_FROM = new Set(['draft', 'pending_compliance', 'delisted']);

// Fields a PATCH may edit. `status`, `content_category`, `pack_id`, `seller_wallet`,
// `license_type`, `compliance_gate` are deliberately excluded (immutable here).
const EDITABLE_FIELDS = new Set([
  'title',
  'description',
  'tags',
  'supply_kind',
  'supply_total',
  'preview_sample_count',
  'preview_redaction',
]);
const IMMUTABLE_FIELDS = new Set([
  'status',
  'content_category',
  'pack_id',
  'seller_wallet',
  'license_type',
  'compliance_gate',
  'listing_id',
]);

interface ErrorBody {
  error: string;
  reason?: string;
  hint?: string;
  blocking_reasons?: string[];
}

function ownerFromReq(req: Request): string | null {
  if (req.verifiedWallet) return req.verifiedWallet;
  const q = req.query.owner;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

function publicBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}`;
}

function generateListingId(): string {
  return `lst-${randomBytes(4).toString('hex')}`;
}

// ─────────── Pack rows (server source of truth for category + sale_mode) ───────────

interface PackRow {
  pack_id: string;
  author_wallet: string;
  name: string;
  version: string;
  memory_count: number;
  merkle_root: string | null;
  pack_token_address: string | null;
  content_category: 'personal' | 'knowledge' | 'agent' | null;
  sale_mode: 'copy' | 'title' | null;
}

const PACK_SELECT =
  'pack_id, author_wallet, name, version, memory_count, merkle_root, pack_token_address, content_category, sale_mode';

interface ListingRow {
  listing_id: string;
  pack_id: string;
  seller_wallet: string;
  title: string;
  description: string | null;
  tags: string[];
  content_category: 'personal' | 'knowledge' | 'agent';
  license_type: 'copy' | 'title';
  supply_kind: 'unlimited' | 'limited' | 'single';
  supply_total: number | null;
  supply_sold: number;
  preview_sample_count: number;
  preview_redaction: string;
  status: string;
  compliance_gate: 'blocked' | 'passed';
  created_at?: string;
  updated_at?: string;
}

/** Load a pack the caller must OWN. Returns null + writes a response on any failure. */
async function loadOwnedPack(
  req: Request,
  res: Response,
  packId: string,
  owner: string,
): Promise<PackRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from('memory_packs')
    .select(PACK_SELECT)
    .eq('pack_id', packId)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn({ err: error, packId }, 'pack lookup failed');
    res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    return null;
  }
  if (!data) {
    res.status(404).json({ error: 'pack_not_found' } satisfies ErrorBody);
    return null;
  }
  const pack = data as PackRow;
  if (pack.author_wallet !== owner) {
    res.status(403).json({ error: 'forbidden', hint: 'you do not own this pack' } satisfies ErrorBody);
    return null;
  }
  return pack;
}

/** Load a listing the caller must OWN (by seller_wallet). null + response on failure. */
async function loadOwnedListing(
  res: Response,
  listingId: string,
  owner: string,
): Promise<ListingRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from('pack_listings')
    .select('*')
    .eq('listing_id', listingId)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn({ err: error, listingId }, 'listing lookup failed');
    res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    return null;
  }
  if (!data) {
    res.status(404).json({ error: 'listing_not_found' } satisfies ErrorBody);
    return null;
  }
  const listing = data as ListingRow;
  if (listing.seller_wallet !== owner) {
    res.status(403).json({ error: 'forbidden' } satisfies ErrorBody);
    return null;
  }
  return listing;
}

interface GateResolution {
  gate: { gate: 'passed' | 'blocked'; blocking_reasons: string[] };
  scanned: boolean;
}

/**
 * Resolve the full compliance gate for a pack from its persisted facts:
 *   ToS acceptance (legal_acceptances) ∧ attestation (pack_attestations) ∧
 *   moderation result (pack_moderation) ∧ server category/sale_mode (memory_packs).
 *
 * Fail-closed: an absent moderation row contributes a `not_scanned` reason (we
 * cannot prove the pack is free of secrets without a scan), independent of the
 * pure gate. The pure `evaluateGate` still owns every other rule.
 */
async function resolveGate(pack: PackRow): Promise<GateResolution> {
  const db = getDb();

  // ToS acceptance for the pack author (current ToS doc).
  const { data: tosRow } = await db
    .from('legal_acceptances')
    .select('id')
    .eq('owner_wallet', pack.author_wallet)
    .eq('doc_id', TOS_DOC_ID)
    .limit(1)
    .maybeSingle();
  const tosAccepted = !!tosRow;

  // Latest attestation for the pack.
  const { data: attRow } = await db
    .from('pack_attestations')
    .select('owns_or_licensed, no_thirdparty_pii, not_investment_advice, signature')
    .eq('pack_id', pack.pack_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const attestation = attRow
    ? {
        owns_or_licensed: !!(attRow as any).owns_or_licensed,
        no_thirdparty_pii: !!(attRow as any).no_thirdparty_pii,
        not_investment_advice: !!(attRow as any).not_investment_advice,
        signed: !!(attRow as any).signature,
      }
    : null;

  // Moderation result. No row ⇒ not scanned ⇒ cannot prove safety.
  const { data: modRow } = await db
    .from('pack_moderation')
    .select('status, severity, findings')
    .eq('pack_id', pack.pack_id)
    .limit(1)
    .maybeSingle();

  const scanned = !!modRow;
  const findings: Array<{ severity?: string }> = Array.isArray((modRow as any)?.findings)
    ? (modRow as any).findings
    : [];
  // Derive the filter summary the gate needs from the persisted (redacted) findings.
  const hasSecrets = findings.some((f) => f?.severity === 'reject');
  const hasPii = findings.some((f) => f?.severity === 'hold');

  const input: GateInput = {
    tosAccepted,
    attestation,
    filter: { hasSecrets, hasPii },
    contentCategory: pack.content_category,
    saleMode: pack.sale_mode === 'title' ? 'title' : 'copy',
  };

  const gateResult = evaluateGate(input);
  const blocking_reasons: string[] = [...gateResult.blocking_reasons];

  // Fail-closed additions the pure gate does not model:
  if (!scanned) blocking_reasons.unshift('not_scanned');
  else if (modRow && FLAGGED_MODERATION_STATUSES.has((modRow as any).status)) {
    if (!blocking_reasons.includes('moderation_flagged')) blocking_reasons.push('moderation_flagged');
  }

  return {
    gate: { gate: blocking_reasons.length === 0 ? 'passed' : 'blocked', blocking_reasons },
    scanned,
  };
}

// ─────────── Route module ───────────

export function packMarketplaceRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * POST /v1/listings — create a draft listing from a pack the caller owns.
   * Body: { pack_id, title, description?, tags?, supply_kind?, supply_total?,
   *         preview_sample_count?, preview_redaction?, license_type? }
   * `license_type` may only be 'copy' in this slice; 'title' → 422.
   * `content_category` / `sale_mode` are IGNORED if sent — derived from the pack.
   */
  router.post('/v1/listings', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }

    const body = req.body ?? {};
    const packId = typeof body.pack_id === 'string' ? body.pack_id.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    if (!packId) {
      res.status(422).json({ error: 'invalid_body', hint: 'pack_id is required' } satisfies ErrorBody);
      return;
    }
    if (!title) {
      res.status(422).json({ error: 'invalid_body', hint: 'title is required' } satisfies ErrorBody);
      return;
    }
    // license_type: copy-only in Part A. Reject an explicit 'title'.
    const licenseType = body.license_type ?? 'copy';
    if (licenseType !== 'copy') {
      res
        .status(422)
        .json({ error: 'invalid_license_type', reason: 'title_not_in_slice1' } satisfies ErrorBody);
      return;
    }

    try {
      const pack = await loadOwnedPack(req, res, packId, owner);
      if (!pack) return; // response already written

      // Supply: default unlimited. (Title would force single, but title is blocked here.)
      const supplyKind: 'unlimited' | 'limited' | 'single' =
        body.supply_kind === 'limited' || body.supply_kind === 'single' ? body.supply_kind : 'unlimited';
      const supplyTotal =
        supplyKind === 'unlimited' ? null : Number.isInteger(body.supply_total) ? body.supply_total : null;
      const previewSampleCount = Number.isInteger(body.preview_sample_count)
        ? Math.max(0, Math.min(body.preview_sample_count, PREVIEW_MAX_REVEAL))
        : 1;
      const previewRedaction = ['none', 'mask_entities', 'summary_only'].includes(body.preview_redaction)
        ? body.preview_redaction
        : 'none';
      const tags: string[] = Array.isArray(body.tags)
        ? body.tags.filter((t: unknown): t is string => typeof t === 'string')
        : [];

      // Compliance pre-check (informational at create — publish enforces it).
      const resolution = await resolveGate(pack);

      const db = getDb();
      const listingId = generateListingId();
      const row = {
        listing_id: listingId,
        pack_id: pack.pack_id,
        seller_wallet: owner,
        title,
        description: typeof body.description === 'string' ? body.description : null,
        tags,
        // SERVER-derived from the pack — never the client.
        content_category: pack.content_category,
        license_type: 'copy' as const,
        supply_kind: supplyKind,
        supply_total: supplyTotal,
        supply_sold: 0,
        preview_sample_count: previewSampleCount,
        preview_redaction: previewRedaction,
        status: 'draft' as const,
        compliance_gate: resolution.gate.gate,
      };

      const { error: insErr } = await db.from('pack_listings').insert(row);
      if (insErr) {
        // uq_pack_listings_active_pack — one active listing per pack.
        if ((insErr as any).code === '23505') {
          res
            .status(409)
            .json({ error: 'listing_exists', hint: 'an active listing already exists for this pack' } satisfies ErrorBody);
          return;
        }
        log.warn({ err: insErr, packId }, 'create listing insert failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }

      // Append-only audit (best-effort).
      await db
        .from('pack_listing_events')
        .insert({ listing_id: listingId, event_type: 'created', actor_wallet: owner, metadata: null });

      res.status(201).json({
        listing: row,
        compliance: resolution.gate,
      });
    } catch (err) {
      log.error({ err, packId }, 'POST /v1/listings failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /**
   * PATCH /v1/listings/:id — edit whitelisted draft fields.
   * Refuses any attempt to set an immutable field (status/content_category/pack_id/…).
   * `status` only moves via publish/delist.
   */
  router.patch('/v1/listings/:id', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }

    const body = req.body ?? {};
    // Reject immutable fields BEFORE touching the DB — fail closed.
    for (const key of Object.keys(body)) {
      if (IMMUTABLE_FIELDS.has(key)) {
        res
          .status(422)
          .json({ error: 'immutable_field', reason: 'field_immutable', hint: `${key} cannot be edited` } satisfies ErrorBody);
        return;
      }
    }

    try {
      const listing = await loadOwnedListing(res, id, owner);
      if (!listing) return;

      // Build the whitelisted patch.
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
      if ('description' in body) patch.description = typeof body.description === 'string' ? body.description : null;
      if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t: unknown) => typeof t === 'string');
      if (body.supply_kind === 'unlimited' || body.supply_kind === 'limited' || body.supply_kind === 'single')
        patch.supply_kind = body.supply_kind;
      if (Number.isInteger(body.supply_total)) patch.supply_total = body.supply_total;
      if (Number.isInteger(body.preview_sample_count))
        patch.preview_sample_count = Math.max(0, Math.min(body.preview_sample_count, PREVIEW_MAX_REVEAL));
      if (['none', 'mask_entities', 'summary_only'].includes(body.preview_redaction))
        patch.preview_redaction = body.preview_redaction;

      // Defensive: never let a non-editable key slip into the patch.
      for (const k of Object.keys(patch)) {
        if (!EDITABLE_FIELDS.has(k)) delete patch[k];
      }

      if (Object.keys(patch).length === 0) {
        res.status(422).json({ error: 'no_editable_fields' } satisfies ErrorBody);
        return;
      }
      patch.updated_at = new Date().toISOString();

      const db = getDb();
      const { error: updErr } = await db
        .from('pack_listings')
        .update(patch)
        .eq('listing_id', id)
        .eq('seller_wallet', owner);
      if (updErr) {
        log.warn({ err: updErr, id }, 'patch listing failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }

      res.json({ listing: { ...listing, ...patch } });
    } catch (err) {
      log.error({ err, id }, 'PATCH /v1/listings failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /**
   * POST /v1/listings/:id/publish — draft → listed, ONLY when the compliance gate
   * passes. Re-resolves the gate from persisted facts (category read server-side
   * from memory_packs). Secrets / personal / unclassified / un-scanned all 422.
   */
  router.post('/v1/listings/:id/publish', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }

    try {
      const listing = await loadOwnedListing(res, id, owner);
      if (!listing) return;

      if (!PUBLISHABLE_FROM.has(listing.status)) {
        res
          .status(409)
          .json({ error: 'not_publishable', hint: `listing is ${listing.status}` } satisfies ErrorBody);
        return;
      }

      // Re-load the backing pack: category + sale_mode are the trusted, server-set
      // fields. Ownership re-checked here too.
      const pack = await loadOwnedPack(req, res, listing.pack_id, owner);
      if (!pack) return;

      const resolution = await resolveGate(pack);
      if (resolution.gate.gate !== 'passed') {
        res.status(422).json({
          error: 'compliance_blocked',
          blocking_reasons: resolution.gate.blocking_reasons,
        } satisfies ErrorBody);
        return;
      }

      const db = getDb();
      const patch = {
        status: 'listed' as const,
        compliance_gate: 'passed' as const,
        // Re-denormalise the trusted category onto the listing at publish time.
        content_category: pack.content_category,
        listed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: updErr } = await db
        .from('pack_listings')
        .update(patch)
        .eq('listing_id', id)
        .eq('seller_wallet', owner);
      if (updErr) {
        if ((updErr as any).code === '23505') {
          res.status(409).json({ error: 'listing_exists' } satisfies ErrorBody);
          return;
        }
        log.warn({ err: updErr, id }, 'publish update failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }

      await db
        .from('pack_listing_events')
        .insert({ listing_id: id, event_type: 'published', actor_wallet: owner, metadata: null });

      res.json({ listing: { ...listing, ...patch } });
    } catch (err) {
      log.error({ err, id }, 'POST /v1/listings/:id/publish failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /** POST /v1/listings/:id/delist — listed → delisted. */
  router.post('/v1/listings/:id/delist', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }

    try {
      const listing = await loadOwnedListing(res, id, owner);
      if (!listing) return;

      const db = getDb();
      const patch = {
        status: 'delisted' as const,
        delisted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: updErr } = await db
        .from('pack_listings')
        .update(patch)
        .eq('listing_id', id)
        .eq('seller_wallet', owner);
      if (updErr) {
        log.warn({ err: updErr, id }, 'delist update failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }

      await db
        .from('pack_listing_events')
        .insert({ listing_id: id, event_type: 'delisted', actor_wallet: owner, metadata: null });

      res.json({ listing: { ...listing, ...patch } });
    } catch (err) {
      log.error({ err, id }, 'POST /v1/listings/:id/delist failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /** GET /v1/listings/mine — the caller's own listings (auth required). */
  router.get('/v1/listings/mine', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data, error } = await db
        .from('pack_listings')
        .select('*')
        .eq('seller_wallet', owner)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        log.warn({ err: error, owner }, 'GET /v1/listings/mine failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }
      res.json({ listings: (data ?? []) as ListingRow[] });
    } catch (err) {
      log.error({ err }, 'GET /v1/listings/mine failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /**
   * GET /v1/listings — browse. Returns ONLY status='listed' rows. Optional filters:
   *   ?category=knowledge|agent|personal   ?tag=foo   ?limit=N
   * Personal listings cannot exist in Part A (blocked at publish), but the filter
   * is accepted for forward-compat.
   */
  router.get('/v1/listings', optionalPrivyAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      let q = db.from('pack_listings').select('*').eq('status', 'listed');

      const category = req.query.category;
      if (category === 'knowledge' || category === 'agent' || category === 'personal') {
        q = q.eq('content_category', category);
      }
      const tag = req.query.tag;
      if (typeof tag === 'string' && tag.length > 0) {
        q = q.overlaps('tags', [tag]);
      }
      const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100));
      q = q.order('created_at', { ascending: false }).limit(limit);

      const { data, error } = await q;
      if (error) {
        log.warn({ err: error }, 'GET /v1/listings browse failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }
      res.json({ listings: (data ?? []) as ListingRow[] });
    } catch (err) {
      log.error({ err }, 'GET /v1/listings failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  /**
   * GET /v1/listings/:id/preview — sealed-safe preview via the shared
   * `buildPackPreview` helper (Merkle proofs over the revealed slice; per-leaf
   * plaintext suppressed for personal packs). Reveals `preview_sample_count` leaves.
   */
  router.get('/v1/listings/:id/preview', optionalPrivyAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data: listing, error: lErr } = await db
        .from('pack_listings')
        .select('listing_id, pack_id, preview_sample_count')
        .eq('listing_id', id)
        .limit(1)
        .maybeSingle();
      if (lErr) {
        log.warn({ err: lErr, id }, 'preview: listing lookup failed');
        res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
        return;
      }
      if (!listing) {
        res.status(404).json({ error: 'listing_not_found' } satisfies ErrorBody);
        return;
      }
      const lr = listing as { listing_id: string; pack_id: string; preview_sample_count: number };

      const { data: packData, error: pErr } = await db
        .from('memory_packs')
        .select(PACK_SELECT)
        .eq('pack_id', lr.pack_id)
        .limit(1)
        .maybeSingle();
      if (pErr) {
        log.warn({ err: pErr, id }, 'preview: pack lookup failed');
        res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
        return;
      }
      if (!packData) {
        res.status(404).json({ error: 'pack_not_found' } satisfies ErrorBody);
        return;
      }
      const pack = packData as PackRow;
      if (!pack.merkle_root) {
        res
          .status(409)
          .json({ error: 'not_tokenised', hint: 'pack draft — not committed on-chain' } satisfies ErrorBody);
        return;
      }

      const { data: contentsRaw, error: cErr } = await db
        .from('memory_pack_contents')
        .select('memory_id, leaf_index, content_hash')
        .eq('pack_id', lr.pack_id)
        .order('leaf_index', { ascending: true });
      if (cErr) {
        log.warn({ err: cErr, id }, 'preview: contents lookup failed');
        res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
        return;
      }
      const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number; content_hash: string }>;
      if (contents.length === 0) {
        res.status(500).json({ error: 'preview_failed', reason: 'no_contents' } satisfies ErrorBody);
        return;
      }

      const count = Math.max(1, Math.min(lr.preview_sample_count || 1, PREVIEW_MAX_REVEAL));
      const revealMemoryIds = contents.slice(0, Math.min(count, contents.length)).map((r) => r.memory_id);
      const { data: memoriesRaw } = await db
        .from('memories')
        .select('id, hash_id, memory_type, content, owner_wallet, created_at, tags')
        .in('id', revealMemoryIds);
      const memoryById = new Map<number, PreviewMemoryBody>();
      for (const m of (memoriesRaw ?? []) as PreviewMemoryBody[]) memoryById.set(m.id, m);

      const preview = buildPackPreview(
        {
          pack_id: pack.pack_id,
          name: pack.name,
          version: pack.version,
          author_wallet: pack.author_wallet,
          memory_count: pack.memory_count,
          merkle_root: pack.merkle_root,
          pack_token_address: pack.pack_token_address,
          content_category: pack.content_category,
        },
        contents,
        memoryById,
        { count, maxReveal: PREVIEW_MAX_REVEAL },
      );
      if (!preview.ok) {
        if (preview.reason === 'root_mismatch') {
          log.error({ id, builtRoot: preview.builtRoot }, 'preview: rebuilt root mismatch');
        }
        res.status(500).json({ error: 'preview_failed', reason: preview.reason } satisfies ErrorBody);
        return;
      }

      res.json({
        listing_id: lr.listing_id,
        pack: preview.pack,
        revealed_count: preview.revealed_count,
        unrevealed_count: preview.unrevealed_count,
        revealed: preview.revealed,
        verifier_url: `${publicBaseUrl(req)}/v1/packs/${lr.pack_id}/verify`,
      });
    } catch (err) {
      log.error({ err, id }, 'GET /v1/listings/:id/preview failed');
      res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
    }
  });

  /** GET /v1/listings/:id — full listing (public). MUST be last (after /mine, /preview). */
  router.get('/v1/listings/:id', optionalPrivyAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data, error } = await db
        .from('pack_listings')
        .select('*')
        .eq('listing_id', id)
        .limit(1)
        .maybeSingle();
      if (error) {
        log.warn({ err: error, id }, 'GET /v1/listings/:id failed');
        res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'listing_not_found' } satisfies ErrorBody);
        return;
      }
      res.json({ listing: data as ListingRow });
    } catch (err) {
      log.error({ err, id }, 'GET /v1/listings/:id failed');
      res.status(500).json({ error: 'listing_failed' } satisfies ErrorBody);
    }
  });

  return router;
}

export type { GateBlockingReason };
