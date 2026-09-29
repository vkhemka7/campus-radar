import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { collectWebtools } from "./collect";
import { WEBTOOLS_CALENDARS } from "./constants";
import { createWebtoolsHtmlFetcher } from "./html-fetch";
import type { NormalizedIllinoisEvent } from "./normalize";

const NOW = new Date("2026-09-28T15:00:00Z");
const EMPTY = '<div id="ws-calendar-content"><p id="no-events">There are no events for this criteria</p></div>';
const fixture = readFileSync("collectors/illinois-webtools/fixtures/html/detail-sponsor-speaker-registration.html", "utf8");
const network = vi.fn<typeof fetch>();
const databaseFetch = vi.fn<typeof fetch>();
const supabase = createClient("https://example.supabase.co", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
});
function list(ids = ["33559024"], time = "5:30 pm") {
  return `<div id="ws-calendar-content"><h2>Monday, September 28, 2026</h2><ul>${ids.map((id) =>
    `<li class="entry"><h3><a href="/detail/2654?eventId=${id}">Event</a></h3><div class="entry-time"><dd>${time}</dd></div></li>`).join("")}</ul></div>`;
}
function existing(overrides: Partial<NormalizedIllinoisEvent> = {}) {
  return {
    id: "stored-id", source: "Illinois Webtools", external_id: "33559024@illinois.edu",
    title: "L3Harris Technologies Information Session", company: "", description: "Stored description",
    category: "Informational", location: "Stored room", registration_url: "",
    source_url: "https://calendars.illinois.edu/detail/6805/33559024",
    start_time: "2026-09-28T22:30:00+00:00", end_time: "2026-09-29T00:00:00+00:00",
    timezone: "America/Chicago", ...overrides,
  };
}
function readResponse(rows: ReturnType<typeof existing>[], total = rows.length) {
  return new Response(JSON.stringify(rows), { headers: { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/${total}` } });
}
function writes(): NormalizedIllinoisEvent[] {
  const call = databaseFetch.mock.calls.find(([, options]) => options?.method === "POST");
  return call ? JSON.parse(String(call[1]?.body)) : [];
}
function pages(options: { ids?: string[]; badDetail?: string; badCalendar?: string; empty?: boolean; sparse?: boolean; ambiguous?: boolean } = {}) {
  network.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/list/")) {
      if (url.pathname === `/list/${options.badCalendar}`) return new Response("offline", { status: 503 });
      return new Response(options.empty || url.searchParams.get("startDate") !== "09/28/2026"
        ? EMPTY : list(options.ids, options.ambiguous ? "11:00" : "5:30 pm"));
    }
    const id = url.pathname.split("/").at(-1)!;
    if (id === options.badDetail) return new Response("<html>broken detail</html>");
    if (options.ambiguous && id === "33553793") return new Response(
      `<meta property="og:url" content="https://calendars.illinois.edu/detail/1551/${id}"><h1>Career Fair</h1><div class="date">Sep 28, 2026 11:00</div>`);
    if (options.sparse) return new Response(
      `<meta property="og:url" content="https://calendars.illinois.edu/detail/7541/${id}"><h1>L3Harris Technologies Information Session</h1><div class="date">Sep 28, 2026 5:30 pm</div>`);
    return new Response(fixture.replaceAll("33559024", id));
  });
}
function run(calendars = WEBTOOLS_CALENDARS) {
  return collectWebtools({ supabase, calendars, now: NOW,
    fetcher: createWebtoolsHtmlFetcher({ fetch: network, minIntervalMs: 0, sleep: async () => {} }) });
}
beforeEach(() => {
  network.mockReset(); databaseFetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in tests"); }));
  databaseFetch.mockImplementation(async (_url, options) => options?.method === "POST"
    ? new Response(null, { status: 201 }) : readResponse([]));
  pages();
});
afterEach(() => vi.unstubAllGlobals());

describe("production HTML collection", () => {
  test("uses only five configured HTML lists, bounded windows, and one detail for a shared id", async () => {
    const result = await run();
    expect(WEBTOOLS_CALENDARS.map(({ id }) => id)).toEqual(["2654", "1551", "5115", "6499", "6805"]);
    expect(result).toMatchObject({ ok: true, discovered: 1, normalized: 1, upserted: 1, skipped: 0, identityConflicts: 0 });
    const urls = network.mock.calls.map(([url]) => new URL(String(url)));
    expect(new Set(urls.filter((url) => url.pathname.startsWith("/list/")).map((url) => url.pathname)))
      .toEqual(new Set(WEBTOOLS_CALENDARS.map(({ id }) => `/list/${id}`)));
    expect(urls.filter((url) => url.pathname.startsWith("/list/"))).toHaveLength(35);
    expect(urls.filter((url) => url.pathname.startsWith("/detail/"))).toHaveLength(1);
    expect(urls.every((url) => /^\/(list\/\d+|detail\/\d+\/\d+)$/.test(url.pathname))).toBe(true);
    expect(network.mock.calls.every(([, options]) => options?.signal instanceof AbortSignal && options.redirect === "manual")).toBe(true);
    expect(writes()[0]).toMatchObject({ external_id: "33559024@illinois.edu", source: "Illinois Webtools",
      registration_url: "https://forms.illinois.edu/sec/1462200831", company: "", timezone: "America/Chicago" });
    expect(writes()[0]).not.toHaveProperty("sponsor");
    const post = databaseFetch.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(new URL(String(post[0])).searchParams.get("on_conflict")).toBe("source,external_id");
  });

  test("updates the existing UID and preserves stored URL despite discovery/origin calendar differences", async () => {
    databaseFetch.mockResolvedValueOnce(readResponse([existing()]));
    await run();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ external_id: "33559024@illinois.edu", source_url: existing().source_url,
      registration_url: "https://forms.illinois.edu/sec/1462200831", company: "" });
    expect(writes()[0]).not.toHaveProperty("id");
    expect(writes()[0]).not.toHaveProperty("discovered_at");
  });

  test("preserves enrichment and known end time on sparse HTML", async () => {
    pages({ sparse: true });
    databaseFetch.mockResolvedValueOnce(readResponse([existing({ company: "Stored company", registration_url: "https://example.com/register" })]));
    await run();
    expect(writes()[0]).toMatchObject({ company: "Stored company", description: "Stored description",
      location: "Stored room", registration_url: "https://example.com/register", end_time: existing().end_time });
  });

  test("never borrows an end from an old schedule", async () => {
    pages({ sparse: true });
    databaseFetch.mockResolvedValueOnce(readResponse([existing({ start_time: "2026-09-27T22:30:00Z", end_time: "2026-09-28T00:00:00Z" })]));
    await run();
    expect(writes()[0].end_time).toBe(writes()[0].start_time);
  });

  test.each([
    { external_id: "999@illinois.edu" },
    { source_url: "https://calendars.illinois.edu/detail/2654/999" },
    { external_id: "malformed@illinois.edu" },
  ])("blocks conflicting stored identity %j before any write", async (override) => {
    databaseFetch.mockResolvedValueOnce(readResponse([existing(override)]));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, identityConflicts: 1, gate: { decision: "BLOCKED" } });
    expect(writes()).toEqual([]);
  });

  test("blocks multiple related rows and leaves recurrence-qualified rows untouched", async () => {
    databaseFetch.mockResolvedValueOnce(readResponse([existing(), { ...existing({ external_id: "999@illinois.edu" }), id: "other" }]));
    expect(await run()).toMatchObject({ upserted: 0, identityConflicts: 1 });
    databaseFetch.mockClear();
    databaseFetch.mockResolvedValueOnce(readResponse([existing({ external_id: "33559024@illinois.edu::20260929" })]));
    expect(await run()).toMatchObject({ upserted: 1, identityConflicts: 0 });
    expect(writes()[0].external_id).toBe("33559024@illinois.edu");
  });

  test("skips a malformed detail while upserting valid events; never deletes", async () => {
    pages({ ids: ["33559024", "123"], badDetail: "123" });
    expect(await run()).toMatchObject({ ok: false, discovered: 2, normalized: 1, upserted: 1, skipped: 1,
      detailFailures: [{ eventId: "123", stage: "parse" }] });
    expect(writes().map(({ external_id }) => external_id)).toEqual(["33559024@illinois.edu"]);
    expect(databaseFetch.mock.calls.every(([, options]) => ["GET", "POST"].includes(String(options?.method)))).toBe(true);
  });

  test("33553793 missing meridiem fails closed without replacing its stored row", async () => {
    pages({ ids: ["33559024", "33553793"], ambiguous: true });
    databaseFetch.mockResolvedValueOnce(readResponse([existing({ external_id: "33553793@illinois.edu", source_url: "https://calendars.illinois.edu/detail/1551/33553793" })]));
    expect(await run()).toMatchObject({ ok: false, normalized: 1, upserted: 1, skipped: 1,
      detailFailures: [{ eventId: "33553793", stage: "schedule", reason: "unparsed-date" }] });
    expect(writes().some(({ external_id }) => external_id === "33553793@illinois.edu")).toBe(false);
  });

  test("failed calendar blocks all writes instead of looking empty", async () => {
    pages({ badCalendar: "1551" });
    const result = await run();
    expect(result).toMatchObject({ ok: false, upserted: 0, gate: { decision: "BLOCKED" } });
    expect(result.calendars.filter(({ ok }) => !ok).map(({ id }) => id)).toEqual(["1551"]);
    expect(writes()).toEqual([]);
  });

  test("empty discovery and single-calendar runs retain stored-only rows", async () => {
    pages({ empty: true });
    databaseFetch.mockResolvedValueOnce(readResponse([existing()]));
    expect(await run()).toMatchObject({ ok: true, discovered: 0, upserted: 0 });
    expect(writes()).toEqual([]);
    pages();
    databaseFetch.mockResolvedValueOnce(readResponse(Array.from({ length: 20 }, (_, i) => ({ ...existing({
      external_id: `${i}@illinois.edu`, source_url: `https://calendars.illinois.edu/detail/1551/${i}` }), id: `${i}` }))));
    expect(await run([WEBTOOLS_CALENDARS[0]])).toMatchObject({ ok: true, upserted: 1 });
    expect(network.mock.calls.every(([url]) => !String(url).includes("/ical"))).toBe(true);
  });

  test.each(["missing", "truncated", "denied"])("fails safely on %s existing-row read", async (kind) => {
    databaseFetch.mockResolvedValueOnce(kind === "missing" ? new Response("[]") : kind === "truncated"
      ? readResponse([], 1) : new Response('{"message":"denied"}', { status: 403 }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, databaseError: expect.any(String) });
    expect(writes()).toEqual([]);
  });

  test("reads every stored page before writing and detects later count changes", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...existing({ external_id: `${i}@illinois.edu`,
      source_url: `https://calendars.illinois.edu/detail/2654/${i}`, start_time: "2020-01-01T00:00:00Z", end_time: "2020-01-01T00:00:00Z" }), id: `${i}` }));
    databaseFetch.mockResolvedValueOnce(readResponse(rows, 101)).mockResolvedValueOnce(readResponse([existing()], 101));
    expect(await run()).toMatchObject({ upserted: 1 });
    expect(databaseFetch.mock.calls.map(([, options]) => options?.method)).toEqual(["GET", "GET", "POST"]);
    databaseFetch.mockClear();
    databaseFetch.mockResolvedValueOnce(readResponse(rows, 101)).mockResolvedValueOnce(readResponse([existing()], 102));
    expect(await run()).toMatchObject({ upserted: 0, databaseError: expect.stringContaining("changing") });
    expect(writes()).toEqual([]);
  });

  test("reports failed upsert without claiming success", async () => {
    databaseFetch.mockResolvedValueOnce(readResponse([])).mockResolvedValueOnce(new Response('{"message":"write denied"}', { status: 403 }));
    expect(await run()).toMatchObject({ ok: false, upserted: 0, skipped: 1, databaseError: expect.stringContaining("write denied") });
  });

  test("single-day 100-row truncation blocks production writes", async () => {
    network.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return new Response(url.searchParams.get("startDate") === "09/28/2026"
        ? list(Array.from({ length: 100 }, (_, i) => String(9000 + i))) : EMPTY);
    });
    const result = await run([WEBTOOLS_CALENDARS[0]]);
    expect(result).toMatchObject({ ok: false, upserted: 0, gate: { decision: "BLOCKED" } });
    expect(result.calendars[0].error).toContain("single day can still be truncated");
    expect(writes()).toEqual([]);
  });

  test("systemic one-hour shifts block every upsert", async () => {
    const ids = ["111", "222", "333", "444", "555"];
    pages({ ids });
    databaseFetch.mockResolvedValueOnce(readResponse(ids.map((id) => ({ ...existing({
      external_id: `${id}@illinois.edu`, source_url: `https://calendars.illinois.edu/detail/2654/${id}`,
      start_time: "2026-09-28T21:30:00Z", end_time: "2026-09-28T23:00:00Z",
    }), id }))));
    expect(await run()).toMatchObject({ ok: false, upserted: 0,
      timeValidation: { startHourShift: 5 }, gate: { decision: "BLOCKED" } });
    expect(writes()).toEqual([]);
  });

  test("rejects source expansion before any network requests", async () => {
    await expect(run([{ id: "7541", label: "Excluded" }])).rejects.toThrow("existing configured");
    expect(network).not.toHaveBeenCalled();
    expect(databaseFetch).not.toHaveBeenCalled();
  });
});

describe("collector CLI reconciliation", () => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  const collectMock = vi.fn();
  const reconcileMock = vi.fn();
  const clientMock = vi.fn(() => supabase);
  beforeEach(() => {
    vi.resetModules();
    collectMock.mockReset().mockResolvedValue({ ok: true, upserted: 1 });
    reconcileMock.mockReset().mockResolvedValue({ assignedEvents: 1, createdOccurrences: 1, joinedOccurrences: 0 });
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
    process.argv = argv; process.exitCode = exitCode;
    vi.unstubAllEnvs(); vi.restoreAllMocks();
    vi.doUnmock("./collect"); vi.doUnmock("../event-occurrences"); vi.doUnmock("@supabase/supabase-js");
  });
  test.each([undefined, "2654", "1551", "5115", "6499", "6805"])("selects %s and reconciles only after upsert", async (id) => {
    process.argv = ["node", "collect-webtools.ts", ...(id ? ["--calendar", id] : [])];
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(reconcileMock).toHaveBeenCalledWith(supabase));
    expect(collectMock.mock.calls[0][0].calendars.map((calendar: { id: string }) => calendar.id))
      .toEqual(id ? [id] : ["2654", "1551", "5115", "6499", "6805"]);
    expect(collectMock.mock.invocationCallOrder[0]).toBeLessThan(reconcileMock.mock.invocationCallOrder[0]);
  });
  test("reconciles successful partial detail run and reports nonzero exit", async () => {
    process.argv = ["node", "collect-webtools.ts"];
    collectMock.mockResolvedValue({ ok: false, upserted: 1 });
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(reconcileMock).toHaveBeenCalledWith(supabase);
  });
  test("does not reconcile after blocked writes", async () => {
    process.argv = ["node", "collect-webtools.ts"];
    collectMock.mockResolvedValue({ ok: false, upserted: 0 });
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(reconcileMock).not.toHaveBeenCalled();
  });
  test("rejects an excluded calendar before creating a client", async () => {
    process.argv = ["node", "collect-webtools.ts", "--calendar", "6327"];
    await import("../../scripts/collect-webtools");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(clientMock).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();
  });
});
