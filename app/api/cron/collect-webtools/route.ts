import { createClient } from "@supabase/supabase-js";
import { runWebtoolsCollector } from "@/lib/illinois-webtools/collect-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby's maximum with Fluid Compute; independent of the 600s database lease.
export const maxDuration = 300;

function respond(summary: { status: string; error?: string }, status: number) {
  if (status >= 500) console.error(JSON.stringify(summary));
  else console.log(JSON.stringify(summary));
  return Response.json(summary, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return respond({ status: "failure", error: "Missing server-side Supabase configuration." }, 500);
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const summary = await runWebtoolsCollector({ supabase });
    return respond(summary, summary.status === "failure" ? 500 : 200);
  } catch {
    // Unexpected setup errors must not echo credentials into HTTP responses/logs.
    return respond({ status: "failure", error: "Scheduled collector failed before producing a summary." }, 500);
  }
}

// Next.js otherwise delegates HEAD to GET, which would perform collection.
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
