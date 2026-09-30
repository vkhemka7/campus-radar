import { NextResponse, type NextRequest } from "next/server";
import { authCallbackRedirectTarget } from "@/lib/auth";
import { createSupabaseServerClient, hasSupabaseAuthCookie } from "@/lib/supabase-session";

/**
 * Refreshes a Supabase session cookie before the page renders.
 * Requests with no session cookie skip Auth entirely so public browsing stays
 * on the stateless event client.
 * Email-confirmation links are forwarded to /auth/confirm before any session
 * refresh. Recovery query links go to /auth/reset. Those pages do not spend
 * the token on GET. Implicit recovery hashes are handled in RecoveryHashCatcher.
 */
export async function proxy(request: NextRequest) {
  const callback = authCallbackRedirectTarget(request.nextUrl);
  if (callback) return NextResponse.redirect(new URL(callback, request.url));
  if (request.nextUrl.pathname === "/auth/confirm") return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  if (!hasSupabaseAuthCookie(cookieNames)) return response;

  const client = createSupabaseServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  });
  if (!client.ok) return response;

  try {
    await client.supabase.auth.getUser();
  } catch {
    // A failed refresh must not block public pages. Event reads do not use this client.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
