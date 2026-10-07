import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EventCard } from "./event-card";
import { planFeedback } from "./occurrence-state-controls";
import type { BrowsingEvent } from "@/lib/get-events";

vi.stubGlobal("React", React);
vi.mock("@/app/occurrence-state-actions", () => ({
  saveOccurrenceState: vi.fn(),
}));
const event = {
  id: "source-id",
  title:
    "A very long workshop title about building a career in distributed systems and finding your first research opportunity",
  company: "Illinois",
  category: "Workshop",
  description: "A detailed description. ".repeat(60),
  startTime: "2026-10-08T22:00:00Z",
  endTime: "2026-10-08T22:00:00Z",
  timezone: "America/Chicago",
  location: "Siebel Center",
  registrationUrl: "https://example.test/register",
  sourceUrl: "https://example.test/event",
  source: "Illinois Webtools",
  externalId: "source-id",
  discoveredAt: "2026-10-07T12:00:00Z",
};
const occurrence: BrowsingEvent = {
  occurrenceId: "11111111-1111-4111-8111-111111111111",
  event,
  provenance: [
    event,
    {
      ...event,
      id: "source-two",
      externalId: "two",
      sourceUrl: "https://example.test/second",
    },
  ],
  relevance: { classification: "relevant", reasons: [] },
};

describe("event presentation", () => {
  test("preserves both sources, registration and unknown-duration calendar explanation", () => {
    const html = renderToStaticMarkup(
      <EventCard occurrence={occurrence} saved={{ kind: "anonymous" }} />,
    );
    expect(html).toContain("2 listings");
    expect(html).not.toContain("listings<span");
    expect(html).toContain("<h3>");
    expect(html).toContain('class="description-preview" aria-hidden="true"');
    expect(html).toContain("About this event");
    expect(html).toContain("5:00 PM CDT");
    expect(html).toContain('href="https://example.test/second"');
    expect(html).toContain('href="https://example.test/register"');
    expect(html).toContain("Calendar links allow one hour");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('name="occurrence_id"');
    expect(html).toContain("20261008T220000Z%2F20261008T230000Z");
  });
  test.each(["interested", "going", "not_interested"] as const)(
    "renders %s with accessible selection and an explicit clear request",
    (status) => {
      const html = renderToStaticMarkup(
        <EventCard
          occurrence={occurrence}
          saved={{
            kind: "loaded",
            states: new Map([[occurrence.occurrenceId, status]]),
          }}
        />,
      );
      expect(html).toContain(
        `name="occurrence_id" value="${occurrence.occurrenceId}"`,
      );
      expect(html).toContain('value="unset" aria-pressed="true"');
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    },
  );
  test("shows a same-day time range without repeating the date marker", () => {
    const html = renderToStaticMarkup(
      <EventCard
        occurrence={{
          ...occurrence,
          event: { ...event, endTime: "2026-10-09T00:30:00Z" },
          provenance: [
            { ...event, endTime: "2026-10-09T00:30:00Z" },
            occurrence.provenance[1],
          ],
        }}
        saved={{ kind: "anonymous" }}
      />,
    );
    expect(html).toContain("5:00–7:30 PM CDT");
    expect(html).toContain("Ends Thu, Oct 8, 2026, 7:30 PM CDT");
  });
  test("save feedback stays visible after a successful plan change", () => {
    expect(planFeedback(true, undefined)).toEqual({
      className: "save-feedback",
      message: "Saving your plan…",
    });
    expect(planFeedback(false, "success").className).toBe(
      "save-feedback is-saved",
    );
    expect(planFeedback(false, undefined).className).toBe("sr-only");
  });
  test("unavailable states never offer a save action", () => {
    const html = renderToStaticMarkup(
      <EventCard occurrence={occurrence} saved={{ kind: "unavailable" }} />,
    );
    expect(html).toContain("Saving is temporarily unavailable");
    expect(html).not.toContain('name="status"');
  });
});
