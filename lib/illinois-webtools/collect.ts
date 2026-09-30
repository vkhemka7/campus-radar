import type { SupabaseClient } from "@supabase/supabase-js";
import { JobLeaseLostError } from "../job-lease";
import { ILLINOIS_WEBTOOLS_SOURCE, WEBTOOLS_CALENDARS, type WebtoolsCalendar } from "./constants";
import { discoverWebtoolsHtml, type HtmlDiscovery } from "./discover-html";
import { compareWebtoolsHtmlDryRun, type DryRunReport, type StoredWebtoolsRow } from "./dry-run-compare";
import { createWebtoolsHtmlFetcher, type WebtoolsHtmlFetcher } from "./html-fetch";
import type { NormalizedIllinoisEvent } from "./normalize";

type StoredEvent = NormalizedIllinoisEvent & { id: string };

export type CollectionResult = {
  /** False for unsafe/incomplete collection. Isolated detail skips leave this true. */
  ok: boolean;
  calendars: HtmlDiscovery["calendars"];
  discovered: number;
  normalized: number;
  detailFailures: HtmlDiscovery["detailFailures"];
  upserted: number;
  skipped: number;
  identityConflicts: number;
  gate?: DryRunReport["gate"];
  timeValidation?: DryRunReport["timeValidation"];
  databaseError?: string;
};

// Prefer current HTML values; preserve stored enrichment when HTML is blank.
// Never borrow an old end time after a reschedule.
function fillMissing(primary: NormalizedIllinoisEvent, fallback: NormalizedIllinoisEvent): NormalizedIllinoisEvent {
  const merged = { ...primary };
  for (const field of ["company", "description", "category", "location", "registration_url"] as const) {
    if (!merged[field].trim()) merged[field] = fallback[field];
  }
  const start = Date.parse(primary.start_time);
  if (Date.parse(primary.end_time) === start && Date.parse(fallback.start_time) === start && Date.parse(fallback.end_time) > start) {
    merged.end_time = fallback.end_time;
  }
  merged.source_url = fallback.source_url || primary.source_url;
  return merged;
}

function comparisonRow(row: StoredEvent): StoredWebtoolsRow {
  return {
    id: row.id, externalId: row.external_id, title: row.title, company: row.company,
    description: row.description, category: row.category, startTime: row.start_time,
    endTime: row.end_time, timezone: row.timezone, location: row.location,
    registrationUrl: row.registration_url, sourceUrl: row.source_url,
  };
}

/** One collector at a time: the existing-row read and upsert are not a transaction. */
export async function collectWebtools({
  supabase,
  calendars = WEBTOOLS_CALENDARS,
  fetcher = createWebtoolsHtmlFetcher(),
  now,
  onProgress,
  assertStillOwns,
}: {
  supabase: SupabaseClient;
  calendars?: readonly WebtoolsCalendar[];
  fetcher?: WebtoolsHtmlFetcher;
  now?: Date;
  onProgress?: (message: string) => void;
  assertStillOwns?: () => void;
}): Promise<CollectionResult> {
  if (!calendars.length || new Set(calendars.map(({ id }) => id)).size !== calendars.length
    || calendars.some(({ id }) => !WEBTOOLS_CALENDARS.some((configured) => configured.id === id))) {
    throw new Error("Select only the existing configured Webtools calendars, without duplicates.");
  }
  assertStillOwns?.();
  const discovery = await discoverWebtoolsHtml({ calendars, fetcher, now, onProgress });
  const result: CollectionResult = {
    ok: discovery.calendars.every(({ ok }) => ok),
    calendars: discovery.calendars,
    discovered: discovery.uniqueEventIds,
    normalized: discovery.candidates.length,
    detailFailures: discovery.detailFailures,
    upserted: 0,
    skipped: discovery.uniqueEventIds,
    identityConflicts: 0,
  };
  try {
    assertStillOwns?.();
    // Read ALL Webtools rows, not just candidate external IDs: a conflicting
    // source URL under a different external ID must also block insertion.
    const stored: StoredEvent[] = [];
    let total: number | null = null;
    for (let offset = 0; ; offset += 100) {
      const { data, error, count } = await supabase.from("events")
        .select("id, source, external_id, title, company, description, category, start_time, end_time, timezone, location, registration_url, source_url", { count: "exact" })
        .eq("source", ILLINOIS_WEBTOOLS_SOURCE)
        .order("id").range(offset, offset + 99);
      if (error) throw new Error(`Existing-event read failed: ${error.message}`);
      if (count === null || (total !== null && count !== total)) {
        throw new Error("Missing or changing Webtools row count; refusing incomplete identity validation.");
      }
      total = count;
      const batch = (data ?? []) as StoredEvent[];
      stored.push(...batch);
      if (stored.length === total) break;
      if (stored.length > total || batch.length !== 100) {
        throw new Error("Existing-event read was truncated; refusing incomplete identity validation.");
      }
    }
    const report = compareWebtoolsHtmlDryRun({
      discovery, rows: stored.map(comparisonRow),
      // Absence is not deletion evidence, especially for --calendar runs.
      checkStoredCoverage: false,
    });
    result.identityConflicts = report.identity.conflicts;
    result.gate = report.gate;
    result.timeValidation = report.timeValidation;
    if (report.gate.decision !== "READY_FOR_CUTOVER") {
      result.ok = false;
      return result;
    }
    assertStillOwns?.();
    const byExternalId = new Map(stored.map((row) => [row.external_id, row]));
    const candidates = discovery.candidates.map((event): NormalizedIllinoisEvent => {
      // Discovery already used normalizeHtmlWebtoolsEvent. Keep precisely its
      // identity and supported metadata; sponsor/speaker are not company.
      const normalized: NormalizedIllinoisEvent = {
        source: ILLINOIS_WEBTOOLS_SOURCE, external_id: event.externalId,
        title: event.title, company: event.company, description: event.description,
        category: event.category, start_time: event.startTime, end_time: event.endTime,
        timezone: event.timezone, location: event.location,
        registration_url: event.registrationUrl, source_url: event.sourceUrl,
      };
      const existing = byExternalId.get(event.externalId);
      return existing ? fillMissing(normalized, existing) : normalized;
    });
    if (!candidates.length) return result;
    // No id/discovered_at fields and no deletes. Existing identities stay intact.
    const { error } = await supabase.from("events")
      .upsert(candidates, { onConflict: "source,external_id" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    result.upserted = candidates.length;
    result.skipped = result.discovered - result.upserted;
  } catch (error) {
    if (error instanceof JobLeaseLostError) throw error;
    result.ok = false;
    result.databaseError = error instanceof Error ? error.message : String(error);
  }
  return result;
}
