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
    discoveredAt: row.discovered_at,
  };
}

export async function getEvents(): Promise<GetEventsResult> {
  const clientResult = createSupabaseClient();

  if (!clientResult.ok) {
    return clientResult;
  }

  const { data, error } = await clientResult.supabase
    .from("events")
    .select(
      "id, title, company, description, category, start_time, end_time, timezone, location, registration_url, source_url, source, discovered_at",
    )
    .order("start_time", { ascending: true });

  if (error) {
    return {
      ok: false,
      error: `Could not load events from the database: ${error.message}`,
    };
  }

  const rows = (data ?? []) as EventRow[];

  return {
    ok: true,
    events: rows.map(toCampusEvent),
  };
}
