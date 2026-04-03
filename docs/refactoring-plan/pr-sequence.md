# PR Sequence & Dependencies

All PRs target `staging`. Board approves before merge to `main`.

## Dependency Graph

```
Phase 0 (Foundation)
  0.1 Privy wallet resolver
  0.2 requireOwnership middleware
        |
        v
Phase 1 (Auth) -- starts after Phase 0
  1.1-1.8 endpoint protections (parallelizable)
  1.9 integration tests
        
Phase 2 (Performance) -- starts immediately
  Quick wins: 2.1, 2.3, 2.4, 2.9, 2.10 (no dependencies)
  2.8 Index migrations (no dependency, schedule low-traffic)
  2.2 Batch entity recall (depends on 2.8)
  2.5 LOTR pagination (needs frontend coordination)
  2.6 Job queue (independent, large scope)
  2.7 Dream parallelization (independent)

Phase 3 (Architecture) -- starts immediately
  3.2 Multi-tenant fix (URGENT, no dependency)
  3.4 Confabulation test (no dependency)
  3.1 Dream observability (no dependency)
  3.3 Configurable scoring (after 3.4)
```

## Recommended PR Order

| PR | Branch | Contents | Size | Depends On |
|----|--------|----------|------|------------|
| 1 | `perf/quick-wins` | 2.1, 2.3, 2.4, 2.9, 2.10 | S | -- |
| 2 | `fix/dream-tenant-isolation` | 3.2 (per-owner accumulator) | S | -- |
| 3 | `feat/privy-wallet-resolver` | 0.1, 0.2 | M | -- |
| 4 | `feat/auth-hardening` | 1.1-1.8 (all endpoint protections) | M | PR 3 |
| 5 | `test/auth-ownership` | 1.9 (integration tests) | S | PR 4 |
| 6 | `perf/db-indexes` | 2.8 (migration script) | S | -- |
| 7 | `perf/batch-entity-recall` | 2.2 | M | PR 6 |
| 8 | `feat/dream-observability` | 3.1 | M | -- |
| 9 | `perf/dream-parallelization` | 2.7 | M | -- |
| 10 | `feat/job-queue` | 2.6 | L | -- |
| 11 | `perf/pagination` | 2.5 (+ frontend PR) | M | -- |
| 12 | `test/confab-penalty` | 3.4 | S | -- |
| 13 | `feat/configurable-scoring` | 3.3 | M | PR 12 |

## Parallel Tracks

PRs 1, 2, 3, 6, 8, 12 can all be developed **simultaneously** as they have no interdependencies.

After those land:
- Track A: PR 4 -> PR 5 (auth)
- Track B: PR 7 (entity recall, after indexes)
- Track C: PR 9, PR 10 (dream + job queue)
- Track D: PR 13 (scoring, after confab test)

PR 11 (pagination) requires frontend coordination and can be scheduled independently.

## Testing Strategy Per Workstream

### Auth (Phase 0-1)
- **Unit**: Mock Privy JWKS, test middleware with various token states
- **Integration**: supertest with full Express app, mock Privy server SDK
- **Manual QA**: Test each endpoint in staging with chat + dashboard frontends
- **Regression**: Verify LOTR campaign routes remain public

### Performance (Phase 2)
- **Unit**: LRU cache, BM25 dedup, job queue
- **Benchmark**: Recall pipeline before/after SELECT * fix (response time + payload size)
- **Load test**: k6 on greeting endpoint, verify count caching
- **Database**: `EXPLAIN ANALYZE` on key queries before/after index creation

### Architecture (Phase 3)
- **Unit**: `scoreMemory` with internal-source memories at various similarity levels
- **Integration**: `dreamForAgent` for two wallets concurrently, verify no cross-contamination
- **Manual QA**: Trigger dream cycle in staging, verify logs + metrics in dream_logs

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Frontend breaks on auth enforcement | High | Feature flag; use optionalPrivyAuth + logging first |
| Privy API latency on every request | Medium | Cache with 5-min TTL; 3s timeout + graceful fallback |
| DB indexes slow writes | Low | Use CONCURRENTLY; monitor after deploy |
| Dream parallelization write conflicts | Medium | Test concurrent compaction + consolidation |
| Job queue memory leak | Medium | Max size 1000; drop low-priority when full |
| Per-owner accumulator Map unbounded | Low | TTL cleanup every 24h; limit 10K entries |
