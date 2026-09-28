import { cookies } from "next/headers";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { hasSupabaseAuthCookie } from "@/lib/supabase-session";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

export type Viewer =
  | { status: "anonymous" }
  | { status: "unconfigured"; message: string }
  | { status: "authenticated"; user: User };

/**
 * Reads the signed-in user from the request cookies.
 * Anonymous requests, including public event browsing, do not contact Auth.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const cookieStore = await cookies();
  const names = cookieStore.getAll().map((cookie) => cookie.name);
  if (!hasSupabaseAuthCookie(names)) return { status: "anonymous" };

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { status: "unconfigured", message: client.error };

  const { data } = await client.supabase.auth.getUser();
  if (!data.user) return { status: "anonymous" };
  return { status: "authenticated", user: data.user };
});
