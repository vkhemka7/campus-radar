import { describe, expect, test } from "vitest";
import { deduplicateEvents, duplicateEvidence } from "@/lib/event-deduplication";
import type { CampusEvent } from "@/lib/events";

const base: CampusEvent = {
  id: "a", title: "Founders Week fireside chat", company: "", description: "Full event description",
  category: "", startTime: "2026-10-01T20:00:00.000Z", endTime: "2026-10-01T21:00:00.000Z",
  timezone: "America/Chicago", location: "Beckman Institute, Auditorium (Room 1025)", registrationUrl: "",
  sourceUrl: "https://calendars.illinois.edu/detail/2654/1", source: "Illinois Webtools",
  externalId: "1@illinois.edu", discoveredAt: "2026-09-20T00:00:00.000Z",
};
const event = (overrides: Partial<CampusEvent> = {}): CampusEvent => ({ ...base, ...overrides });

describe("conservative occurrence deduplication", () => {
  test("matches the known duplicate shape using title, time, end, and compatible venue", () => {
    const duplicate = event({ id: "b", externalId: "2@illinois.edu",
      sourceUrl: "https://calendars.illinois.edu/detail/2654/2",
      location: "Beckman Institute, Auditorium (Room 1025) 405 N Mathews Ave, Urbana, IL 61801" });
    expect(duplicateEvidence(base, duplicate)).toBe("exact-occurrence");
    expect(deduplicateEvents([base, duplicate])).toEqual([expect.objectContaining({
      provenance: [base, duplicate],
    })]);
  });

  test("uses a shared canonical event URL at the exact same start", () => {
    const duplicate = event({ id: "b", externalId: "other", title: "Alternate listing title",
      sourceUrl: "https://events.example.edu/item/42?utm_source=calendar#details" });
    const original = event({ sourceUrl: "https://events.example.edu/item/42" });
    expect(duplicateEvidence(original, duplicate)).toBe("canonical-url");
  });

  test.each([
    ["different start", { startTime: "2026-10-01T20:30:00.000Z" }],
    ["different end", { endTime: "2026-10-01T22:00:00.000Z" }],
    ["different title", { title: "Founders Week investor chat" }],
    ["different location", { location: "Levis Faculty Center" }],
    ["empty location", { location: "" }],
  ] as const)("does not match text evidence with a %s", (_label, overrides) => {
    expect(duplicateEvidence(base, event({ id: "b", externalId: "2", sourceUrl: "https://example.edu/other", ...overrides }))).toBeNull();
  });

  test.each(["Information Session", "Workshop", "Coffee Chat", "Tech Talk"])(
    "never merges the generic title %s through text fields", (title) => {
      const left = event({ title, sourceUrl: "https://example.edu/one" });
      const right = event({ id: "b", externalId: "2", title, sourceUrl: "https://example.edu/two" });
      expect(duplicateEvidence(left, right)).toBeNull();
    });

  test("keeps recurring occurrences separate because their starts differ", () => {
    const november = event({ id: "b", externalId: "2", startTime: "2026-11-01T20:00:00.000Z",
      endTime: "2026-11-01T21:00:00.000Z", sourceUrl: "https://example.edu/series" });
    expect(deduplicateEvents([event({ sourceUrl: "https://example.edu/series" }), november])).toHaveLength(2);
  });

  test("does not transitively merge a row that lacks direct evidence with every group member", () => {
    const byUrl = event({ id: "b", externalId: "2", title: "Alternate", sourceUrl: base.sourceUrl });
    const byTextOnly = event({ id: "c", externalId: "3", sourceUrl: "https://example.edu/three" });
    expect(duplicateEvidence(base, byUrl)).toBe("canonical-url");
    expect(duplicateEvidence(base, byTextOnly)).toBe("exact-occurrence");
    expect(duplicateEvidence(byUrl, byTextOnly)).toBeNull();
    expect(deduplicateEvents([base, byUrl, byTextOnly])).toHaveLength(2);
  });

  test("selects the richer representative deterministically while retaining every row", () => {
    const richer = event({ id: "b", externalId: "2", sourceUrl: base.sourceUrl,
      company: "Example", registrationUrl: "https://register.example.edu/42" });
    const result = deduplicateEvents([base, richer])[0];
    expect(result.event).toBe(richer);
    expect(result.provenance).toEqual([base, richer]);
  });
});
