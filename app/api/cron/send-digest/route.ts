import { createClient } from "@supabase/supabase-js";
import { runEventDigest, sendResendEmail } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(summary: { status: string; error?: string }, status: number) {
  if (status >= 500) console.error(JSON.stringify(summary));
  else console.log(JSON.stringify(summary));
  return Response.json(summary, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const siteUrl = process.env.SITE_URL;
  if (!url || !key || !apiKey || !from || !siteUrl) {
    return respond(
      { status: "failure", error: "Missing server-side digest configuration." },
      500,
    );
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const summary = await runEventDigest({
      supabase,
      siteUrl,
      sendEmail: ({ to, subject, text, html }) =>
        sendResendEmail({ apiKey, from, to, subject, text, html }),
    });
    return respond(summary, summary.status === "failure" ? 500 : 200);
  } catch {
    return respond(
      { status: "failure", error: "Digest failed before producing a summary." },
      500,
    );
  }
}

export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
