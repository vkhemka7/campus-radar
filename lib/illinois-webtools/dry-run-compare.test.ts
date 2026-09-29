import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { HtmlCandidate, HtmlDiscovery } from "@/lib/illinois-webtools/discover-html";
import { compareWebtoolsHtmlDryRun, type StoredWebtoolsRow } from "@/lib/illinois-webtools/dry-run-compare";
import { webtoolsCollectionWindow, webtoolsDiscoverySpans } from "@/lib/illinois-webtools/html-window";
import { discoverWebtoolsHtml } from "@/lib/illinois-webtools/discover-html";
import { webtoolsDetailFetchUrl, webtoolsListUrl, type WebtoolsHtmlFetcher } from "@/lib/illinois-webtools/html-fetch";

const window = webtoolsCollectionWindow(new Date("2026-09-28T15:00:00.000Z"));

function row(overrides: Partial<StoredWebtoolsRow> & Pick<StoredWebtoolsRow, "id" | "externalId">): StoredWebtoolsRow {
  return {
    title: "Career Fair",
    company: "",
    description: "Meet employers.",
    category: "Career Fair",
    startTime: "2026-09-28T23:30:00.000Z",
    endTime: "2026-09-28T23:30:00.000Z",
    timezone: "America/Chicago",
    location: "Siebel 1214",
    registrationUrl: "",
    sourceUrl: `https://calendars.illinois.edu/detail/2654/${overrides.externalId.split("@")[0]}`,
    ...overrides,
  };
}

function candidate(overrides: Partial<HtmlCandidate> & Pick<HtmlCandidate, "eventId">): HtmlCandidate {
  return {
    externalId: `${overrides.eventId}@illinois.edu`,
    title: "Career Fair",
    company: "",
    description: "Meet employers. Bring a resume.",
    category: "Career Fair",
    startTime: "2026-09-28T23:30:00.000Z",
    endTime: "2026-09-28T23:30:00.000Z",
    timezone: "America/Chicago",
    location: "Siebel 1214",
    registrationUrl: "https://forms.illinois.edu/sec/1",
    sourceUrl: `https://calendars.illinois.edu/detail/2654/${overrides.eventId}`,
    dateText: "Sep 28, 2026 6:30 pm",
    emptyDate: false,
    recurring: false,
    listDays: ["2026-09-28"],
    displayedTimes: ["6:30 pm"],
    listTitles: ["Career Fair"],
    discoveryCalendarIds: ["2654"],
    originatingCalendarId: "2654",
    allDay: false,
    ...overrides,
  };
}

function discovery(candidates: HtmlCandidate[], extras?: Partial<HtmlDiscovery>): HtmlDiscovery {
  return {
    window,
    calendars: [{ id: "2654", label: "Siebel", ok: true, listRows: candidates.length, uniqueEventIds: candidates.length, capHits: 0 }],
    listWindows: [],
    candidates,
    uniqueEventIds: candidates.length,
    detailAttempts: candidates.length,
    detailSuccesses: candidates.length,
    detailFailures: [],
    ...extras,
  };
}

describe("Webtools HTML dry-run comparison", () => {
  test("treats richer description and a new registration URL as a match", () => {
    const report = compareWebtoolsHtmlDryRun({
      discovery: discovery([
        candidate({ eventId: "33563355" }),
        candidate({
          eventId: "33560001",
          title: "Picnic",
          description: "An industry technical talk.",
          category: "Other",
          registrationUrl: "",
          listTitles: ["Picnic"],
        }),
      ]),
      rows: [
        row({ id: "stored-1", externalId: "33563355@illinois.edu" }),
        row({
          id: "stored-2",
          externalId: "33560001@illinois.edu",
          title: "Picnic",
          description: "",
          category: "Other",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/33560001",
        }),
        row({
          id: "history",
          externalId: "100@illinois.edu",
          title: "Old fair",
          startTime: "2026-03-01T18:00:00.000Z",
          endTime: "2026-03-01T19:00:00.000Z",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/100",
        }),
      ],
    });

    expect(report.identity).toMatchObject({ matched: 2, htmlOnly: 0, conflicts: 0, storedOnlyInWindow: 0 });
    expect(report.fieldDifferences.description.richer).toBe(2);
    expect(report.fieldDifferences.registration_url.gained).toBe(1);
    expect(report.registration.wouldGain).toBe(1);
    expect(report.registration.hosts).toEqual([{ host: "forms.illinois.edu", count: 1 }]);
    expect(report.classification.transitions["relevant -> relevant"]).toBe(1);
    expect(report.classification.transitions["uncertain -> relevant"]).toBe(1);
    expect(report.gate.decision).toBe("READY_FOR_CUTOVER");
  });

  test("blocks identity conflicts and keeps out-of-window rows out of the missing set", () => {
    const report = compareWebtoolsHtmlDryRun({
      discovery: discovery([candidate({ eventId: "33563355" })]),
      rows: [
        row({
          id: "conflict",
          externalId: "33563355@illinois.edu",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/99999999",
        }),
        row({
          id: "missing",
          externalId: "200@illinois.edu",
          title: "Missing workshop",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/200",
        }),
        row({
          id: "history",
          externalId: "100@illinois.edu",
          startTime: "2026-01-15T18:00:00.000Z",
          endTime: "2026-01-15T19:00:00.000Z",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/100",
        }),
        row({
          id: "series",
          externalId: "300@illinois.edu::20260928T173000",
          title: "Series instance",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/300",
        }),
      ],
    });

    expect(report.identity.conflicts).toBe(1);
    expect(report.identity.htmlOnly).toBe(0);
    expect(report.identity.storedOnlyInWindow).toBe(2);
    expect(report.storedOnly.map((item) => item.reason)).toEqual([
      "not discovered in the HTML window",
      "recurrence-qualified external id left unchanged",
    ]);
    expect(report.gate.decision).toBe("BLOCKED");
    expect(report.gate.blockers.join(" ")).toMatch(/identity conflict/i);
  });

  test("does not treat a completed calendar of 100 events as truncated", () => {
    const events = Array.from({ length: 100 }, (_, index) => candidate({ eventId: String(33500000 + index) }));
    const report = compareWebtoolsHtmlDryRun({
      discovery: discovery(events),
      rows: events.map((event, index) => row({ id: `row-${index}`, externalId: event.externalId, sourceUrl: event.sourceUrl })),
    });
    expect(report.identity.matched).toBe(100);
    expect(report.gate.decision).toBe("READY_FOR_CUTOVER");
  });

  test("blocks when a single-day list still hits the 100-row cap", () => {
    const report = compareWebtoolsHtmlDryRun({
      discovery: discovery([], {
        calendars: [
          {
            id: "2654",
            label: "Siebel",
            ok: false,
            listRows: 0,
            uniqueEventIds: 0,
            capHits: 1,
            error: "summary list returned 100 rows on 2026-09-28; a single day can still be truncated",
          },
        ],
        listWindows: [
          {
            calendarId: "2654",
            startDate: "2026-09-28",
            endDate: "2026-09-28",
            listRows: 100,
            action: "failed-closed",
          },
        ],
      }),
      rows: [],
    });
    expect(report.gate.decision).toBe("BLOCKED");
    expect(report.gate.blockers.join(" ")).toMatch(/100 rows/);
  });

  test("retains dry-run coverage blocking while production can explicitly allow stored-only rows", () => {
    const input = {
      discovery: discovery([candidate({ eventId: "1" })]),
      rows: Array.from({ length: 20 }, (_, index) => row({ id: `row-${index}`, externalId: `${index + 1}@illinois.edu` })),
    };
    expect(compareWebtoolsHtmlDryRun(input).gate).toEqual({ decision: "BLOCKED",
      blockers: ["19 stored events in the window were not in HTML"] });
    const production = compareWebtoolsHtmlDryRun({ ...input, checkStoredCoverage: false });
    expect(production.gate.decision).toBe("READY_FOR_CUTOVER");
    expect(production.identity.storedOnlyInWindow).toBe(19);
    expect(compareWebtoolsHtmlDryRun({ ...input, checkStoredCoverage: false,
      rows: [row({ id: "conflict", externalId: "1@illinois.edu", sourceUrl: "https://calendars.illinois.edu/detail/2654/999" })],
    }).gate.decision).toBe("BLOCKED");
  });

  test("does not import a database client or perform fetches", () => {
    const source = readFileSync("lib/illinois-webtools/dry-run-compare.ts", "utf8");
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

describe("HTML discovery", () => {
  test("dedupes an id across calendars and requests only list and detail URLs", async () => {
    const list = (calendarId: string, eventId: string) => `
      <div id="ws-calendar-content">
        <h2>Monday, September 28, 2026</h2>
        <ul class="event-entries">
          <li class="entry recurring-event">
            <h3><a href="/detail/${calendarId}?eventId=${eventId}">Capital One Workshop</a></h3>
            <div class="entry-time"><dd>6:30 pm</dd></div>
          </li>
        </ul>
      </div>`;
    const detail = `
      <meta content="https://calendars.illinois.edu/detail/1002/33563355" property="og:url">
      <h1>Capital One Workshop</h1>
      <div class="date">Sep 28, 2026 6:30 pm</div>
      <dl>
        <dt>Originating Calendar</dt>
        <dd><a href="/list/1002">Siebel Corporate</a></dd>
        <dt>Registration</dt>
        <dd><a href="https://forms.illinois.edu/sec/9">Apply Now</a></dd>
      </dl>`;
    const urls: string[] = [];
    const fetcher: WebtoolsHtmlFetcher = {
      async fetchHtml(url: string) {
        urls.push(url);
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/list/")) {
          const calendarId = parsed.pathname.split("/")[2] ?? "";
          return { ok: true, url, status: 200, html: list(calendarId, "33563355") };
        }
        return { ok: true, url, status: 200, html: detail };
      },
    };
    const found = await discoverWebtoolsHtml({
      calendars: [
        { id: "2654", label: "Siebel" },
        { id: "1551", label: "HireIllini" },
      ],
      fetcher,
      now: new Date("2026-09-28T15:00:00.000Z"),
    });

    const spans = webtoolsDiscoverySpans(window);
    expect(urls).toEqual([
      ...spans.map((span) => webtoolsListUrl("2654", span.startQuery, span.endQuery)),
      ...spans.map((span) => webtoolsListUrl("1551", span.startQuery, span.endQuery)),
      webtoolsDetailFetchUrl("2654", "33563355"),
    ]);
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]).toMatchObject({
      externalId: "33563355@illinois.edu",
      registrationUrl: "https://forms.illinois.edu/sec/9",
      discoveryCalendarIds: ["2654", "1551"],
      originatingCalendarId: "1002",
      sourceUrl: "https://calendars.illinois.edu/detail/1002/33563355",
      recurring: true,
    });
    expect(found.detailAttempts).toBe(1);
    expect(urls.join(" ")).not.toMatch(/ical|export|outlook|eventXML|userRole/i);
  });
});
