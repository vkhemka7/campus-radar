import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET, HEAD } from "./route";

const { createClient, runDigest } = vi.hoisted(() => ({
  createClient: vi.fn(), runDigest: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/digest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/digest")>();
  return { ...actual, runEventDigest: runDigest };
});
const client = { from: vi.fn() };
function request(authorization = "Bearer test-cron-secret") {
  return new Request("https://example.test/api/cron/send-digest", { headers: { authorization } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-service-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM", "CampusRadar <noreply@example.test>");
  vi.stubEnv("SITE_URL", "https://campus.example");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClient.mockReturnValue(client);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("digest execution route", () => {
  test("rejects incorrect authorization before creating a client", async () => {
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(runDigest).not.toHaveBeenCalled();
  });

  test.each(["SUPABASE_SECRET_KEY", "RESEND_API_KEY", "RESEND_FROM", "SITE_URL"])(
    "fails closed when %s is missing",
    async (name) => {
      vi.stubEnv(name, "");
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ status: "failure" });
      expect(runDigest).not.toHaveBeenCalled();
    },
  );

  test("returns the digest summary without caching", async () => {
    const summary = { status: "success", users_processed: 1, emails_sent: 1, skipped: 0, failures: 0 };
    runDigest.mockResolvedValue(summary);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(summary);
    expect(createClient).toHaveBeenCalledWith("https://example.test", "test-service-secret", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(runDigest).toHaveBeenCalledOnce();
  });

  test("HEAD cannot start the digest", () => {
    expect(HEAD().status).toBe(405);
    expect(runDigest).not.toHaveBeenCalled();
  });
});
