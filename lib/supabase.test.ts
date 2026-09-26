import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSupabaseClient } from "@/lib/supabase";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ kind: "stateless" })) }));

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

describe("stateless Supabase client", () => {
  test("uses the publishable key and does not persist a session", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    process.env.SUPABASE_SECRET_KEY = "secret-key";

    expect(createSupabaseClient()).toEqual({ ok: true, supabase: { kind: "stateless" } });
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "publishable-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
});
