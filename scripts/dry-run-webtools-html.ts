import { writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ILLINOIS_WEBTOOLS_SOURCE, WEBTOOLS_CALENDARS } from "../lib/illinois-webtools/constants";
import { discoverWebtoolsHtml } from "../lib/illinois-webtools/discover-html";
import { compareWebtoolsHtmlDryRun, type DryRunReport, type StoredWebtoolsRow } from "../lib/illinois-webtools/dry-run-compare";
import { createWebtoolsHtmlFetcher } from "../lib/illinois-webtools/html-fetch";
import { createSupabaseClient } from "../lib/supabase";

async function readWebtoolsRows(supabase: SupabaseClient): Promise<StoredWebtoolsRow[]> {
  const rows: StoredWebtoolsRow[] = [];
  let total: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const { data, error, count } = await supabase
      .from("events")
      .select("id,title,company,description,category,start_time,end_time,timezone,location,registration_url,source_url,external_id", { count: "exact" })
      .eq("source", ILLINOIS_WEBTOOLS_SOURCE)
      .order("id")
      .range(offset, offset + 99);
    if (error) {
      throw new Error(error.message);
    }
    if (count === null || (total !== null && count !== total)) {
      throw new Error("Missing or changing Webtools row count.");
    }
    total = count;
    for (const row of data ?? []) {
      rows.push({
        id: String(row.id),
        externalId: String(row.external_id),
        title: String(row.title),
        company: String(row.company),
        description: String(row.description),
        category: String(row.category),
        startTime: String(row.start_time),
        endTime: String(row.end_time),
        timezone: String(row.timezone),
        location: String(row.location),
        registrationUrl: String(row.registration_url),
        sourceUrl: String(row.source_url),
      });
    }
    if (rows.length >= total) {
      break;
    }
    if (!data?.length) {
      throw new Error("Incomplete Webtools read.");
    }
  }
  return rows;
}

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record).filter(([, count]) => count > 0);
  return entries.length ? entries.map(([kind, count]) => `${kind} ${count}`).join(", ") : "none";
}

function formatReport(report: DryRunReport): string {
  const lines = [
    `Window ${report.window.startDate} through ${report.window.endDate} (${report.window.start} .. ${report.window.endExclusive})`,
    "",
    "Calendars",
  ];
  for (const calendar of report.calendars) {
    lines.push(
      calendar.ok
        ? `${calendar.label} (${calendar.id}): rows ${calendar.listRows}, unique ${calendar.uniqueEventIds}`
        : `${calendar.label} (${calendar.id}): FAILED ${calendar.error}`,
    );
  }
  lines.push(
    "",
    `Unique HTML events ${report.uniqueHtmlEvents}`,
    `Details ${report.detailSuccesses}/${report.detailAttempts} succeeded, ${report.detailFailures.length} failed`,
    `Identity matched ${report.identity.matched}, HTML-only ${report.identity.htmlOnly}, conflicts ${report.identity.conflicts}, stored-only-in-window ${report.identity.storedOnlyInWindow}`,
    `100-row guard splits ${report.listWindows.filter((item) => item.action === "split").length}, failed-closed ${report.listWindows.filter((item) => item.action === "failed-closed").length}`,
  );
  for (const item of report.listWindows.filter((window) => window.action === "split" || window.action === "failed-closed")) {
    lines.push(`guard ${item.action} ${item.calendarId} ${item.startDate}..${item.endDate} rows ${item.listRows}`);
  }
  lines.push(
    "",
    "Field differences",
  );
  for (const [field, kinds] of Object.entries(report.fieldDifferences)) {
    lines.push(`${field}: ${counts(kinds)}`);
  }
  lines.push(
    "",
    `Time start same ${report.timeValidation.startSame}, hour-shift ${report.timeValidation.startHourShift}, material ${report.timeValidation.startMaterial}`,
    `Time end same ${report.timeValidation.endSame}, hour-shift ${report.timeValidation.endHourShift}, all-day-boundary ${report.timeValidation.endAllDayBoundary}, material ${report.timeValidation.endMaterial}`,
    "",
    `Empty detail dates ${report.recurrence.emptyDate.length}`,
    `Multi-day ids ${report.recurrence.multiDayIds.length}`,
    `Recurring markers ${report.recurrence.recurring.length}`,
    `Same title, different ids ${report.recurrence.sameTitleDifferentIds.length} groups`,
    `Originating differs from a discovery calendar ${report.originating.originatingDiffersFromDiscovery}/${report.originating.matched}`,
    `Originating missing ${report.originating.originatingMissing}`,
    `Stored source calendar differs from originating ${report.originating.storedCalendarDiffersFromOriginating}`,
    `Registration blank stored ${report.registration.matchedBlankStored}, HTML URLs ${report.registration.htmlHasRegistration}, would gain ${report.registration.wouldGain}`,
    `Registration hosts ${report.registration.hosts.map((host) => `${host.host} ${host.count}`).join(", ") || "none"}`,
    "",
    "Classification",
  );
  for (const [transition, count] of Object.entries(report.classification.transitions).sort()) {
    lines.push(`${transition}: ${count}`);
  }
  lines.push("", `Gate ${report.gate.decision}`);
  for (const blocker of report.gate.blockers) {
    lines.push(`blocker: ${blocker}`);
  }
  return lines.join("\n");
}

async function main() {
  const client = createSupabaseClient();
  if (!client.ok) {
    throw new Error(client.error);
  }
  const rows = await readWebtoolsRows(client.supabase);
  const discovery = await discoverWebtoolsHtml({
    calendars: WEBTOOLS_CALENDARS.map(({ id, label }) => ({ id, label })),
    fetcher: createWebtoolsHtmlFetcher(),
    onProgress: (message) => console.error(message),
  });
  const report = compareWebtoolsHtmlDryRun({ discovery, rows });
  writeFileSync("audits/webtools-html-dry-run.json", JSON.stringify(report, null, 2));
  console.log(formatReport(report));
}

if (process.argv[1]?.endsWith("dry-run-webtools-html.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
