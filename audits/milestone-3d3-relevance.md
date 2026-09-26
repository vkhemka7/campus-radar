# Milestone 3D.3 relevance audit

Audit timestamp: 2026-09-23T21:55:40.716Z

Read-only Supabase query, source = Illinois Webtools, ordered by ID and paginated in batches of 100. No date filter or UI limit. All 207 IDs were unique and every classifier input matched the pre-change snapshot. No database writes.

| Classification | Before | After | Change |
|---|---:|---:|---:|
| relevant | 16 | 33 | +17 |
| uncertain | 98 | 81 | -17 |
| not_relevant | 93 | 93 | +0 |

## Every changed row

All 17 changes are uncertain → relevant; no other classification transitions occurred. IDs below are Webtools external IDs.

| Event / ID | Old → new | Rule and evidence |
|---|---|---|
| [After Hours in Chicago - Fall 2026](https://calendars.illinois.edu/detail/2654/33557768) — 33557768@illinois.edu | uncertain → relevant | `career-reception` (description): An informal career reception in Chicago for CS and ECE students and companies to connect, network, and socialize |
| [Champaign Blockchain Meetup - December](https://calendars.illinois.edu/detail/5115/33539687) — 33539687@illinois.edu | uncertain → relevant | `technical-community` (title): blockchain meetup |
| [Champaign Blockchain Meetup - November](https://calendars.illinois.edu/detail/5115/33539686) — 33539686@illinois.edu | uncertain → relevant | `technical-community` (title): blockchain meetup |
| [Champaign Blockchain Meetup - October](https://calendars.illinois.edu/detail/5115/33539685) — 33539685@illinois.edu | uncertain → relevant | `technical-community` (title): blockchain meetup |
| [Data + AI User Group - December](https://calendars.illinois.edu/detail/5115/33539398) — 33539398@illinois.edu | uncertain → relevant | `technical-community` (title): data + ai user group |
| [Data + AI User Group - November](https://calendars.illinois.edu/detail/5115/33539396) — 33539396@illinois.edu | uncertain → relevant | `technical-community` (title): data + ai user group |
| [Data + AI User Group - October](https://calendars.illinois.edu/detail/5115/33538309) — 33538309@illinois.edu | uncertain → relevant | `technical-community` (title): data + ai user group |
| [Explore Teaching and Summer Opportunities with MTR](https://calendars.illinois.edu/detail/6499/33562269) — 33562269@illinois.edu | uncertain → relevant | `opportunity` (description): summer fellowships |
| [Fireside chat with Dan Caruso](https://calendars.illinois.edu/detail/2654/33562395) — 33562395@illinois.edu | uncertain → relevant | `startup-learning` (description): Caruso will share insights on his career as an entrepreneur and discuss the future tech frontier, including quantum computing, space technology and the evolving landscape of entrepreneurship |
| [Founders Week fireside chat](https://calendars.illinois.edu/detail/2654/33562692) — 33562692@illinois.edu | uncertain → relevant | `startup-program` (title): founders week fireside chat |
| [Founders Week fireside chat](https://calendars.illinois.edu/detail/2654/33563639) — 33563639@illinois.edu | uncertain → relevant | `startup-program` (title): founders week fireside chat |
| [Information Session: L3HARRIS](https://calendars.illinois.edu/detail/6805/33563719) — 33563719@illinois.edu | uncertain → relevant | `opportunity` (description): hiring for |
| [LAS - AlphaSights Coffee Chat](https://calendars.illinois.edu/detail/6499/33557470) — 33557470@illinois.edu | uncertain → relevant | `opportunity` (description): internships |
| [LAS - Info session with Walsh Group: Summer 2027 Internships for Las Majors](https://calendars.illinois.edu/detail/6499/33555587) — 33555587@illinois.edu | uncertain → relevant | `opportunity` (title): internships |
| [LAS - Summer Research Internships at Oak Ridge National Laboratory](https://calendars.illinois.edu/detail/6499/33555584) — 33555584@illinois.edu | uncertain → relevant | `opportunity` (title): internships |
| [SBIR/STTR Webinar: Cracking the Code: NIGMS SBIR Priorities and What It Takes to Get Funded](https://calendars.illinois.edu/detail/5115/33561685) — 33561685@illinois.edu | uncertain → relevant | `startup-program` (title): sttr webinar |
| [“Startup Incorporation: The What, When, & How” with Alan Singleton](https://calendars.illinois.edu/detail/5115/33519110) — 33519110@illinois.edu | uncertain → relevant | `startup-program` (title): startup incorporation |

## Manual review and conservative misses

- Blockchain meetups and Data + AI user groups (six rows): technical community value is explicit, but descriptions do not promise hiring or a hands-on exercise. Review if the product should require those narrower outcomes.
- SBIR/STTR webinar: startup funding guidance, primarily useful to founders and researchers; student accessibility/relevance is not established by this classifier.
- Founders Week fireside chat appears twice under distinct external IDs (33562692 and 33563639). Both rows describe the same speakers and time. This is a likely existing cross-calendar duplicate; deduplication is outside this milestone.
- First Friday Breakfast (three rows), AgTech Breakfast, Fire at Five, alumni social events, and the generic business-growth webinar remain uncertain. Some may provide useful professional interaction, but the new rules require clearer evidence than audience, venue, or incidental networking.
- Existing title-only technical-talk behavior remains unchanged; technical talks do not imply employer involvement.
- Rules remain deterministic heuristics. Description action gates, sentence boundaries, biography exclusions, and negative context reduce incidental matches but are not semantic proof of an offering.

## Files and validation

- `lib/event-relevance.ts`: extends existing phrase/evidence architecture across the five requested families; retains existing classification precedence.
- `lib/event-relevance.test.ts`: adds positive/negative contextual cases and updates the three reviewed source snapshots.
- `scripts/audit-event-relevance.ts`: read-only complete pagination and baseline comparison, rejects changed inputs or incomplete reads.
- `audits/milestone-3d3-relevance.json`: full before/after classifications and evidence for all 207 rows.
- `audits/milestone-3d3-relevance.md`: this review report.

Tests: `npm test` — 159 passed across four files (88 classifier tests). `npm run lint` and `npx tsc --noEmit` passed.
Default `npm run build` failed twice because Turbopack could not bind a worker port (Operation not permitted), including an escalated retry. `npm run build -- --webpack` passed, including compilation, TypeScript, and page generation.

Baseline snapshot for this session: `/tmp/campus-relevance-baseline.json`. To repeat while it exists:
```sh
TSX_DISABLE_CACHE=1 node --env-file=.env.local --import tsx scripts/audit-event-relevance.ts /tmp/campus-relevance-baseline.json
```

No changes to Supabase data, migrations, ingestion, UI, or later milestones. Pre-existing working-tree edits were preserved.
