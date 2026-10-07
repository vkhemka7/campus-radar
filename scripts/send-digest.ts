import { createClient } from "@supabase/supabase-js";
import { runEventDigest, sendResendEmail } from "../lib/digest";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local (server-only, never NEXT_PUBLIC_).`,
    );
  }
  return value;
}

async function main() {
  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("RESEND_FROM");
  const summary = await runEventDigest({
    supabase,
    siteUrl: requiredEnv("SITE_URL"),
    sendEmail: ({ to, subject, text, html }) =>
      sendResendEmail({ apiKey, from, to, subject, text, html }),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === "failure") process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "failure", error: message }, null, 2));
  process.exitCode = 1;
});
