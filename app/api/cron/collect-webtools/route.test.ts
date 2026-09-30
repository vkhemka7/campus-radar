import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET, HEAD } from "./route";

const { createClient, runCollector } = vi.hoisted(() => ({
  createClient: vi.fn(), runCollector: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/illinois-webtools/collect-run", () => ({ runWebtoolsCollector: runCollector }));
const client = { rpc: vi.fn() };
function request(authorization = "Bearer test-cron-secret") {
  return new Request("https://example.test/api/cron/collect-webtools", { headers: { authorization } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-service-secret");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClient.mockReturnValue(client);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Vercel scheduled collection", () => {
  test.each(["", "Bearer wrong", "test-cron-secret"])("rejects incorrect authorization: %s", async (header) => {
    expect((await GET(request(header))).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(runCollector).not.toHaveBeenCalled();
  });

  test("fails closed when CRON_SECRET is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(runCollector).not.toHaveBeenCalled();
  });

  test.each(["success", "warning", "skipped_locked", "failure"])("preserves %s summary and HTTP outcome", async (status) => {
    const summary = { status, owner_id: "test-owner", lease: { acquired: status !== "skipped_locked" }, warnings: [] };
    runCollector.mockResolvedValue(summary);
    const response = await GET(request());
    expect(response.status).toBe(status === "failure" ? 500 : 200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(summary);
    expect(runCollector).toHaveBeenCalledExactlyOnceWith({ supabase: client });
    expect(createClient).toHaveBeenCalledWith("https://example.test", "test-service-secret", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(status === "failure" ? console.error : console.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(summary));
  });

  test.each(["SUPABASE_URL", "SUPABASE_SECRET_KEY"])("reports missing %s without collection", async (name) => {
    vi.stubEnv(name, "");
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: "failure" });
    expect(createClient).not.toHaveBeenCalled();
    expect(runCollector).not.toHaveBeenCalled();
  });

  test("reports unexpected exceptions without exposing their contents", async () => {
    runCollector.mockRejectedValue(new Error("test-service-secret"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("test-service-secret");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("test-service-secret");
  });

  test("HEAD cannot start collection", () => {
    expect(HEAD().status).toBe(405);
    expect(runCollector).not.toHaveBeenCalled();
  });
});
