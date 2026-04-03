# Major Refactoring Plan

**Created**: 2026-04-03  
**Status**: Planning  
**Branch workflow**: All PRs target `staging` -> board approval -> merge to `main`

## Overview

Three workstreams covering authentication hardening, memory system performance, and architecture improvements.

- [Phase 0: Foundation](./phase-0-foundation.md) - Privy wallet resolver + ownership middleware
- [Phase 1: Auth Hardening](./phase-1-auth-hardening.md) - Protect all unprotected endpoints
- [Phase 2: Memory Performance](./phase-2-memory-performance.md) - SQL fixes, caching, job queue
- [Phase 3: Memory Architecture](./phase-3-memory-architecture.md) - Observability, multi-tenant, scoring
- [PR Sequence & Dependencies](./pr-sequence.md) - Recommended order of execution
