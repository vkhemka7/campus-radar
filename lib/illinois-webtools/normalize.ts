import {
  ILLINOIS_WEBTOOLS_SOURCE,
  SIEBEL_MASTER_CALENDAR_ID,
} from "@/lib/illinois-webtools/constants";
import { absoluteHttpUrl } from "@/lib/illinois-webtools/html-fragment";
import { WEBTOOLS_TIME_ZONE } from "@/lib/illinois-webtools/html-schedule";
import { htmlEventIdToExternalId, webtoolsDetailSourceUrl } from "@/lib/illinois-webtools/identity";
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
    external_id: event.recurrenceId ? `${event.uid}::${event.recurrenceId}` : event.uid,
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

/**
 * Map a parsed HTML event onto the existing Webtools row.
 * Sponsor is intentionally not an input: it is the hosting unit, so `company` stays empty.
 */
export function normalizeHtmlWebtoolsEvent(input: {
  eventId: string;
  title: string;
  description: string;
  category: string;
  location: string;
  registrationUrl: string;
  originatingCalendarId: string | null;
  listCalendarId: string;
  start: Date;
  end: Date;
}): NormalizedIllinoisEvent | null {
  const externalId = htmlEventIdToExternalId(input.eventId);
  const sourceUrl = externalId
    ? webtoolsDetailSourceUrl(input.originatingCalendarId ?? input.listCalendarId, input.eventId)
    : null;
  if (
    !externalId ||
    !sourceUrl ||
    !input.title.trim() ||
    Number.isNaN(input.start.getTime()) ||
    Number.isNaN(input.end.getTime())
  ) {
    return null;
  }

  return {
    external_id: externalId,
    title: input.title.trim(),
    company: "",
    description: input.description,
    category: input.category,
    start_time: input.start.toISOString(),
    end_time: input.end.toISOString(),
    timezone: WEBTOOLS_TIME_ZONE,
    location: input.location,
    registration_url: absoluteHttpUrl(input.registrationUrl) ?? "",
    source_url: sourceUrl,
    source: ILLINOIS_WEBTOOLS_SOURCE,
  };
}
