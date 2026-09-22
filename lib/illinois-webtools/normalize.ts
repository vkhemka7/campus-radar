import {
  ILLINOIS_WEBTOOLS_SOURCE,
  SIEBEL_MASTER_CALENDAR_ID,
} from "@/lib/illinois-webtools/constants";
import { type IcsEvent } from "@/lib/illinois-webtools/parse-ics";
import { parseIcsDateTime } from "@/lib/illinois-webtools/time";

export type NormalizedIllinoisEvent = {
  external_id: string;
  title: string;
  company: string;
  description: string;
  category: string;
  start_time: string;
  end_time: string;
  timezone: string;
  location: string;
  registration_url: string;
  source_url: string;
  source: string;
};

export function canonicalEventUrl(url: string, uid: string, calendarId: string): string {
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      const withoutQuery = url.split("?")[0]?.split("#")[0] ?? "";
      if (withoutQuery) {
        return withoutQuery;
      }
    }
  }

  const eventId = uid.split("@")[0] ?? uid;
  return `https://calendars.illinois.edu/detail/${calendarId}/${eventId}`;
}

export function normalizeIllinoisWebtoolsEvent(
  event: IcsEvent,
  calendarId: string = SIEBEL_MASTER_CALENDAR_ID,
): NormalizedIllinoisEvent | null {
  const timezone = event.tzid || "America/Chicago";
  const start = parseIcsDateTime(event.dtstart, timezone);

  if (!event.uid || !event.summary || !start) {
    return null;
  }

  const end =
    event.dtend && event.dtend !== event.dtstart
      ? parseIcsDateTime(event.dtend, timezone)
      : start;

  if (!end) {
    return null;
  }

  return {
    external_id: event.uid,
    title: event.summary,
    company: "",
    description: event.description,
    category: event.categories,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    timezone,
    location: event.location,
    registration_url: "",
    source_url: canonicalEventUrl(event.url, event.uid, calendarId),
    source: ILLINOIS_WEBTOOLS_SOURCE,
  };
}

export function normalizeIllinoisWebtoolsEvents(
  events: IcsEvent[],
  calendarId: string = SIEBEL_MASTER_CALENDAR_ID,
): NormalizedIllinoisEvent[] {
  const byExternalId = new Map<string, NormalizedIllinoisEvent>();

  for (const event of events) {
    const normalized = normalizeIllinoisWebtoolsEvent(event, calendarId);
    if (!normalized) {
      continue;
    }

    byExternalId.set(normalized.external_id, normalized);
  }

  return [...byExternalId.values()];
}
