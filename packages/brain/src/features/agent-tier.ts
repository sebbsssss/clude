import { randomBytes, createHash } from 'crypto';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import type { AgentTier } from '../character/agent-tier-modifiers';
import {
  resolveWalletsForDid,
  ensurePrivySolanaWalletForDid,
  resolveEmailForDid,
} from '../auth/privy-wallet-resolver';

const log = createChildLogger('agent-tier');

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX_WALLET_RE = /^[0-9a-f]+$/;

export interface AgentRegistration {
  id: number;
  api_key: string;
  agent_id: string;
  agent_name: string;
  tier: AgentTier;
  total_interactions: number;
  registered_at: string;
  last_used: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  owner_wallet: string | null;
  privy_did: string | null;
  email: string | null;
}

export async function authenticateAgent(apiKey: string): Promise<AgentRegistration | null> {
  const db = getDb();

  const { data, error } = await db
    .from('agent_keys')
    .select('*')
    .eq('api_key', apiKey)
    .eq('is_active', true)
    .single();

  if (error) {
    log.warn({ error: error.message, code: error.code }, 'agent auth query failed');
    return null;
  }
  if (!data) return null;

  return data as AgentRegistration;
}

/**
 * Look up an active agent registration by Privy DID.
 * Returns null if no agent is registered for this DID.
 */
export async function authenticateAgentByDid(did: string): Promise<AgentRegistration | null> {
  const db = getDb();
  const { data, error } = await db
    .from('agent_keys')
    .select('*')
    .eq('privy_did', did)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data as AgentRegistration;
}

export async function recordAgentInteraction(agentId: string): Promise<void> {
  const db = getDb();

  const { data: current } = await db
    .from('agent_keys')
    .select('total_interactions')
    .eq('agent_id', agentId)
    .single();

  await db
    .from('agent_keys')
    .update({
      total_interactions: (current?.total_interactions || 0) + 1,
      last_used: new Date().toISOString(),
    })
    .eq('agent_id', agentId);
}

export async function registerAgent(
  name: string,
  tier: AgentTier = 'AGENT_UNKNOWN'
): Promise<{ agentId: string; apiKey: string }> {
  const db = getDb();
  const agentId = `agent_${randomBytes(8).toString('hex')}`;
  const apiKey = `clk_${randomBytes(24).toString('hex')}`;

  const { error } = await db
    .from('agent_keys')
    .insert({
      api_key: apiKey,
      agent_id: agentId,
      agent_name: name,
      tier,
    });

  if (error) {
    log.error({ error: error.message }, 'Failed to register agent');
    throw new Error('Agent registration failed');
  }

  log.info({ agentId, name, tier }, 'Agent registered');
  return { agentId, apiKey };
}

/**
 * Migrate all user data from a synthetic owner_wallet to a real Solana wallet.
 * Called when an email-only user links a wallet via Privy.
 *
 * Guards:
 * - oldWallet must be synthetic (hex format)
 * - newWallet must be a real Solana address (base58)
 * - newWallet must not already belong to another user
 */
export async function migrateOwnerWallet(oldWallet: string, newWallet: string): Promise<void> {
  // Guard: old must be synthetic (hex)
  if (!HEX_WALLET_RE.test(oldWallet)) {
    throw new Error('Source wallet is not synthetic — refusing to migrate');
  }

  // Guard: new must be real Solana address (base58)
  if (!SOLANA_ADDR_RE.test(newWallet)) {
    throw new Error('Target wallet is not a valid Solana address');
  }

  const db = getDb();

  // Guard: collision — check if new wallet already has an agent
  const { data: collision } = await db
    .from('agent_keys')
    .select('agent_id')
    .eq('owner_wallet', newWallet)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (collision) {
    throw new Error('Target wallet already belongs to another user');
  }

  // Migrate all tables sequentially
  // 1. agent_keys
  await db.from('agent_keys').update({ owner_wallet: newWallet }).eq('owner_wallet', oldWallet);

  // 2. memories
  await db.from('memories').update({ owner_wallet: newWallet }).eq('owner_wallet', oldWallet);

  // 3. chat_conversations
  await db.from('chat_conversations').update({ owner_wallet: newWallet }).eq('owner_wallet', oldWallet);

  // 4. chat_usage
  await db.from('chat_usage').update({ wallet_address: newWallet }).eq('wallet_address', oldWallet);

  // 5. chat_topups
  await db.from('chat_topups').update({ wallet_address: newWallet }).eq('wallet_address', oldWallet);

  // 6. llm_outputs
  await db.from('llm_outputs').update({ owner_wallet: newWallet }).eq('owner_wallet', oldWallet);

  // 7. chat_balances (PK is wallet_address — can't update in place)
  const { data: balance } = await db
    .from('chat_balances')
    .select('*')
    .eq('wallet_address', oldWallet)
    .single();

  if (balance) {
    await db.from('chat_balances').delete().eq('wallet_address', oldWallet);
    await db.from('chat_balances').upsert({
      wallet_address: newWallet,
      balance_usdc: balance.balance_usdc,
      total_deposited: balance.total_deposited,
      total_spent: balance.total_spent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'wallet_address', ignoreDuplicates: false });
  }

  log.info({ oldWallet, newWallet }, 'Owner wallet migrated across all tables');
}

/**
 * Find existing agent key for a wallet, or create one.
 * Returns the plaintext API key.
 */
export async function findOrCreateAgentForWallet(wallet: string): Promise<{ apiKey: string; agentId: string; isNew: boolean }> {
  const db = getDb();

  // Check if wallet already has an agent
  const { data: existing } = await db
    .from('agent_keys')
    .select('agent_id, api_key')
    .eq('owner_wallet', wallet)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (existing) {
    return { apiKey: existing.api_key, agentId: existing.agent_id, isNew: false };
  }

  // Create new agent for this wallet
  const name = `chat-${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

  // Set the owner_wallet
  await db
    .from('agent_keys')
    .update({ owner_wallet: wallet })
    .eq('agent_id', agentId);

  return { apiKey, agentId, isNew: true };
}

/**
 * Find or create an agent for a Privy DID.
 *
 * Identity is anchored on EMAIL when one is verified for the DID — this
 * keeps the same person on the same agent_keys row across devices/sessions
 * even if Privy provisions a fresh embedded wallet for a new device. Email
 * is stamped onto every row this function returns when it can be resolved,
 * so existing rows backfill passively as users log in.
 *
 * Order of operations:
 *  1. DID already has an agent → return it (existing wallet-link / migration paths preserved).
 *  2. DID is new BUT email matches an existing active row → adopt that row, attach this DID.
 *  3. DID is new and a wallet was passed → find/create by wallet, backfill DID.
 *  4. DID is new, no wallet → provision a Privy embedded Solana wallet, create agent.
 *  5. Last resort → synthetic owner_wallet (Privy unavailable).
 */
async function stampEmailOnAgent(agentId: string, email: string | null): Promise<void> {
  if (!email) return;
  const db = getDb();
  // Idempotent: only writes when the row's email is null OR differs.
  const { data: row } = await db
    .from('agent_keys')
    .select('email')
    .eq('agent_id', agentId)
    .single();
  if (!row || row.email === email) return;
  if (row.email && row.email !== email) {
    log.warn(
      { agentId, existingEmail: row.email, incomingEmail: email },
      'Refusing to overwrite agent email with a different verified address',
    );
    return;
  }
  const { error } = await db
    .from('agent_keys')
    .update({ email })
    .eq('agent_id', agentId);
  if (error) {
    log.warn({ agentId, email, err: error.message }, 'Failed to stamp email on agent_keys');
  }
}

export async function findOrCreateAgentForDid(
  did: string,
  wallet?: string,
): Promise<{ apiKey: string; agentId: string; isNew: boolean; ownerWallet: string }> {
  const db = getDb();

  // Resolve verified email up front (cached, single Privy call). Used for
  // email-anchored adoption AND for passively backfilling rows on every login.
  const verifiedEmail = await resolveEmailForDid(did).catch(() => null as string | null);

  // 1. Check if DID already has an agent
  const { data: existing } = await db
    .from('agent_keys')
    .select('agent_id, api_key, owner_wallet')
    .eq('privy_did', did)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (existing) {
    // Check if email user is now providing a real wallet (wallet linking)
    if (wallet && existing.owner_wallet && HEX_WALLET_RE.test(existing.owner_wallet) && SOLANA_ADDR_RE.test(wallet)) {
      try {
        await migrateOwnerWallet(existing.owner_wallet, wallet);
        await stampEmailOnAgent(existing.agent_id, verifiedEmail);
        return {
          apiKey: existing.api_key,
          agentId: existing.agent_id,
          isNew: false,
          ownerWallet: wallet,
        };
      } catch (err: any) {
        // Migration collided: the real wallet already has an agent (typically
        // an orphan row from the pre-Privy wallet-auth era). Adopt that row
        // only if BOTH guards pass:
        //   1. Privy confirms this DID actually owns the wallet — otherwise
        //      anyone could claim any wallet by passing it in the body.
        //   2. The existing agent is orphan (privy_did IS NULL) — never steal
        //      another DID's claim.
        const linkedWallets = await resolveWalletsForDid(did).catch(() => [] as string[]);
        if (linkedWallets.includes(wallet)) {
          const { data: realAgent } = await db
            .from('agent_keys')
            .select('agent_id, api_key')
            .eq('owner_wallet', wallet)
            .eq('is_active', true)
            .is('privy_did', null)
            .limit(1)
            .single();

          if (realAgent) {
            // Retire synthetic first — the unique index on privy_did forbids
            // two active rows carrying the same DID.
            await db
              .from('agent_keys')
              .update({ privy_did: null, is_active: false })
              .eq('agent_id', existing.agent_id);

            await db
              .from('agent_keys')
              .update({ privy_did: did })
              .eq('agent_id', realAgent.agent_id);

            log.info(
              { did, wallet, retired: existing.agent_id, adopted: realAgent.agent_id },
              'Migration collision resolved: adopted orphan real-wallet agent',
            );

            await stampEmailOnAgent(realAgent.agent_id, verifiedEmail);
            return {
              apiKey: realAgent.api_key,
              agentId: realAgent.agent_id,
              isNew: false,
              ownerWallet: wallet,
            };
          }
        }
        log.warn({ did, wallet, err: err.message }, 'Wallet linking migration failed');
        // Fall through — return existing agent with synthetic wallet
      }
    }

    // Existing agent has a synthetic-hex wallet AND no real wallet was passed
    // in this call. Try to provision one via Privy and migrate. This rescues
    // pre-existing email-signup accounts that registered before auto-
    // provisioning was wired (e.g. seb@clude.io, alexiustham@gmail.com).
    if (
      !wallet &&
      existing.owner_wallet &&
      HEX_WALLET_RE.test(existing.owner_wallet)
    ) {
      try {
        const provisioned = await ensurePrivySolanaWalletForDid(did);
        if (SOLANA_ADDR_RE.test(provisioned) && provisioned !== existing.owner_wallet) {
          await migrateOwnerWallet(existing.owner_wallet, provisioned);
          log.info(
            { did, agentId: existing.agent_id, from: existing.owner_wallet, to: provisioned },
            'Auto-migrated existing email-signup agent to Privy embedded wallet',
          );
          await stampEmailOnAgent(existing.agent_id, verifiedEmail);
          return {
            apiKey: existing.api_key,
            agentId: existing.agent_id,
            isNew: false,
            ownerWallet: provisioned,
          };
        }
      } catch (err: any) {
        log.warn(
          { did, err: err.message },
          'Auto-provisioning + migration failed for existing synthetic agent',
        );
        // Fall through — return existing agent with synthetic wallet.
      }
    }

    await stampEmailOnAgent(existing.agent_id, verifiedEmail);
    return {
      apiKey: existing.api_key,
      agentId: existing.agent_id,
      isNew: false,
      ownerWallet: existing.owner_wallet,
    };
  }

  // 1.5. Email-anchored adoption: same email = same agent_keys row, even if
  //      Privy issues a new DID (e.g. user signed in on a fresh device, or
  //      we re-registered them via the admin API). Without this, every new
  //      DID for an existing email gets a fresh embedded wallet and orphans
  //      the user's prior memory history.
  if (verifiedEmail) {
    const { data: emailRow } = await db
      .from('agent_keys')
      .select('agent_id, api_key, owner_wallet, privy_did')
      .eq('email', verifiedEmail)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (emailRow) {
      if (emailRow.privy_did && emailRow.privy_did !== did) {
        log.warn(
          { email: verifiedEmail, incomingDid: did, claimedBy: emailRow.privy_did },
          'Email already bound to a different active DID — skipping email-anchored adoption',
        );
      } else {
        // Free up the unique idx_agent_keys_privy_did partial index in case
        // an inactive row still carries this DID (otherwise the stamp below
        // would collide). is_active=false rows still count under the partial
        // index because it's WHERE privy_did IS NOT NULL.
        await db
          .from('agent_keys')
          .update({ privy_did: null })
          .eq('privy_did', did)
          .neq('agent_id', emailRow.agent_id);

        await db
          .from('agent_keys')
          .update({ privy_did: did })
          .eq('agent_id', emailRow.agent_id);

        log.info(
          {
            email: verifiedEmail,
            did,
            agentId: emailRow.agent_id,
            ownerWallet: emailRow.owner_wallet,
          },
          'Email-anchored adoption: bound DID to existing agent_keys row',
        );

        return {
          apiKey: emailRow.api_key,
          agentId: emailRow.agent_id,
          isNew: false,
          ownerWallet: emailRow.owner_wallet,
        };
      }
    }
  }

  // 2. DID not found — if wallet provided, find/create by wallet and backfill DID
  if (wallet) {
    const result = await findOrCreateAgentForWallet(wallet);

    // Backfill privy_did on the row
    await db
      .from('agent_keys')
      .update({ privy_did: did })
      .eq('agent_id', result.agentId);

    await stampEmailOnAgent(result.agentId, verifiedEmail);
    return { ...result, ownerWallet: wallet };
  }

  // 2.5. (Removed) Auto-adoption of "linked" wallets used to live here. It
  //      trusted Privy's `linked_accounts` API as proof of memory ownership,
  //      but `linked_accounts` only means "this wallet was active in the
  //      browser at signup," not "this user owns the wallet's history." A
  //      shared computer or a still-connected Phantom from a prior session
  //      caused new email signups to inherit unrelated history. Real
  //      ownership now requires an explicit signed-message import flow
  //      (Phase 2) — automatic adoption is gone.

  // 2.6. No existing record — provision a Privy embedded Solana wallet
  //      so the user has a fundable address from day one. This is the
  //      difference between an account that can top up and one that's
  //      stuck on a synthetic-hex owner_wallet forever.
  try {
    const provisionedWallet = await ensurePrivySolanaWalletForDid(did);
    if (SOLANA_ADDR_RE.test(provisionedWallet)) {
      const result = await findOrCreateAgentForWallet(provisionedWallet);
      await db
        .from('agent_keys')
        .update({ privy_did: did })
        .eq('agent_id', result.agentId);
      log.info(
        { did, agentId: result.agentId, wallet: provisionedWallet },
        'Provisioned Privy Solana wallet for new email-signup agent',
      );
      await stampEmailOnAgent(result.agentId, verifiedEmail);
      return { ...result, ownerWallet: provisionedWallet };
    }
  } catch (err: any) {
    log.warn(
      { did, err: err.message },
      'Privy wallet auto-provisioning failed — falling back to synthetic owner_wallet',
    );
  }

  // 3. Last resort — synthetic owner_wallet. Reached only if Privy's wallet
  //    API is down or not configured. The user can still chat (free tier)
  //    but cannot top up until the wallet is later provisioned.
  const syntheticWallet = createHash('sha256')
    .update(`privy:${did}`)
    .digest('hex')
    .slice(0, 44);

  const didSuffix = did.slice(-8);
  const name = `email-${didSuffix}`;
  const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

  // Set both privy_did and synthetic owner_wallet
  await db
    .from('agent_keys')
    .update({ owner_wallet: syntheticWallet, privy_did: did })
    .eq('agent_id', agentId);

  log.warn({ agentId, did, ownerWallet: syntheticWallet }, 'Created agent for Privy DID with SYNTHETIC wallet (Privy provisioning unavailable)');

  await stampEmailOnAgent(agentId, verifiedEmail);
  return { apiKey, agentId, isNew: true, ownerWallet: syntheticWallet };
}
