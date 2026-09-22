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
