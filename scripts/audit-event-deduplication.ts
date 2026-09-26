/** Read-only audit of every stored Illinois Webtools row; no date or UI limit. */
import { deduplicateEvents, duplicateEvidence } from "../lib/event-deduplication";
import type { CampusEvent } from "../lib/events";
import { createSupabaseClient } from "../lib/supabase";

type EventRow = {
  id: string; title: string; company: string; description: string; category: string;
  start_time: string; end_time: string; timezone: string; location: string;
  registration_url: string; source_url: string; source: string; external_id: string;
  discovered_at: string;
};

function toCampusEvent(row: EventRow): CampusEvent {
  return {
    id: row.id, title: row.title, company: row.company, description: row.description,
    category: row.category, startTime: row.start_time, endTime: row.end_time,
    timezone: row.timezone, location: row.location, registrationUrl: row.registration_url,
    sourceUrl: row.source_url, source: row.source, externalId: row.external_id,
    discoveredAt: row.discovered_at,
  };
}

async function main() {
  const client = createSupabaseClient();
  if (!client.ok) throw new Error(client.error);
  const rows: EventRow[] = [];
  let total: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const { data, error, count } = await client.supabase.from("events")
      .select("id,title,company,description,category,start_time,end_time,timezone,location,registration_url,source_url,source,external_id,discovered_at", { count: "exact" })
      .eq("source", "Illinois Webtools").order("id").range(offset, offset + 99);
    if (error) throw new Error(error.message);
    if (count === null || (total !== null && count !== total)) throw new Error("Missing or changing row count.");
    total = count;
    rows.push(...((data ?? []) as EventRow[]));
    if (rows.length >= total) break;
    if (!data?.length) throw new Error("Incomplete read.");
  }
  if (rows.length !== total || new Set(rows.map(({ id }) => id)).size !== rows.length) {
    throw new Error("Incomplete or duplicate audit rows.");
  }
  const occurrences = deduplicateEvents(rows.map(toCampusEvent));
  const duplicateGroups = occurrences.filter(({ provenance }) => provenance.length > 1)
    .map(({ event, provenance }) => ({
      representativeId: event.id,
      evidence: duplicateEvidence(provenance[0], provenance[1]),
      rows: provenance.map(({ id, externalId, title, startTime, endTime, location, source, sourceUrl, registrationUrl }) =>
        ({ id, externalId, title, startTime, endTime, location, source, sourceUrl, registrationUrl })),
    }));
  console.log(JSON.stringify({ auditedAt: new Date().toISOString(), sourceRows: rows.length,
    uniqueOccurrences: occurrences.length, duplicateGroups }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
