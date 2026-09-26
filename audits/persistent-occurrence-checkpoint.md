# Persistent occurrence identity checkpoint — 2026-09-26

**MILESTONE COMPLETE.** Workspace writes and Supabase network access were confirmed in this session. Existing unrelated working-tree changes were preserved. No Auth, personalization, notifications, calendar integration, or new-source work was started.

## Deployed schema

Verified the connected project `pexzwkdkoncthdsmkngz` through its authenticated Supabase SQL Editor and REST API.

- 004: `events_source_url_key` absent; `events_source_external_id_key` remains `UNIQUE (source, external_id)`. Rollback-only inserts successfully shared a source URL.
- 005: both occurrence tables exist; mapping primary key, unique event constraint and foreign keys exist; RLS enabled; anon/authenticated table grants are SELECT only. Assignment function is security-definer with fixed `search_path=public` and advisory locking. Service-only assignment privileges were confirmed before 006.
- **006 applied and verified in this session:** `supabase/migrations/006_atomic_occurrence_reconciliation.sql`. A single SQL statement reads events and mappings from one MVCC snapshot. The new RPC validates that snapshot and commits the entire plan atomically under advisory and table locks. Service role can execute it; anon/authenticated cannot. Direct service-role execution of the old assignment RPC is revoked so old workers fail closed instead of bypassing validation.
- The stale-plan error is `PT409` (HTTP 409), handled by up to three fresh read/plan attempts. The initial `40001` prototype stalled through the REST path; it was replaced and the explicit conflict response was verified live.

## Backfill and identity evidence

| Check | Result |
| --- | --- |
| Raw events before / after | 210 / 210 |
| Initial backfill | 210 assignments, 209 new occurrences |
| Final occurrences / mappings | 209 / 210 |
| Unmapped / invalid / duplicate mappings | 0 / 0 / 0 |
| Orphan occurrences | 0 |
| Second pass after initial backfill | 0 assignments, 0 creations, unchanged snapshots |
| Additional two-pass verification | Both passes made 0 assignments; all 210 established mappings and raw IDs unchanged |
| Publishable-key career / all results | 21 / 30 (all is capped at 30) |

Final sorted mapping SHA-256:
`1c0bcb461cc85bd5071aae891f1b93d98e6e3b2aabe7707542c4dae06156e411`

Evidence: `audits/persistent-occurrence-verification.log`. Its first run completed the backfill and idempotence checks, then exposed a homepage embedding bug; the subsequent run passed all checks after the fix. Read-only verification after the rollback-only SQL tests confirmed the same counts and digest.

## Concurrency and transactional verification

The former read/plan/per-group-write race is resolved by validating the complete snapshot **inside the same transaction that applies the entire plan**. Events cannot be inserted, updated, or deleted between validation and commit; occurrence/mapping writes serialize with that commit. A collector write or competing reconciliation that changed the snapshot before the locks were obtained causes rejection and replanning. Counters describe only the committed plan. Interrupted or invalid plans roll back all assignments. Already established identities are never reassigned by the planner or new RPC.

`supabase/verify-occurrence-transactions.sql` passed in the deployed SQL Editor, inside an explicitly rolled-back transaction. It verified actual changed-event and changed-mapping snapshot rejection, complete rollback including newly created occurrences after a later assignment failed, repeated assignment returning the same UUID, shared source URLs, and identity preservation during enrichment/rescheduling. No fixture rows were committed or publicly visible. These were deterministic competing-snapshot checks, not parallel production collector runs.

`scripts/verify-occurrence-rpc.ts` passed through the API: anonymous read/write RPC execution denied, legacy service-role assignment denied, stale snapshot rejected with HTTP 409, established-identity reassignment rejected, and unchanged data after rejected operations. Before backfill, the same checker also verified rollback of an earlier valid assignment when a later assignment failed. Evidence: `audits/persistent-occurrence-rpc-verification.log` (final post-backfill run).

## Homepage verification

Fixed the live PostgREST embed shape: the unique `event_id` relationship returns an object or null, rather than always an array. Browsing now accepts the deployed shape, skips pending null mappings, and retains corruption checks. Regression tests cover object, null, invalid identity, and multiple mappings.

Production server: `npm run start -- --hostname 127.0.0.1 --port 3100`, connected to the deployed Supabase database with the publishable key. `/` returned HTTP 200 with 21 event cards; `/?view=all` returned HTTP 200 with 30. Neither HTML response contained the database-error state. Chrome guest browser rendering was inspected in both views. This verifies the local production build against the live database; no separately hosted deployment URL is configured in this repository.

## Independent continuation verification (same day)

A later session independently inspected the working tree, migrations 004–006, `lib/get-events.ts` embed handling, and the existing checkpoint **without recreating schema or re-running backfill**. Codex’s occurrence files were left in place.

Read-only `npm run verify:occurrences` against the live project reproduced:

- 210 raw events, 209 occurrences, 210 mappings
- 0 unmapped / invalid / duplicate mappings, 0 orphan occurrences
- identity digest `1c0bcb461cc85bd5071aae891f1b93d98e6e3b2aabe7707542c4dae06156e411`
- publishable-key queries: career 21, all 30

`scripts/verify-occurrence-rpc.ts` was re-run after backfill and still passed: anonymous RPC denied, legacy `assign_event_occurrence` denied (403), stale plan 409, established-identity reassignment rejected, snapshot unchanged.

Rendered homepage on the already-running webpack production server `http://127.0.0.1:3100`:

- `GET /` and `GET /?view=career`: HTTP 200, **21** `<article>` cards, no generic database-error alert. First cards include Fireside chat with Dan Caruso and Information Session: L3HARRIS. Browser snapshot confirmed Career & Industry view, occurrence grouping (`Original source 1` / `2` on Founders Week), and truncated descriptions with “Read description”.
- `GET /?view=all`: HTTP 200, **30** `<article>` cards, no error alert. First card is `HYBRID: CS CARES Office Hour: Steve Herzog` (non-career rows appear only in all). Browser snapshot confirmed All Events selected.

Two-pass `--reconcile` was **not** repeated so as not to duplicate the already-proven idempotent write path.

Re-run validation in this continuation: `npm test` 6 files / 194 tests PASS; `npm run lint` PASS; `npx tsc --noEmit` PASS; `npm run build` (`next build --webpack`) PASS; `git diff --check` PASS. Turbopack was not retried; the webpack production path remains the documented default.

## Validation

- `npm test`: PASS, 6 files / **194 tests**.
- `npm run lint`: PASS.
- `npx tsc --noEmit`: PASS.
- `npm run build`: PASS using the explicitly adopted `next build --webpack` script. Compilation, TypeScript, static generation and build traces succeed; `/` is dynamic.
- Turbopack was retried and still fails because its CSS worker cannot bind a port (`Operation not permitted`). The documented webpack production workflow is now the default build command; successful server rendering was verified from that build.
- `git diff --check`: PASS.

Repeat the read-only audit with `npm run verify:occurrences`; use `npm run verify:occurrences -- --reconcile` for two atomic reconciliation passes. For deterministic final coverage snapshots, run the audit when collection is idle. Ordinary reconciliation itself does not depend on a single-worker convention.

## Explicitly retained limitations

- Representative ranking can change the displayed raw representative while preserving the occurrence UUID. Unit and database checks cover identity stability.
- Raw collection and reconciliation remain separate commits. Newly collected rows can temporarily be pending and are skipped by browsing until reconciliation succeeds. Calling `collectWebtools` directly does not reconcile; the collector CLI does.
- Concurrent collectors can still overwrite raw enrichment fields because their read/merge/upsert is not one transaction. The reconciliation snapshot check now detects intervening raw writes; it does not change collector field-precedence policy.
- Existing identities are never automatically merged or split, including ambiguous matches or inconsistent reschedules. Administrative correction policy remains deferred.
- Cancellation/feed removal is not modeled; the collector does not delete missing rows. Physical deletion cascades mappings and reimport can lose the prior association.
- Snapshot transfer and comparison cover the complete current dataset. This is appropriate for the verified 210 rows; future scale may warrant a version token or server-side planning.

**Remaining checkpoint blockers: none.**
