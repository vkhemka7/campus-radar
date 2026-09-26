import { createClient } from "@supabase/supabase-js";
import { WEBTOOLS_CALENDARS } from "../lib/illinois-webtools/constants";
import { collectWebtools } from "../lib/illinois-webtools/collect";
import { reconcileEventOccurrences } from "../lib/event-occurrences";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local (server-only, never NEXT_PUBLIC_) and rerun the collector.`,
    );
  }

  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--calendar" || !WEBTOOLS_CALENDARS.some((calendar) => calendar.id === args[1]))) {
    throw new Error(`Usage: collect-webtools.ts [--calendar ${WEBTOOLS_CALENDARS.map(({ id }) => id).join("|")}]`);
  }
  const calendars = args.length ? WEBTOOLS_CALENDARS.filter((calendar) => calendar.id === args[1]) : WEBTOOLS_CALENDARS;
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const result = await collectWebtools({ supabase, calendars });
  const occurrences = await reconcileEventOccurrences(supabase);
  for (const calendar of result.calendars) {
    const label = `${calendar.label} (${calendar.id})`;
    if (calendar.ok) console.log(`${label}: collected ${calendar.eventCount} events.`);
    else console.error(`${label}: ${calendar.error}`);
  }
  for (const overlap of result.overlaps) {
    console.log(`Shared UID ${overlap.uid}: calendars ${overlap.calendarIds.join(", ")}`);
  }
  if (result.databaseError) console.error(result.databaseError);
  console.log(`Upserted ${result.upserted} unique events. Run ${result.ok ? "succeeded" : "incomplete / failed"}.`);
  console.log(`Occurrence reconciliation assigned ${occurrences.assignedEvents} events (${occurrences.createdOccurrences} new, ${occurrences.joinedOccurrences} existing occurrences).`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
