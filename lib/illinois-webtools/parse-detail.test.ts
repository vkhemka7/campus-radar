import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ILLINOIS_WEBTOOLS_SOURCE } from "@/lib/illinois-webtools/constants";
import { resolveWebtoolsSchedule } from "@/lib/illinois-webtools/html-schedule";
import { normalizeHtmlWebtoolsEvent } from "@/lib/illinois-webtools/normalize";
import { parseWebtoolsDetailHtml } from "@/lib/illinois-webtools/parse-detail";
import { parseWebtoolsListHtml } from "@/lib/illinois-webtools/parse-list";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "collectors/illinois-webtools/fixtures/html", name), "utf8");
}

describe("Webtools detail HTML", () => {
  test("parses a timed detail page", () => {
    const result = parseWebtoolsDetailHtml(fixture("detail-timed.html"), "33560597");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.event).toMatchObject({
      eventId: "33560597",
      title: "Peer Mentoring Center",
      dateText: "Sep 28, 2026 5:30 - 7:00 pm",
      location: "Siebel 1214",
      category: "Other",
      description: "Drop-in mentoring.",
      sponsor: "",
      speaker: "",
      registrationUrl: "",
      originatingCalendarId: null,
    });
  });

  test("parses sponsor, speaker, registration, and originating calendar without copying sponsor into company", () => {
    const result = parseWebtoolsDetailHtml(fixture("detail-sponsor-speaker-registration.html"), "33559024");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.event).toMatchObject({
      eventId: "33559024",
      title: "L3Harris Technologies Information Session",
      location: "Campus Instructional Facility",
      category: "Informational",
      description: "Hiring for internships.",
      sponsor: "Department of Aerospace Engineering",
      speaker: "Jonathan Homesley",
      registrationUrl: "https://forms.illinois.edu/sec/1462200831",
      contact: "Courtney McLearin",
      email: "cmcleari@illinois.edu",
      cost: "Free for students",
      originatingCalendarId: "7541",
    });
    expect(result.event.registrationUrl).not.toMatch(/export|userRole|eventXML|outlook|\/ical/i);

    const schedule = resolveWebtoolsSchedule({
      dateText: result.event.dateText,
      listDays: [],
    });
    const normalized = schedule
      ? normalizeHtmlWebtoolsEvent({
          eventId: result.event.eventId,
          title: result.event.title,
          description: result.event.description,
          category: result.event.category,
          location: result.event.location,
          registrationUrl: result.event.registrationUrl,
          originatingCalendarId: result.event.originatingCalendarId,
          listCalendarId: "2654",
          start: schedule.start,
          end: schedule.end,
        })
      : null;

    expect(normalized).toMatchObject({
      external_id: "33559024@illinois.edu",
      company: "",
      registration_url: "https://forms.illinois.edu/sec/1462200831",
      source_url: "https://calendars.illinois.edu/detail/7541/33559024",
      source: ILLINOIS_WEBTOOLS_SOURCE,
      timezone: "America/Chicago",
    });
    expect(normalized).not.toHaveProperty("sponsor");
  });

  test("keeps an event valid when optional metadata is missing and does not treat Apply Now as a URL", () => {
    const result = parseWebtoolsDetailHtml(fixture("detail-missing-optional.html"), "33560001");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.event).toMatchObject({
      title: "Office Hours",
      dateText: "Sep 28, 2026 6:30 pm",
      location: "",
      category: "",
      description: "",
      sponsor: "",
      speaker: "",
      registrationUrl: "",
      contact: "",
      email: "",
      cost: "",
      originatingCalendarId: null,
    });
  });

  test("uses a Join online http URL only when registration has no URL", () => {
    const result = parseWebtoolsDetailHtml(
      `
        <meta content="https://calendars.illinois.edu/detail/1551/33546590" property="og:url">
        <h1>Virtual Job Fair</h1>
        <div class="date">Sep 23, 2026 12:00 - 4:00 pm</div>
        <div class="location-new"><span><a href="https://illinois.joinhandshake.com/edu/career_fairs/64265">Join online</a></span></div>
        <dl><dt>Registration</dt><dd>Apply Now</dd></dl>
      `,
      "33546590",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.registrationUrl).toBe("https://illinois.joinhandshake.com/edu/career_fairs/64265");
    expect(result.event.registrationUrl).not.toBe("Apply Now");
    expect(result.event.registrationUrl).not.toBe("Join online");
  });

  test("fails when the detail page has no h1", () => {
    expect(parseWebtoolsDetailHtml(fixture("detail-malformed.html"), "33563355")).toEqual({
      ok: false,
      reason: "missing-title",
    });
  });

  test("fails when the page id does not match the requested event id", () => {
    expect(parseWebtoolsDetailHtml(fixture("detail-id-mismatch.html"), "33563355")).toEqual({
      ok: false,
      reason: "id-mismatch",
    });
    expect(
      parseWebtoolsDetailHtml("<h1>Untitled</h1><p>No Webtools id on this page.</p>", "33563355"),
    ).toEqual({ ok: false, reason: "missing-event-id" });
  });

  test("does not take a schedule from description prose when the detail date is empty", () => {
    const detail = parseWebtoolsDetailHtml(fixture("detail-empty-date.html"), "33559211");
    const list = parseWebtoolsListHtml(fixture("list-repeated-days.html"));
    expect(detail.ok).toBe(true);
    expect(list.ok).toBe(true);
    if (!detail.ok || !list.ok || list.empty) {
      return;
    }

    expect(detail.event.dateText).toBe("");
    expect(detail.event.description).toContain("October 4, 2026");
    const schedule = resolveWebtoolsSchedule({
      dateText: detail.event.dateText,
      listDays: list.events[0]?.appearances.map((appearance) => appearance.day) ?? [],
      displayedTime: list.events[0]?.appearances[0]?.displayedTime,
    });
    expect(schedule?.allDay).toBe(true);
    expect(schedule?.start.toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });
});
