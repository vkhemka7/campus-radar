# CampusRadar engineering log

A chronological record of major engineering decisions. It is not a commit changelog.

Dates come from git history (`2026-09-19` through `2026-09-28`).

## How to keep this log

For every substantial milestone:

- Update `README.md` only when current product behavior, architecture, setup, or status changes.
- Append or update this log with Problem / Decision / Why / Implementation / Validation.
- Document the engineering system, not AI-agent interactions or the session or tool that produced the change.
- Leave historical entries intact unless a factual inaccuracy needs a correction.

---

## Next.js bootstrap and product specification

**When:** 2026-09-19 (`fb3b6f3`, `c62c01d`)

**Problem**
The repository started as a Create Next App tree with the default Next.js README.

**Decision**
Keep the Next.js App Router app and add `PROJECT.md` as a written product specification for a UIUC career-event discovery system.

**Why**
Git shows the specification landing immediately after the scaffold, before application features.

**Implementation**
`PROJECT.md` describes collection, relevance, student profiles, email alerts, and calendar export. Those last two are specification text only. The running app does not implement notification email or Google Calendar.

**Validation / Result**
A documented product target exists in-tree. Later work implemented a subset of that target (browse, collect, classify, identity, auth, interests, For You).

---

## Initial event listing

**When:** 2026-09-19 (`edc14a9`)

**Problem**
There was no CampusRadar UI—only the create-next-app starter page.

**Decision**
Replace the starter with a campus event listing and a shared `CampusEvent` type.

**Why**
The first product surface is a list of events, not a collector.

**Implementation**
`app/page.tsx` and `lib/events.ts` defined title, times, timezone, location, company, category, description, and source links. Times are ISO-8601 strings formatted with an IANA timezone.

**Validation / Result**
The homepage became an event browser. Data at this step was still local to the app.

---

## Supabase event storage

**When:** 2026-09-19 (`c8d350a`)

**Problem**
Events lived in application code and could not be collected independently of deploys.

**Decision**
Store events in Postgres (Supabase). The website reads with a publishable key; RLS allows `SELECT` only for `anon` and `authenticated`.

**Why**
Database-backed reads let collected event data change independently of application deploys, while SELECT-only access keeps public browsing from modifying events.

**Implementation**
`public.events` (`001_create_events.sql`), `lib/supabase.ts`, and `lib/get-events.ts`. `.env.example` documents `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The original schema unique-constrained `source_url`.

**Validation / Result**
The homepage loads rows from the database. Seed SQL exists for local/demo rows.

---

## Illinois Webtools ICS collection

**When:** 2026-09-22 (`e5f26af`)

**Problem**
The listing had no live campus feed. UIUC publishes calendars through Illinois Webtools.

**Decision**
Collect Siebel Master (calendar 2654) from its Outlook ICS URL, normalize into `events`, and browse upcoming/ongoing rows.

**Why**
ICS is a complete VCALENDAR the collector can parse without a browser. Identity is the feed UID, stored as `external_id`, unique with `source` (`002_add_event_external_id.sql`). The collector uses `SUPABASE_SECRET_KEY` (`003_grant_events_to_service_role.sql`).

**Implementation**
`parse-ics`, Chicago-aware time conversion, `normalizeIllinoisWebtoolsEvent` (empty `company` and `registration_url` on the ICS path), and a CLI collector. Homepage filters upcoming events. Vitest is added.

**Validation / Result**
ICS fixtures and parser tests. `npm run collect:siebel` remains the single-calendar entry (later pointed at the multi-calendar script).

---

## Explainable career and industry filtering

**When:** 2026-09-22 (`67ffdb1`)

**Problem**
The collected calendar includes office hours, seminars, and other non-career listings. A raw feed is noisy for the product.

**Decision**
Classify each event with small, explicit phrase rules: `relevant`, `not_relevant`, or `uncertain`. Career & Industry shows `relevant` only. All Events remains available. The UI prints the rule explanations.

**Why**
`lib/event-relevance.ts` comments that broad words like “interview” or “workshop” alone are not enough, and that there is no employer-name dictionary or numeric score.

**Implementation**
Title rules first (career fairs, recruiting sessions, interview/resume prep). Routine office hours / departmental meetings in the title are `not_relevant`. Category and description can still mark `relevant`; otherwise `uncertain`.

**Validation / Result**
`lib/event-relevance.test.ts` and get-events tests for the career vs all views.

---

## Contextual career relevance rules

**When:** 2026-09-26 (`514bfc9`; audit timestamp 2026-09-23)

**Problem**
The first rule set missed career-adjacent events whose titles were not classic “career fair” phrasing (startup programs, technical communities, employer encounters).

**Decision**
Add tighter contextual rules on title/description sentences: opportunities, employer encounters, startup programs, technical community events, recruiter networking, career receptions. Speaker biographies are not evidence. Incidental or cancelled prose is ignored.

**Why**
The in-repo audit shows 17 stored Illinois Webtools rows moving uncertain → relevant and zero other transitions.

**Implementation**
Additional patterns in `lib/event-relevance.ts`. Descriptions usually also need an invitation/action word in the same sentence.

**Validation / Result**
`audits/milestone-3d3-relevance.md` / `.json`: 207 unique IDs, relevant 16 → 33, uncertain 98 → 81, not_relevant unchanged at 93. Classifier tests expanded. No writes during the audit.

---

## Multi-calendar collection and stable occurrence identity

**When:** 2026-09-26 (`6f36dfb`)

**Problem**
The same happening can appear on more than one Illinois calendar. A unique `source_url` blocked two raw rows from sharing a detail page. Students would otherwise see duplicates, and later user state would have no stable object to attach to.

**Decision**
Collect five ICS calendars (2654, 1551, 5115, 6499, 6805). Drop the unique `source_url` constraint. Keep raw rows on `(source, external_id)`. Introduce `event_occurrences`, with each raw event mapped to exactly one occurrence and multiple raw events allowed per occurrence. Reconcile after collection.

**Why**
Migration comments and `event-occurrences.ts` state that raw provenance stays, each source row maps to exactly one occurrence, and ambiguous matches must not merge established identities.

**Implementation**
`collectWebtools` fetches calendars in configured order, merges overlapping UIDs by filling blank fields, and upserts. The collector CLI then calls `reconcileEventOccurrences`. Duplicate evidence is same start plus a canonical URL, or same non-generic title, end, and compatible location (complete-link groups). Planner + RPCs apply a full snapshot atomically (`PT409` on stale snapshots, up to three total attempts). The homepage embeds mappings and skips unmapped rows.

**Validation / Result**
`audits/persistent-occurrence-checkpoint.md`: 210 raw events, 209 occurrences, 210 mappings, 0 unmapped/invalid/duplicate mappings. Transaction and RPC verification scripts passed. Career/all browse still capped at 30.

---

## User identity foundation

**When:** 2026-09-26 (`75a1931`)

**Problem**
Occurrence identity existed, but there was no student account or place to hang preferences. Public event reads must stay on the stateless publishable client.

**Decision**
Add Supabase Auth-backed `profiles`, a career-interest catalog, `profile_career_interests`, and `user_occurrence_states` pointing at `event_occurrences.id`. Service role gets no privileges on those user tables.

**Why**
`007_add_user_identity.sql` states occurrence identity is unchanged and that a missing state row means unset.

**Implementation**
Profile created on new `auth.users`. Cookie-aware session helper and Next.js `proxy.ts` that refreshes Auth only when a session cookie is present.

**Validation / Result**
RLS verification SQL, migration tests, session and proxy tests. No homepage personalization yet.

---

## Authentication UX and email confirmation

**When:** 2026-09-28 (`ca0f467`)

**Problem**
The identity tables existed without signup, login, or a safe confirmation flow.

**Decision**
Email/password signup and login. Confirmation links land on `/auth/confirm` and are spent only when the visitor confirms. Public browsing stays available without Auth.

**Why**
`proxy.ts` forwards confirmation URLs before session refresh so the token is not consumed by middleware.

**Implementation**
`/signup`, `/login`, `/account`, `/auth/confirm`, credential validation, and mapped provider error messages.

**Validation / Result**
`lib/auth.test.ts` and proxy tests for confirmation redirects and credential limits.

---

## Career interest preferences

**When:** 2026-09-28 (`cc67dcf`)

**Problem**
Signed-in users had no way to record which career areas they care about.

**Decision**
A catalog-only multi-select on `/account/interests`. Unknown slugs are rejected. An empty submission clears all saved interests.

**Why**
`profile_career_interests` has no UPDATE grant, so the app inserts missing rows and deletes extras. Apply adds first so a failed delete leaves a recoverable superset.

**Implementation**
Server Actions plus `lib/career-interests.ts` planning helpers. Catalog slugs match the seed in migration 007.

**Validation / Result**
`lib/career-interests.test.ts`. Interests are stored; they do not yet change the homepage ranking.

---

## User event occurrence states

**When:** 2026-09-28 (`57b87e8`)

**Problem**
Students needed a durable plan for a happening, not a raw `events.id` that collection might treat as a second row.

**Decision**
One mutually exclusive status per user and occurrence: Interested, Going, or Not Interested. Pressing the active control clears it. Controls render only when states load for a signed-in user.

**Why**
`occurrence-states.ts` documents that `occurrence_id` must be `event_occurrences.id`; a well-formed raw event UUID is rejected by the foreign key.

**Implementation**
Homepage controls and a Server Action writing `user_occurrence_states`.

**Validation / Result**
`lib/occurrence-states.test.ts`. Career and All lists show saved marks; For You does not exist yet.

---

## Deterministic For You ranking

**When:** 2026-09-28 (`27285e8`)

**Problem**
Career & Industry is a global filter. It does not use the student’s saved interests or hide events they already declined.

**Decision**
A signed-in For You view that ranks upcoming occurrences with phrase matches against the saved catalog. No ML model.

**Why**
`rankForYou` states that Interested and Going are not inputs, Not Interested ids are dropped, `not_relevant` is dropped, and a generic career backfill explains itself as a career opportunity rather than a false interest match.

**Implementation**
Title phrases per slug; stronger phrases on description/category/company only after the career classifier is `relevant`. Score: per matched interest, +5 for a title match or +2 for a strong match; then +1 if relevant. Sort by score, then start time, then occurrence id. Cap 30. Empty interests show a prompt instead of a ranked list.

**Validation / Result**
`lib/for-you.test.ts`. Homepage view `for-you` is hidden unless the visitor is signed in.

---

## Webtools HTML ingestion preparation, validation, and production cutover

**When:** 2026-09-28 (preparation: `f2ee7e8`; Phase 3 production cutover follows documentation checkpoint `dbe6853`)

**Problem**
Production collection depended on Outlook ICS URLs. An HTML list/detail path was needed to replace those feeds without inventing new `external_id` values or writing unverified rows.

**Decision**
Prepare public HTML parsers and a no-write dry run against the five existing calendars, initially retaining ICS as the writer. After validating the dry-run gate, switch production collection to that HTML pipeline. Do not add AE Corporate Relations or Entrepreneurship sources (calendars 7541 and 6327).

**Why**
HTML identity helpers map a numeric event id to the existing `{eventId}@illinois.edu` form so a later upsert would update the same row. Recurrence-qualified `::` ids are left unchanged. The fetch helper refuses `/ical`, `/icalOutlook`, `/export`, `/outlook`, `/eventXML`, and `/userRole`.

**Implementation**
- List and detail HTML parsers, Chicago schedule normalization, `normalizeHtmlWebtoolsEvent` (company still empty; registration only from absolute http(s) URLs).
- Discovery over today–180 days in America/Chicago, in ≤30-day slices, one request at a time, with retries on 429/502/503.
- A slice that returns exactly 100 list rows is split; a single day that still returns 100 rows fails closed (the first full-horizon Siebel list returned 100 events and silently omitted later ones; a later window proved more events existed).
- Detail clocks without AM/PM borrow meridiem only from a same-day list time whose hour and minute agree. Trailing `Central Time` / `CT` / `CST` / `CDT` is accepted and converted with `America/Chicago`, not a fixed offset.
- `scripts/dry-run-webtools-html.ts` reads events with the publishable client only and writes `audits/webtools-html-dry-run.json`.

**Validation / Result**
Fixtures and tests for parsers, windows, fetch allowlisting, comparison, and the dry-run script’s inability to upsert. Final dry run against the five calendars:

| Measure | Result |
| --- | --- |
| Discovered ids | 184 |
| Normalized | 183 |
| Matched | 175 |
| HTML-only | 8 |
| Identity conflicts | 0 |
| Stored-only in window | 5 |
| Hour-wide timezone shifts | 0 |
| Gate | `READY_FOR_CUTOVER` |

The preparation dry run left HireIllini `33553793` unresolved (`Oct 7, 2026 11:00` on both list and detail, so meridiem is not inferred). ICS remained the production writer at that preparation checkpoint.

**Production cutover implementation**

- `collectWebtools` now uses the same bounded HTML discovery, allowlisted fetcher, parsers, and normalization. The configured source set is unchanged; ICS URLs were removed from active configuration. ICS parser code, fixtures, and parser tests remain.
- Read every stored Webtools row with exact-count pagination before writing, so conflicting source-URL identities under other external IDs are detected. Reuse the dry-run identity/time/metadata gate. Any failed calendar list or blocked gate prevents all upserts; isolated detail failures skip only those events and make the command exit nonzero.
- Production disables only the stored-coverage gate because absence is not deletion evidence and single-calendar runs intentionally discover a subset. The read-only dry run retains its original coverage check. No path deletes stored-only events.
- Keep `(source, external_id)`, raw IDs, discovery timestamps, and stored source URLs. Fill blank HTML fields from stored enrichment; accept HTML registration URLs without inferring company from Sponsor.
- The CLI reports collection counts before reconciling successful upserts, including valid events from a partial detail run. Reconciliation algorithms, schema, and user-state semantics are unchanged.

**Production verification / Result**

One `npm run collect:webtools` run on 2026-09-28 used the existing server-only configuration after tests, TypeScript, lint, and the webpack build passed. A read-only baseline and post-run audit compared raw identity fields, mappings, and registration URLs; a SELECT-only SQL audit compared user-state counts, references, and a digest of complete state rows.

| Measure | Production cutover result |
| --- | --- |
| Calendars attempted / list discovery succeeded / failed | 5 / 5 / 0 |
| List requests / unique detail attempts | 35 / 181 |
| Discovered / normalized / upserted / skipped | 181 / 180 / 180 / 1 |
| Identity conflicts | 0 |
| Hour-wide start / end shifts | 0 / 0 |
| Raw events before → after | 210 → 218 (Webtools: 207 → 215) |
| Occurrences before → after | 209 → 217 |
| Mappings before → after | 210 → 218 |
| Reconciliation | 8 assigned, 8 new occurrences, 0 joins to existing occurrences |
| Unmapped / invalid / duplicate mappings / orphan occurrences | 0 / 0 / 0 / 0 |
| Lost raw rows / changed existing identity fields / changed established mappings | 0 / 0 / 0 |
| Previously HTML-only events | All 8 inserted and mapped |
| Registration enrichment | 30 existing rows gained URLs; 4 new rows have URLs; 0 stored URLs lost |
| Existing company changes | 0 |
| User occurrence states | 4 → 4; identical full-row digest; 0 invalid occurrence or profile references |

The command exited 1 to report the one skipped schedule: `33553793` still lacked unambiguous meridiem and its stored row was unchanged. The pre-upsert gate returned `READY_FOR_CUTOVER` with no blockers. All 180 validated candidates were upserted (172 existing rows and 8 new rows), and reconciliation completed.

The live list contained three fewer IDs than the earlier dry run: `33563355`, `33563719`, and `33563356` were no longer discovered. All three stored rows were retained, as were the previously stored-only events. The two schedule changes matched the prior dry-run findings: `33561105` moved from October 12 to January 20, and `33541184` shifted 15 minutes earlier. There was no additional schedule drift or unexpected row-count growth.

Collector integration tests now cover HTML-only requests, the unchanged source set, identity conflicts (including other stored external IDs sharing a source URL), source-URL preservation, registration enrichment, Sponsor exclusion, sparse-field preservation, failed details and missing meridiem, incomplete lists, 100-row fail-closed behavior, systemic hour shifts, exact-count pagination, no deletion, and CLI reconciliation after successful upserts. Existing ICS parser and HTML parser/discovery/dry-run tests remain. Validation: 293 tests across 23 files, `npx tsc --noEmit`, `npm run lint`, and `npm run build` (`next build --webpack`) passed.

Result: the five production calendars now collect through HTML list/detail pages, with stable event and occurrence identities preserved. Phase 3 is ready for commit review. No source expansion, schema changes, or Phase 4 work is included.

---

## Phase 4 Webtools source expansion

**When:** 2026-09-28 (4A read-only audit; 4B configuration; 4C live seven-source collection)

**Problem**
Two additional Illinois Webtools calendars were candidates for production: AE Corporate Relations (7541) and Illinois Entrepreneurship Master (6327). They could not be added until HTML discovery, identity, and overlap with the existing five calendars were validated without writing.

**Decision**
Reuse the existing HTML list/detail collector and `{eventId}@illinois.edu` identity. Do not invent calendar-specific IDs. Do not retune the relevance classifier in the same change as source expansion.

**Phase 4A (read-only)**
Live HTML discovery for 7541 and 6327 over the same America/Chicago 180-day window as production: 3/3 and 42/42 normalized, 0 failures, 0 identity conflicts. Combined 45 unique IDs: 13 already stored (all overlap Research Park 5115), 32 genuinely new. Parser handled both sources; empty detail dates recovered from list days. Classifier observations only (not changed): `{Company} Information Session` titles on 7541 can stay `uncertain`; several entrepreneurship application/social events stay `uncertain`; Landuyt office hours are already `not_relevant`.

**Phase 4B (configuration)**
`WEBTOOLS_CALENDARS` has exactly seven entries, in order: 2654, 1551, 5115, 6499, 6805, 7541, 6327. Both new calendars use the same HTML discover → detail → normalize → validate → upsert → reconcile path. Overlapping 6327/5115 IDs keep one `(source, external_id)` row.

**Phase 4C (live seven-source verification)**
One `npm run collect:webtools` run on 2026-09-28 used the seven-calendar HTML collector. Pre-upsert gate `READY_FOR_CUTOVER`. Command exited 1 only for the known HireIllini meridiem skip `33553793` (stored row unchanged).

| Measure | Live result |
| --- | --- |
| Calendars attempted / list succeeded / failed | 7 / 7 / 0 |
| Unique IDs discovered / normalized / upserted / skipped | 212 / 211 / 211 / 1 |
| Identity conflicts / hour-wide start or end shifts | 0 / 0 |
| 7541 discovered / genuinely new | 3 / 3 |
| 6327 discovered / overlap with 5115 / genuinely new | 42 / 13 / 29 |
| Raw events before → after | 218 → 250 (Webtools: 215 → 247) |
| Occurrences / mappings | 217 → 248 / 218 → 250 |
| Reconciliation | 32 assigned, 31 new occurrences, 1 join to an existing occurrence |
| Unmapped / invalid / duplicate mappings / orphan occurrences | 0 / 0 / 0 / 0 |
| Lost raw rows / changed existing identity fields / changed established mappings | 0 / 0 / 0 |
| New-event classifier (current rules) | 9 relevant / 9 uncertain / 14 not_relevant |
| Registration | 16 of 32 new rows have URLs; 0 stored URLs lost; 0 company changes |

The 13 overlapping Research Park IDs stayed on `{eventId}@illinois.edu`. Collector-key SELECT cannot read `user_occurrence_states` (by design); no baseline occurrence IDs were removed, so existing user-state foreign keys remain valid.

**Validation / Result**
Configuration and collector tests assert the seven-calendar set. After documentation: tests, `npx tsc --noEmit`, `npm run lint`, and `npm run build` (`next build --webpack`). Classifier, parser, and schema were not changed.

Result: seven-source HTML collection is in production. Phase 4 is ready for commit review.

---

## Phase 5B.1A collector lease infrastructure

**When:** 2026-09-28

**Problem**
Unattended collection must not overlap a laptop run. A session-level `pg_try_advisory_lock` cannot protect the multi-minute HTML collector: `@supabase/supabase-js` talks to PostgREST, and each REST/RPC request may use a different pooled backend. Separate acquire/release advisory RPCs would leak the lock or no-op the unlock.

**Decision**
Durable server-time lease: table `job_leases` (one row per job, seeded `collect_webtools`) and security-definer RPCs `try_acquire_job_lease`, `renew_job_lease`, `release_job_lease`. Ownership and expiry use `clock_timestamp()`. Acquire is one `UPDATE ... WHERE` free, expired, or same owner, serialized with a **transaction** advisory lock (released at the end of that HTTP call). Expired rows may be taken over. This is not job history.

**Why**
Works across separate REST connections. A crashed collector stops heartbeating and the lease expires instead of blocking forever.

**Recommended timing (collector integration later)**
600 second lease, renew every 120 seconds. Live collection is ~4–5 minutes; 10 minutes covers retries without a 30-minute static hold.

**Implementation**
`supabase/migrations/008_add_job_leases.sql`. RLS on; no table grants to anon, authenticated, or service_role. EXECUTE on the three RPCs to service_role only.

**Validation**
Static tests in `supabase/job-lease-migration.test.ts`. SQL Editor: `verify-job-leases.sql` (privileges) and `verify-job-lease-transactions.sql` (acquire/deny/renew/release/takeover inside a rolled-back transaction).

**Not in this milestone (at 5B.1A)**
Collector did not acquire the lease yet. Exit semantics were unchanged. GitHub Actions scheduling was not implemented.

**Production apply (2026-09-28)**
Target project identity matches CampusRadar `.env.local` (`pexzwkdkoncthdsmkngz`, same ref as prior occurrence-migration audits). This environment has REST keys only: no `supabase` CLI, no Postgres URI. Established workflow is the SQL Editor. `008_add_job_leases.sql` was applied there, then `verify-job-leases.sql` and `verify-job-lease-transactions.sql`. Seed row `collect_webtools` exists, `owner_id` is NULL, `lease_expires_at` is epoch, and acquire / competing-owner rejection / renew / foreign renew rejection / foreign release rejection / release / reacquire / expired takeover passed. The lease was confirmed free after verification.

---

## Phase 5B.1B collector lease integration

**When:** 2026-09-28

**Problem**
Unattended Webtools collection still had no durable exclusion and treated isolated detail skips as a whole-run failure (`result.ok` required zero `detailFailures`). A laptop run and a later scheduled run must not overlap, and HireIllini `33553793` (missing meridiem) must warn rather than fail the job.

**Decision**
The privileged collector acquires `collect_webtools` via `try_acquire_job_lease` before list discovery, detail fetching, event reads/writes, or occurrence reconciliation. Owner identity is a per-invocation `crypto.randomUUID()` (no extra env). Lease duration 600s, heartbeat 120s, same owner on renew. Heartbeat loss fails closed before further privileged mutation. `release_job_lease` runs in `finally` after success, warning, controlled failure, and thrown failure. Force-kill still relies on expiry.

Run statuses: `success` and `warning` exit 0; `failure` exit 1; `skipped_locked` exit 0 with no collection. Isolated detail/schedule skip no longer sets `CollectionResult.ok` false; validation gates are unchanged.

**Implementation**
`lib/job-lease.ts` wraps the three RPCs and an injectable heartbeat timer. `lib/illinois-webtools/collect-run.ts` orchestrates acquire → collect → reconcile → release and prints one structured summary. `scripts/collect-webtools.ts` is the CLI wrapper.

**Validation**
Unit tests for RPC mapping, heartbeat stop/loss, skip-locked, warning vs failure vs success, release after thrown failure, and CLI exit codes. No live production collector run and no GitHub Actions in this milestone.

**Not in this milestone**
GitHub Actions scheduling. Live production collection after this wiring.

---

## Phase 5B.1 completion verification

**When:** 2026-09-30

**Scope and fixes**
Reviewed the uncommitted 5B.1A/B checkpoint at `b9c653b`. Kept `collect_webtools`, a fresh UUID per CLI invocation, 600-second leases, and 120-second heartbeats. Added ownership checks before occurrence reconciliation writes, including retries after snapshot conflicts. Preserved failures from in-flight heartbeats during shutdown instead of suppressing them. Added regression coverage for those cases and clean-run release failures. Collection errors remain primary when release also fails.

**Local verification**
`npm test`: 27 files, 323 tests passed. `npx tsc --noEmit`, `npm run lint`, and `npm run build` (Next.js webpack production build): all exit 0. `git diff --check`: passed after removing the checkpoint's trailing blank line. No unrelated implementation changes.

**Production schema verification**
Authenticated SQL Editor for project `pexzwkdkoncthdsmkngz`, production branch, matched `.env.local`. Migration 008 was already installed; no migration was reapplied. Read-only catalog checks verified all three RPC body hashes against the local migration, security-definer/postgres ownership, `search_path=public`, service-role EXECUTE, no anon/authenticated EXECUTE, RLS enabled, and no direct table privileges for anon/authenticated/service_role. The seeded lease was free before collection. Migration 008 affects only lease infrastructure, with no destructive event/occurrence/user-data operations.

**One controlled production collection**
2026-09-30 14:00:12–14:04:36 UTC; owner `7ce47a5e-3896-498a-bee8-641baa2a9aeb`. Existing CLI with a temporary external fetch observer that recorded request paths/status and lease responses, without keys or headers. One JSON summary; status `warning`, exit 0. Seven calendars succeeded; 212 discovered, 211 normalized/upserted, one known schedule warning (`33553793`, `unparsed-date`), zero identity conflicts. Gate `READY_FOR_CUTOVER`, zero blockers and zero material/hour-wide time shifts. Acquire succeeded; renewals at 14:02:13 and 14:04:14 UTC succeeded; release succeeded. A separate post-run SQL SELECT confirmed NULL owner, epoch expiry, and `lease_free=true`.

Reconciliation: 258 source events, 250 existing mappings, 8 assignments, 8 new occurrences, no joins. Read-only before/after comparison: 250 → 258 events and mappings, zero lost event IDs, zero changed existing source identities or occurrence mappings, and the skipped event unchanged. `npm run verify:occurrences` exited 0: 256 occurrences, 258 mappings, zero unmapped/invalid/duplicate mappings/orphan occurrences; both public views loaded. Output scan found no configured keys.

**Real overlap verification**
A second invocation at 14:00:23 UTC used its own UUID, returned `skipped_locked`, and exited 0. Its complete database request log contained only the denied acquire RPC; no event reads/writes or reconciliation calls, and no collection progress output. It did not release the first owner's lease.

**Result and limits**
Phase 5B.1 verification complete; ready for commit review. Nothing committed, pushed, or scheduled. The known upstream ambiguous schedule remains a warning. Client ownership checks prevent subsequent writes after reported lease loss; they cannot cancel database requests already in flight. Crash recovery still relies on lease expiry. Temporary observation artifacts are outside the repository at `/tmp/campusradar-phase5b1/`.

---

## Daily Vercel collection (local implementation; activation pending)

**When:** 2026-09-30

Phase 5B.1 committed as `3ca8303` with its verified code unchanged. Scheduling uses two daily Vercel Cron GETs in `vercel.json`: `/api/cron/collect-webtools` at `0 11 * * *` (11:00 UTC; Hobby may invoke during that hour) and `/api/cron/send-digest` at `0 16 * * *` (16:00 UTC, after collection). Both require `Authorization: Bearer` matching `CRON_SECRET`. The collector route awaits the existing `runWebtoolsCollector`; the 600s lease and 120s heartbeat are unchanged. No GitHub Actions workflow remains.

Vercel Hobby supports daily cron, not every 30 minutes. Daily discovery is a reasonable V1 freshness tradeoff: new/changed events may take until the next daily run to appear. The existing deployed project/plan could not be confirmed: no local Vercel linkage or GitHub deployment records, and browser login required a new Vercel authorization, which was not accepted. This implementation targets Hobby without purchasing anything.

**Security and failure behavior**
`CRON_SECRET` must be present and match `Authorization: Bearer <secret>` before any privileged client is created. Production-only environment variables hold the secret and Supabase credentials; nothing is exposed to the browser. The original structured summary is logged and returned without caching: success/warning/skipped_locked → HTTP 200; failure or missing configuration → HTTP 500; absent/incorrect authorization → HTTP 401. HEAD cannot invoke collection. Unexpected exceptions return a generic failure without echoing exception contents. Vercel records HTTP failures but does not automatically retry cron invocations.

**Runtime constraint**
`maxDuration=300` matches Hobby with Fluid Compute. The verified CLI run took 264 seconds, leaving only 36 seconds of headroom; serverless runtime has not been measured. A timeout can terminate without a summary or release; the unchanged lease expires naturally. Confirm Fluid Compute and observe the first authorized deployed run before treating this as reliable unattended collection. Do not deploy on a legacy 60-second function limit. No paid upgrade or collector redesign was introduced.

**Activation handoff**
In the existing Vercel project's Settings → Environment Variables, Production scope only:
- `CRON_SECRET`: generate a random 32-byte hex value with `openssl rand -hex 32`.
- `SUPABASE_URL`: existing CampusRadar URL (`https://pexzwkdkoncthdsmkngz.supabase.co`).
- `SUPABASE_SECRET_KEY`: existing privileged collector key from `.env.local` / Supabase, not the publishable key.
- `SITE_URL`: public production origin, no trailing slash (digest email links).
- `RESEND_API_KEY` and `RESEND_FROM`: digest sender only on the server.
Confirm project Settings → Functions has Fluid Compute enabled and allows 300s. Deploy only after approval; production deployment registers both crons from `vercel.json`. Check Settings → Cron Jobs is enabled. No extra scheduler service is needed in code. No secrets were created, no deployment/push performed, and no production run triggered in this work.

**Verification**
`npm test`: 335 tests / 28 files passed, including 12 isolated route tests with mocked collector and forbidden live fetch. TypeScript, lint, production webpack build passed. Build manifest confirms the route's 300s duration. Local production-server smoke checks with empty cron/service secrets returned GET 401 and HEAD 405, without collection. `git diff --check` passed. To verify after an approved deployment, use Cron Jobs → View Logs and inspect HTTP status and the structured summary, including lease acquire/release, validation gate, occurrence results, and warnings. Confirm the first run completes below 300s. Use the existing read-only `supabase/verify-job-leases.sql` if a timeout leaves ownership uncertain.

References: https://vercel.com/docs/cron-jobs/usage-and-pricing ; https://vercel.com/docs/functions/configuring-functions/duration ; https://vercel.com/docs/cron-jobs/manage-cron-jobs

---

## Editorial interface and HTML digest

**When:** 2026-10-07

**Problem**
Every screen used the same zinc card treatment. Event cards did not give the date and title a clear hierarchy, source provenance was easy to miss, and the digest was plain text only. Account and auth controls still looked like a separate, generic form system after the first visual pass.

**Decision**
Keep discovery, ranking, the 30-result cap, occurrence identity, calendar instants, authentication, and digest send tracking. Do not add a Saved tab. Add an HTML digest beside the existing text body. Finish the interface as one editorial system: paper surfaces, ink type, Illinois orange, date markers, and shared form controls.

**Why**
Students scan a campus list by day and title. A Saved tab would misrepresent a feed that only loads the first 30 results. HTML mail can carry the same facts as the card without changing who receives a digest or whether a send is recorded. Shared controls stop account and auth from looking unfinished next to the feed.

**Implementation**
Event titles are `h3`. The marker shows the day; the visible line shows the time range; screen readers still get the full start and end. Description previews are visual only, and “About this event” is the control name. Source rows use a disclosure marker. Google Calendar underlines its label, not the gap before the arrow. Successful plan changes stay visible. Empty result lists do not also say “0 events.” Login, signup, recovery, account, and interests use the same fields, notices, and buttons. The header stays one line at 320px. The HTML digest is a 600px table with inline styles, bgcolor, a light color scheme, date markers, and only http(s) source and registration links. Plain text and delivery bookkeeping are unchanged.

**Validation**
`npm test`: 36 files, 404 passed, 1 skipped (the optional offline visual-fixture export). `npx tsc --noEmit` and `npm run lint` exited 0. `npm run build` (`next build --webpack`) compiled successfully. Responsive checks covered 320, 390, 768, 1024, and 1280 with no horizontal overflow. The live anonymous feed, empty search, login, signup, and the recovery holding page were rendered. Interested, Going, and Not Interested were checked by applying the real selected styles on live cards, not by writing user state. The HTML digest was opened locally from `scripts/preview-digest.ts` at about 700px and 390px. No production email was sent. Signed-in account and interests pages were not loaded in a session.
