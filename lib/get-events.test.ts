import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getEvents } from "@/lib/get-events";
import { createSupabaseClient } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ createSupabaseClient: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const now = "2026-09-22T18:00:00.000Z";

function requestParams() {
  return new URL(String(fetchMock.mock.calls[0][0])).searchParams;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
  vi.mocked(createSupabaseClient).mockReturnValue({
    ok: true,
    supabase: createClient("https://example.supabase.co", "test-publishable-key", {
      global: { fetch: fetchMock },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("event browsing query", () => {
  test("restricts to the real source, orders deterministically, and limits to 30", async () => {
    expect(await getEvents({ view: "all" })).toEqual({ ok: true, events: [] });
    const params = requestParams();
    expect(params.get("source")).toBe("eq.Illinois Webtools");
    expect(params.get("order")).toBe("start_time.asc,id.asc");
    expect(params.get("limit")).toBe("100");
    expect(params.get("title")).toBeNull();
    expect(params.get("start_time")).toBeNull();
  });

  test("uses future starts OR strictly future ends without inventing a duration", async () => {
    await getEvents({ view: "all" });
    expect(requestParams().get("or")).toBe(
      `(start_time.gte.${now},end_time.gt.${now})`,
    );
    // With this database predicate, past start=end rows match neither branch;
    // ongoing rows match the end branch, and events ending exactly now do not.
  });

  test.each([7, 30] as const)("applies a %i-day upper bound while retaining ongoing events", async (days) => {
    await getEvents({ view: "all", days, search: "  workshop  " });
    const params = requestParams();
    expect(params.get("title")).toBe("ilike.%workshop%");
    expect(params.get("start_time")).toBe(
      `lt.${new Date(Date.parse(now) + days * 86400000).toISOString()}`,
    );
    expect(params.get("or")).toBe(`(start_time.gte.${now},end_time.gt.${now})`);
    expect(params.get("limit")).toBe("100");
  });

  test("escapes SQL LIKE wildcards in title search", async () => {
    await getEvents({ search: "100%_\\" });
    expect(requestParams().get("title")).toBe("ilike.%100\\%\\_\\\\%");
  });

  test("ignores blank searches", async () => {
    await getEvents({ search: "   " });
    expect(requestParams().get("title")).toBeNull();
  });

  test("maps stored event fields for the cards without shortening the description", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{
      id: "event-1", title: "Workshop", company: "", description: "Full description",
      category: "Workshop", start_time: now, end_time: now,
      timezone: "America/Chicago", location: "Siebel", registration_url: "",
      source_url: "https://calendars.illinois.edu/detail/2654/1",
      source: "Illinois Webtools", external_id: "1@illinois.edu", discovered_at: now,
      event_occurrence_sources: [{ occurrence_id: "occurrence-1" }],
    }]), { status: 200 }));
    const result = await getEvents({ view: "all" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0]?.event).toMatchObject({
        id: "event-1", startTime: now, endTime: now,
        description: "Full description", externalId: "1@illinois.edu",
      });
      expect(result.events[0]?.occurrenceId).toBe("occurrence-1");
    }
  });

  test("logs database details but returns a generic error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "internal database detail" }), { status: 400 }));
    expect(await getEvents({ view: "all" })).toEqual({
      ok: false, error: "Events could not be loaded. Please try again later.",
    });
    expect(console.error).toHaveBeenCalled();
  });

  test("handles missing configuration without displaying setup instructions", async () => {
    vi.mocked(createSupabaseClient).mockReturnValue({ ok: false, error: "Missing configuration detail" });
    expect(await getEvents({ view: "all" })).toEqual({
      ok: false, error: "Events could not be loaded. Please try again later.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

function row(id: string, title: string) {
  return {
    id, title, company: "", description: "", category: "",
    start_time: now, end_time: now, timezone: "America/Chicago",
    location: "Siebel", registration_url: "",
    source: "Illinois Webtools", external_id: id, discovered_at: now,
    source_url: `https://example.com/event/${id}`,
    event_occurrence_sources: [{ occurrence_id: `occurrence-${id}` }],
  };
}
function response(rows: unknown[]) {
  return new Response(JSON.stringify(rows), { status: 200 });
}

describe("career view and all-events fallback", () => {
  test("defaults to career and scans past a full batch of nonmatches", async () => {
    fetchMock.mockResolvedValueOnce(response(Array.from({ length: 100 }, (_, i) => row(String(i), "Office Hours"))))
      .mockResolvedValueOnce(response([row("career", "Career Fair")]));
    const result = await getEvents();
    expect(result.ok && result.events.map(({ event }) => event.id)).toEqual(["career"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(second.get("offset")).toBe("100");
    expect(second.get("limit")).toBe("100");
    expect(second.get("order")).toBe("start_time.asc,id.asc");
    expect(second.get("or")).toBe(`(start_time.gte.${now},end_time.gt.${now})`);
    expect(second.get("source")).toBe("eq.Illinois Webtools");
  });
  test("stops at 30 relevant events in database order", async () => {
    fetchMock.mockResolvedValueOnce(response(Array.from({ length: 100 }, (_, i) => row(String(i), "Career Fair"))));
    const result = await getEvents();
    expect(result.ok && result.events.map(({ event }) => event.id)).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  test("all view retains every classification", async () => {
    fetchMock.mockResolvedValueOnce(response([row("a", "Career Fair"), row("b", "Office Hours"), row("c", "Research Talk")]));
    const result = await getEvents({ view: "all" });
    expect(result.ok && result.events.map(({ relevance }) => relevance.classification)).toEqual(["relevant", "not_relevant", "uncertain"]);
  });
  test("deduplicates before the 30-result limit and retains all source rows", async () => {
    const first = Array.from({ length: 30 }, (_, i) => row(`duplicate-${i}`, `Career Fair ${i}`));
    for (let i = 0; i < 10; i += 2) {
      first[i].source_url = `https://events.example.edu/${i / 2}`;
      first[i + 1].source_url = `https://events.example.edu/${i / 2}`;
      first[i].event_occurrence_sources = [{ occurrence_id: `shared-${i / 2}` }];
      first[i + 1].event_occurrence_sources = [{ occurrence_id: `shared-${i / 2}` }];
    }
    const remaining = Array.from({ length: 5 }, (_, i) => row(`unique-${i}`, `Career Fair unique ${i}`));
    fetchMock.mockResolvedValueOnce(response([...first, ...remaining]));
    const result = await getEvents({ view: "all" });
    expect(result.ok && result.events).toHaveLength(30);
    if (result.ok) {
      expect(result.events.slice(0, 5).every(({ provenance }) => provenance.length === 2)).toBe(true);
      expect(result.events.flatMap(({ provenance }) => provenance)).toHaveLength(35);
    }
  });

  test("combines relevance evidence across duplicate source rows", async () => {
    const sparse = row("a", "Open house");
    const relevant = { ...row("b", "Career Fair"), source_url: sparse.source_url };
    relevant.event_occurrence_sources = sparse.event_occurrence_sources;
    fetchMock.mockResolvedValueOnce(response([sparse, relevant]));
    const result = await getEvents();
    expect(result.ok && result.events).toHaveLength(1);
    if (result.ok) {
      expect(result.events[0].relevance.classification).toBe("relevant");
      expect(result.events[0].provenance).toHaveLength(2);
    }
  });
  test("reads the deployed one-to-one object relation and skips a null pending relation", async () => {
    fetchMock.mockResolvedValueOnce(response([
      { ...row("pending", "Career Fair"), event_occurrence_sources: null },
      { ...row("ready", "Career Fair"), event_occurrence_sources: { occurrence_id: "stable" } },
    ]));
    const result = await getEvents();
    expect(result.ok && result.events.map(({ occurrenceId }) => occurrenceId)).toEqual(["stable"]);
  });
  test("rejects a malformed embedded occurrence identity", async () => {
    fetchMock.mockResolvedValueOnce(response([
      { ...row("broken", "Career Fair"), event_occurrence_sources: {} },
    ]));
    expect((await getEvents()).ok).toBe(false);
  });
  test("keeps mapped events available while new rows await reconciliation", async () => {
    fetchMock.mockResolvedValueOnce(response([
      { ...row("pending", "Career Fair"), event_occurrence_sources: [] },
      row("ready", "Career Fair"),
    ]));
    const result = await getEvents();
    expect(result.ok && result.events.map(({ occurrenceId }) => occurrenceId)).toEqual(["occurrence-ready"]);
    expect(console.error).toHaveBeenCalled();
  });
  test.each([2])(
    "fails safely when a raw event has %i occurrence mappings", async (count) => {
      const event_occurrence_sources = Array.from({ length: count }, (_, index) => ({ occurrence_id: `occurrence-${index}` }));
      fetchMock.mockResolvedValueOnce(response([{ ...row("a", "Career Fair"), event_occurrence_sources }]));
      expect(await getEvents()).toEqual({ ok: false, error: "Events could not be loaded. Please try again later." });
      expect(console.error).toHaveBeenCalled();
    });
  test("second batch failure returns an error instead of partial results", async () => {
    fetchMock.mockResolvedValueOnce(response([row("a", "Career Fair"), ...Array.from({ length: 99 }, (_, i) => row(String(i), "Office Hours"))]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "database error" }), { status: 400 }));
    expect(await getEvents()).toEqual({ ok: false, error: "Events could not be loaded. Please try again later." });
  });
  test("search and date filters persist across career batches", async () => {
    fetchMock.mockResolvedValueOnce(response(Array.from({ length: 100 }, (_, i) => row(String(i), "Office Hours"))))
      .mockResolvedValueOnce(response([]));
    await getEvents({ search: "workshop", days: 7 });
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(String(url)).searchParams;
      expect(params.get("title")).toBe("ilike.%workshop%");
      expect(params.get("start_time")).toBe("lt.2026-09-29T18:00:00.000Z");
    }
  });
});
