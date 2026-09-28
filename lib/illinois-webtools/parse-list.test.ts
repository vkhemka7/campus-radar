import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { htmlEventIdToExternalId } from "@/lib/illinois-webtools/identity";
import { parseWebtoolsListHtml } from "@/lib/illinois-webtools/parse-list";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "collectors/illinois-webtools/fixtures/html", name), "utf8");
}

describe("Webtools list HTML", () => {
  test("reads the event id from the query string, including a normal timed row", () => {
    const result = parseWebtoolsListHtml(fixture("list-timed.html"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.empty) {
      return;
    }

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventId: "33563355",
      title: "Capital One Workshop",
      listCalendarId: "2654",
      recurring: false,
      earliestDay: "2026-09-28",
      latestDay: "2026-09-28",
    });
    const appearance = result.events[0]?.appearances[0];
    expect(appearance).toMatchObject({
      eventId: "33563355",
      listCalendarId: "2654",
      day: "2026-09-28",
      displayedTime: "5:30 - 7:00 pm",
      recurring: false,
    });
    const detailUrl = new URL(appearance?.detailUrl ?? "");
    expect(detailUrl.pathname).toBe("/detail/2654");
    expect(detailUrl.searchParams.get("eventId")).toBe("33563355");
    expect(appearance?.detailUrl).not.toMatch(/\/(export|ical|outlook|userRole|eventXML)(\/|$)/i);
  });

  test("keeps extra query parameters and still reads eventId", () => {
    const result = parseWebtoolsListHtml(fixture("list-extra-query.html"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.empty) {
      return;
    }

    const appearance = result.events[0]?.appearances[0];
    const detailUrl = new URL(appearance?.detailUrl ?? "");
    expect(detailUrl.searchParams.get("eventId")).toBe("33523822");
    expect(detailUrl.searchParams.get("listType")).toBe("summary");
    expect(detailUrl.searchParams.get("startDate")).toBe("08/15/2026");
    expect(result.events.map((event) => event.eventId)).toEqual(["33523822"]);
  });

  test("groups repeated appearances of the same event id and keeps the day span", () => {
    const result = parseWebtoolsListHtml(fixture("list-repeated-days.html"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.empty) {
      return;
    }

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventId: "33559211",
      title: "Cozad Registration Begins",
      earliestDay: "2026-09-30",
      latestDay: "2026-10-01",
    });
    expect(result.events[0]?.appearances.map((appearance) => appearance.day)).toEqual([
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  test("keeps different event ids separate when the titles match", () => {
    const result = parseWebtoolsListHtml(fixture("list-recurring-distinct-ids.html"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.empty) {
      return;
    }

    expect(result.events.map((event) => event.eventId)).toEqual(["33563735", "33563736"]);
    expect(result.events.map((event) => event.title)).toEqual([
      "Silicon Valley Entrepreneurship Workshop",
      "Silicon Valley Entrepreneurship Workshop",
    ]);
    expect(result.events.every((event) => event.recurring)).toBe(true);
    expect(result.events.map((event) => htmlEventIdToExternalId(event.eventId))).toEqual([
      "33563735@illinois.edu",
      "33563736@illinois.edu",
    ]);
  });

  test("groups one event id that shows up in more than one list context", () => {
    const result = parseWebtoolsListHtml(fixture("list-duplicate-id.html"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.empty) {
      return;
    }

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventId: "33563355",
      earliestDay: "2026-09-28",
      latestDay: "2026-09-29",
    });
    expect(result.events[0]?.appearances.map((appearance) => appearance.listCalendarId)).toEqual([
      "2654",
      "2654",
      "1002",
    ]);
  });

  test("rejects pagination instead of returning a partial list", () => {
    const result = parseWebtoolsListHtml(fixture("list-pagination.html"));
    expect(result).toEqual({ ok: false, reason: "pagination" });
  });

  test("accepts a recognizable empty list", () => {
    expect(parseWebtoolsListHtml(fixture("list-empty.html"))).toEqual({
      ok: true,
      empty: true,
      events: [],
    });
  });

  test("fails closed on a list that does not expose eventId as a query parameter", () => {
    expect(parseWebtoolsListHtml(fixture("list-malformed.html"))).toEqual({
      ok: false,
      reason: "malformed-list",
    });
  });

  test("does not treat broken markup or a month control as an empty calendar", () => {
    expect(parseWebtoolsListHtml("<div>not a calendar</div>")).toEqual({
      ok: false,
      reason: "unrecognized-list",
    });
    expect(parseWebtoolsListHtml('<div id="ws-calendar-content"><p>Calendar</p></div>')).toEqual({
      ok: false,
      reason: "malformed-list",
    });
    expect(parseWebtoolsListHtml('<div id="ws-calendar-content"><p>More events coming soon!</p></div>')).toEqual({
      ok: true,
      empty: true,
      events: [],
    });
    expect(
      parseWebtoolsListHtml(`
        <div id="ws-calendar-content">
          <p>More events coming soon!</p>
          <h2>Monday, September 28, 2026</h2>
          <ul><li class="entry"><h3><a href="/detail/2654?eventId=33563355">Workshop</a></h3><div class="entry-time"><dd>6:30 pm</dd></div></li></ul>
        </div>
      `),
    ).toEqual({ ok: false, reason: "malformed-list" });
    expect(
      parseWebtoolsListHtml(`
        <div id="ws-calendar-content">
          <div id="no-events">There are no events for this criteria</div>
          <h2>Monday, September 28, 2026</h2>
          <ul><li class="entry"><h3><a href="/detail/2654?eventId=33563355">Workshop</a></h3></li></ul>
        </div>
      `),
    ).toEqual({ ok: false, reason: "malformed-list" });
  });
});
