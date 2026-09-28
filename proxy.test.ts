import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { proxy } from "@/proxy";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
};

afterEach(() => {
  restore("SUPABASE_URL", env.SUPABASE_URL);
  restore("SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY);
  vi.clearAllMocks();
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function request(cookie?: string) {
  return new NextRequest("http://localhost:3000/", {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("session proxy", () => {
  test("leaves anonymous browsing alone", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    const response = await proxy(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("refreshes an existing session onto the response", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    vi.mocked(createServerClient).mockImplementation((_url, key, options) => {
      expect(key).toBe("publishable-key");
      return {
        auth: {
          getUser: async () => {
            if (!options.cookies.setAll) throw new Error("Expected setAll cookie adapter");
            await options.cookies.setAll(
              [{ name: "sb-project-auth-token", value: "refreshed", options: { httpOnly: true, path: "/" } }],
              { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
            );
            return { data: { user: { id: "user-1" } }, error: null };
          },
        },
      } as never;
    });

    const response = await proxy(request("sb-project-auth-token=old"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("leaves a signup verifier cookie on the public path", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    const response = await proxy(request("sb-project-auth-token-code-verifier=verifier"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("forwards an email confirmation link before refreshing a session", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    const response = await proxy(
      new NextRequest("http://localhost:3000/?code=abc", {
        headers: { cookie: "sb-project-auth-token=old" },
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/auth/confirm?code=abc");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("does not refresh a session on the confirmation route", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    const response = await proxy(
      new NextRequest("http://localhost:3000/auth/confirm?code=abc", {
        headers: { cookie: "sb-project-auth-token=old" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("continues when session refresh throws", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: async () => { throw new Error("Auth unavailable"); } },
    } as never);

    const response = await proxy(request("sb-project-auth-token=old"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
