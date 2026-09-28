import { createServerClient } from "@supabase/ssr";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSupabaseServerClient, hasSupabaseAuthCookie } from "@/lib/supabase-session";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth: {} })) }));

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

afterEach(() => {
  restore("SUPABASE_URL", env.SUPABASE_URL);
  restore("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY);
  restore("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY);
  vi.clearAllMocks();
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Supabase session client", () => {
  test("detects only Supabase auth cookies", () => {
    expect(hasSupabaseAuthCookie([])).toBe(false);
    expect(hasSupabaseAuthCookie(["theme"])).toBe(false);
    expect(hasSupabaseAuthCookie(["sb-project-auth-token"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-project-auth-token.0"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-project-auth-token-code-verifier"])).toBe(false);
    expect(hasSupabaseAuthCookie(["sb-project-auth-token-flow-abc12345-code-verifier"])).toBe(false);
    expect(hasSupabaseAuthCookie(["sb-project-auth-token", "sb-project-auth-token-code-verifier"])).toBe(true);
  });

  test("returns a configuration error without contacting Auth", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const result = createSupabaseServerClient({ getAll: () => [], setAll: vi.fn() });
    expect(result.ok).toBe(false);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("uses the publishable key and the request cookie adapter", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    process.env.SUPABASE_SECRET_KEY = "secret-key";
    const setAll = vi.fn();
    const result = createSupabaseServerClient({
      getAll: () => [{ name: "sb-project-auth-token", value: "token" }],
      setAll,
    });

    expect(result.ok).toBe(true);
    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "publishable-key",
      expect.objectContaining({
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
      }),
    );
    const options = vi.mocked(createServerClient).mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([{ name: "sb-project-auth-token", value: "token" }]);
    const headers = { "Cache-Control": "private, no-store" };
    options.cookies.setAll?.([{ name: "sb-project-auth-token", value: "next", options: { path: "/" } }], headers);
    expect(setAll).toHaveBeenCalledWith(
      [{ name: "sb-project-auth-token", value: "next", options: { path: "/" } }],
      headers,
    );
  });
});
