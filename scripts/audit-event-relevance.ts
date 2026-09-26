/** Read-only, unfiltered Webtools audit against a saved pre-change snapshot.
 * Run: node --env-file=.env.local --import tsx scripts/audit-event-relevance.ts BASELINE.json
 * Baseline rows must contain id, classifier fields, and pre-change relevance.
 */
import { readFileSync } from "node:fs";
import { classifyEvent, type EventRelevance } from "../lib/event-relevance";
import { createSupabaseClient } from "../lib/supabase";

type Row = Parameters<typeof classifyEvent>[0] & {
  id: string; external_id: string; source_url: string; start_time: string;
};
type BaselineRow = Row & { relevance: EventRelevance };

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Provide a pre-change baseline JSON snapshot.");
  const baseline: BaselineRow[] = JSON.parse(readFileSync(path, "utf8"));
  const prior = new Map(baseline.map((row) => [row.id, row]));
  if (prior.size !== baseline.length) throw new Error("Duplicate baseline IDs.");
  const client = createSupabaseClient();
  if (!client.ok) throw new Error(client.error);
  const rows: Row[] = [];
  let total: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const { data, error, count } = await client.supabase.from("events")
      .select("id,title,company,description,category,source,external_id,source_url,start_time", { count: "exact" })
      .eq("source", "Illinois Webtools").order("id").range(offset, offset + 99);
    if (error) throw new Error(error.message);
    if (count === null || (total !== null && count !== total)) throw new Error("Missing or changing row count.");
    total = count;
    rows.push(...(data ?? []));
    if (rows.length >= total) break;
    if (!data?.length) throw new Error("Incomplete read.");
  }
  if (rows.length !== baseline.length || new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("Live row set differs from baseline.");
  }
  const counts = () => ({ relevant: 0, uncertain: 0, not_relevant: 0 });
  const oldCounts = counts();
  const newCounts = counts();
  const results = rows.map((row) => {
    const old = prior.get(row.id);
    if (!old || (["title", "description", "category", "company", "source"] as const).some((key) => old[key] !== row[key])) {
      throw new Error(`Classifier input changed for ${row.id}; capture a fresh baseline before comparing.`);
    }
    const next = classifyEvent(row);
    oldCounts[old.relevance.classification]++;
    newCounts[next.classification]++;
    return { id: row.id, externalId: row.external_id, title: row.title, startTime: row.start_time,
      sourceUrl: row.source_url, old: old.relevance, new: next };
  });
  console.log(JSON.stringify({ auditedAt: new Date().toISOString(), total, oldCounts, newCounts,
    changes: results.filter((row) => row.old.classification !== row.new.classification), results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
