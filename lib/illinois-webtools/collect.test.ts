import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { collectWebtools } from "./collect";
import { WEBTOOLS_CALENDARS } from "./constants";
import type { NormalizedIllinoisEvent } from "./normalize";

const fixture = readFileSync("collectors/illinois-webtools/fixtures/hireillini-sample.ics", "utf8");
// Keep existing two-feed unit scenarios independent of the default inventory.
const originalCalendars = WEBTOOLS_CALENDARS.filter(({ id }) => ["2654", "1551"].includes(id));
const addedFixtures = ["research-park", "las-career-services", "ece-student-events"]
  .map((name) => readFileSync(`collectors/illinois-webtools/fixtures/${name}-sample.ics`, "utf8"));
function fiveFeeds() {
  for (const raw of [calendar(event({ UID: "siebel@illinois.edu" })), fixture, ...addedFixtures]) {
    fetchFeed.mockResolvedValueOnce(new Response(raw));
  }
}
const fetchFeed = vi.fn<typeof fetch>();
const databaseFetch = vi.fn<typeof fetch>();
const supabase = createClient("https://example.supabase.co", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: databaseFetch },
});
const calendar = (events: string) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events}END:VCALENDAR\n`;
function event(overrides: Record<string, string> = {}) {
  const properties = {
    UID: "shared@illinois.edu", SUMMARY: "Tech Talk", DTSTART: "20260924T173000", DTEND: "20260924T173000",
    TZID: "America/Chicago", DESCRIPTION: "", LOCATION: "", CATEGORIES: "Other", ...overrides,
  };
  return `BEGIN:VEVENT\n${Object.entries(properties).map(([key, value]) => `${key}:${value}`).join("\n")}\nEND:VEVENT\n`;
}
function feeds(first = calendar(event()), second = calendar(event())) {
  fetchFeed.mockResolvedValueOnce(new Response(first)).mockResolvedValueOnce(new Response(second));
}
function writes(): NormalizedIllinoisEvent[] {
  const call = databaseFetch.mock.calls.find(([, options]) => options?.method === "POST");
  return call ? JSON.parse(String(call[1]?.body)) : [];
}
function existing(overrides: Partial<NormalizedIllinoisEvent> = {}): NormalizedIllinoisEvent {
  return {
    source: "Illinois Webtools", external_id: "shared@illinois.edu", title: "Old Title",
    company: "Example Company", description: "Rich stored description", category: "Informational",
    location: "Stored room", registration_url: "https://example.com/register", source_url: "https://calendars.illinois.edu/detail/2654/shared",
    start_time: "2026-09-24T22:30:00+00:00", end_time: "2026-09-24T23:30:00+00:00", timezone: "America/Chicago", ...overrides,
  };
}
const run = (calendars: typeof WEBTOOLS_CALENDARS = originalCalendars) => collectWebtools({ supabase, fetchFeed, calendars });

beforeEach(() => {
  fetchFeed.mockReset();
  databaseFetch.mockReset();
  // Any accidental unmocked network request fails the test immediately.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in collector tests"); }));
  databaseFetch.mockImplementation(async (_url, options) => options?.method === "POST"
    ? new Response(null, { status: 201 }) : new Response("[]"));
});
afterEach(() => vi.unstubAllGlobals());

describe("shared multi-calendar collection", () => {
  test("collects exactly the configured feeds and keeps their shared source identity", async () => {
    fiveFeeds();
    const result = await collectWebtools({ supabase, fetchFeed });
    expect(result).toMatchObject({ ok: true, upserted: 32, overlaps: [] });
    expect(result.calendars.map(({ id, eventCount }) => [id, eventCount])).toEqual([["2654", 1], ["1551", 5], ["5115", 16], ["6499", 8], ["6805", 2]]);
    expect(fetchFeed.mock.calls.map(([url]) => url)).toEqual(WEBTOOLS_CALENDARS.map(({ url }) => url));
    expect(writes().every(({ source }) => source === "Illinois Webtools")).toBe(true);
    const post = databaseFetch.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(new URL(String(post[0])).searchParams.get("on_conflict")).toBe("source,external_id");
    expect(writes().find(({ external_id }) => external_id === "33546590@illinois.edu")?.source_url).toBe("https://calendars.illinois.edu/detail/1551/33546590");
  });

  test("preserves all three known different-UID fair pairs without repairing source data", async () => {
    fiveFeeds();
    await run(WEBTOOLS_CALENDARS);
    const byId = (id: string) => writes().find(({ external_id }) => external_id === `${id}@illinois.edu`)!;
    // ACES + LAS: same schedule, independently entered titles/venue wording.
    expect(byId("33552091").start_time).toBe(byId("33550719").start_time);
    expect(byId("33552091").end_time).toBe(byId("33550719").end_time);
    // Hire Illini: LAS lacks an end/location; do not borrow from another UID.
    expect(byId("33553540")).toMatchObject({ start_time: "2027-02-24T19:00:00.000Z", end_time: "2027-02-24T19:00:00.000Z", location: "" });
    expect(byId("33553657").end_time).toBe("2027-02-24T23:00:00.000Z");
    // Research Park: LAS DTSTART says Feb 25, its prose and HireIllini say Feb 16.
    expect(byId("33553537").start_time).toBe("2027-02-25T21:00:00.000Z");
    expect(byId("33553537").description).toContain("Tuesday, Feb 16");
    expect(byId("33552514").start_time).toBe("2027-02-16T21:00:00.000Z");
    const pairs = [["33552091", "33550719"], ["33553540", "33553657"], ["33553537", "33552514"]];
    for (const [las, hire] of pairs) {
      expect(byId(las).source_url).not.toBe(byId(hire).source_url);
    }
    expect(new Set(writes().map(({ external_id }) => external_id)).size).toBe(32);
  });

  test.each([2, 3, 4])("failure of added calendar at index %i preserves other calendars", async (failed) => {
    const raws = [calendar(event()), fixture, ...addedFixtures];
    raws.forEach((raw, index) => fetchFeed.mockResolvedValueOnce(index === failed
      ? new Response("unavailable", { status: 503 }) : new Response(raw)));
    const result = await run(WEBTOOLS_CALENDARS);
    expect(result).toMatchObject({ ok: false, upserted: 32 - [1, 5, 16, 8, 2][failed] });
    expect(result.calendars).toHaveLength(5);
    expect(result.calendars.filter(({ ok }) => ok)).toHaveLength(4);
    expect(result.calendars[failed]).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    expect(fetchFeed).toHaveBeenCalledTimes(5);
  });

  test("a shared UID across all five feeds retains configured precedence", async () => {
    WEBTOOLS_CALENDARS.forEach(({ id }, index) => fetchFeed.mockResolvedValueOnce(new Response(calendar(event({
      SUMMARY: id, DESCRIPTION: index === 2 ? "Research Park description" : "", LOCATION: index === 3 ? "LAS room" : "",
    })))));
    expect(await run(WEBTOOLS_CALENDARS)).toMatchObject({ ok: true, upserted: 1,
      overlaps: [{ uid: "shared@illinois.edu", calendarIds: ["2654", "1551", "5115", "6499", "6805"] }] });
    expect(writes()[0]).toMatchObject({ title: "2654", description: "Research Park description", location: "LAS room" });
  });

  test("single-calendar selection only fetches Siebel", async () => {
    fetchFeed.mockResolvedValueOnce(new Response(calendar(event())));
    expect(await run(WEBTOOLS_CALENDARS.filter(({ id }) => id === "2654"))).toMatchObject({ ok: true, upserted: 1 });
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed.mock.calls[0][0]).toBe(WEBTOOLS_CALENDARS[0].url);
  });

  test("merges a shared UID once, reports origins, and keeps first-calendar nonempty fields", async () => {
    feeds(calendar(event({ SUMMARY: "Siebel title", DESCRIPTION: "Primary description" })), calendar(event({ SUMMARY: "Other title", DESCRIPTION: "Other description", LOCATION: "HireIllini room", DTEND: "20260924T183000" })));
    expect(await run()).toMatchObject({ ok: true, upserted: 1, overlaps: [{ uid: "shared@illinois.edu", calendarIds: ["2654", "1551"] }] });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ title: "Siebel title", description: "Primary description", location: "HireIllini room", end_time: "2026-09-24T23:30:00.000Z", source_url: "https://calendars.illinois.edu/detail/2654/shared" });
  });

  test("repeated UID within one feed is written once", async () => {
    feeds(calendar(event() + event({ DESCRIPTION: "Filled description" })), calendar(""));
    expect(await run()).toMatchObject({ ok: true, upserted: 1, overlaps: [] });
    expect(writes()[0].description).toBe("Filled description");
  });

  test("existing rich fields and source URL survive a sparse rerun with equivalent timestamp formats", async () => {
    feeds(calendar(event({ CATEGORIES: "", SUMMARY: "Updated title" })), calendar(""));
    databaseFetch.mockResolvedValueOnce(new Response(JSON.stringify([existing()])));
    expect(await run()).toMatchObject({ ok: true, upserted: 1 });
    expect(writes()[0]).toMatchObject({ ...existing(), title: "Updated title", start_time: "2026-09-24T22:30:00.000Z" });
    expect(writes()[0]).not.toHaveProperty("id");
    expect(writes()[0]).not.toHaveProperty("discovered_at");
  });

  test("new nonempty values update stored fields, including an explicitly changed end", async () => {
    feeds(calendar(event({ DESCRIPTION: "Updated description", LOCATION: "New room", DTEND: "20260924T190000" })), calendar(""));
    databaseFetch.mockResolvedValueOnce(new Response(JSON.stringify([existing()])));
    await run();
    expect(writes()[0]).toMatchObject({ description: "Updated description", location: "New room", end_time: "2026-09-25T00:00:00.000Z" });
  });

  test("rescheduled event never inherits an old end time", async () => {
    feeds(calendar(event({ DTSTART: "20260925T173000", DTEND: "20260925T173000" })), calendar(event({ DTEND: "20260924T183000" })));
    databaseFetch.mockResolvedValueOnce(new Response(JSON.stringify([existing()])));
    await run();
    expect(writes()[0]).toMatchObject({ start_time: "2026-09-25T22:30:00.000Z", end_time: "2026-09-25T22:30:00.000Z" });
  });

  test.each([0, 1])("calendar %i HTTP failure still allows the other calendar to write", async (failed) => {
    for (let i = 0; i < 2; i++) fetchFeed.mockResolvedValueOnce(i === failed ? new Response("unavailable", { status: 503 }) : new Response(fixture));
    const result = await run();
    expect(result).toMatchObject({ ok: false, upserted: 5 });
    expect(result.calendars[failed]).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    expect(result.calendars[1 - failed].ok).toBe(true);
  });

  test("timeout does not prevent attempting the next calendar", async () => {
    fetchFeed.mockRejectedValueOnce(new Error("Request timed out")).mockResolvedValueOnce(new Response(fixture));
    const result = await run();
    expect(result).toMatchObject({ ok: false, upserted: 5 });
    expect(result.calendars[0].error).toContain("timed out");
    expect(fetchFeed.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    "<html>Service unavailable</html>",
    calendar(event().replace("UID:shared@illinois.edu\n", "")),
    calendar(event({ DTSTART: "invalid" })),
    calendar(event({ SUMMARY: "" })),
    calendar(event({ DTEND: "20260923T173000" })),
    calendar(event({ TZID: "Invalid/Timezone" })),
    calendar(event().replace("END:VEVENT\n", "")),
  ])("rejects malformed/unusable calendar data without accepting a subset", async (badFeed) => {
    feeds(badFeed, fixture);
    const result = await run();
    expect(result).toMatchObject({ ok: false, upserted: 5 });
    expect(result.calendars[0].ok).toBe(false);
    expect(writes().some(({ external_id }) => external_id === "shared@illinois.edu")).toBe(false);
  });

  test("a valid event before an invalid one is also excluded from a failed calendar", async () => {
    feeds(calendar(event() + event({ UID: "invalid", DTSTART: "bad" })), calendar(""));
    expect(await run()).toMatchObject({ ok: false, upserted: 0 });
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  test("valid empty feeds succeed without database activity or deletion", async () => {
    feeds(calendar(""), calendar(""));
    expect(await run()).toMatchObject({ ok: true, upserted: 0 });
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  test("all failed feeds produce failure without database activity", async () => {
    fetchFeed.mockRejectedValue(new Error("offline"));
    expect(await run()).toMatchObject({ ok: false, upserted: 0 });
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  test("existing-row read failure prevents every write", async () => {
    feeds();
    databaseFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Read denied" }), { status: 403 }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, databaseError: expect.stringContaining("Read denied") });
    expect(writes()).toEqual([]);
  });

  test("a server row cap cannot silently omit existing fields", async () => {
    feeds();
    databaseFetch.mockResolvedValueOnce(new Response("[]", { headers: { "Content-Range": "*/1" } }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, databaseError: expect.stringContaining("truncated") });
    expect(writes()).toEqual([]);
  });

  test("reads all candidate batches before writing and scopes reads to Webtools", async () => {
    feeds(calendar(Array.from({ length: 101 }, (_, i) => event({ UID: `${i}@illinois.edu` })).join("")), calendar(""));
    expect(await run()).toMatchObject({ ok: true, upserted: 101 });
    expect(databaseFetch.mock.calls.map(([, options]) => options?.method)).toEqual(["GET", "GET", "POST"]);
    for (const [url] of databaseFetch.mock.calls.slice(0, 2)) {
      expect(new URL(String(url)).searchParams.get("source")).toBe("eq.Illinois Webtools");
    }
  });

  test("a later read failure also prevents writing earlier candidates", async () => {
    feeds(calendar(Array.from({ length: 101 }, (_, i) => event({ UID: `${i}@illinois.edu` })).join("")), calendar(""));
    databaseFetch.mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Read failed" }), { status: 400 }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0 });
    expect(writes()).toEqual([]);
  });

  test("database uniqueness/write failure is reported, with no claimed successful writes", async () => {
    feeds();
    databaseFetch.mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "duplicate source_url" }), { status: 409 }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, databaseError: expect.stringContaining("duplicate source_url") });
  });
});

// Exercise CLI selection and exit status with the collector and client creation
// mocked out. These tests never load .env.local or invoke the real collector.
describe("collector CLI", () => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  const collectMock = vi.fn();
  const reconcileMock = vi.fn();
  const clientMock = vi.fn(() => supabase);

  beforeEach(() => {
    vi.resetModules();
    collectMock.mockReset().mockResolvedValue({ ok: true, calendars: [], overlaps: [], upserted: 0 });
    reconcileMock.mockReset().mockResolvedValue({ sourceEvents: 0, existingMappings: 0,
      assignedEvents: 0, joinedOccurrences: 0, createdOccurrences: 0 });
    clientMock.mockClear();
    vi.doMock("./collect", () => ({ collectWebtools: collectMock }));
    vi.doMock("../event-occurrences", () => ({ reconcileEventOccurrences: reconcileMock }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient: clientMock }));
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-only-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("./collect");
    vi.doUnmock("../event-occurrences");
    vi.doUnmock("@supabase/supabase-js");
  });

  test.each([
    [[], ["2654", "1551", "5115", "6499", "6805"]],
    [["--calendar", "2654"], ["2654"]],
    [["--calendar", "1551"], ["1551"]],
    [["--calendar", "5115"], ["5115"]],
    [["--calendar", "6499"], ["6499"]],
    [["--calendar", "6805"], ["6805"]],
  ])("selects calendars for arguments %j", async (args, ids) => {
    process.argv = ["node", "collect-webtools.ts", ...args];
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith("Upserted 0 unique events. Run succeeded."));
    expect(collectMock.mock.calls[0][0].calendars.map((calendar: { id: string }) => calendar.id)).toEqual(ids);
    expect(reconcileMock).toHaveBeenCalledWith(supabase);
    expect(process.exitCode).toBeUndefined();
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  test("reports partial success but exits nonzero", async () => {
    process.argv = ["node", "collect-webtools.ts"];
    collectMock.mockResolvedValue({ ok: false, calendars: [
      { id: "2654", label: "Siebel", ok: false, eventCount: 0, error: "timeout" },
      { id: "1551", label: "HireIllini Career Fairs", ok: true, eventCount: 5 },
    ], overlaps: [], upserted: 5 });
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(console.error).toHaveBeenCalledWith("Siebel (2654): timeout");
    expect(console.log).toHaveBeenCalledWith("HireIllini Career Fairs (1551): collected 5 events.");
    expect(console.log).toHaveBeenCalledWith("Upserted 5 unique events. Run incomplete / failed.");
    expect(reconcileMock).toHaveBeenCalledWith(supabase);
  });

  test("rejects an unconfigured calendar before creating a database client", async () => {
    process.argv = ["node", "collect-webtools.ts", "--calendar", "9999"];
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(collectMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Usage: collect-webtools.ts [--calendar 2654|1551|5115|6499|6805]");
  });
});
