/**
 * Compliance endpoints — legal docs + attestation + content scan + gate status.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 4 (spec §3F).
 *
 *   GET  /v1/legal/:doc_id        Current ToS/disclaimer body + body_hash (public).
 *   POST /v1/legal/accept         Record a ToS acceptance (privy; ip + user agent).
 *   GET  /v1/legal/acceptances    The caller's own acceptances (privy).
 *   POST /v1/packs/:id/attest     Author signs claims; SERVER derives + writes
 *                                 memory_packs.content_category from content_source.
 *   POST /v1/packs/:id/scan       Scan the pack's PLAINTEXT members → pack_moderation.
 *   GET  /v1/packs/:id/compliance Gate state + blocking_reasons via evaluateGate.
 *
 * Fail-closed design (design §00 + founder):
 *   - content_category is derived SERVER-SIDE from the attestation's content_source
 *     (own_personal→personal, curated_knowledge→knowledge, agent_memory→agent). It is
 *     the ONLY trusted origin of category and is never client-set at listing time.
 *   - /scan reads each member as PLAINTEXT. If ANY member is encrypted (ciphertext at
 *     rest), we CANNOT prove it free of secrets → status='flagged' + cannot_scan_encrypted
 *     (never 'clean'). Only REDACTED findings are persisted — never a raw credential.
 *   - The gate (evaluateGate) plus a fail-closed `not_scanned` guard decide eligibility.
 *
 * Owner-scoping: attest/scan/compliance require the caller to be the pack AUTHOR
 * (`author_wallet`); legal accept/acceptances scope to the caller (`owner_wallet`).
 * `ownerFromReq()` mirrors pmp-packs.routes.ts:45.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { createChildLogger } from '@clude/shared/core/logger';
import { scanPack, type Finding } from '../lib/content-filter.js';
import { evaluateGate, type GateInput } from '../lib/compliance-gate.js';
import { createHash } from 'node:crypto';

const log = createChildLogger('compliance-routes');

const TOS_DOC_ID = 'marketplace_tos';
const FILTER_VERSION = 'cf-1';

// content_source → server-derived content_category. The single trusted mapping.
const SOURCE_TO_CATEGORY: Record<string, 'personal' | 'knowledge' | 'agent'> = {
  own_personal: 'personal',
  curated_knowledge: 'knowledge',
  agent_memory: 'agent',
};

// Moderation statuses that mean "not provably clean" — they block publishing.
const FLAGGED_MODERATION_STATUSES = new Set(['flagged', 'quarantined', 'rejected', 'taken_down', 'suspended']);

interface ErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

function ownerFromReq(req: Request): string | null {
  if (req.verifiedWallet) return req.verifiedWallet;
  const q = req.query.owner;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

interface PackRow {
  pack_id: string;
  author_wallet: string;
  merkle_root: string | null;
  content_category: 'personal' | 'knowledge' | 'agent' | null;
  sale_mode: 'copy' | 'title' | null;
}

const PACK_SELECT = 'pack_id, author_wallet, merkle_root, content_category, sale_mode';

/** Load a pack the caller must OWN (author). Returns null + writes a response on failure. */
async function loadOwnedPack(res: Response, packId: string, owner: string): Promise<PackRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from('memory_packs')
    .select(PACK_SELECT)
    .eq('pack_id', packId)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn({ err: error, packId }, 'pack lookup failed');
    res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
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

/** Read the current (highest-version, is_current) legal doc. */
async function loadCurrentLegalDoc(docId: string): Promise<{
  doc_id: string;
  version: number;
  body_hash: string;
  url: string;
  effective_at: string;
} | null> {
  const db = getDb();
  const { data } = await db
    .from('legal_documents')
    .select('doc_id, version, body_hash, url, effective_at, is_current')
    .eq('doc_id', docId)
    .eq('is_current', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  return {
    doc_id: d.doc_id,
    version: d.version,
    body_hash: d.body_hash,
    url: d.url,
    effective_at: d.effective_at,
  };
}

interface GateResolution {
  gate: 'passed' | 'blocked';
  blocking_reasons: string[];
  scanned: boolean;
}

/**
 * Resolve the full compliance gate for a pack from persisted facts: ToS acceptance ∧
 * attestation ∧ moderation ∧ server category/sale_mode. Fail-closed: an absent
 * moderation row adds `not_scanned` (we cannot prove the pack is secret-free without a
 * scan). Mirrors resolveGate in pack-marketplace.routes.ts so publish + status agree.
 */
async function resolveGate(pack: PackRow): Promise<GateResolution> {
  const db = getDb();

  const { data: tosRow } = await db
    .from('legal_acceptances')
    .select('id')
    .eq('owner_wallet', pack.author_wallet)
    .eq('doc_id', TOS_DOC_ID)
    .limit(1)
    .maybeSingle();
  const tosAccepted = !!tosRow;

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

  if (!scanned) blocking_reasons.unshift('not_scanned');
  else if (modRow && FLAGGED_MODERATION_STATUSES.has((modRow as any).status)) {
    if (!blocking_reasons.includes('moderation_flagged')) blocking_reasons.push('moderation_flagged');
  }

  return {
    gate: blocking_reasons.length === 0 ? 'passed' : 'blocked',
    blocking_reasons,
    scanned,
  };
}

// ─────────── Route module ───────────

export function complianceRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // ─────────── GET /v1/legal/acceptances (must precede /v1/legal/:doc_id) ───────────
  router.get('/v1/legal/acceptances', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data, error } = await db
        .from('legal_acceptances')
        .select('id, owner_wallet, doc_id, doc_version, body_hash, context, accepted_at')
        .eq('owner_wallet', owner)
        .order('accepted_at', { ascending: false })
        .limit(200);
      if (error) {
        log.warn({ err: error, owner }, 'GET /v1/legal/acceptances failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }
      res.json({ acceptances: data ?? [] });
    } catch (err) {
      log.error({ err }, 'GET /v1/legal/acceptances failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  // ─────────── GET /v1/legal/:doc_id ───────────
  router.get('/v1/legal/:doc_id', optionalPrivyAuth, async (req: Request, res: Response) => {
    const docId = String(req.params.doc_id ?? '');
    if (!docId || docId.length > 64) {
      res.status(422).json({ error: 'invalid_doc_id' } satisfies ErrorBody);
      return;
    }
    try {
      const doc = await loadCurrentLegalDoc(docId);
      if (!doc) {
        res.status(404).json({ error: 'doc_not_found' } satisfies ErrorBody);
        return;
      }
      res.json(doc);
    } catch (err) {
      log.error({ err, docId }, 'GET /v1/legal/:doc_id failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  // ─────────── POST /v1/legal/accept ───────────
  router.post('/v1/legal/accept', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    const body = req.body ?? {};
    const docId = typeof body.doc_id === 'string' ? body.doc_id : TOS_DOC_ID;
    const context = typeof body.context === 'string' ? body.context : 'unspecified';

    try {
      const doc = await loadCurrentLegalDoc(docId);
      if (!doc) {
        res.status(422).json({ error: 'unknown_doc', hint: `no current legal document '${docId}'` } satisfies ErrorBody);
        return;
      }
      const db = getDb();
      const row = {
        owner_wallet: owner,
        privy_user_id: typeof body.privy_user_id === 'string' ? body.privy_user_id : null,
        doc_id: doc.doc_id,
        doc_version: doc.version,
        body_hash: doc.body_hash,
        context,
        ip_inet: clientIp(req),
        user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      };
      const { error } = await db.from('legal_acceptances').insert(row);
      if (error) {
        log.warn({ err: error, owner, docId }, 'legal accept insert failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }
      res.status(201).json({
        accepted: true,
        doc_id: doc.doc_id,
        doc_version: doc.version,
        body_hash: doc.body_hash,
        context,
      });
    } catch (err) {
      log.error({ err, docId }, 'POST /v1/legal/accept failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  // ─────────── POST /v1/packs/:id/attest ───────────
  router.post('/v1/packs/:id/attest', requirePrivyAuth, async (req: Request, res: Response) => {
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
    const contentSource = typeof body.content_source === 'string' ? body.content_source : '';
    const category = SOURCE_TO_CATEGORY[contentSource];
    if (!category) {
      res.status(422).json({
        error: 'invalid_content_source',
        hint: "content_source must be one of own_personal | curated_knowledge | agent_memory",
      } satisfies ErrorBody);
      return;
    }
    const ownsOrLicensed = body.owns_or_licensed === true;
    const noThirdPartyPii = body.no_thirdparty_pii === true;
    const notInvestmentAdvice = body.not_investment_advice === true;
    if (!ownsOrLicensed || !noThirdPartyPii || !notInvestmentAdvice) {
      res.status(422).json({
        error: 'incomplete_attestation',
        hint: 'owns_or_licensed, no_thirdparty_pii and not_investment_advice must all be true',
      } satisfies ErrorBody);
      return;
    }

    try {
      const pack = await loadOwnedPack(res, id, owner);
      if (!pack) return; // response already written

      const db = getDb();
      // attestation_hash binds the pack's committed merkle_root so the attestation
      // cannot be silently re-pointed at different content.
      const attestationHash = createHash('sha256')
        .update(`${id}:${pack.merkle_root ?? ''}:${contentSource}:${owner}`)
        .digest('hex');

      const attRow = {
        pack_id: id,
        author_wallet: owner,
        content_source: contentSource,
        owns_or_licensed: ownsOrLicensed,
        no_thirdparty_pii: noThirdPartyPii,
        not_investment_advice: notInvestmentAdvice,
        consent_basis: typeof body.consent_basis === 'string' ? body.consent_basis : null,
        attestation_hash: attestationHash,
        signature: typeof body.signature === 'string' ? body.signature : null,
        signed_message: typeof body.signed_message === 'string' ? body.signed_message : null,
      };
      const { error: insErr } = await db.from('pack_attestations').insert(attRow);
      if (insErr) {
        log.warn({ err: insErr, id }, 'attestation insert failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }

      // SERVER writes content_category from content_source — the only trusted origin.
      const { error: updErr } = await db
        .from('memory_packs')
        .update({ content_category: category })
        .eq('pack_id', id)
        .eq('author_wallet', owner);
      if (updErr) {
        log.warn({ err: updErr, id }, 'content_category update failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }

      res.status(201).json({
        pack_id: id,
        content_source: contentSource,
        content_category: category,
        attestation_hash: attestationHash,
      });
    } catch (err) {
      log.error({ err, id }, 'POST /v1/packs/:id/attest failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  // ─────────── POST /v1/packs/:id/scan ───────────
  router.post('/v1/packs/:id/scan', requirePrivyAuth, async (req: Request, res: Response) => {
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
      const pack = await loadOwnedPack(res, id, owner);
      if (!pack) return;

      const db = getDb();
      // Pull the pack's member memory ids (owner-scoped via the pack we just authorised).
      const { data: contentsRaw, error: cErr } = await db
        .from('memory_pack_contents')
        .select('memory_id, leaf_index')
        .eq('pack_id', id)
        .order('leaf_index', { ascending: true });
      if (cErr) {
        log.warn({ err: cErr, id }, 'scan: contents lookup failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }
      const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number }>;
      const memoryIds = contents.map((c) => c.memory_id);

      // Hydrate member memories (owner-scoped — only the author's own rows).
      const { data: memoriesRaw } = memoryIds.length
        ? await db
            .from('memories')
            .select('id, content, owner_wallet, encrypted')
            .in('id', memoryIds)
            .eq('owner_wallet', owner)
        : { data: [] as any[] };
      const members = (memoriesRaw ?? []) as Array<{
        id: number;
        content: string | null;
        owner_wallet: string | null;
        encrypted: boolean | null;
      }>;

      // FAIL-CLOSED: if ANY member is encrypted, its content is ciphertext — we cannot
      // prove it free of secrets. Mark flagged + cannot_scan_encrypted (NEVER clean).
      const anyEncrypted = members.some((m) => m.encrypted === true);
      let status: 'clean' | 'flagged';
      let reason: string | undefined;
      let findings: Finding[];
      let hasSecrets: boolean;
      let hasPii: boolean;

      if (anyEncrypted) {
        status = 'flagged';
        reason = 'cannot_scan_encrypted';
        findings = [];
        hasSecrets = false;
        hasPii = false;
      } else {
        const scan = scanPack(members.map((m) => ({ content: m.content ?? '' })));
        findings = scan.findings; // already REDACTED by the content-filter
        hasSecrets = scan.hasSecrets;
        hasPii = scan.hasPii;
        status = hasSecrets || hasPii ? 'flagged' : 'clean';
      }

      const severity = hasSecrets ? 'reject' : hasPii ? 'hold' : anyEncrypted ? 'reject' : null;
      const modRow = {
        pack_id: id,
        status,
        filter_version: FILTER_VERSION,
        findings, // REDACTED samples only
        severity,
        scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Upsert: one moderation row per pack (pack_id PK). Re-scan overwrites.
      const { error: upErr } = await db.from('pack_moderation').upsert(modRow, { onConflict: 'pack_id' });
      if (upErr) {
        log.warn({ err: upErr, id }, 'scan: moderation upsert failed');
        res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
        return;
      }

      res.json({
        pack_id: id,
        status,
        reason,
        has_secrets: hasSecrets,
        has_pii: hasPii,
        filter_version: FILTER_VERSION,
        findings, // REDACTED — never a raw credential
      });
    } catch (err) {
      log.error({ err, id }, 'POST /v1/packs/:id/scan failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  // ─────────── GET /v1/packs/:id/compliance ───────────
  router.get('/v1/packs/:id/compliance', requirePrivyAuth, async (req: Request, res: Response) => {
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
      const pack = await loadOwnedPack(res, id, owner);
      if (!pack) return;

      const resolution = await resolveGate(pack);
      res.json({
        pack_id: id,
        content_category: pack.content_category,
        sale_mode: pack.sale_mode ?? 'copy',
        scanned: resolution.scanned,
        gate: resolution.gate,
        blocking_reasons: resolution.blocking_reasons,
      });
    } catch (err) {
      log.error({ err, id }, 'GET /v1/packs/:id/compliance failed');
      res.status(500).json({ error: 'compliance_failed' } satisfies ErrorBody);
    }
  });

  return router;
}
