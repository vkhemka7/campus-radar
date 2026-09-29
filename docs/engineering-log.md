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

## Webtools HTML ingestion preparation and validation

**When:** 2026-09-28 (`f2ee7e8`)

**Problem**
Production collection depends on Outlook ICS URLs. An HTML list/detail path was needed that can later replace those feeds without inventing new `external_id` values or writing unverified rows.

**Decision**
Implement public HTML parsers and a no-write dry run against the five existing calendars. Keep ICS collection as the writer. Do not add AE Corporate Relations or Entrepreneurship sources (calendars 7541 and 6327).

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

The remaining schedule failure is HireIllini `33553793` (`Oct 7, 2026 11:00` on both list and detail, so meridiem is not inferred). Production HTML cutover has not happened. `npm run collect:webtools` still fetches ICS.
