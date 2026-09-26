import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-session";

/**
 * Request-scoped Supabase client for Server Actions and Server Components.
 * Anonymous event reads stay on createSupabaseClient.
 */
export async function createRequestSupabaseClient() {
  const cookieStore = await cookies();
  return createSupabaseServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const cookie of cookiesToSet) {
          cookieStore.set(cookie.name, cookie.value, cookie.options);
        }
      } catch {
        // Server Components cannot write cookies. proxy.ts refreshes the session.
      }
    },
  });
}
