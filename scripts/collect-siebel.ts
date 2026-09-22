import { createClient } from "@supabase/supabase-js";
import {
  COLLECTOR_USER_AGENT,
  ILLINOIS_WEBTOOLS_SOURCE,
  SIEBEL_MASTER_CALENDAR_ID,
  SIEBEL_MASTER_ICS_URL,
} from "../lib/illinois-webtools/constants";
import { normalizeIllinoisWebtoolsEvents } from "../lib/illinois-webtools/normalize";
import { parseIcsEvents } from "../lib/illinois-webtools/parse-ics";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local (server-only, never NEXT_PUBLIC_) and rerun the collector.`,
    );
  }

  return value;
}

async function collectSiebelEvents() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

  const response = await fetch(SIEBEL_MASTER_ICS_URL, {
    headers: {
      "User-Agent": COLLECTOR_USER_AGENT,
      Accept: "text/calendar",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `ICS feed request failed: ${response.status} ${response.statusText}`,
    );
  }

  const ics = await response.text();
  const parsed = parseIcsEvents(ics);
  const events = normalizeIllinoisWebtoolsEvents(
    parsed,
    SIEBEL_MASTER_CALENDAR_ID,
  );

  if (events.length === 0) {
    throw new Error("ICS feed parsed successfully but contained no usable events.");
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error, data } = await supabase
    .from("events")
    .upsert(events, { onConflict: "source,external_id" })
    .select("id");

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log(
    `Collected ${events.length} ${ILLINOIS_WEBTOOLS_SOURCE} events from calendar ${SIEBEL_MASTER_CALENDAR_ID}.`,
  );
  console.log(`Upserted ${data?.length ?? 0} rows.`);
}

collectSiebelEvents().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
