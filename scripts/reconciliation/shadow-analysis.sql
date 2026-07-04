-- Memory 3.0 C1 — SHADOW reconciliation calibration queries.
--
-- Run these against the production DB (Supabase SQL editor / psql) AFTER MEMORY_RECONCILE has been
-- collecting shadow rows for a while. They turn memory_reconciliation_log into the numbers that
-- (a) set the LO threshold, (b) size the router budget, and (c) decide whether ENFORCE may ship.
--
-- The GREENLIGHT for enforce (the design's kill-ladder): on a labeled sample of >= 200 proposed
-- supersessions within ONE gate regime, the false-positive-supersession rate (query F) must be
-- < 2%. Until then, enforce stays unbuilt/off.
--
-- Every query auto-scopes to the LATEST gate_version (one threshold/code regime — mixing regimes
-- corrupts the math). Edit the `regime` CTE if you want a specific one. `mode = 'shadow'` throughout.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A. COVERAGE — how many writes were evaluated vs skipped, and why. Low coverage (lots of
--    no_embedding) means the sample under-represents reality; investigate before trusting B–F.
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  l.proposed_op,
  l.reason,
  count(*) AS n,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow'
GROUP BY l.proposed_op, l.reason
ORDER BY n DESC;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- B. TRIGGER RATE — of evaluated writes (not skipped), what fraction had a similar prior fact
--    (needs_router / update / noop) vs were novel (add). This is "how often reconciliation fires."
--    Too high (~everything) => LO is too low (see C); too low => little to reconcile.
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  count(*) FILTER (WHERE l.proposed_op IN ('needs_router','update','noop')) AS with_similar_prior,
  count(*) FILTER (WHERE l.proposed_op <> 'skip')                            AS evaluated,
  round(100.0 * count(*) FILTER (WHERE l.proposed_op IN ('needs_router','update','noop'))
        / NULLIF(count(*) FILTER (WHERE l.proposed_op <> 'skip'), 0), 2)     AS trigger_rate_pct
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- C. MAX_COSINE HISTOGRAM — the distribution used to SET LO. Look for the knee: the cosine above
--    which candidates are genuinely the-same-fact vs merely same-topic. 10 buckets over [floor,1].
--    (Recall the landmine: same-topic different-fact pairs sit high, so the knee is not at 0.5.)
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  width_bucket(l.max_cosine, 0.5, 1.0, 10) AS bucket,
  round(0.5 + (width_bucket(l.max_cosine, 0.5, 1.0, 10) - 1) * 0.05, 2) AS bucket_lo,
  count(*) AS n
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow' AND l.max_cosine IS NOT NULL
GROUP BY bucket ORDER BY bucket;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- D. ROUTER OP DISTRIBUTION — once the router is on, how it classifies the >= LO band, by band.
--    A healthy split has most hi-band as noop/update and mid-band mixed. router_used = true only.
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT l.band, l.proposed_op, count(*) AS n
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow' AND l.router_used = true
GROUP BY l.band, l.proposed_op ORDER BY l.band, n DESC;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- E. PER-OWNER ROUTER VOLUME — to size the daily budget. p95/max calls/owner/day. If many owners
--    hit the cap, the sample is front-loaded (bias) or the budget is too small.
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  round(avg(daily), 1) AS avg_calls_per_owner_day,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY daily) AS p95_calls_per_owner_day,
  max(daily) AS max_calls_per_owner_day
FROM (
  SELECT coalesce(l.owner_wallet, '__BOT_OWN__') AS owner, date_trunc('day', l.created_at) AS d,
         count(*) AS daily
  FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
  WHERE l.mode = 'shadow' AND l.router_used = true
  GROUP BY 1, 2
) per_owner_day;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- F. *** THE GREENLIGHT METRIC *** — false-positive-supersession rate over the LABELED sample.
--    A false positive = the router proposed update/noop (would drop/merge the new fact) but the
--    human label says the new fact was actually 'distinct'. Enforce may ship only when this is
--    < 2% AND proposed_supersessions >= 200 (enough signal). See scripts/reconciliation/README
--    for the labeling protocol (labeler must read full CONTENT, not just the summary the router saw).
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  count(*) FILTER (WHERE l.label = 'distinct')                     AS false_positive_supersessions,
  count(*)                                                         AS labeled_proposed_supersessions,
  round(100.0 * count(*) FILTER (WHERE l.label = 'distinct')
        / NULLIF(count(*), 0), 2)                                  AS fp_rate_pct,
  (count(*) >= 200 AND
   100.0 * count(*) FILTER (WHERE l.label = 'distinct') / NULLIF(count(*), 0) < 2.0)
                                                                   AS enforce_greenlit
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow' AND l.router_used = true
  AND l.proposed_op IN ('update','noop') AND l.label IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- G. LABELING PROGRESS — how much of the proposed-supersession sample is labeled yet. Drives "keep
--    labeling" vs "enough to decide". Pull the unlabeled rows to hand to a labeler with query G2.
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  count(*) FILTER (WHERE l.label IS NOT NULL) AS labeled,
  count(*)                                    AS total_proposed_supersessions,
  round(100.0 * count(*) FILTER (WHERE l.label IS NOT NULL) / NULLIF(count(*), 0), 1) AS labeled_pct
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
WHERE l.mode = 'shadow' AND l.router_used = true AND l.proposed_op IN ('update','noop');

-- G2. Unlabeled rows to label (join to memories for the human to read full content of both sides).
--     Label each by UPDATE memory_reconciliation_log SET label = '<duplicate|update|distinct>',
--     labeled_at = now() WHERE id = <row id>.  'distinct' = the router was WRONG (false positive).
WITH regime AS (
  SELECT gate_version FROM memory_reconciliation_log
  WHERE mode = 'shadow' GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 1
)
SELECT
  l.id AS log_id, l.proposed_op, l.max_cosine,
  nm.summary AS new_summary, nm.content AS new_content,
  cm.summary AS candidate_summary, cm.content AS candidate_content
FROM memory_reconciliation_log l JOIN regime r USING (gate_version)
LEFT JOIN memories nm ON nm.id = l.memory_id
LEFT JOIN memories cm ON cm.id = l.target_memory_id
WHERE l.mode = 'shadow' AND l.router_used = true
  AND l.proposed_op IN ('update','noop') AND l.label IS NULL
ORDER BY l.created_at
LIMIT 50;
