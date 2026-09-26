import type { SupabaseClient } from "@supabase/supabase-js";
import { COLLECTOR_USER_AGENT, ILLINOIS_WEBTOOLS_SOURCE, WEBTOOLS_CALENDARS, type WebtoolsCalendar } from "./constants";
import { normalizeIllinoisWebtoolsEvent, type NormalizedIllinoisEvent } from "./normalize";
import { parseIcsEvents } from "./parse-ics";

type CalendarResult = {
  id: string;
  label: string;
  ok: boolean;
  eventCount: number;
  error?: string;
};

export type CollectionResult = {
  ok: boolean;
  calendars: CalendarResult[];
  overlaps: { uid: string; calendarIds: string[] }[];
  upserted: number;
  databaseError?: string;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Prefer current feed values; only fill blanks from the fallback. Do not mix
// times from different schedules or infer an end for an unknown-duration event.
function fillMissing(primary: NormalizedIllinoisEvent, fallback: NormalizedIllinoisEvent): NormalizedIllinoisEvent {
  const merged = { ...primary };
  for (const field of ["company", "description", "category", "location", "registration_url"] as const) {
    if (!merged[field].trim()) merged[field] = fallback[field];
  }
  const start = Date.parse(primary.start_time);
  if (Date.parse(primary.end_time) === start && Date.parse(fallback.start_time) === start && Date.parse(fallback.end_time) > start) {
    merged.end_time = fallback.end_time;
  }
  return merged;
}

function parseCalendar(ics: string, calendarId: string): NormalizedIllinoisEvent[] {
  const lines = ics.trim().split(/\r\n|\n|\r/);
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") {
    throw new Error("Response is not a complete VCALENDAR.");
  }
  let insideEvent = false;
  let count = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      if (insideEvent) throw new Error("Nested VEVENT blocks.");
      insideEvent = true;
      count++;
    } else if (line === "END:VEVENT") {
      if (!insideEvent) throw new Error("Unmatched VEVENT ending.");
      insideEvent = false;
    }
  }
  if (insideEvent) throw new Error("Incomplete VEVENT block.");
  const parsed = parseIcsEvents(ics);
  if (parsed.length !== count) throw new Error(`Parsed ${parsed.length} of ${count} VEVENTs; refusing partial calendar data.`);
  return parsed.map((event) => {
    const normalized = normalizeIllinoisWebtoolsEvent(event, calendarId);
    if (!normalized || !normalized.title.trim() || Date.parse(normalized.end_time) < Date.parse(normalized.start_time)) {
      throw new Error(`Unusable event ${event.uid}; refusing partial calendar data.`);
    }
    return normalized;
  });
}

/** One process at a time: the existing-row read and upsert are not a transaction. */
export async function collectWebtools({
  supabase,
  calendars = WEBTOOLS_CALENDARS,
  fetchFeed = fetch,
}: {
  supabase: SupabaseClient;
  calendars?: readonly WebtoolsCalendar[];
  fetchFeed?: typeof fetch;
}): Promise<CollectionResult> {
  const result: CollectionResult = { ok: true, calendars: [], overlaps: [], upserted: 0 };
  const candidates = new Map<string, NormalizedIllinoisEvent>();
  const origins = new Map<string, Set<string>>();

  // Sequential configured order makes precedence independent of network timing.
  for (const calendar of calendars) {
    try {
      const response = await fetchFeed(calendar.url, {
        headers: { "User-Agent": COLLECTOR_USER_AGENT, Accept: "text/calendar" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`ICS request failed: ${response.status} ${response.statusText}`);
      const events = parseCalendar(await response.text(), calendar.id);
      // Validate the entire calendar before contributing any candidates.
      for (const event of events) {
        const prior = candidates.get(event.external_id);
        candidates.set(event.external_id, prior ? fillMissing(prior, event) : event);
        const ids = origins.get(event.external_id) ?? new Set<string>();
        ids.add(calendar.id);
        origins.set(event.external_id, ids);
      }
      result.calendars.push({ id: calendar.id, label: calendar.label, ok: true, eventCount: events.length });
    } catch (error) {
      result.ok = false;
      result.calendars.push({ id: calendar.id, label: calendar.label, ok: false, eventCount: 0, error: message(error) });
    }
  }
  result.overlaps = [...origins].filter(([, ids]) => ids.size > 1)
    .map(([uid, ids]) => ({ uid, calendarIds: [...ids] }));
  if (!candidates.size) return result;

  try {
    const ids = [...candidates.keys()];
    // Bound URL size and read all existing candidates before attempting a write.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error, count } = await supabase.from("events")
        .select("source, external_id, title, company, description, category, start_time, end_time, timezone, location, registration_url, source_url", { count: "exact" })
        .eq("source", ILLINOIS_WEBTOOLS_SOURCE)
        .in("external_id", ids.slice(offset, offset + 100))
        .range(0, 99);
      if (error) throw new Error(`Existing-event read failed: ${error.message}`);
      if (count !== null && count > (data?.length ?? 0)) {
        throw new Error("Existing-event read was truncated; refusing to overwrite unread stored fields.");
      }
      for (const existing of (data ?? []) as NormalizedIllinoisEvent[]) {
        const incoming = candidates.get(existing.external_id);
        if (!incoming) continue;
        const merged = fillMissing(incoming, existing);
        merged.source_url = existing.source_url || incoming.source_url;
        candidates.set(existing.external_id, merged);
      }
    }
    // No id or discovered_at fields: existing identities and discovery dates stay.
    const { error } = await supabase.from("events")
      .upsert([...candidates.values()], { onConflict: "source,external_id" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    result.upserted = candidates.size;
  } catch (error) {
    result.ok = false;
    result.databaseError = message(error);
  }
  return result;
}
