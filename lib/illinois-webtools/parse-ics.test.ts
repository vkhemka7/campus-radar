import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ILLINOIS_WEBTOOLS_SOURCE } from "@/lib/illinois-webtools/constants";
import { normalizeIllinoisWebtoolsEvents } from "@/lib/illinois-webtools/normalize";
import { parseIcsEvents } from "@/lib/illinois-webtools/parse-ics";
import { parseIcsDateTime } from "@/lib/illinois-webtools/time";

const fixturePath = path.join(
  process.cwd(),
  "collectors/illinois-webtools/fixtures/siebel-master-sample.ics",
);

describe("parseIcsDateTime", () => {
  test("interprets Central Daylight Time as UTC-5", () => {
    const date = parseIcsDateTime("20260923T180000", "America/Chicago");
    expect(date?.toISOString()).toBe("2026-09-23T23:00:00.000Z");
  });

  test("interprets Central Standard Time as UTC-6", () => {
    const date = parseIcsDateTime("20260115T180000", "America/Chicago");
    expect(date?.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  test("keeps explicit UTC timestamps in UTC", () => {
    const date = parseIcsDateTime("20260923T230000Z", "America/Chicago");
    expect(date?.toISOString()).toBe("2026-09-23T23:00:00.000Z");
  });
});

describe("Illinois Webtools ICS fixture", () => {
  const ics = readFileSync(fixturePath, "utf8");
  const parsed = parseIcsEvents(ics);
  const normalized = normalizeIllinoisWebtoolsEvents(parsed);

  test("parses each VEVENT including folded lines", () => {
    expect(parsed).toHaveLength(3);
    expect(parsed.map((event) => event.uid)).toEqual([
      "33563354@illinois.edu",
      "33560593@illinois.edu",
      "33561103@illinois.edu",
    ]);
  });

  test("reads TZID from a standalone property", () => {
    expect(parsed[0]?.tzid).toBe("America/Chicago");
  });

  test("reads TZID from a DTSTART parameter", () => {
    expect(parsed[2]?.tzid).toBe("America/Chicago");
  });

  test("unescapes description text and joins folded lines", () => {
    expect(parsed[2]?.description).toBe(
      "A mock folded description with a comma, semicolon; and slash.",
    );
  });

  test("maps Google Interview Prep with missing fields left empty", () => {
    const google = normalized.find(
      (event) => event.external_id === "33563354@illinois.edu",
    );

    expect(google).toMatchObject({
      source: ILLINOIS_WEBTOOLS_SOURCE,
      title: "Google Interview Prep Workshop",
      company: "",
      description: "",
      category: "Conference/Workshop",
      location: "1404 Siebel Center for Computer Science",
      registration_url: "",
      source_url: "https://calendars.illinois.edu/detail/2654/33563354",
      timezone: "America/Chicago",
      start_time: "2026-09-23T23:00:00.000Z",
      end_time: "2026-09-23T23:00:00.000Z",
    });
  });

  test("keeps a real end time when DTEND differs from DTSTART", () => {
    const mentoring = normalized.find(
      (event) => event.external_id === "33560593@illinois.edu",
    );

    expect(mentoring?.start_time).toBe("2026-09-21T22:00:00.000Z");
    expect(mentoring?.end_time).toBe("2026-09-22T01:00:00.000Z");
  });

  test("strips query parameters from source_url", () => {
    const mentoring = normalized.find(
      (event) => event.external_id === "33560593@illinois.edu",
    );

    expect(mentoring?.source_url).toBe(
      "https://calendars.illinois.edu/detail/2654/33560593",
    );
  });
});

test("keeps RECURRENCE-ID occurrences distinct without changing ordinary UIDs", () => {
  const parsed = parseIcsEvents(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:series@example.edu\nRECURRENCE-ID:20261001T170000\nSUMMARY:Monthly workshop\nDTSTART:20261001T170000\nDTEND:20261001T180000\nEND:VEVENT\nBEGIN:VEVENT\nUID:series@example.edu\nRECURRENCE-ID:20261101T170000\nSUMMARY:Monthly workshop\nDTSTART:20261101T170000\nDTEND:20261101T180000\nEND:VEVENT\nEND:VCALENDAR\n`);
  expect(parsed.map(({ recurrenceId }) => recurrenceId)).toEqual(["20261001T170000", "20261101T170000"]);
  expect(normalizeIllinoisWebtoolsEvents(parsed).map(({ external_id }) => external_id)).toEqual([
    "series@example.edu::20261001T170000", "series@example.edu::20261101T170000",
  ]);
});

describe("HireIllini live-feed snapshot (2026-09-22)", () => {
  const ics = readFileSync(path.join(process.cwd(), "collectors/illinois-webtools/fixtures/hireillini-sample.ics"), "utf8");
  const parsed = parseIcsEvents(ics);
  const normalized = normalizeIllinoisWebtoolsEvents(parsed, "1551");

  test("handles all five VEVENTs without losing or duplicating any", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
    expect(parsed).toHaveLength(5);
    expect(normalized).toHaveLength(5);
    expect(new Set(normalized.map((event) => event.external_id)).size).toBe(5);
    expect(normalized.map((event) => event.title)).toEqual([
      "Illinois Gies College of Business Fall 2026 Virtual Job Fair",
      "ACES + LAS 2026 Career Fair",
      "The Grainger Engineering Fall 2026 Career Fair (VIRTUAL)",
      "2027 Research Park Career Fair",
      "Hire Illini Career and Internship Fair 2027",
    ]);
  });
  test("preserves empty descriptions and company, category Other, and URL locations", () => {
    for (const event of normalized) {
      expect(event).toMatchObject({ description: "", company: "", category: "Other", registration_url: "", timezone: "America/Chicago", source: ILLINOIS_WEBTOOLS_SOURCE });
      expect(event.source_url).toBe(`https://calendars.illinois.edu/detail/1551/${event.external_id.split("@")[0]}`);
    }
    expect(normalized[0].location).toBe("https://illinois.joinhandshake.com/edu/career_fairs/64265");
    expect(normalized[1].location).toBe("111 Saint Mary's Road, Champaign, Illinois 61820, United States");
  });
  test("converts daylight and standard time and does not invent a virtual fair end", () => {
    expect(normalized[0]).toMatchObject({ start_time: "2026-09-23T17:00:00.000Z", end_time: "2026-09-23T21:00:00.000Z" });
    expect(normalized[3]).toMatchObject({ start_time: "2027-02-16T21:00:00.000Z", end_time: "2027-02-17T01:00:00.000Z" });
    expect(normalized[2]).toMatchObject({ start_time: "2026-10-07T16:00:00.000Z", end_time: "2026-10-07T16:00:00.000Z", location: "" });
  });
});

// Unmodified public ICS snapshots captured 2026-09-22 for Milestone 3D.2.
describe("additional Webtools feed snapshots", () => {
  const snapshots = [
    ["5115", "research-park", 16],
    ["6499", "las-career-services", 8],
    ["6805", "ece-student-events", 2],
  ] as const;
  const events = snapshots.flatMap(([id, name]) => normalizeIllinoisWebtoolsEvents(
    parseIcsEvents(readFileSync(`collectors/illinois-webtools/fixtures/${name}-sample.ics`, "utf8")), id,
  ));
  const byId = (id: string) => events.find(({ external_id }) => external_id === `${id}@illinois.edu`)!;

  test.each(snapshots)("calendar %s preserves every VEVENT and canonical source URL", (id, name, count) => {
    const raw = readFileSync(`collectors/illinois-webtools/fixtures/${name}-sample.ics`, "utf8");
    const parsed = parseIcsEvents(raw);
    const normalized = normalizeIllinoisWebtoolsEvents(parsed, id);
    expect(raw.match(/BEGIN:VEVENT/g)).toHaveLength(count);
    expect(parsed).toHaveLength(count);
    expect(normalized).toHaveLength(count);
    expect(new Set(normalized.map(({ external_id }) => external_id)).size).toBe(count);
    for (const event of normalized) {
      expect(event).toMatchObject({ source: "Illinois Webtools", timezone: "America/Chicago", company: "", registration_url: "" });
      expect(event.source_url).toBe(`https://calendars.illinois.edu/detail/${id}/${event.external_id.split("@")[0]}`);
      expect(Date.parse(event.end_time)).toBeGreaterThanOrEqual(Date.parse(event.start_time));
    }
  });

  test("keeps URL locations, registration prose and eligibility without inventing fields", () => {
    expect(byId("33561685").location).toBe("https://forms.illinois.edu/sec/699547774");
    expect(byId("33519110").description).toContain("https://forms.illinois.edu/sec/836574257");
    expect(byId("33523823").description).toContain("invite-only");
    expect(byId("33557470").description).toContain("appointment only");
    expect(byId("33555587").description).toContain("internship opportunitiesDiscover");
  });

  test("preserves sparse Apple data and real ECE end times", () => {
    expect(byId("33563482")).toMatchObject({ title: "Tech Talk: Apple", description: "", category: "Informational",
      location: "ECEB 1013 & 1015", start_time: "2026-09-24T22:30:00.000Z", end_time: "2026-09-24T23:30:00.000Z" });
    expect(byId("33563719")).toMatchObject({ start_time: "2026-09-28T22:30:00.000Z", end_time: "2026-09-29T00:00:00.000Z" });
  });

  test("converts Research Park daylight and standard time and retains LAS unknown duration", () => {
    expect(byId("33537800")).toMatchObject({ start_time: "2026-10-02T14:00:00.000Z", end_time: "2026-10-02T15:00:00.000Z" });
    expect(byId("33537921")).toMatchObject({ start_time: "2026-11-06T15:00:00.000Z", end_time: "2026-11-06T16:00:00.000Z" });
    expect(byId("33553540")).toMatchObject({ location: "", start_time: "2027-02-24T19:00:00.000Z", end_time: "2027-02-24T19:00:00.000Z" });
  });
});
