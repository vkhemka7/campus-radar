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
    expect(await getEvents()).toEqual({ ok: true, events: [] });
    const params = requestParams();
    expect(params.get("source")).toBe("eq.Illinois Webtools");
    expect(params.get("order")).toBe("start_time.asc,id.asc");
    expect(params.get("limit")).toBe("30");
    expect(params.get("title")).toBeNull();
    expect(params.get("start_time")).toBeNull();
  });

  test("uses future starts OR strictly future ends without inventing a duration", async () => {
    await getEvents();
    expect(requestParams().get("or")).toBe(
      `(start_time.gte.${now},end_time.gt.${now})`,
    );
    // With this database predicate, past start=end rows match neither branch;
    // ongoing rows match the end branch, and events ending exactly now do not.
  });

  test.each([7, 30] as const)("applies a %i-day upper bound while retaining ongoing events", async (days) => {
    await getEvents({ days, search: "  workshop  " });
    const params = requestParams();
    expect(params.get("title")).toBe("ilike.%workshop%");
    expect(params.get("start_time")).toBe(
      `lt.${new Date(Date.parse(now) + days * 86400000).toISOString()}`,
    );
    expect(params.get("or")).toBe(`(start_time.gte.${now},end_time.gt.${now})`);
    expect(params.get("limit")).toBe("30");
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
    }]), { status: 200 }));
    const result = await getEvents();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0]).toMatchObject({
        id: "event-1", startTime: now, endTime: now,
        description: "Full description", externalId: "1@illinois.edu",
      });
    }
  });

  test("logs database details but returns a generic error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "internal database detail" }), { status: 400 }));
    expect(await getEvents()).toEqual({
      ok: false, error: "Events could not be loaded. Please try again later.",
    });
    expect(console.error).toHaveBeenCalled();
  });

  test("handles missing configuration without displaying setup instructions", async () => {
    vi.mocked(createSupabaseClient).mockReturnValue({ ok: false, error: "Missing configuration detail" });
    expect(await getEvents()).toEqual({
      ok: false, error: "Events could not be loaded. Please try again later.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
