import { renderDigestHtml } from "./digest-template";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readCareerInterests,
  type CareerInterest,
} from "@/lib/career-interests";
import { rankForYou, type ForYouRecommendation } from "@/lib/for-you";
import { getEvents, type BrowsingEvent } from "@/lib/get-events";

export const DIGEST_EVENT_LIMIT = 8;

export type DigestSummary = {
  status: "success" | "failure";
  users_processed: number;
  emails_sent: number;
  skipped: number;
  failures: number;
  error?: string;
};

export type DigestSendEmail = (input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => Promise<{ ok: boolean }>;

const loadError = "Digest data could not be loaded.";

function isUpcoming(event: BrowsingEvent, nowMs: number): boolean {
  const start = Date.parse(event.event.startTime);
  return !Number.isNaN(start) && start >= nowMs;
}

/**
 * For You ranking over upcoming events, minus Not Interested and already emailed
 * occurrences, capped for one digest.
 */
export function buildUserDigestItems(
  events: readonly BrowsingEvent[],
  catalog: readonly CareerInterest[],
  selectedSlugs: readonly string[],
  options: {
    now?: Date;
    notInterestedIds?: ReadonlySet<string>;
    alreadySentIds?: ReadonlySet<string>;
    limit?: number;
  } = {},
): ForYouRecommendation[] {
  const nowMs = (options.now ?? new Date()).getTime();
  const exclude = new Set<string>([
    ...(options.notInterestedIds ?? []),
    ...(options.alreadySentIds ?? []),
  ]);
  const upcoming = events.filter((event) => isUpcoming(event, nowMs));
  return rankForYou(upcoming, catalog, selectedSlugs, {
    excludeOccurrenceIds: exclude,
  }).slice(0, options.limit ?? DIGEST_EVENT_LIMIT);
}

function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function formatDigestEmail(
  items: readonly ForYouRecommendation[],
  siteUrl: string,
  now = new Date(),
): { subject: string; text: string; html: string } {
  const origin = siteUrl.replace(/\/$/, "");
  const browse = `${origin}/?view=for-you`;
  const blocks = items.map((item, index) => {
    const { event, provenance } = item.occurrence;
    const when =
      event.startTime === event.endTime
        ? formatWhen(event.startTime, event.timezone)
        : `${formatWhen(event.startTime, event.timezone)} – ${formatWhen(event.endTime, event.timezone)}`;
    const sourceUrl =
      provenance.find((row) => row.sourceUrl)?.sourceUrl ?? event.sourceUrl;
    const lines = [
      `${index + 1}. ${event.title}`,
      `When: ${when}`,
      ...(event.category ? [`Category: ${event.category}`] : []),
      ...(event.company ? [`Organization: ${event.company}`] : []),
    ];
    if (event.location) lines.push(`Where: ${event.location}`);
    lines.push(`Why: ${item.explanation}`);
    lines.push(`CampusRadar: ${browse}`);
    if (sourceUrl) lines.push(`Source: ${sourceUrl}`);
    return lines.join("\n");
  });
  const count = items.length;
  const subject =
    count === 1
      ? "CampusRadar: 1 upcoming event for you"
      : `CampusRadar: ${count} upcoming events for you`;
  const text = [
    `Your radar for ${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }).format(now)}.`,
    `${count} upcoming ${count === 1 ? "opportunity" : "opportunities"} worth a look, based on your saved career interests.`,
    "",
    ...blocks,
    "",
    `See more on CampusRadar: ${browse}`,
    `Manage interests: ${origin}/account/interests`,
    "Clear all career interests to stop these digests.",
  ].join("\n\n");
  return { subject, text, html: renderDigestHtml(items, siteUrl, now) };
}

export async function sendResendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean }> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

function asUserId(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function groupSlugs(rows: unknown): Map<string, string[]> | null {
  if (!Array.isArray(rows)) return null;
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const userId = asUserId((row as { user_id?: unknown }).user_id);
    const slug = (row as { interest_slug?: unknown }).interest_slug;
    if (!userId || typeof slug !== "string" || !slug) return null;
    const list = grouped.get(userId) ?? [];
    list.push(slug);
    grouped.set(userId, list);
  }
  return grouped;
}

function groupIdsByUser(
  rows: unknown,
  idKey: "occurrence_id",
  extra?: (row: Record<string, unknown>) => boolean,
): Map<string, Set<string>> | null {
  if (!Array.isArray(rows)) return null;
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const record = row as Record<string, unknown>;
    if (extra && !extra(record)) continue;
    const userId = asUserId(record.user_id);
    const occurrenceId = asUserId(record[idKey]);
    if (!userId || !occurrenceId) return null;
    const set = grouped.get(userId) ?? new Set<string>();
    set.add(occurrenceId);
    grouped.set(userId, set);
  }
  return grouped;
}

export async function runEventDigest(input: {
  supabase: SupabaseClient;
  sendEmail: DigestSendEmail;
  siteUrl: string;
  now?: Date;
  loadEvents?: () => Promise<
    { ok: true; events: BrowsingEvent[] } | { ok: false; error: string }
  >;
}): Promise<DigestSummary> {
  const empty: DigestSummary = {
    status: "success",
    users_processed: 0,
    emails_sent: 0,
    skipped: 0,
    failures: 0,
  };
  const loadEvents = input.loadEvents ?? (() => getEvents({ view: "for-you" }));
  const eventsResult = await loadEvents();
  if (!eventsResult.ok) {
    return { ...empty, status: "failure", error: eventsResult.error };
  }

  const [catalogResult, interestResult, stateResult, sentResult] =
    await Promise.all([
      input.supabase.from("career_interests").select("slug, label, sort_order"),
      input.supabase
        .from("profile_career_interests")
        .select("user_id, interest_slug"),
      input.supabase
        .from("user_occurrence_states")
        .select("user_id, occurrence_id, status"),
      input.supabase.from("user_digest_sends").select("user_id, occurrence_id"),
    ]);
  if (
    catalogResult.error ||
    interestResult.error ||
    stateResult.error ||
    sentResult.error
  ) {
    return { ...empty, status: "failure", error: loadError };
  }
  const catalog = readCareerInterests(catalogResult.data);
  const interests = groupSlugs(interestResult.data);
  const notInterested = groupIdsByUser(
    stateResult.data,
    "occurrence_id",
    (row) => row.status === "not_interested",
  );
  const alreadySent = groupIdsByUser(sentResult.data, "occurrence_id");
  if (!catalog || !interests || !notInterested || !alreadySent) {
    return { ...empty, status: "failure", error: loadError };
  }

  const summary: DigestSummary = { ...empty };
  for (const [userId, slugs] of interests) {
    summary.users_processed += 1;
    const selected = [...new Set(slugs)].filter((slug) =>
      catalog.some((interest) => interest.slug === slug),
    );
    if (selected.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const items = buildUserDigestItems(eventsResult.events, catalog, selected, {
      now: input.now,
      notInterestedIds: notInterested.get(userId),
      alreadySentIds: alreadySent.get(userId),
    });
    if (items.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const { data: userResult, error: userError } =
      await input.supabase.auth.admin.getUserById(userId);
    const email = userResult.user?.email?.trim();
    if (userError || !email) {
      summary.skipped += 1;
      continue;
    }

    const { subject, text, html } = formatDigestEmail(
      items,
      input.siteUrl,
      input.now,
    );
    let sent: { ok: boolean };
    try {
      sent = await input.sendEmail({ to: email, subject, text, html });
    } catch {
      sent = { ok: false };
    }
    if (!sent.ok) {
      summary.failures += 1;
      continue;
    }

    const { error: insertError } = await input.supabase
      .from("user_digest_sends")
      .insert(
        items.map((item) => ({
          user_id: userId,
          occurrence_id: item.occurrence.occurrenceId,
        })),
      );
    if (insertError) {
      summary.failures += 1;
      continue;
    }
    for (const item of items) {
      const set = alreadySent.get(userId) ?? new Set<string>();
      set.add(item.occurrence.occurrenceId);
      alreadySent.set(userId, set);
    }
    summary.emails_sent += 1;
  }

  if (summary.failures > 0 && summary.emails_sent === 0)
    summary.status = "failure";
  return summary;
}
