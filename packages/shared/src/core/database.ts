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

/**
 * The boot DDL blob — the full schema for a FRESH database. Since Memory 3.0 C0
 * (P0.4) this is NOT replayed on every start: replaying hundreds of lines of
 * CREATE OR REPLACE on boot silently reverts hand-applied migrations whenever
 * this blob is stale (the migration-028 class: a reverted RPC killed vector
 * recall for weeks). Migrations are the single schema writer for ESTABLISHED
 * databases; this blob only bootstraps empty ones (the self-hosted SDK
 * zero-config path). Keep it in sync with supabase-schema.sql + migrations.
 */
async function runBootDdl(db: SupabaseClient): Promise<void> {
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
          memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'self_model', 'introspective')),
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
          owner_wallet TEXT,
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
          owner_wallet TEXT,
          privy_did TEXT,
          email TEXT
        );

        -- Backfill: older deployments may have agent_keys without the email column.
        ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS email TEXT;

        CREATE INDEX IF NOT EXISTS idx_agent_keys_api_key ON agent_keys(api_key);
        CREATE INDEX IF NOT EXISTS idx_agent_keys_owner ON agent_keys(owner_wallet);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_owner_unique ON agent_keys(owner_wallet) WHERE owner_wallet IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_privy_did ON agent_keys(privy_did) WHERE privy_did IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_email ON agent_keys(email) WHERE email IS NOT NULL AND is_active = true;

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
            'supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves',
            'supersedes', 'happens_before', 'happens_after', 'concurrent_with'
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
            AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
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
            AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
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

        -- Migration 021: per-owner attribution for dream_logs (fixes totalDreamSessions leak)
        ALTER TABLE dream_logs ADD COLUMN IF NOT EXISTS owner_wallet TEXT;
        CREATE INDEX IF NOT EXISTS idx_dream_logs_owner ON dream_logs(owner_wallet);

        -- Migration: add 'resolves' + temporal link types
        ALTER TABLE memory_links DROP CONSTRAINT IF EXISTS memory_links_link_type_check;
        ALTER TABLE memory_links ADD CONSTRAINT memory_links_link_type_check
          CHECK (link_type IN (
            'supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves',
            'happens_before', 'happens_after', 'concurrent_with'
          ));

        -- Migration: client-side encryption support
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT FALSE;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS encryption_pubkey TEXT;

        -- Migration: add 'introspective' memory type
        ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_memory_type_check;
        ALTER TABLE memories ADD CONSTRAINT memories_memory_type_check
          CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'self_model', 'introspective'));

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

        -- Migration: temporal indexing (Exp 9)
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ DEFAULT NULL;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS event_date_precision TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_event_date ON memories(event_date)
          WHERE event_date IS NOT NULL;

        -- Lexical index for keyword/BM25 search (encryption §9). content_tokens is
        -- app-maintained; ts_summary (summary-only) is added on fresh deploys that lack it.
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_tokens tsvector;
        CREATE INDEX IF NOT EXISTS idx_memories_content_tokens ON memories USING GIN(content_tokens);
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS provider_delegated BOOLEAN DEFAULT TRUE;
        CREATE INDEX IF NOT EXISTS idx_memories_delegated ON memories(provider_delegated) WHERE encrypted = TRUE;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS summary_ciphertext TEXT;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_ciphertext TEXT;

        -- Memory 3.0 Phase 1 (migration 044): bi-temporal validity + provenance (additive/nullable, inert until MEMORY_RECONCILE)
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS invalid_at TIMESTAMPTZ;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded_by TEXT;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS fact_key TEXT;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS extractor_version TEXT;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS extraction_confidence REAL;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_turn_ref JSONB;
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS hash_id_v2 TEXT;
        CREATE INDEX IF NOT EXISTS idx_memories_valid ON memories(id) WHERE invalid_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_fact_key ON memories(fact_key) WHERE fact_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_hash_id_v2 ON memories(hash_id_v2) WHERE hash_id_v2 IS NOT NULL;

        -- Memory 3.0 Phase 1 (migration 044): the C2 durable write outbox.
        CREATE TABLE IF NOT EXISTS memory_write_jobs (
          id BIGSERIAL PRIMARY KEY,
          memory_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          job_type TEXT NOT NULL CHECK (job_type IN ('enrich', 'embed', 'link', 'extract', 'reconcile', 'backfill_v2')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
          attempts INT NOT NULL DEFAULT 0,
          next_retry_at TIMESTAMPTZ DEFAULT NOW(),
          last_error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_write_jobs_claim ON memory_write_jobs(status, next_retry_at) WHERE status IN ('pending', 'failed');
        CREATE INDEX IF NOT EXISTS idx_write_jobs_memory ON memory_write_jobs(memory_id);
        CREATE INDEX IF NOT EXISTS idx_write_jobs_running ON memory_write_jobs(updated_at) WHERE status = 'running';

        -- Memory 3.0 C2 outbox — MIRROR of migration 045 (byte-equivalent). The table above is in
        -- the boot blob, so the claim RPC + idempotency objects MUST be too: otherwise a
        -- boot-provisioned box gets the table but not the RPC and the worker silently never drains
        -- (the migration-028 class). Keep in sync with 045.
        DO $do$
        BEGIN
          ALTER TABLE memory_write_jobs DROP CONSTRAINT IF EXISTS memory_write_jobs_job_type_check;
          ALTER TABLE memory_write_jobs ADD CONSTRAINT memory_write_jobs_job_type_check
            CHECK (job_type IN ('enrich', 'embed', 'link', 'extract', 'reconcile', 'backfill_v2'));
        EXCEPTION WHEN undefined_table THEN NULL; END $do$;

        CREATE OR REPLACE FUNCTION claim_memory_write_jobs(
          p_limit INT DEFAULT 20, p_stale_running INTERVAL DEFAULT INTERVAL '15 minutes', p_owner TEXT DEFAULT NULL
        )
        RETURNS TABLE (id BIGINT, memory_id BIGINT, job_type TEXT, attempts INT, owner_wallet TEXT)
        LANGUAGE plpgsql AS $claimfn$
        BEGIN
          RETURN QUERY
          UPDATE memory_write_jobs j
             SET status = 'running', attempts = j.attempts + 1, updated_at = NOW()
            FROM (
              SELECT jj.id FROM memory_write_jobs jj JOIN memories m ON m.id = jj.memory_id
               WHERE ((jj.status IN ('pending','failed') AND jj.next_retry_at IS NOT NULL AND jj.next_retry_at <= NOW())
                      OR (jj.status = 'running' AND jj.updated_at < NOW() - p_stale_running))
                 AND (p_owner IS NULL OR m.owner_wallet = p_owner OR (p_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL))
               ORDER BY jj.next_retry_at ASC NULLS LAST LIMIT p_limit FOR UPDATE SKIP LOCKED
            ) claimed
           WHERE j.id = claimed.id
          RETURNING j.id, j.memory_id, j.job_type, j.attempts,
                    (SELECT mm.owner_wallet FROM memories mm WHERE mm.id = j.memory_id);
        END; $claimfn$;

        DO $do$
        BEGIN
          DELETE FROM memory_links a USING memory_links b
           WHERE a.ctid < b.ctid AND a.source_id = b.source_id AND a.target_id = b.target_id AND a.link_type = b.link_type;
          ALTER TABLE memory_links DROP CONSTRAINT IF EXISTS memory_links_unique_edge;
          ALTER TABLE memory_links ADD CONSTRAINT memory_links_unique_edge UNIQUE (source_id, target_id, link_type);
        EXCEPTION WHEN undefined_table THEN NULL; END $do$;

        CREATE OR REPLACE FUNCTION upsert_entity_relation(
          p_src BIGINT, p_tgt BIGINT, p_type TEXT, p_evidence BIGINT DEFAULT NULL, p_strength REAL DEFAULT 0.5
        )
        RETURNS VOID LANGUAGE sql AS $uerfn$
          INSERT INTO entity_relations (source_entity_id, target_entity_id, relation_type, strength, evidence_memory_ids)
          VALUES (p_src, p_tgt, p_type, LEAST(1.0, p_strength),
                  CASE WHEN p_evidence IS NULL THEN '{}'::bigint[] ELSE ARRAY[p_evidence] END)
          ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO UPDATE
            SET strength = LEAST(1.0, entity_relations.strength +
                  CASE WHEN p_evidence IS NULL OR p_evidence = ANY(entity_relations.evidence_memory_ids) THEN 0.0 ELSE 0.1 END),
                evidence_memory_ids = (SELECT ARRAY(SELECT DISTINCT e FROM unnest(entity_relations.evidence_memory_ids || EXCLUDED.evidence_memory_ids) AS e));
        $uerfn$;

        -- Memory 3.0 C1 (migration 046): reconciliation SHADOW decision log. MIRROR — byte-equivalent
        -- to migration 046. Records a PROPOSED reconcile op per write without applying it, so enforce
        -- can be greenlit from a labeled sample. Deliberately NOT added to CORE_TABLES (dormant,
        -- default-off; must not trip SCHEMA DRIFT at boot on an un-migrated prod box — C2 precedent).
        CREATE TABLE IF NOT EXISTS memory_reconciliation_log (
          id               BIGSERIAL PRIMARY KEY,
          memory_id        BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          owner_wallet     TEXT,
          mode             TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','enforce')),
          proposed_op      TEXT NOT NULL CHECK (proposed_op IN ('add','update','noop','needs_router','skip')),
          target_memory_id BIGINT,
          max_cosine       REAL,
          band             TEXT CHECK (band IN ('hi','mid','lo','none')),
          router_used      BOOLEAN NOT NULL DEFAULT false,
          router_model     TEXT,
          fact_key         TEXT,
          reason           TEXT,
          label            TEXT,
          labeled_at       TIMESTAMPTZ,
          gate_version     TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_reconcile_log_owner_created ON memory_reconciliation_log(owner_wallet, created_at);
        CREATE INDEX IF NOT EXISTS idx_reconcile_log_op ON memory_reconciliation_log(proposed_op);
        CREATE INDEX IF NOT EXISTS idx_reconcile_log_router ON memory_reconciliation_log(mode, router_used);

        DO $do$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'memories' AND column_name = 'ts_summary'
          ) THEN
            ALTER TABLE memories ADD COLUMN ts_summary tsvector GENERATED ALWAYS AS (
              setweight(to_tsvector('english', COALESCE(summary, '')), 'A')
            ) STORED;
            CREATE INDEX IF NOT EXISTS idx_memories_ts_summary ON memories USING GIN(ts_summary);
          END IF;
        END $do$;

        -- Temporal-aware semantic search RPC (Exp 9)
        CREATE OR REPLACE FUNCTION match_memories_temporal(
          query_embedding vector(1024),
          match_threshold float DEFAULT 0.3,
          match_count int DEFAULT 20,
          start_date timestamptz DEFAULT NULL,
          end_date timestamptz DEFAULT NULL,
          filter_types text[] DEFAULT NULL,
          filter_user text DEFAULT NULL,
          min_decay float DEFAULT 0.1,
          filter_owner text DEFAULT NULL,
          filter_tags text[] DEFAULT NULL
        )
        RETURNS TABLE (id bigint, similarity float)
        LANGUAGE plpgsql AS $$
        BEGIN
          RETURN QUERY
          SELECT m.id, (1 - (m.embedding <=> query_embedding))::float AS similarity
          FROM memories m
          WHERE m.embedding IS NOT NULL
            AND m.decay_factor >= min_decay
            AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
            AND (filter_user IS NULL OR m.related_user = filter_user)
            AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
            AND (filter_tags IS NULL OR m.tags && filter_tags)
            AND (1 - (m.embedding <=> query_embedding)) > match_threshold
            AND (start_date IS NULL OR COALESCE(m.event_date, m.created_at) >= start_date)
            AND (end_date IS NULL OR COALESCE(m.event_date, m.created_at) <= end_date)
          ORDER BY m.embedding <=> query_embedding
          LIMIT match_count;
        END;
        $$;

        -- Encryption: owner key registry + per-memory wrapped DEKs (encryption §9, Plan 1 sync).
        CREATE TABLE IF NOT EXISTS encryption_keys (
          owner_wallet  TEXT PRIMARY KEY,
          x25519_pubkey TEXT NOT NULL,
          verifier_ct   TEXT NOT NULL,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS memory_dek_wraps (
          memory_id     BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          recipient     TEXT   NOT NULL,
          wrapped_dek   TEXT   NOT NULL,
          wrap_pubkey   TEXT   NOT NULL,
          holder_wallet TEXT,                          -- (034) names the title_holder; NULL for owner/provider
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT memory_dek_wraps_recipient_chk CHECK (recipient IN ('owner', 'provider', 'title_holder')),
          CONSTRAINT memory_dek_wraps_holder_chk CHECK ((recipient = 'title_holder') = (holder_wallet IS NOT NULL))
        );
        -- (036) holder-aware uniqueness: one owner + one provider per memory (NULLS NOT DISTINCT),
        -- and one title_holder per (memory, holder) so a sale's seller + buyer wraps coexist (RT7).
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dek_wraps_identity
          ON memory_dek_wraps (memory_id, recipient, holder_wallet) NULLS NOT DISTINCT;
        CREATE INDEX IF NOT EXISTS idx_dek_wraps_memory ON memory_dek_wraps(memory_id);

        -- Populate content_tokens from a transient plaintext arg (PostgREST can't express to_tsvector inline).
        -- setweight 'B' mirrors the old combined ts_summary weighting (summary 'A' > content 'B').
        CREATE OR REPLACE FUNCTION set_memory_content_tokens(p_memory_id bigint, p_text text)
        RETURNS void LANGUAGE sql AS $fn$
          UPDATE memories
          SET content_tokens = CASE
                WHEN p_text IS NULL OR p_text = '' THEN NULL
                ELSE setweight(to_tsvector('english', p_text), 'B')
              END
          WHERE id = p_memory_id;
        $fn$;

        -- Atomic revoke: clear plaintext + drop the provider wrap in one transaction (encryption §7).
        CREATE OR REPLACE FUNCTION revoke_memory(p_memory_id bigint, p_summary_ct text, p_embedding_ct text)
        RETURNS void LANGUAGE plpgsql AS $rev$
        BEGIN
          UPDATE memories SET
            summary = '',
            summary_ciphertext = p_summary_ct,
            embedding = NULL,
            embedding_ciphertext = NULLIF(p_embedding_ct, ''),
            content_tokens = NULL,
            provider_delegated = false
          WHERE id = p_memory_id;
          DELETE FROM memory_dek_wraps WHERE memory_id = p_memory_id AND recipient = 'provider';
          -- Fragment parity (migration 043): fragments hold plaintext + live embeddings.
          DELETE FROM memory_fragments WHERE memory_id = p_memory_id;
        END;
        $rev$;

        -- Atomic re-delegate (encryption §7) — inverse of revoke_memory. Restores plaintext
        -- summary/embedding, rebuilds content_tokens via the canonical builder, clears ciphertext
        -- cols, sets provider_delegated=true, (re-)inserts the provider wrap.
        CREATE OR REPLACE FUNCTION redelegate_memory(
          p_memory_id   bigint,
          p_summary     text,
          p_embedding   text,
          p_content     text,
          p_wrapped_dek text,
          p_wrap_pubkey text
        )
        RETURNS void LANGUAGE plpgsql AS $redel$
        BEGIN
          UPDATE memories SET
            summary = p_summary,
            summary_ciphertext = NULL,
            embedding = NULLIF(p_embedding, '')::vector,
            embedding_ciphertext = NULL,
            provider_delegated = true
          WHERE id = p_memory_id;
          PERFORM set_memory_content_tokens(p_memory_id, p_content);
          INSERT INTO memory_dek_wraps (memory_id, recipient, wrapped_dek, wrap_pubkey)
          VALUES (p_memory_id, 'provider', p_wrapped_dek, p_wrap_pubkey)
          ON CONFLICT (memory_id, recipient) DO UPDATE
            SET wrapped_dek = EXCLUDED.wrapped_dek, wrap_pubkey = EXCLUDED.wrap_pubkey;
        END;
        $redel$;

        -- BM25-ranked full-text search RPC (Exp 8) — dual-column (ts_summary + content_tokens)
        CREATE OR REPLACE FUNCTION bm25_search_memories(
          search_query text,
          match_count int DEFAULT 20,
          min_decay float DEFAULT 0.1,
          filter_owner text DEFAULT NULL,
          filter_types text[] DEFAULT NULL,
          filter_tags text[] DEFAULT NULL
        )
        RETURNS TABLE (id bigint, rank float)
        LANGUAGE plpgsql AS $$
        DECLARE
          tsquery_val tsquery;
        BEGIN
          tsquery_val := plainto_tsquery('english', search_query);
          IF tsquery_val IS NULL OR tsquery_val = ''::tsquery THEN
            RETURN;
          END IF;
          RETURN QUERY
          SELECT m.id,
            (ts_rank_cd(COALESCE(m.ts_summary, ''::tsvector), tsquery_val, 32)
             + ts_rank_cd(COALESCE(m.content_tokens, ''::tsvector), tsquery_val, 32))::float AS rank
          FROM memories m
          WHERE (m.ts_summary @@ tsquery_val OR m.content_tokens @@ tsquery_val)
            AND m.decay_factor >= min_decay
            AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
            AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
            AND (filter_tags IS NULL OR m.tags && filter_tags)
          ORDER BY rank DESC
          LIMIT match_count;
        END;
        $$;

        -- Chat: conversations and messages for memory-augmented chat
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_wallet TEXT NOT NULL,
          title TEXT,
          model TEXT NOT NULL DEFAULT 'kimi-k2-thinking',
          message_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chat_conv_owner ON chat_conversations(owner_wallet);

        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          model TEXT,
          tokens_prompt INTEGER,
          tokens_completion INTEGER,
          memory_ids INTEGER[],
          frontier_tokens INTEGER,
          memories_used INTEGER,
          tokens_saved INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_chat_msg_saved ON chat_messages(created_at) WHERE tokens_saved IS NOT NULL;
        -- Proof counter totals. "today" is UTC-based (resets 00:00 UTC). Full-table aggregate:
        -- callers MUST use a server-side TTL cache (see proof.routes.ts). Mirror of migration 026.
        CREATE OR REPLACE FUNCTION proof_tokens_saved_totals()
        RETURNS TABLE(
          measured_saved        bigint,
          measured_today        bigint,
          measured_frontier     bigint,
          historical_prompt_sum bigint,
          n                     bigint
        ) LANGUAGE sql STABLE AS $$
          SELECT
            COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
            COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL AND created_at >= date_trunc('day', now())), 0)::bigint,
            COALESCE(SUM(frontier_tokens) FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
            COALESCE(SUM(tokens_prompt)   FILTER (WHERE tokens_saved IS NULL), 0)::bigint,
            COUNT(*)                      FILTER (WHERE tokens_saved IS NOT NULL)::bigint
          FROM chat_messages;
        $$;

        -- Chat billing: balances, top-ups, and per-message usage
        CREATE TABLE IF NOT EXISTS chat_balances (
          wallet_address TEXT PRIMARY KEY,
          balance_usdc NUMERIC(20,8) NOT NULL DEFAULT 0,
          total_deposited NUMERIC(20,8) NOT NULL DEFAULT 0,
          total_spent NUMERIC(20,8) NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chat_topups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_address TEXT NOT NULL,
          amount_usdc NUMERIC(20,8) NOT NULL,
          chain TEXT NOT NULL DEFAULT 'solana',
          tx_hash TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ,
          reference TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_chat_topups_wallet ON chat_topups(wallet_address, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_topups_tx ON chat_topups(tx_hash);
        CREATE INDEX IF NOT EXISTS idx_chat_topups_reference ON chat_topups(reference);

        -- Migration: add reference column if table already existed without it (CLU-173)
        ALTER TABLE chat_topups ADD COLUMN IF NOT EXISTS reference TEXT;
        CREATE INDEX IF NOT EXISTS idx_chat_topups_reference ON chat_topups(reference);

        CREATE TABLE IF NOT EXISTS chat_usage (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_address TEXT NOT NULL,
          conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
          message_id UUID,
          model TEXT NOT NULL,
          tokens_prompt INTEGER,
          tokens_completion INTEGER,
          cost_usdc NUMERIC(20,8) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chat_usage_wallet ON chat_usage(wallet_address, created_at DESC);

        -- Wiki pack installations: which packs (Workspace, Compliance, Sales)
        -- each wallet has installed. Drives the topic rail in /wiki and
        -- the auto-categorisation rules applied to incoming memories.
        CREATE TABLE IF NOT EXISTS wiki_pack_installations (
          id BIGSERIAL PRIMARY KEY,
          owner_wallet TEXT NOT NULL,
          pack_id TEXT NOT NULL,
          installed_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (owner_wallet, pack_id)
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_pack_installations_owner
          ON wiki_pack_installations(owner_wallet);

        -- Migration 019: corrected access-boost RPC (no importance mutation on read).
        -- Re-asserted on every boot so the read->rank->read feedback loop can't return.
        -- importance_boosts is kept for call-site signature compatibility and ignored.
        -- Drop the stale single-arg overload (migration 003) so the two-arg version is
        -- unambiguous and the lockdown below can't be bypassed via an unrevoked overload.
        DROP FUNCTION IF EXISTS batch_boost_memory_access(bigint[]);
        CREATE OR REPLACE FUNCTION batch_boost_memory_access(
          memory_ids BIGINT[],
          importance_boosts DOUBLE PRECISION[] DEFAULT NULL
        ) RETURNS void LANGUAGE plpgsql AS $fn$
        BEGIN
          UPDATE memories
          SET access_count = access_count + 1,
              last_accessed = NOW(),
              decay_factor = LEAST(1.0, decay_factor + 0.1)
          WHERE id = ANY(memory_ids);
        END;
        $fn$;

        -- Migration 020: lock down dangerous SECURITY DEFINER RPCs to service_role only.
        -- exec_sql/boost RPCs must never be callable by anon/authenticated (the publishable
        -- key ships in client apps). Wrapped so a not-yet-created function never aborts boot.
        DO $do$ BEGIN
          REVOKE EXECUTE ON FUNCTION exec_sql(text) FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
        EXCEPTION WHEN undefined_function THEN NULL; END $do$;

        DO $do$ BEGIN
          REVOKE EXECUTE ON FUNCTION batch_boost_memory_access(bigint[], double precision[]) FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION batch_boost_memory_access(bigint[], double precision[]) TO service_role;
        EXCEPTION WHEN undefined_function THEN NULL; END $do$;

        DO $do$ BEGIN
          REVOKE EXECUTE ON FUNCTION boost_memory_importance(bigint, double precision, double precision) FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION boost_memory_importance(bigint, double precision, double precision) TO service_role;
        EXCEPTION WHEN undefined_function THEN NULL; END $do$;

        -- Migration 022 (guard portion): reject empty content on NEW writes in every env.
        -- NOT VALID enforces on new INSERT/UPDATE without scanning existing rows; the
        -- one-time cleanup of legacy blank rows + VALIDATE lives in the manual 022 file.
        DO $do$ BEGIN
          ALTER TABLE memories ADD CONSTRAINT memories_content_nonempty CHECK (length(btrim(content)) > 0) NOT VALID;
        EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
      `
    });

    if (error) {
      log.warn({ error: error.message }, 'Could not auto-create tables via rpc. Create tables via Supabase SQL editor.');
    }
  } catch {
    log.warn('rpc exec_sql not available. Create tables via Supabase SQL editor.');
  }
}

// ---- Schema verification (Memory 3.0 C0 / P0.4: the boot-blob freeze) ---- //

/** Core tables every deployment must have; `memories` doubles as the fresh-DB probe. */
const CORE_TABLES = [
  'memories',
  'memory_fragments',
  'memory_links',
  'agent_keys',
  'dream_logs',
  'rate_limits',
  'chat_conversations',
  'chat_messages',
] as const;

/** Core RPCs whose absence means a stale/partial schema (both live in the blob + migrations). */
const CORE_RPC_PROBES: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'get_linked_memories', args: { seed_ids: [], min_strength: 0.1, max_results: 1, filter_owner: null } },
  { name: 'bm25_search_memories', args: { search_query: '', match_count: 1, min_decay: 0.1, filter_owner: null } },
  // Memory 3.0 C2: probe the outbox claim RPC so a table-without-RPC state (the §6 hazard) is
  // caught at boot as drift rather than silently never draining.
  { name: 'claim_memory_write_jobs', args: { p_limit: 0 } },
];

export interface SchemaReport {
  at: string;
  status: 'ok' | 'fresh-bootstrapped' | 'drift' | 'unknown' | 'replayed';
  missingTables: string[];
  brokenRpcs: string[];
}

let lastSchemaReport: SchemaReport | null = null;

/** Last schema verification result, for /health or dashboard surfacing. */
export function getSchemaDriftReport(): SchemaReport | null {
  return lastSchemaReport;
}

const MISSING_RE = /does not exist|could not find|schema cache/i;

async function verifyCoreSchema(db: SupabaseClient): Promise<{ missingTables: string[]; brokenRpcs: string[]; probeErrors: string[] }> {
  const missingTables: string[] = [];
  const probeErrors: string[] = [];

  for (const table of CORE_TABLES) {
    try {
      const { error } = await db.from(table).select('id', { head: true, count: 'exact' }).limit(1);
      if (error) {
        if (MISSING_RE.test(error.message ?? '')) missingTables.push(table);
        else probeErrors.push(`${table}: ${error.message}`);
      }
    } catch (err) {
      probeErrors.push(`${table}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const brokenRpcs: string[] = [];
  for (const probe of CORE_RPC_PROBES) {
    try {
      const { error } = await db.rpc(probe.name, probe.args);
      if (error && MISSING_RE.test(error.message ?? '')) brokenRpcs.push(probe.name);
    } catch (err) {
      probeErrors.push(`${probe.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { missingTables, brokenRpcs, probeErrors };
}

/**
 * Initialize the database (Memory 3.0 C0 / P0.4 semantics).
 *
 * Modes via INIT_DB_MODE:
 *   'auto' (default) — verify-only drift check. Mutates schema ONLY when the
 *       database is verifiably FRESH (the `memories` table itself is missing),
 *       which preserves the self-hosted SDK zero-config bootstrap. Anything
 *       else missing on an established DB is DRIFT: log.error, never mutate —
 *       apply the corresponding migration by hand.
 *   'verify' — never mutates, even on a fresh DB (drift check only).
 *   'replay' — legacy behavior, unconditional DDL replay (escape hatch).
 *
 * @param dbOverride test injection; production callers pass nothing.
 */
export async function initDatabase(dbOverride?: SupabaseClient): Promise<void> {
  const db = dbOverride ?? getDb();
  const mode = process.env.INIT_DB_MODE ?? 'auto';

  if (mode === 'replay') {
    await runBootDdl(db);
    lastSchemaReport = { at: new Date().toISOString(), status: 'replayed', missingTables: [], brokenRpcs: [] };
    log.info('Database initialized (legacy replay mode)');
    return;
  }

  let { missingTables, brokenRpcs, probeErrors } = await verifyCoreSchema(db);

  // Fresh database: the memories table itself is deterministically absent.
  if (mode === 'auto' && missingTables.includes('memories')) {
    log.info('Fresh database detected (no memories table) — running boot DDL');
    await runBootDdl(db);
    ({ missingTables, brokenRpcs, probeErrors } = await verifyCoreSchema(db));
    const healthy = missingTables.length === 0 && brokenRpcs.length === 0;
    lastSchemaReport = {
      at: new Date().toISOString(),
      status: healthy ? 'fresh-bootstrapped' : 'drift',
      missingTables,
      brokenRpcs,
    };
    if (healthy) log.info('Database bootstrapped from boot DDL');
    else log.error({ missingTables, brokenRpcs }, 'SCHEMA DRIFT after fresh bootstrap — check exec_sql availability');
    return;
  }

  if (probeErrors.length > 0 && missingTables.length === 0 && brokenRpcs.length === 0) {
    // Probes errored for non-schema reasons (network, auth) — health unknown, never mutate.
    lastSchemaReport = { at: new Date().toISOString(), status: 'unknown', missingTables, brokenRpcs };
    log.warn({ probeErrors: probeErrors.slice(0, 3) }, 'Schema verification inconclusive (probe errors); skipping');
    return;
  }

  const healthy = missingTables.length === 0 && brokenRpcs.length === 0;
  lastSchemaReport = { at: new Date().toISOString(), status: healthy ? 'ok' : 'drift', missingTables, brokenRpcs };
  if (healthy) {
    log.info('Database schema verified (boot blob frozen; migrations are the single schema writer)');
  } else {
    log.error(
      { missingTables, brokenRpcs },
      'SCHEMA DRIFT — core objects missing on an established database; apply the corresponding migration by hand (the boot blob no longer auto-repairs)',
    );
  }
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
export async function claimForProcessing(
  tweetId: string,
  extra?: { conversationId?: string; authorId?: string },
): Promise<boolean> {
  const db = getDb();

  // Insert with onConflict=ignore — only succeeds if no row exists
  const { error } = await db
    .from('processed_mentions')
    .insert({
      tweet_id: tweetId,
      feature: 'processing',
      response_tweet_id: null,
      conversation_id: extra?.conversationId || null,
      author_id: extra?.authorId || null,
      processed_at: new Date().toISOString(),
    });
  
  // If error is unique violation (code 23505), another process claimed it
  if (error) {
    // Any error means we didn't get the lock (already exists or DB issue)
    return false;
  }
  
  return true;
}

export async function markProcessed(
  tweetId: string,
  feature: string,
  responseTweetId?: string,
  extra?: { conversationId?: string; authorId?: string },
): Promise<void> {
  const db = getDb();
  await db
    .from('processed_mentions')
    .upsert({
      tweet_id: tweetId,
      feature,
      response_tweet_id: responseTweetId || null,
      conversation_id: extra?.conversationId || null,
      author_id: extra?.authorId || null,
      processed_at: new Date().toISOString(),
    });
}
