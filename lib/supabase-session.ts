import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseSessionConfigError = {
  ok: false;
  error: string;
};

export type SupabaseSessionConfigSuccess = {
  ok: true;
  supabase: SupabaseClient;
};

const missingConfig =
  "Missing database configuration. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the Next.js dev server.";

/**
 * True when the request carries a Supabase session cookie.
 * PKCE verifier cookies are stored at signup before a session exists, so they
 * do not count. Public pages keep skipping Auth until a session cookie is set.
 */
export function hasSupabaseAuthCookie(names: readonly string[]): boolean {
  return names.some((name) => name.startsWith("sb-") && !name.includes("-code-verifier"));
}

/**
 * Cookie-backed Supabase client for a single server request.
 * Pass the publishable key only. The secret key must stay in the collector scripts.
 */
export function createSupabaseServerClient(cookieStore: {
  getAll: () => { name: string; value: string }[];
  setAll: SetAllCookies;
}): SupabaseSessionConfigSuccess | SupabaseSessionConfigError {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return { ok: false, error: missingConfig };
  }

  return {
    ok: true,
    supabase: createServerClient(url, publishableKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet, headers) => cookieStore.setAll(cookiesToSet, headers),
      },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}
