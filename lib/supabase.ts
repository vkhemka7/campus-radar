import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfigError = {
  ok: false;
  error: string;
};

export type SupabaseConfigSuccess = {
  ok: true;
  supabase: SupabaseClient;
};

/**
 * Creates a Supabase client for server-side use only.
 *
 * Uses the publishable key (not a secret/service_role key). That key maps to
 * the Postgres `anon` role when no user is signed in, so Row Level Security
 * still applies.
 *
 * This client never reads or writes a user session. Public event browsing and
 * the audit scripts stay on it. Signed-in Server Actions use
 * createRequestSupabaseClient in lib/supabase-server.ts.
 */
export function createSupabaseClient():
  | SupabaseConfigSuccess
  | SupabaseConfigError {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return {
      ok: false,
      error:
        "Missing database configuration. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the Next.js dev server.",
    };
  }

  return {
    ok: true,
    supabase: createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
  };
}
