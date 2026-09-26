import type { CampusEvent } from "@/lib/events";

export type EventOccurrence = {
  event: CampusEvent;
  provenance: CampusEvent[];
};

const genericTitles = new Set([
  "coffee chat",
  "career fair",
  "employer information session",
  "information session",
  "info session",
  "networking event",
  "recruiting event",
  "office hours",
  "seminar",
  "social hour",
  "tech talk",
  "technical talk",
  "webinar",
  "workshop",
]);

function normalizeText(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrl(value: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|key)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    // An origin alone is commonly reused and does not identify an event.
    if (path === "/" && !url.search) return "";
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return "";
  }
}

function eventUrls(event: CampusEvent): Set<string> {
  return new Set([canonicalUrl(event.sourceUrl), canonicalUrl(event.registrationUrl)].filter(Boolean));
}

function compatibleLocations(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  // Require a meaningful venue phrase; short room/building fragments are not
  // enough to connect otherwise independent events.
  return shorter.length >= 20 && longer.startsWith(`${shorter} `);
}

export function duplicateEvidence(left: CampusEvent, right: CampusEvent): "canonical-url" | "exact-occurrence" | null {
  if (Date.parse(left.startTime) !== Date.parse(right.startTime)) return null;

  const leftUrls = eventUrls(left);
  if ([...eventUrls(right)].some((url) => leftUrls.has(url))) return "canonical-url";

  const title = normalizeText(left.title);
  if (!title || title !== normalizeText(right.title) || genericTitles.has(title)) return null;
  if (Date.parse(left.endTime) !== Date.parse(right.endTime)) return null;
  if (!compatibleLocations(left.location, right.location)) return null;
  return "exact-occurrence";
}

function representativeScore(event: CampusEvent): number {
  const fields = [event.company, event.description, event.category, event.location, event.registrationUrl];
  return fields.filter((value) => value.trim()).length + (event.endTime !== event.startTime ? 1 : 0);
}

export function selectEventRepresentative(events: CampusEvent[]): CampusEvent {
  if (!events.length) throw new Error("An occurrence requires at least one source event.");
  return [...events].sort((left, right) =>
    representativeScore(right) - representativeScore(left)
    || right.description.length - left.description.length
    || left.source.localeCompare(right.source)
    || left.externalId.localeCompare(right.externalId)
    || left.id.localeCompare(right.id))[0];
}

export function deduplicateEvents(events: CampusEvent[]): EventOccurrence[] {
  const groups: CampusEvent[][] = [];
  for (const event of events) {
    // Complete-link membership prevents a chain of partial matches from joining
    // rows that do not directly have strong duplicate evidence with each other.
    const group = groups.find((candidate) => candidate.every((member) => duplicateEvidence(event, member)));
    if (group) group.push(event);
    else groups.push([event]);
  }
  return groups.map((provenance) => ({ event: selectEventRepresentative(provenance), provenance }));
}
