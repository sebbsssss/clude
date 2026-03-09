import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { createChildLogger } from './logger';

const log = createChildLogger('database');

let supabase: SupabaseClient;

export function getDb(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey);
    log.info('Supabase client initialized');
  }
  return supabase;
}

/** @internal SDK escape hatch — allows Cortex to inject a pre-configured client. */
export function _setDb(client: SupabaseClient): void {
  supabase = client;
}

export async function initDatabase(): Promise<void> {
  const db = getDb();

  // Create tables via SQL (using Supabase's rpc or direct REST)
  // We'll use the Supabase SQL editor approach — run migrations via rpc
  try {
    const { error } = await db.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS wallet_links (
          id BIGSERIAL PRIMARY KEY,
          x_handle TEXT UNIQUE NOT NULL,
          x_user_id TEXT UNIQUE NOT NULL,
          wallet_address TEXT NOT NULL,
          verified_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS processed_mentions (
          tweet_id TEXT PRIMARY KEY,
          feature TEXT NOT NULL,
          response_tweet_id TEXT,
          processed_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS opinion_commits (
          id BIGSERIAL PRIMARY KEY,
          tweet_id TEXT NOT NULL,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          answer_hash TEXT NOT NULL,
          solana_signature TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT PRIMARY KEY,
          count INTEGER DEFAULT 0,
          window_start TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS price_snapshots (
          id BIGSERIAL PRIMARY KEY,
          price_usd DOUBLE PRECISION NOT NULL,
          volume_24h DOUBLE PRECISION,
          market_cap DOUBLE PRECISION,
          recorded_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_price_snapshots_recorded ON price_snapshots(recorded_at);

        CREATE EXTENSION IF NOT EXISTS pg_trgm;

        CREATE TABLE IF NOT EXISTS memories (
          id BIGSERIAL PRIMARY KEY,
          memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'self_model')),
          content TEXT NOT NULL,
          summary TEXT NOT NULL,
          tags TEXT[] DEFAULT '{}',
          emotional_valence REAL DEFAULT 0,
          importance REAL DEFAULT 0.5,
          access_count INTEGER DEFAULT 0,
          source TEXT,
          source_id TEXT,
          related_user TEXT,
          related_wallet TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_accessed TIMESTAMPTZ DEFAULT NOW(),
          decay_factor REAL DEFAULT 1.0
        );

        CREATE TABLE IF NOT EXISTS dream_logs (
          id BIGSERIAL PRIMARY KEY,
          session_type TEXT NOT NULL CHECK (session_type IN ('consolidation', 'reflection', 'emergence')),
          input_memory_ids BIGINT[] DEFAULT '{}',
          output TEXT NOT NULL,
          new_memories_created BIGINT[] DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
        CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(related_user);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_factor);
        CREATE INDEX IF NOT EXISTS idx_dream_logs_type ON dream_logs(session_type);
        CREATE INDEX IF NOT EXISTS idx_dream_logs_created ON dream_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_keys (
          id BIGSERIAL PRIMARY KEY,
          api_key TEXT UNIQUE NOT NULL,
          agent_id TEXT UNIQUE NOT NULL,
          agent_name TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'AGENT_UNKNOWN'
            CHECK (tier IN ('AGENT_VERIFIED', 'AGENT_UNKNOWN', 'AGENT_ALLY', 'AGENT_RIVAL')),
          total_interactions INTEGER DEFAULT 0,
          registered_at TIMESTAMPTZ DEFAULT NOW(),
          last_used TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT TRUE,
          metadata JSONB DEFAULT '{}',
          owner_wallet TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_agent_keys_api_key ON agent_keys(api_key);
        CREATE INDEX IF NOT EXISTS idx_agent_keys_owner ON agent_keys(owner_wallet);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_owner_unique ON agent_keys(owner_wallet) WHERE owner_wallet IS NOT NULL;

        -- Cortex recall performance: owner_wallet scoped queries
        CREATE INDEX IF NOT EXISTS idx_cortex_owner_recall ON memories(owner_wallet, decay_factor DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cortex_owner_type ON memories(owner_wallet, memory_type);
        -- Migration: evidence-linked reflections (Park et al. 2023)
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS evidence_ids BIGINT[] DEFAULT '{}';
        CREATE INDEX IF NOT EXISTS idx_memories_evidence ON memories USING GIN(evidence_ids);

        -- Migration: on-chain memory commits
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS solana_signature TEXT;

        -- Migration: concept ontology
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS concepts TEXT[] DEFAULT '{}';
        CREATE INDEX IF NOT EXISTS idx_memories_concepts ON memories USING GIN(concepts);

        -- Migration: hash IDs and compaction tracking
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS hash_id TEXT;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS compacted BOOLEAN DEFAULT FALSE;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS compacted_into TEXT;

        -- Backfill hash_ids for any existing memories that lack one
        UPDATE memories
        SET hash_id = 'clude-' || SUBSTRING(md5(id::text || created_at::text), 1, 8)
        WHERE hash_id IS NULL;

        CREATE INDEX IF NOT EXISTS idx_memories_compaction
        ON memories(memory_type, compacted, decay_factor, importance, created_at)
        WHERE memory_type = 'episodic' AND compacted = FALSE;

        -- Memory fragments: granular vector decomposition for precision retrieval
        CREATE TABLE IF NOT EXISTS memory_fragments (
          id BIGSERIAL PRIMARY KEY,
          memory_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          fragment_type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding vector(1024),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_fragments_memory_id ON memory_fragments(memory_id);

        -- Memory association graph: typed, weighted links between memories
        CREATE TABLE IF NOT EXISTS memory_links (
          id BIGSERIAL PRIMARY KEY,
          source_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          target_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          link_type TEXT NOT NULL CHECK (link_type IN (
            'supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves'
          )),
          strength REAL DEFAULT 0.5,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source_id, target_id, link_type)
        );
        CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id);
        CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id);
        CREATE INDEX IF NOT EXISTS idx_links_type ON memory_links(link_type);
        CREATE INDEX IF NOT EXISTS idx_links_strength ON memory_links(strength DESC);

        -- 1-hop traversal: get all memories linked to a set of IDs (both directions)
        CREATE OR REPLACE FUNCTION get_linked_memories(
          seed_ids BIGINT[],
          min_strength FLOAT DEFAULT 0.1,
          max_results INT DEFAULT 20,
          filter_owner TEXT DEFAULT NULL
        )
        RETURNS TABLE (
          memory_id BIGINT,
          linked_from BIGINT,
          link_type TEXT,
          strength FLOAT
        )
        LANGUAGE sql AS $$
          SELECT DISTINCT ON (ml.target_id, ml.link_type)
            ml.target_id AS memory_id,
            ml.source_id AS linked_from,
            ml.link_type,
            ml.strength::float
          FROM memory_links ml
          JOIN memories m ON m.id = ml.target_id
          WHERE ml.source_id = ANY(seed_ids)
            AND ml.target_id != ALL(seed_ids)
            AND ml.strength >= min_strength
            AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
          UNION
          SELECT DISTINCT ON (ml.source_id, ml.link_type)
            ml.source_id AS memory_id,
            ml.target_id AS linked_from,
            ml.link_type,
            ml.strength::float
          FROM memory_links ml
          JOIN memories m ON m.id = ml.source_id
          WHERE ml.target_id = ANY(seed_ids)
            AND ml.source_id != ALL(seed_ids)
            AND ml.strength >= min_strength
            AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
          ORDER BY strength DESC
          LIMIT max_results;
        $$;

        -- Hebbian reinforcement: boost link strength for co-retrieved memories
        CREATE OR REPLACE FUNCTION boost_link_strength(
          memory_ids BIGINT[],
          boost_amount FLOAT DEFAULT 0.05
        )
        RETURNS INTEGER
        LANGUAGE plpgsql AS $$
        DECLARE affected INTEGER;
        BEGIN
          UPDATE memory_links
          SET strength = LEAST(1.0, strength + boost_amount)
          WHERE source_id = ANY(memory_ids)
            AND target_id = ANY(memory_ids);
          GET DIAGNOSTICS affected = ROW_COUNT;
          RETURN affected;
        END;
        $$;

        -- Migration: expand dream_logs session types for compaction/decay/contradiction_resolution
        ALTER TABLE dream_logs DROP CONSTRAINT IF EXISTS dream_logs_session_type_check;
        ALTER TABLE dream_logs ADD CONSTRAINT dream_logs_session_type_check
          CHECK (session_type IN ('consolidation', 'reflection', 'emergence', 'compaction', 'decay', 'contradiction_resolution'));

        -- Migration: add 'resolves' link type for contradiction resolution
        ALTER TABLE memory_links DROP CONSTRAINT IF EXISTS memory_links_link_type_check;
        ALTER TABLE memory_links ADD CONSTRAINT memory_links_link_type_check
          CHECK (link_type IN (
            'supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves'
          ));

        -- Migration: client-side encryption support
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT FALSE;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS encryption_pubkey TEXT;

        -- Migration: owner wallet for memory ownership
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS owner_wallet TEXT;
        CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner_wallet);

        -- Migration: owner wallet on agent keys for hosted cortex
        ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS owner_wallet TEXT;
        CREATE INDEX IF NOT EXISTS idx_agent_keys_owner ON agent_keys(owner_wallet);

        -- Find unresolved contradiction pairs (no 'resolves' link spanning both)
        CREATE OR REPLACE FUNCTION get_unresolved_contradictions(
          max_pairs INT DEFAULT 3,
          filter_owner TEXT DEFAULT NULL
        )
        RETURNS TABLE (
          link_id BIGINT,
          source_id BIGINT,
          target_id BIGINT,
          strength FLOAT
        )
        LANGUAGE sql AS $$
          SELECT
            ml.id AS link_id,
            ml.source_id,
            ml.target_id,
            ml.strength::float
          FROM memory_links ml
          JOIN memories ms ON ms.id = ml.source_id AND ms.decay_factor > 0.1
          JOIN memories mt ON mt.id = ml.target_id AND mt.decay_factor > 0.1
          WHERE ml.link_type = 'contradicts'
            AND (filter_owner IS NULL OR ms.owner_wallet = filter_owner)
            AND (filter_owner IS NULL OR mt.owner_wallet = filter_owner)
            AND NOT EXISTS (
              SELECT 1 FROM memory_links r1
              JOIN memory_links r2 ON r1.source_id = r2.source_id
              WHERE r1.link_type = 'resolves'
                AND r2.link_type = 'resolves'
                AND r1.target_id = ml.source_id
                AND r2.target_id = ml.target_id
            )
          ORDER BY ml.strength DESC, ml.created_at DESC
          LIMIT max_pairs;
        $$;

        -- Campaign: tweet tracking
        CREATE TABLE IF NOT EXISTS campaign_tweets (
          id BIGSERIAL PRIMARY KEY,
          tweet_id TEXT UNIQUE NOT NULL,
          author_id TEXT NOT NULL,
          author_username TEXT,
          text TEXT NOT NULL,
          campaign_day INTEGER NOT NULL CHECK (campaign_day BETWEEN 1 AND 10),
          content_type TEXT DEFAULT 'general',
          likes INTEGER DEFAULT 0,
          retweets INTEGER DEFAULT 0,
          replies INTEGER DEFAULT 0,
          quotes INTEGER DEFAULT 0,
          engagement_score REAL DEFAULT 0,
          is_holder BOOLEAN DEFAULT FALSE,
          wallet_address TEXT,
          is_eligible BOOLEAN DEFAULT TRUE,
          tokens_awarded REAL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          metrics_updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_campaign_tweets_day ON campaign_tweets(campaign_day);
        CREATE INDEX IF NOT EXISTS idx_campaign_tweets_score ON campaign_tweets(engagement_score DESC);

        -- Campaign: gacha spins
        CREATE TABLE IF NOT EXISTS campaign_gacha (
          id BIGSERIAL PRIMARY KEY,
          campaign_day INTEGER NOT NULL CHECK (campaign_day IN (2, 8)),
          wallet_address TEXT NOT NULL,
          x_handle TEXT,
          bet_amount REAL NOT NULL,
          multiplier REAL NOT NULL,
          win BOOLEAN NOT NULL,
          payout REAL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_campaign_gacha_day ON campaign_gacha(campaign_day);

        -- Campaign: hackathon grants
        CREATE TABLE IF NOT EXISTS campaign_grants (
          id SERIAL PRIMARY KEY,
          grant_number INTEGER UNIQUE NOT NULL CHECK (grant_number BETWEEN 1 AND 3),
          reveal_day INTEGER NOT NULL,
          project_name TEXT DEFAULT '',
          project_url TEXT DEFAULT '',
          pfp_image_url TEXT DEFAULT '',
          description TEXT DEFAULT '',
          amount REAL DEFAULT 10000000,
          is_revealed BOOLEAN DEFAULT FALSE,
          revealed_at TIMESTAMPTZ
        );
        INSERT INTO campaign_grants (grant_number, reveal_day)
          VALUES (1, 4), (2, 6), (3, 9) ON CONFLICT DO NOTHING;

        -- Campaign: global state (single row)
        CREATE TABLE IF NOT EXISTS campaign_state (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          campaign_start TIMESTAMPTZ NOT NULL DEFAULT '2026-02-25T00:00:00Z',
          campaign_end TIMESTAMPTZ NOT NULL DEFAULT '2026-03-07T00:00:00Z',
          current_day INTEGER DEFAULT 0,
          total_tokens_distributed REAL DEFAULT 0,
          is_active BOOLEAN DEFAULT FALSE
        );
        INSERT INTO campaign_state (id, campaign_start, campaign_end)
          VALUES (1, '2026-02-25T00:00:00Z', '2026-03-07T00:00:00Z') ON CONFLICT DO NOTHING;

        -- Agent Dashboard: orchestration & monitoring tables
        CREATE TABLE IF NOT EXISTS dashboard_agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          type TEXT DEFAULT 'claude_code' CHECK (type IN ('claude_code', 'script', 'webhook', 'clude_bot', 'content', 'research', 'dev', 'testing', 'design_audit', 'customer_journey')),
          status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'paused', 'error')),
          description TEXT,
          config JSONB DEFAULT '{}',
          heartbeat_url TEXT,
          heartbeat_interval_ms INTEGER DEFAULT 300000,
          last_heartbeat_at TIMESTAMPTZ,
          budget_monthly_usd NUMERIC(10,2) DEFAULT 0,
          budget_used_usd NUMERIC(10,2) DEFAULT 0,
          budget_reset_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_agents_status ON dashboard_agents(status);
        CREATE INDEX IF NOT EXISTS idx_dashboard_agents_type ON dashboard_agents(type);

        CREATE TABLE IF NOT EXISTS dashboard_tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES dashboard_agents(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
          priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
          parent_task_id UUID REFERENCES dashboard_tasks(id) ON DELETE SET NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_agent ON dashboard_tasks(agent_id);
        CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_status ON dashboard_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_priority ON dashboard_tasks(priority);

        CREATE TABLE IF NOT EXISTS dashboard_activity (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES dashboard_agents(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          details JSONB DEFAULT '{}',
          cost_usd NUMERIC(10,4) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_activity_agent ON dashboard_activity(agent_id);
        CREATE INDEX IF NOT EXISTS idx_dashboard_activity_action ON dashboard_activity(action);
        CREATE INDEX IF NOT EXISTS idx_dashboard_activity_created ON dashboard_activity(created_at DESC);
      `
    });

    if (error) {
      log.warn({ error: error.message }, 'Could not auto-create tables via rpc. Create tables via Supabase SQL editor.');
    }
  } catch {
    log.warn('rpc exec_sql not available. Create tables via Supabase SQL editor.');
  }

  log.info('Database initialized');
}

// Rate limiting helpers
export async function checkRateLimit(key: string, maxCount: number, windowMinutes: number): Promise<boolean> {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { data: row } = await db
    .from('rate_limits')
    .select('count, window_start')
    .eq('key', key)
    .single();

  if (!row || row.window_start < cutoff) {
    await db
      .from('rate_limits')
      .upsert({ key, count: 1, window_start: new Date().toISOString() });
    return true;
  }

  if (row.count >= maxCount) return false;

  await db
    .from('rate_limits')
    .update({ count: row.count + 1 })
    .eq('key', key);
  return true;
}

export async function isAlreadyProcessed(tweetId: string): Promise<boolean> {
  const db = getDb();
  const { data } = await db
    .from('processed_mentions')
    .select('tweet_id')
    .eq('tweet_id', tweetId)
    .single();
  return !!data;
}

/**
 * Atomically claim a tweet for processing. Returns true if we got the lock,
 * false if another process already claimed it.
 * 
 * This prevents race conditions where two processes see isAlreadyProcessed=false
 * before either has a chance to mark it.
 */
export async function claimForProcessing(tweetId: string): Promise<boolean> {
  const db = getDb();
  
  // Insert with onConflict=ignore — only succeeds if no row exists
  const { error } = await db
    .from('processed_mentions')
    .insert({
      tweet_id: tweetId,
      feature: 'processing',
      response_tweet_id: null,
      processed_at: new Date().toISOString(),
    });
  
  // If error is unique violation (code 23505), another process claimed it
  if (error) {
    // Any error means we didn't get the lock (already exists or DB issue)
    return false;
  }
  
  return true;
}

export async function markProcessed(tweetId: string, feature: string, responseTweetId?: string): Promise<void> {
  const db = getDb();
  await db
    .from('processed_mentions')
    .upsert({
      tweet_id: tweetId,
      feature,
      response_tweet_id: responseTweetId || null,
      processed_at: new Date().toISOString(),
    });
}
