import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateEvidence } from "@/lib/event-deduplication";
import type { CampusEvent } from "@/lib/events";

export type OccurrenceMapping = { eventId: string; occurrenceId: string };
export type OccurrenceAssignment = { occurrenceId: string | null; eventIds: string[] };
export type ReconciliationResult = {
  sourceEvents: number;
  existingMappings: number;
  assignedEvents: number;
  joinedOccurrences: number;
  createdOccurrences: number;
};

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

function eventOrder(left: CampusEvent, right: CampusEvent): number {
  return Date.parse(left.startTime) - Date.parse(right.startTime) || left.id.localeCompare(right.id);
}

export function planOccurrenceAssignments(
  events: CampusEvent[], mappings: OccurrenceMapping[],
): OccurrenceAssignment[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const mappedEventIds = new Set<string>();
  const groups: { occurrenceId: string | null; provenance: CampusEvent[]; newEventIds: string[] }[] = [];
  const established = new Map<string, (typeof groups)[number]>();

  for (const mapping of mappings) {
    const event = byId.get(mapping.eventId);
    if (!event) throw new Error(`Occurrence mapping references missing event ${mapping.eventId}.`);
    if (mappedEventIds.has(mapping.eventId)) throw new Error(`Event ${mapping.eventId} has multiple occurrence mappings.`);
    mappedEventIds.add(mapping.eventId);
    let group = established.get(mapping.occurrenceId);
    if (!group) {
      group = { occurrenceId: mapping.occurrenceId, provenance: [], newEventIds: [] };
      established.set(mapping.occurrenceId, group);
      groups.push(group);
    }
    group.provenance.push(event);
  }
  for (const group of groups) group.provenance.sort(eventOrder);

  for (const event of [...events].sort(eventOrder)) {
    if (mappedEventIds.has(event.id)) continue;
    const matches = groups.filter((group) =>
      group.provenance.every((member) => duplicateEvidence(event, member)));
    // Ambiguity must not merge established identities. A new singleton is the
    // conservative fallback when zero or multiple groups match.
    const group = matches.length === 1
      ? matches[0]
      : { occurrenceId: null, provenance: [], newEventIds: [] };
    if (matches.length !== 1) groups.push(group);
    group.provenance.push(event);
    group.newEventIds.push(event.id);
  }

  return groups.filter(({ newEventIds }) => newEventIds.length)
    .map(({ occurrenceId, newEventIds }) => ({ occurrenceId, eventIds: newEventIds }));
}

type ReconciliationSnapshot = {
  events: EventRow[];
  mappings: { event_id: string; occurrence_id: string }[];
};

export async function reconcileEventOccurrences(supabase: SupabaseClient): Promise<ReconciliationResult> {
  // Each retry reads a single database snapshot and recomputes the whole plan.
  // No assignments commit if collection or another reconciler changed it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.rpc("occurrence_reconciliation_snapshot");
    if (error) throw new Error(`Occurrence snapshot failed: ${error.message}`);
    const snapshot = data as ReconciliationSnapshot;
    const mappings = snapshot.mappings.map(({ event_id, occurrence_id }) =>
      ({ eventId: event_id, occurrenceId: occurrence_id }));
    const assignments = planOccurrenceAssignments(snapshot.events.map(toCampusEvent), mappings);
    const result = await supabase.rpc("reconcile_occurrence_plan", {
      p_snapshot: snapshot, p_assignments: assignments,
    });
    if (result.error?.code === "PT409") continue;
    if (result.error) throw new Error(`Occurrence reconciliation failed: ${result.error.message}`);
    return result.data as ReconciliationResult;
  }
  throw new Error("Occurrence snapshot kept changing; retry reconciliation when writers are less busy.");
}
