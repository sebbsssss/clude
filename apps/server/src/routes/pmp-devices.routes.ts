/**
 * DESKTOP DEVICE PAIRING endpoints — the secure server side of the desktop `.pmp` integration
 * the user's EXISTING Clude desktop (Tauri) app consumes.
 *
 * Tradeable Memory Packs — Part C, Task 3 (spec §2 DESKTOP PAIRING · §3C · §4.2 desktop flow).
 *
 *   POST /v1/pmp/devices/pair/init      none/device  A NEW device posts its ed25519 device_pubkey
 *                                                    + name/platform → server stores a PENDING
 *                                                    pmp_pairing_codes row (the sha256 of a short
 *                                                    code, never the plaintext), expires_at =
 *                                                    now+<2min, and returns the short code for the
 *                                                    user to READ on the desktop screen.
 *   POST /v1/pmp/devices/pair/claim     privy+owner  The AUTHENTICATED user types the code on
 *                                                    clude.io → server looks up the pending code,
 *                                                    BINDS owner_wallet (req.verifiedWallet ONLY),
 *                                                    returns the device name/platform for EXPLICIT
 *                                                    human confirmation, status='claimed'.
 *   POST /v1/pmp/devices/pair/complete  device-sig   The device proves possession of its key
 *                                                    (ed25519 over a timestamped message) →
 *                                                    status='consumed' + a pmp_devices row created.
 *   GET  /v1/pmp/devices                privy+owner  The owner's ACTIVE (non-revoked) paired devices.
 *   POST /v1/pmp/devices/:id/revoke     privy+owner  Revoke a device (drops it from active lookup).
 *   POST /v1/pmp/desktop/memories       device-sig   Paginated owner-scoped memory pull (X-PMP-*
 *                                                    headers, ±120s) for the paired device to build
 *                                                    a .pmp locally.
 *
 * ANTI-PHISHING (§00 MINOR 11 — the binding correction from the adversarial review): a pairing
 * code social-engineered out of a user must be USELESS to an attacker. Three properties enforce it:
 *   (1) CLAIM requires an AUTHENTICATED Privy session — the code alone, read aloud, pairs nothing
 *       without the victim's login.
 *   (2) CLAIM surfaces the device name/platform so the human explicitly confirms THEIR device,
 *       not an attacker's.
 *   (3) Codes expire in <2 min (init writes expires_at = now+110s) and are single-use (pending →
 *       claimed → consumed); a new device pair emits a pmp_device_events notification row.
 *
 * AUTH (the fixed Part A/B pattern): owner routes use requirePrivyAuth + requireOwnership and read
 * the wallet ONLY from req.verifiedWallet (ownerFromReq) — a client-supplied ?owner=/body.owner is
 * NEVER trusted (the impersonation hole closed in cc4f2871). Device routes are DEVICE-SIGNED: the
 * caller proves possession of the ed25519 key the pmp_devices row was paired against (Risk R9:
 * device-pull = full memory egress, so it must be signature-gated, owner-scoped, replay-bounded,
 * and revocable).
 *
 * REUSE: ed25519 verification is the same tweetnacl + bs58 path as lib/pack-gate.ts (verify a
 * detached signature over UTF-8 message bytes against a 32-byte base58 pubkey). No new crypto.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop (mirrors pack-gate.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as bs58Module from 'bs58';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bs58 = (bs58Module as any).default || bs58Module;
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('pmp-devices-routes');

// ─────────── Constants ───────────

/** <2 min anti-phishing window (§00 MINOR 11). A claim after this many ms past creation is dead. */
const PAIRING_CODE_TTL_MS = 110_000; // 110s — comfortably under 2 minutes
/** Device-signed request replay window (spec §3C: "±120s"). */
const SIGNATURE_WINDOW_SECONDS = 120;
/** Default + ceiling page size for the desktop memory pull. */
const DEFAULT_PULL_LIMIT = 100;
const MAX_PULL_LIMIT = 500;
/** A pull returning at least this many rows is an egress event worth a notification (Risk R9). */
const LARGE_PULL_THRESHOLD = 250;
/** The default scopes a freshly-paired device receives (mirrors the migration 033 column default). */
const DEFAULT_DEVICE_SCOPES = ['memories:read', 'pmp:export'];

/**
 * Pairing-code alphabet: uppercase letters + digits with the visually ambiguous glyphs removed
 * (no 0/O, 1/I/L) so a human reading it off a desktop screen and typing it on clude.io can't
 * fat-finger it. 8 chars over a 32-symbol alphabet ≈ 40 bits — fine for a single-use <2 min code.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

interface ErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

// ─────────── Helpers ───────────

/** The wallet the caller has been VERIFIED to own — never a client-supplied value. */
function ownerFromReq(req: Request): string | null {
  return req.verifiedWallet ?? null;
}

function generateDeviceId(): string {
  return `dev-${randomBytes(4).toString('hex')}`;
}

/** A fresh single-use pairing code over the unambiguous alphabet. */
function generatePairingCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** The pairing code is stored ONLY as its sha256 — the plaintext is shown once and never persisted. */
function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Validate a base58 ed25519 public key is well-formed (decodes to exactly 32 bytes). */
function isValidEd25519Pubkey(pubkey: string): boolean {
  if (typeof pubkey !== 'string' || pubkey.length === 0 || pubkey.length > 64) return false;
  try {
    const bytes: Uint8Array = bs58.decode(pubkey);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

interface SigCheck {
  ok: boolean;
  reason?: 'malformed' | 'expired' | 'bad_signature';
}

/**
 * Verify a device-signed request: an ed25519 detached signature (base58) over `message`, produced
 * by the secret key matching `devicePubkey` (base58), within ±SIGNATURE_WINDOW_SECONDS of now.
 * The SAME shape lib/pack-gate.ts uses for wallet unlock — bs58.decode + nacl.sign.detached.verify.
 */
function verifyDeviceSignature(
  devicePubkey: string,
  message: string,
  signatureB58: string,
  timestampSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SigCheck {
  if (!Number.isInteger(timestampSeconds)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: 'expired' };
  }
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = bs58.decode(devicePubkey);
    if (pubkeyBytes.length !== 32) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signatureB58);
    if (sigBytes.length !== 64) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const messageBytes = new TextEncoder().encode(message);
  const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
  return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * Append a device-pairing notification event (best-effort — a logging failure must never fail the
 * primary action). This is the durable trail behind "notify on a new device pair" (§00 MINOR 11)
 * and the large-egress alert (Risk R9); a notification worker reads pmp_device_events.
 */
async function emitDeviceEvent(
  ownerWallet: string,
  eventType: 'pair_claimed' | 'paired' | 'revoked' | 'memory_pull',
  fields: { deviceId?: string | null; devicePubkey?: string | null; deviceName?: string | null; platform?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const db = getDb();
    await db.from('pmp_device_events').insert({
      owner_wallet: ownerWallet,
      device_id: fields.deviceId ?? null,
      device_pubkey: fields.devicePubkey ?? null,
      event_type: eventType,
      device_name: fields.deviceName ?? null,
      platform: fields.platform ?? null,
      metadata: fields.metadata ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    log.warn({ err, ownerWallet, eventType }, 'emitDeviceEvent failed (non-fatal)');
  }
}

// ─────────── Route module ───────────

export function pmpDevicesRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-PMP-Device, X-PMP-Timestamp, X-PMP-Signature',
    );
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * POST /v1/pmp/devices/pair/init — a NEW device requests a pairing code. NO auth (the device has
   * no account yet). Body: { device_pubkey, device_name?, platform? }.
   *   - Validates device_pubkey is a 32-byte ed25519 key.
   *   - Stores a PENDING pmp_pairing_codes row keyed by sha256(code), expires_at = now+<2min,
   *     owner_wallet null (only the authenticated claim binds it).
   *   - Returns the plaintext short code exactly ONCE for the user to read on the desktop.
   * The plaintext code is never persisted — only its hash — so a DB read cannot reveal a live code.
   */
  router.post('/v1/pmp/devices/pair/init', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const devicePubkey = typeof body.device_pubkey === 'string' ? body.device_pubkey.trim() : '';
    const deviceName = typeof body.device_name === 'string' ? body.device_name.slice(0, 120) : null;
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 60) : null;

    if (!isValidEd25519Pubkey(devicePubkey)) {
      res
        .status(422)
        .json({ error: 'invalid_device_pubkey', hint: 'device_pubkey must be a base58 32-byte ed25519 key' } satisfies ErrorBody);
      return;
    }

    try {
      const db = getDb();
      const code = generatePairingCode();
      const codeHash = hashCode(code);
      const nowMs = Date.now();
      const expiresAt = new Date(nowMs + PAIRING_CODE_TTL_MS).toISOString();

      const row = {
        code_hash: codeHash,
        device_pubkey: devicePubkey,
        device_name: deviceName,
        platform,
        owner_wallet: null,
        status: 'pending' as const,
        created_at: new Date(nowMs).toISOString(),
        expires_at: expiresAt,
      };

      const { error: insErr } = await db.from('pmp_pairing_codes').insert(row);
      if (insErr) {
        // A live pending/claimed code already exists for this device pubkey (the scoped unique
        // index). Tell the device to retry shortly rather than minting a parallel claimable code.
        if ((insErr as { code?: string }).code === '23505') {
          res
            .status(409)
            .json({ error: 'pairing_in_progress', hint: 'a pairing code for this device is already pending' } satisfies ErrorBody);
          return;
        }
        log.warn({ err: insErr }, 'pair/init: insert failed');
        res.status(500).json({ error: 'pair_init_failed' } satisfies ErrorBody);
        return;
      }

      res.status(201).json({ code, expires_at: expiresAt });
    } catch (err) {
      log.error({ err }, 'POST /v1/pmp/devices/pair/init failed');
      res.status(500).json({ error: 'pair_init_failed' } satisfies ErrorBody);
    }
  });

  /**
   * POST /v1/pmp/devices/pair/claim — the AUTHENTICATED user claims a pending code. Body: { code }.
   *   - requirePrivyAuth + requireOwnership gate this: an unauthenticated claim is 401 (the
   *     anti-phishing binding — a code read aloud to an attacker pairs nothing without the login).
   *   - Looks up the PENDING code by its hash, checks it has not expired (<2 min window).
   *   - Conditionally flips pending → claimed and BINDS owner_wallet to req.verifiedWallet.
   *   - Returns the device name/platform so the human EXPLICITLY confirms their device.
   */
  router.post(
    '/v1/pmp/devices/pair/claim',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      const body = req.body ?? {};
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!code) {
        res.status(422).json({ error: 'invalid_body', hint: 'code is required' } satisfies ErrorBody);
        return;
      }

      try {
        const db = getDb();
        const codeHash = hashCode(code);
        const { data: codeRow, error: lookupErr } = await db
          .from('pmp_pairing_codes')
          .select('code_hash, device_pubkey, device_name, platform, owner_wallet, status, expires_at')
          .eq('code_hash', codeHash)
          .limit(1)
          .maybeSingle();
        if (lookupErr) {
          log.warn({ err: lookupErr }, 'pair/claim: lookup failed');
          res.status(500).json({ error: 'pair_claim_failed' } satisfies ErrorBody);
          return;
        }
        if (!codeRow) {
          res.status(404).json({ error: 'code_not_found' } satisfies ErrorBody);
          return;
        }
        const pairing = codeRow as {
          code_hash: string;
          device_pubkey: string;
          device_name: string | null;
          platform: string | null;
          owner_wallet: string | null;
          status: string;
          expires_at: string;
        };

        // A consumed/expired/already-claimed code cannot be (re)claimed.
        if (pairing.status !== 'pending') {
          res
            .status(409)
            .json({ error: 'code_not_claimable', reason: pairing.status } satisfies ErrorBody);
          return;
        }
        // Anti-phishing: enforce the <2 min window. An expired code is dead even if pending.
        if (Date.parse(pairing.expires_at) <= Date.now()) {
          await db
            .from('pmp_pairing_codes')
            .update({ status: 'expired' })
            .eq('code_hash', codeHash)
            .eq('status', 'pending');
          res.status(410).json({ error: 'code_expired' } satisfies ErrorBody);
          return;
        }

        // Conditionally claim: bind the AUTHENTICATED owner. The WHERE status='pending' makes a
        // racing second claim a no-op (it would match 0 rows).
        const { data: updated, error: updErr } = await db
          .from('pmp_pairing_codes')
          .update({ status: 'claimed', owner_wallet: owner })
          .eq('code_hash', codeHash)
          .eq('status', 'pending')
          .select('code_hash');
        if (updErr) {
          log.warn({ err: updErr }, 'pair/claim: update failed');
          res.status(500).json({ error: 'pair_claim_failed' } satisfies ErrorBody);
          return;
        }
        if (!Array.isArray(updated) || updated.length === 0) {
          // Lost the race (someone claimed between our read and write).
          res.status(409).json({ error: 'code_not_claimable', reason: 'race' } satisfies ErrorBody);
          return;
        }

        await emitDeviceEvent(owner, 'pair_claimed', {
          devicePubkey: pairing.device_pubkey,
          deviceName: pairing.device_name,
          platform: pairing.platform,
        });

        res.status(200).json({
          status: 'claimed',
          // Surfaced for EXPLICIT human confirmation — "is this the device you're pairing?"
          device: {
            device_pubkey: pairing.device_pubkey,
            device_name: pairing.device_name,
            platform: pairing.platform,
          },
        });
      } catch (err) {
        log.error({ err }, 'POST /v1/pmp/devices/pair/claim failed');
        res.status(500).json({ error: 'pair_claim_failed' } satisfies ErrorBody);
      }
    },
  );

  /**
   * POST /v1/pmp/devices/pair/complete — the DEVICE proves possession of its key. DEVICE-SIGNED
   * (not Privy). Body: { device_pubkey, timestamp, signature } where signature is ed25519 over
   * `pmp-pair-complete:<device_pubkey>:<timestamp>`, within ±120s.
   *   - Verifies the signature against device_pubkey (proves the caller holds the secret key).
   *   - Requires a CLAIMED code for that device (an owner already confirmed it). A pending code
   *     cannot be completed — 409.
   *   - Consumes the code (single-use) and creates the pmp_devices row, bound to the owner the
   *     claim set. Emits a 'paired' notification.
   */
  router.post('/v1/pmp/devices/pair/complete', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const devicePubkey = typeof body.device_pubkey === 'string' ? body.device_pubkey.trim() : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const timestamp = typeof body.timestamp === 'number' ? body.timestamp : Number(body.timestamp);

    if (!devicePubkey || !signature || !Number.isFinite(timestamp)) {
      res
        .status(422)
        .json({ error: 'invalid_body', hint: 'device_pubkey, timestamp, and signature are required' } satisfies ErrorBody);
      return;
    }

    // Prove possession of the device key BEFORE any DB work.
    const sig = verifyDeviceSignature(
      devicePubkey,
      `pmp-pair-complete:${devicePubkey}:${timestamp}`,
      signature,
      timestamp,
    );
    if (!sig.ok) {
      res
        .status(401)
        .json({ error: 'invalid_device_signature', reason: sig.reason } satisfies ErrorBody);
      return;
    }

    try {
      const db = getDb();
      // Find the CLAIMED code for this device (owner already confirmed it).
      const { data: codeRow, error: lookupErr } = await db
        .from('pmp_pairing_codes')
        .select('code_hash, device_pubkey, device_name, platform, owner_wallet, status, expires_at')
        .eq('device_pubkey', devicePubkey)
        .eq('status', 'claimed')
        .limit(1)
        .maybeSingle();
      if (lookupErr) {
        log.warn({ err: lookupErr }, 'pair/complete: lookup failed');
        res.status(500).json({ error: 'pair_complete_failed' } satisfies ErrorBody);
        return;
      }
      if (!codeRow) {
        // Either never claimed (still pending), already consumed, or unknown — not completable.
        res
          .status(409)
          .json({ error: 'no_claimed_pairing', hint: 'the code must be claimed by the account owner first' } satisfies ErrorBody);
        return;
      }
      const pairing = codeRow as {
        code_hash: string;
        device_pubkey: string;
        device_name: string | null;
        platform: string | null;
        owner_wallet: string | null;
        status: string;
        expires_at: string;
      };
      if (!pairing.owner_wallet) {
        // Defensive: a claimed row must carry the bound owner.
        res.status(409).json({ error: 'pairing_not_bound' } satisfies ErrorBody);
        return;
      }
      // The pairing window also bounds completion — a long-stalled claim is not completable.
      if (Date.parse(pairing.expires_at) <= Date.now()) {
        await db
          .from('pmp_pairing_codes')
          .update({ status: 'expired' })
          .eq('code_hash', pairing.code_hash)
          .eq('status', 'claimed');
        res.status(410).json({ error: 'code_expired' } satisfies ErrorBody);
        return;
      }

      const owner = pairing.owner_wallet;
      const deviceId = generateDeviceId();
      const nowIso = new Date().toISOString();

      // Create the device row. device_pubkey is globally UNIQUE (migration 033) — a second
      // completion of the same key collides; treat that as "already paired".
      const deviceRow = {
        device_id: deviceId,
        owner_wallet: owner,
        device_pubkey: devicePubkey,
        device_name: pairing.device_name,
        platform: pairing.platform,
        paired_at: nowIso,
        last_seen_at: nowIso,
        revoked_at: null,
        scopes: DEFAULT_DEVICE_SCOPES,
      };
      const { error: devErr } = await db.from('pmp_devices').insert(deviceRow);
      if (devErr) {
        if ((devErr as { code?: string }).code === '23505') {
          res.status(409).json({ error: 'device_already_paired' } satisfies ErrorBody);
          return;
        }
        log.warn({ err: devErr }, 'pair/complete: device insert failed');
        res.status(500).json({ error: 'pair_complete_failed' } satisfies ErrorBody);
        return;
      }

      // Consume the code (single-use). Conditional on status='claimed' for idempotency.
      await db
        .from('pmp_pairing_codes')
        .update({ status: 'consumed' })
        .eq('code_hash', pairing.code_hash)
        .eq('status', 'claimed');

      await emitDeviceEvent(owner, 'paired', {
        deviceId,
        devicePubkey,
        deviceName: pairing.device_name,
        platform: pairing.platform,
      });

      res.status(201).json({
        device: {
          device_id: deviceId,
          device_pubkey: devicePubkey,
          device_name: pairing.device_name,
          platform: pairing.platform,
          scopes: DEFAULT_DEVICE_SCOPES,
          paired_at: nowIso,
        },
      });
    } catch (err) {
      log.error({ err }, 'POST /v1/pmp/devices/pair/complete failed');
      res.status(500).json({ error: 'pair_complete_failed' } satisfies ErrorBody);
    }
  });

  /** GET /v1/pmp/devices — the caller's ACTIVE (non-revoked) paired devices, owner-scoped. */
  router.get(
    '/v1/pmp/devices',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      try {
        const db = getDb();
        const { data, error } = await db
          .from('pmp_devices')
          .select('device_id, device_pubkey, device_name, platform, paired_at, last_seen_at, scopes, revoked_at')
          .eq('owner_wallet', owner)
          .is('revoked_at', null) // active only — revoked devices drop out (Risk R9)
          .order('paired_at', { ascending: false })
          .limit(200);
        if (error) {
          log.warn({ err: error, owner }, 'GET /v1/pmp/devices failed');
          res.status(500).json({ error: 'list_failed' } satisfies ErrorBody);
          return;
        }
        res.json({ devices: data ?? [] });
      } catch (err) {
        log.error({ err }, 'GET /v1/pmp/devices failed');
        res.status(500).json({ error: 'list_failed' } satisfies ErrorBody);
      }
    },
  );

  /**
   * POST /v1/pmp/devices/:id/revoke — revoke a device the caller owns. Sets revoked_at so the
   * device drops out of the active lookup AND fails the device-signed memory pull. Owner-scoped:
   * a device you don't own is 404 (no cross-tenant existence leak), no mutation.
   */
  router.post(
    '/v1/pmp/devices/:id/revoke',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      const deviceId = String(req.params.id ?? '');
      if (!deviceId || deviceId.length > 64) {
        res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
        return;
      }
      try {
        const db = getDb();
        // Verify the device belongs to the caller before mutating (owner-scoped).
        const { data: dev, error: devErr } = await db
          .from('pmp_devices')
          .select('device_id, owner_wallet, device_pubkey, device_name, platform, revoked_at')
          .eq('device_id', deviceId)
          .eq('owner_wallet', owner)
          .limit(1)
          .maybeSingle();
        if (devErr) {
          log.warn({ err: devErr, deviceId }, 'revoke: lookup failed');
          res.status(500).json({ error: 'revoke_failed' } satisfies ErrorBody);
          return;
        }
        if (!dev) {
          res.status(404).json({ error: 'device_not_found' } satisfies ErrorBody);
          return;
        }
        const device = dev as {
          device_id: string;
          owner_wallet: string;
          device_pubkey: string;
          device_name: string | null;
          platform: string | null;
          revoked_at: string | null;
        };
        if (device.revoked_at) {
          // Idempotent — already revoked.
          res.json({ device_id: deviceId, revoked: true, already_revoked: true });
          return;
        }
        const nowIso = new Date().toISOString();
        const { error: updErr } = await db
          .from('pmp_devices')
          .update({ revoked_at: nowIso })
          .eq('device_id', deviceId)
          .eq('owner_wallet', owner);
        if (updErr) {
          log.warn({ err: updErr, deviceId }, 'revoke: update failed');
          res.status(500).json({ error: 'revoke_failed' } satisfies ErrorBody);
          return;
        }
        await emitDeviceEvent(owner, 'revoked', {
          deviceId,
          devicePubkey: device.device_pubkey,
          deviceName: device.device_name,
          platform: device.platform,
        });
        res.json({ device_id: deviceId, revoked: true });
      } catch (err) {
        log.error({ err, deviceId }, 'POST /v1/pmp/devices/:id/revoke failed');
        res.status(500).json({ error: 'revoke_failed' } satisfies ErrorBody);
      }
    },
  );

  /**
   * POST /v1/pmp/desktop/memories — DEVICE-SIGNED, owner-scoped, paginated memory pull. The paired
   * device pulls the owner's memories to build a `.pmp` locally (spec §4.2 step 2). Risk R9: this
   * is full memory egress, so it is signature-gated + replay-bounded (±120s) + revocable.
   *
   * Headers (X-PMP-*): X-PMP-Device (base58 pubkey), X-PMP-Timestamp (unix seconds),
   *                    X-PMP-Signature (base58 ed25519 over `pmp-pull:<pubkey>:<ts>`).
   * Body: { limit?, offset? }.
   *   - Verifies the signature + window, looks up the ACTIVE pmp_devices row for the pubkey, and
   *     scopes the memory query to THAT device's owner_wallet (never a client-supplied owner).
   *   - A revoked / unpaired device is 403; a bad/stale signature is 401.
   */
  router.post('/v1/pmp/desktop/memories', async (req: Request, res: Response) => {
    const devicePubkey = String(req.headers['x-pmp-device'] ?? '').trim();
    const signature = String(req.headers['x-pmp-signature'] ?? '');
    const tsHeader = String(req.headers['x-pmp-timestamp'] ?? '');
    const timestamp = Number(tsHeader);

    if (!devicePubkey || !signature || !tsHeader || !Number.isFinite(timestamp)) {
      res
        .status(401)
        .json({ error: 'device_signature_required', hint: 'X-PMP-Device, X-PMP-Timestamp, X-PMP-Signature required' } satisfies ErrorBody);
      return;
    }

    // 1. Prove possession of the device key + bound the replay window — BEFORE any data read.
    const sig = verifyDeviceSignature(
      devicePubkey,
      `pmp-pull:${devicePubkey}:${timestamp}`,
      signature,
      timestamp,
    );
    if (!sig.ok) {
      res.status(401).json({ error: 'invalid_device_signature', reason: sig.reason } satisfies ErrorBody);
      return;
    }

    try {
      const db = getDb();
      // 2. Resolve the device → its owner. ACTIVE only: a revoked device has no live pull.
      const { data: devRow, error: devErr } = await db
        .from('pmp_devices')
        .select('device_id, owner_wallet, device_pubkey, revoked_at, scopes')
        .eq('device_pubkey', devicePubkey)
        .limit(1)
        .maybeSingle();
      if (devErr) {
        log.warn({ err: devErr }, 'desktop/memories: device lookup failed');
        res.status(500).json({ error: 'pull_failed' } satisfies ErrorBody);
        return;
      }
      if (!devRow) {
        // Signature is valid but the key is not paired (or was hard-deleted) → not authorised.
        res.status(403).json({ error: 'device_not_paired' } satisfies ErrorBody);
        return;
      }
      const device = devRow as {
        device_id: string;
        owner_wallet: string;
        device_pubkey: string;
        revoked_at: string | null;
        scopes: string[] | null;
      };
      if (device.revoked_at) {
        res.status(403).json({ error: 'device_revoked' } satisfies ErrorBody);
        return;
      }
      if (Array.isArray(device.scopes) && !device.scopes.includes('memories:read')) {
        res.status(403).json({ error: 'insufficient_scope', hint: 'device lacks memories:read' } satisfies ErrorBody);
        return;
      }

      // 3. Pagination.
      const body = req.body ?? {};
      let limit = Number(body.limit);
      if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PULL_LIMIT;
      limit = Math.min(Math.floor(limit), MAX_PULL_LIMIT);
      let offset = Number(body.offset);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;
      offset = Math.floor(offset);

      // 4. Owner-scoped page — ONLY the device owner's memories, deterministic order for stable paging.
      const { data: memsRaw, error: memsErr } = await db
        .from('memories')
        .select(
          'id, hash_id, memory_type, content, summary, owner_wallet, created_at, tags, source, related_user, related_wallet, content_hash, importance',
        )
        .eq('owner_wallet', device.owner_wallet)
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (memsErr) {
        log.warn({ err: memsErr }, 'desktop/memories: memory page failed');
        res.status(500).json({ error: 'pull_failed' } satisfies ErrorBody);
        return;
      }
      const memories = (memsRaw ?? []) as Array<Record<string, unknown>>;

      // 5. Bookkeeping: bump last_seen_at; emit an egress notification on a large pull (Risk R9).
      await db
        .from('pmp_devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('device_id', device.device_id);
      if (memories.length >= LARGE_PULL_THRESHOLD) {
        await emitDeviceEvent(device.owner_wallet, 'memory_pull', {
          deviceId: device.device_id,
          devicePubkey,
          metadata: { count: memories.length, offset },
        });
      }

      const nextOffset = memories.length === limit ? offset + limit : null;
      res.json({ memories, count: memories.length, next_offset: nextOffset, limit });
    } catch (err) {
      log.error({ err }, 'POST /v1/pmp/desktop/memories failed');
      res.status(500).json({ error: 'pull_failed' } satisfies ErrorBody);
    }
  });

  return router;
}
