import { describe, expect, test, vi } from "vitest";
import { planOccurrenceAssignments, reconcileEventOccurrences, type OccurrenceMapping } from "@/lib/event-occurrences";
import type { CampusEvent } from "@/lib/events";
import { selectEventRepresentative } from "@/lib/event-deduplication";

const base: CampusEvent = {
  id: "a", title: "Founders Week fireside chat", company: "", description: "Description",
  category: "", startTime: "2026-10-01T20:00:00.000Z", endTime: "2026-10-01T20:00:00.000Z",
  timezone: "America/Chicago", location: "Beckman Institute, Auditorium (Room 1025)", registrationUrl: "",
  sourceUrl: "https://calendars.illinois.edu/detail/2654/1", source: "Illinois Webtools",
  externalId: "1@illinois.edu", discoveredAt: "2026-09-20T00:00:00.000Z",
};
const event = (id: string, overrides: Partial<CampusEvent> = {}): CampusEvent => ({
  ...base, id, externalId: `${id}@illinois.edu`,
  sourceUrl: `https://calendars.illinois.edu/detail/2654/${id}`, ...overrides,
});
const mapping = (eventId: string, occurrenceId: string): OccurrenceMapping => ({ eventId, occurrenceId });

describe("persistent occurrence assignment planning", () => {
  test("a richer representative changes the raw ID without changing occurrence identity", () => {
    const richer = event("richer", { description: "A much richer description", company: "Employer" });
    const mappings = [mapping("a", "persistent")];
    expect(selectEventRepresentative([base]).id).toBe("a");
    expect(planOccurrenceAssignments([base, richer], mappings)).toEqual([
      { occurrenceId: "persistent", eventIds: ["richer"] },
    ]);
    expect(selectEventRepresentative([base, richer]).id).toBe("richer");
    expect(planOccurrenceAssignments([base, richer], [...mappings, mapping("richer", "persistent")])).toEqual([]);
  });

  test("rescheduling an already mapped source row preserves its identity", () => {
    const rescheduled = { ...base, startTime: "2026-11-01T20:00:00.000Z" };
    expect(planOccurrenceAssignments([rescheduled], [mapping("a", "persistent")])).toEqual([]);
  });

  test("resumes a partially committed reconciliation without replacing earlier identities", () => {
    const duplicate = event("b");
    const other = event("c", { title: "Unrelated event" });
    expect(planOccurrenceAssignments([base, duplicate, other], [mapping("a", "saved"), mapping("b", "saved")]))
      .toEqual([{ occurrenceId: null, eventIds: ["c"] }]);
  });
  test("backfills conservative duplicates together and unrelated rows separately", () => {
    const duplicate = event("b", { location: "Beckman Institute, Auditorium (Room 1025) 405 N Mathews Ave, Urbana, IL" });
    const unrelated = event("c", { title: "Different event", location: "Siebel Center" });
    expect(planOccurrenceAssignments([unrelated, duplicate, base], [])).toEqual([
      { occurrenceId: null, eventIds: ["a", "b"] },
      { occurrenceId: null, eventIds: ["c"] },
    ]);
  });

  test("joins an unmapped duplicate to one established occurrence without changing its ID", () => {
    const duplicate = event("b", { location: `${base.location} 405 N Mathews Ave` });
    expect(planOccurrenceAssignments([base, duplicate], [mapping("a", "occurrence-a")])).toEqual([
      { occurrenceId: "occurrence-a", eventIds: ["b"] },
    ]);
  });

  test("is idempotent when every source row is already mapped", () => {
    expect(planOccurrenceAssignments([base], [mapping("a", "occurrence-a")])).toEqual([]);
  });

  test("never merges two established occurrences through a new ambiguous row", () => {
    const second = event("b");
    const incoming = event("c");
    expect(planOccurrenceAssignments([base, second, incoming], [
      mapping("a", "occurrence-a"), mapping("b", "occurrence-b"),
    ])).toEqual([{ occurrenceId: null, eventIds: ["c"] }]);
  });

  test("groups new source rows deterministically regardless of input order", () => {
    const duplicate = event("b", { location: `${base.location} 405 N Mathews Ave` });
    const forward = planOccurrenceAssignments([base, duplicate], []);
    expect(planOccurrenceAssignments([duplicate, base], [])).toEqual(forward);
  });

  test("keeps recurring occurrences with different starts separate", () => {
    const later = event("b", { startTime: "2026-11-01T20:00:00.000Z", endTime: "2026-11-01T20:00:00.000Z" });
    expect(planOccurrenceAssignments([base, later], [])).toEqual([
      { occurrenceId: null, eventIds: ["a"] }, { occurrenceId: null, eventIds: ["b"] },
    ]);
  });

  test("rejects corrupt mappings instead of silently choosing one", () => {
    expect(() => planOccurrenceAssignments([base], [mapping("missing", "occurrence")]))
      .toThrow("references missing event");
    expect(() => planOccurrenceAssignments([base], [mapping("a", "one"), mapping("a", "two")]))
      .toThrow("multiple occurrence mappings");
  });
});

describe("occurrence reconciliation", () => {
  function row(value: CampusEvent) {
    return {
      id: value.id, title: value.title, company: value.company, description: value.description,
      category: value.category, start_time: value.startTime, end_time: value.endTime,
      timezone: value.timezone, location: value.location, registration_url: value.registrationUrl,
      source_url: value.sourceUrl, source: value.source, external_id: value.externalId,
      discovered_at: value.discoveredAt,
    };
  }

  const snapshot = { events: [row(base)], mappings: [] };
  const summary = { sourceEvents: 1, existingMappings: 0, assignedEvents: 1,
    joinedOccurrences: 0, createdOccurrences: 1 };

  test("commits the whole plan against the exact database snapshot", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: summary, error: null });
    expect(await reconcileEventOccurrences({ rpc } as never)).toEqual(summary);
    expect(rpc).toHaveBeenNthCalledWith(2, "reconcile_occurrence_plan", {
      p_snapshot: snapshot, p_assignments: [{ occurrenceId: null, eventIds: ["a"] }],
    });
  });

  test("replans after a concurrent worker maps an event; counters reflect only this commit", async () => {
    const current = { ...snapshot, mappings: [{ event_id: "a", occurrence_id: "stable" }] };
    const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PT409" } })
      .mockResolvedValueOnce({ data: current, error: null })
      .mockResolvedValueOnce({ data: { ...summary, assignedEvents: 0, createdOccurrences: 0, existingMappings: 1 }, error: null });
    expect(await reconcileEventOccurrences({ rpc } as never)).toMatchObject({ assignedEvents: 0, createdOccurrences: 0 });
    expect(rpc).toHaveBeenLastCalledWith("reconcile_occurrence_plan", { p_snapshot: current, p_assignments: [] });
  });

  test("bounds retries when the database keeps changing", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string) => name === "occurrence_reconciliation_snapshot"
      ? { data: snapshot, error: null } : { error: { code: "PT409" } });
    await expect(reconcileEventOccurrences({ rpc } as never)).rejects.toThrow("kept changing");
    expect(rpc).toHaveBeenCalledTimes(6);
  });

  test("fails closed on missing schema or assignment failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "missing function" } });
    await expect(reconcileEventOccurrences({ rpc } as never)).rejects.toThrow("snapshot failed");
    rpc.mockReset().mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ error: { code: "42501", message: "denied" } });
    await expect(reconcileEventOccurrences({ rpc } as never)).rejects.toThrow("denied");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
