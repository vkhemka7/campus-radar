import { classifyEvent, type EventRelevance } from "@/lib/event-relevance";
import { selectEventRepresentative } from "@/lib/event-deduplication";
import { type CampusEvent } from "@/lib/events";
import { createSupabaseClient } from "@/lib/supabase";

type EventRow = {
  id: string;
  title: string;
  company: string;
  description: string;
  category: string;
  start_time: string;
  end_time: string;
  timezone: string;
  location: string;
  registration_url: string;
  source_url: string;
  source: string;
  external_id: string;
  discovered_at: string;
  event_occurrence_sources: { occurrence_id: string } | { occurrence_id: string }[] | null;
};

export type BrowsingEvent = {
  occurrenceId: string;
  event: CampusEvent;
  provenance: CampusEvent[];
  relevance: EventRelevance;
};

export type GetEventsResult =
  | { ok: true; events: BrowsingEvent[] }
  | { ok: false; error: string };

function toCampusEvent(row: EventRow): CampusEvent {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    description: row.description,
    category: row.category,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
    location: row.location,
    registrationUrl: row.registration_url,
    sourceUrl: row.source_url,
    source: row.source,
    externalId: row.external_id,
    discoveredAt: row.discovered_at,
  };
}

export const EVENT_RESULT_LIMIT = 30;

export type EventFilters = {
  view?: "career" | "all";
  search?: string;
  days?: 7 | 30;
};

function combinedRelevance(events: CampusEvent[]): EventRelevance {
  const results = events.map(classifyEvent);
  const classification = results.some((result) => result.classification === "relevant")
    ? "relevant"
    : results.some((result) => result.classification === "uncertain") ? "uncertain" : "not_relevant";
  const reasons = results.flatMap((result) => result.reasons).filter((reason, index, all) =>
    all.findIndex((candidate) => candidate.ruleId === reason.ruleId
      && candidate.field === reason.field && candidate.matchedText === reason.matchedText) === index);
  return { classification, reasons };
}

export async function getEvents(filters: EventFilters = {}): Promise<GetEventsResult> {
  const clientResult = createSupabaseClient();

  if (!clientResult.ok) {
    console.error("Could not configure event database:", clientResult.error);
    return { ok: false, error: "Events could not be loaded. Please try again later." };
  }

  const now = new Date();
  const cutoff = now.toISOString();
  const batchSize = 100;
  const rows: EventRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    let query = clientResult.supabase
      .from("events")
      .select(
        "id, title, company, description, category, start_time, end_time, timezone, location, registration_url, source_url, source, external_id, discovered_at, event_occurrence_sources(occurrence_id)",
      )
      .eq("source", "Illinois Webtools")
      // A past start remains visible only while its listed end is in the future.
      // When end === start (unknown duration), it expires at its start time.
      .or(`start_time.gte.${cutoff},end_time.gt.${cutoff}`);

    const search = filters.search?.trim();
    if (search) {
      const escaped = search.replace(/[\\%_]/g, "\\$&");
      query = query.ilike("title", `%${escaped}%`);
    }
    if (filters.days === 7 || filters.days === 30) {
      const until = new Date(now.getTime() + filters.days * 24 * 60 * 60 * 1000);
      query = query.lt("start_time", until.toISOString());
    }

    const { data, error } = await query
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Could not load events from the database:", error);
      return { ok: false, error: "Events could not be loaded. Please try again later." };
    }

    const batch = (data ?? []) as EventRow[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }

  const byOccurrence = new Map<string, CampusEvent[]>();
  for (const row of rows) {
    // The UNIQUE event_id FK makes PostgREST embed this as an object/null.
    // Accept array-shaped responses too, retaining corruption detection.
    const embedded = row.event_occurrence_sources;
    const mappings = Array.isArray(embedded) ? embedded : embedded === null ? [] : [embedded];
    // Collection and reconciliation are separate commits. Keep already mapped
    // events available during that window without inventing a temporary ID.
    if (mappings.length === 0) {
      console.error(`Event ${row.id} is awaiting occurrence reconciliation.`);
      continue;
    }
    if (mappings.length !== 1) {
      console.error(`Event ${row.id} does not have exactly one occurrence mapping.`);
      return { ok: false, error: "Events could not be loaded. Please try again later." };
    }
    const occurrenceId = mappings[0]?.occurrence_id;
    if (typeof occurrenceId !== "string" || !occurrenceId) {
      console.error(`Event ${row.id} has an invalid occurrence identity.`);
      return { ok: false, error: "Events could not be loaded. Please try again later." };
    }
    const provenance = byOccurrence.get(occurrenceId) ?? [];
    provenance.push(toCampusEvent(row));
    byOccurrence.set(occurrenceId, provenance);
  }
  const events = [...byOccurrence].map(([occurrenceId, provenance]) => ({
    occurrenceId,
    event: selectEventRepresentative(provenance),
    provenance,
    relevance: combinedRelevance(provenance),
  })).filter(({ relevance }) => filters.view === "all" || relevance.classification === "relevant")
    .slice(0, EVENT_RESULT_LIMIT);
  return { ok: true, events };
}
