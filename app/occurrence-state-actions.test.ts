import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { saveOccurrenceState } from "./occurrence-state-actions";

const { viewer, session, refresh } = vi.hoisted(() => ({ viewer: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getViewer: viewer }));
vi.mock("@/lib/supabase-server", () => ({ createRequestSupabaseClient: session }));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
const user = "11111111-1111-4111-8111-111111111111";
const occurrence = "22222222-2222-4222-8222-222222222222";
const network = vi.fn<typeof fetch>();
const client = createClient("https://example.test", "publishable-test-key", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: network },
});
function form(status: string, id = occurrence) {
  const data = new FormData();
  data.set("occurrence_id", id);
  data.set("status", status);
  data.set("user_id", "forged-user");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  viewer.mockResolvedValue({ status: "authenticated", user: { id: user } });
  session.mockResolvedValue({ ok: true, supabase: client });
  network.mockReset().mockResolvedValue(new Response("[]", { status: 200 }));
});

describe("occurrence state server action", () => {
  test("requires authentication before reading or writing state", async () => {
    viewer.mockResolvedValue({ status: "anonymous" });
    await expect(saveOccurrenceState(undefined, form("going"))).rejects.toThrow("redirect:/login");
    expect(session).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  test.each(["interested", "going", "not_interested"])("stores %s against verified user and durable occurrence", async (status) => {
    network.mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await saveOccurrenceState(undefined, form(status))).toEqual({ status: "success" });
    const [readUrl] = network.mock.calls[0];
    expect(String(readUrl)).toContain(`user_id=eq.${user}`);
    expect(String(readUrl)).toContain(`occurrence_id=eq.${occurrence}`);
    const [writeUrl, options] = network.mock.calls[1];
    expect(new URL(String(writeUrl)).pathname).toBe("/rest/v1/user_occurrence_states");
    expect(new URL(String(writeUrl)).searchParams.get("on_conflict")).toBe("user_id,occurrence_id");
    expect(JSON.parse(String(options?.body))).toEqual({ user_id: user, occurrence_id: occurrence, status });
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("clears only the signed-in user's requested occurrence", async () => {
    network.mockResolvedValueOnce(new Response(JSON.stringify([{ occurrence_id: occurrence, status: "going" }])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await saveOccurrenceState(undefined, form("unset"))).toEqual({ status: "success" });
    const [url, options] = network.mock.calls[1];
    expect(options?.method).toBe("DELETE");
    expect(new URL(String(url)).searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(new URL(String(url)).searchParams.get("occurrence_id")).toBe(`eq.${occurrence}`);
  });

  test("rereads persisted state on a later invocation and avoids duplicate writes", async () => {
    network.mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ occurrence_id: occurrence, status: "going" }])));
    await saveOccurrenceState(undefined, form("going"));
    await saveOccurrenceState(undefined, form("going"));
    expect(network.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test.each(["42501", "23503"])("surfaces RLS/FK failure %s without claiming success", async (code) => {
    network.mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code, message: "denied" }), { status: 403 }));
    expect(await saveOccurrenceState(undefined, form("going"))).toMatchObject({ status: "error" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("rejects invalid status or malformed occurrence before database access", async () => {
    expect(await saveOccurrenceState(undefined, form("maybe"))).toMatchObject({ status: "error" });
    expect(await saveOccurrenceState(undefined, form("going", "raw-event-id"))).toMatchObject({ status: "error" });
    expect(network).not.toHaveBeenCalled();
  });
});
