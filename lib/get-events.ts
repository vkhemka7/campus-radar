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
};

export type GetEventsResult =
  | { ok: true; events: CampusEvent[] }
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
  search?: string;
  days?: 7 | 30;
};

export async function getEvents(filters: EventFilters = {}): Promise<GetEventsResult> {
  const clientResult = createSupabaseClient();

  if (!clientResult.ok) {
    console.error("Could not configure event database:", clientResult.error);
    return { ok: false, error: "Events could not be loaded. Please try again later." };
  }

  const now = new Date();
  const cutoff = now.toISOString();
  let query = clientResult.supabase
    .from("events")
    .select(
      "id, title, company, description, category, start_time, end_time, timezone, location, registration_url, source_url, source, external_id, discovered_at",
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
    .limit(EVENT_RESULT_LIMIT);

  if (error) {
    console.error("Could not load events from the database:", error);
    return { ok: false, error: "Events could not be loaded. Please try again later." };
  }

  const rows = (data ?? []) as EventRow[];

  return {
    ok: true,
    events: rows.map(toCampusEvent),
  };
}
