import { resolveWebtoolsSchedule } from "@/lib/illinois-webtools/html-schedule";
import { webtoolsDetailFetchUrl, webtoolsListUrl, type WebtoolsHtmlFetcher } from "@/lib/illinois-webtools/html-fetch";
import {
  splitWebtoolsDateSpan,
  webtoolsCollectionWindow,
  webtoolsDiscoverySpans,
  type WebtoolsDateSpan,
  type WebtoolsWindow,
} from "@/lib/illinois-webtools/html-window";
import { htmlEventIdToExternalId } from "@/lib/illinois-webtools/identity";
import { normalizeHtmlWebtoolsEvent } from "@/lib/illinois-webtools/normalize";
import { parseWebtoolsDetailHtml } from "@/lib/illinois-webtools/parse-detail";
import { parseWebtoolsListHtml, type WebtoolsListEvent } from "@/lib/illinois-webtools/parse-list";

export type HtmlCalendarTarget = { id: string; label: string };

export const WEBTOOLS_LIST_ROW_CAP = 100;

export type HtmlListWindowFetch = {
  calendarId: string;
  startDate: string;
  endDate: string;
  listRows: number;
  action: "accepted" | "split" | "failed-closed" | "error";
};

export type HtmlCalendarDiscovery = {
  id: string;
  label: string;
  ok: boolean;
  listRows: number;
  uniqueEventIds: number;
  capHits: number;
  error?: string;
};

export type DetailFailure = {
  eventId: string;
  calendarId: string;
  stage: "fetch" | "parse" | "schedule";
  reason: string;
};

export type HtmlCandidate = {
  eventId: string;
  externalId: string;
  title: string;
  company: string;
  description: string;
  category: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  registrationUrl: string;
  sourceUrl: string;
  dateText: string;
  emptyDate: boolean;
  recurring: boolean;
  listDays: string[];
  displayedTimes: string[];
  listTitles: string[];
  discoveryCalendarIds: string[];
  originatingCalendarId: string | null;
  allDay: boolean;
};

export type HtmlDiscovery = {
  window: WebtoolsWindow;
  calendars: HtmlCalendarDiscovery[];
  listWindows: HtmlListWindowFetch[];
  candidates: HtmlCandidate[];
  uniqueEventIds: number;
  detailAttempts: number;
  detailSuccesses: number;
  detailFailures: DetailFailure[];
};

type Appearance = {
  calendarId: string;
  day: string;
  displayedTime: string;
  recurring: boolean;
  title: string;
};

type Group = { eventId: string; appearances: Appearance[] };

function remember(groups: Map<string, Group>, calendarId: string, event: WebtoolsListEvent): number {
  const group = groups.get(event.eventId) ?? { eventId: event.eventId, appearances: [] };
  let added = 0;
  for (const appearance of event.appearances) {
    const next = {
      calendarId,
      day: appearance.day,
      displayedTime: appearance.displayedTime,
      recurring: appearance.recurring,
      title: event.title,
    };
    const duplicate = group.appearances.some(
      (existing) =>
        existing.calendarId === next.calendarId &&
        existing.day === next.day &&
        existing.displayedTime === next.displayedTime &&
        existing.recurring === next.recurring &&
        existing.title === next.title,
    );
    if (duplicate) {
      continue;
    }
    group.appearances.push(next);
    added += 1;
  }
  groups.set(event.eventId, group);
  return added;
}

function displayedTimeFor(days: string[], appearances: Appearance[]): string {
  if (new Set(days).size !== 1) {
    return appearances.find((appearance) => appearance.displayedTime)?.displayedTime ?? "";
  }
  const times = [...new Set(appearances.map((appearance) => appearance.displayedTime).filter(Boolean))];
  return times[0] ?? "";
}

export async function discoverWebtoolsHtml(input: {
  calendars: readonly HtmlCalendarTarget[];
  fetcher: WebtoolsHtmlFetcher;
  now?: Date;
  onProgress?: (message: string) => void;
}): Promise<HtmlDiscovery> {
  const window = webtoolsCollectionWindow(input.now ?? new Date());
  const calendars: HtmlCalendarDiscovery[] = [];
  const listWindows: HtmlListWindowFetch[] = [];
  const groups = new Map<string, Group>();
  const log = input.onProgress ?? (() => undefined);

  async function readSpan(calendarId: string, span: WebtoolsDateSpan, acceptedIds: Set<string>): Promise<{ rows: number; error?: string }> {
    const url = webtoolsListUrl(calendarId, span.startQuery, span.endQuery);
    log(`list ${calendarId} ${span.startDate}..${span.endDate}`);
    const response = await input.fetcher.fetchHtml(url);
    if (!response.ok) {
      listWindows.push({
        calendarId,
        startDate: span.startDate,
        endDate: span.endDate,
        listRows: 0,
        action: "error",
      });
      return { rows: 0, error: response.error };
    }
    const parsed = parseWebtoolsListHtml(response.html);
    if (!parsed.ok) {
      listWindows.push({
        calendarId,
        startDate: span.startDate,
        endDate: span.endDate,
        listRows: 0,
        action: "error",
      });
      return { rows: 0, error: parsed.reason };
    }
    const events = parsed.empty ? [] : parsed.events;
    const listRows = events.reduce((sum, event) => sum + event.appearances.length, 0);
    if (listRows === WEBTOOLS_LIST_ROW_CAP) {
      const halves = splitWebtoolsDateSpan(span);
      if (!halves) {
        listWindows.push({
          calendarId,
          startDate: span.startDate,
          endDate: span.endDate,
          listRows,
          action: "failed-closed",
        });
        return {
          rows: 0,
          error: `summary list returned ${WEBTOOLS_LIST_ROW_CAP} rows on ${span.startDate}; a single day can still be truncated`,
        };
      }
      listWindows.push({
        calendarId,
        startDate: span.startDate,
        endDate: span.endDate,
        listRows,
        action: "split",
      });
      const left = await readSpan(calendarId, halves[0], acceptedIds);
      const right = await readSpan(calendarId, halves[1], acceptedIds);
      return { rows: left.rows + right.rows, error: left.error ?? right.error };
    }
    listWindows.push({
      calendarId,
      startDate: span.startDate,
      endDate: span.endDate,
      listRows,
      action: "accepted",
    });
    let added = 0;
    for (const event of events) {
      added += remember(groups, calendarId, event);
      acceptedIds.add(event.eventId);
    }
    return { rows: added };
  }

  for (const calendar of input.calendars) {
    const acceptedIds = new Set<string>();
    let listRows = 0;
    let error: string | undefined;
    for (const span of webtoolsDiscoverySpans(window)) {
      const result = await readSpan(calendar.id, span, acceptedIds);
      listRows += result.rows;
      error = error ?? result.error;
    }
    calendars.push({
      id: calendar.id,
      label: calendar.label,
      ok: !error,
      listRows,
      uniqueEventIds: acceptedIds.size,
      capHits: listWindows.filter((item) => item.calendarId === calendar.id && (item.action === "split" || item.action === "failed-closed")).length,
      error,
    });
  }

  const detailFailures: DetailFailure[] = [];
  const candidates: HtmlCandidate[] = [];
  const groupsInOrder = [...groups.values()];
  for (const [index, group] of groupsInOrder.entries()) {
    const calendarId = group.appearances[0]?.calendarId ?? "";
    const detailUrl = webtoolsDetailFetchUrl(calendarId, group.eventId);
    log(`detail ${index + 1}/${groupsInOrder.length} ${group.eventId}`);
    const response = await input.fetcher.fetchHtml(detailUrl);
    if (!response.ok) {
      detailFailures.push({ eventId: group.eventId, calendarId, stage: "fetch", reason: response.error });
      continue;
    }
    const parsed = parseWebtoolsDetailHtml(response.html, group.eventId);
    if (!parsed.ok) {
      detailFailures.push({ eventId: group.eventId, calendarId, stage: "parse", reason: parsed.reason });
      continue;
    }
    const listDays = [...new Set(group.appearances.map((appearance) => appearance.day))].sort();
    const schedule = resolveWebtoolsSchedule({
      dateText: parsed.event.dateText,
      listDays,
      displayedTime: displayedTimeFor(listDays, group.appearances),
      listAppearances: group.appearances.map((appearance) => ({
        day: appearance.day,
        displayedTime: appearance.displayedTime,
      })),
    });
    if (!schedule) {
      detailFailures.push({ eventId: group.eventId, calendarId, stage: "schedule", reason: "unparsed-date" });
      continue;
    }
    const externalId = htmlEventIdToExternalId(group.eventId);
    const normalized = externalId
      ? normalizeHtmlWebtoolsEvent({
          eventId: group.eventId,
          title: parsed.event.title,
          description: parsed.event.description,
          category: parsed.event.category,
          location: parsed.event.location,
          registrationUrl: parsed.event.registrationUrl,
          originatingCalendarId: parsed.event.originatingCalendarId,
          listCalendarId: calendarId,
          start: schedule.start,
          end: schedule.end,
        })
      : null;
    if (!normalized) {
      detailFailures.push({ eventId: group.eventId, calendarId, stage: "schedule", reason: "normalize-failed" });
      continue;
    }
    candidates.push({
      eventId: group.eventId,
      externalId: normalized.external_id,
      title: normalized.title,
      company: normalized.company,
      description: normalized.description,
      category: normalized.category,
      startTime: normalized.start_time,
      endTime: normalized.end_time,
      timezone: normalized.timezone,
      location: normalized.location,
      registrationUrl: normalized.registration_url,
      sourceUrl: normalized.source_url,
      dateText: parsed.event.dateText,
      emptyDate: parsed.event.dateText.trim() === "",
      recurring: group.appearances.some((appearance) => appearance.recurring),
      listDays,
      displayedTimes: [...new Set(group.appearances.map((appearance) => appearance.displayedTime).filter(Boolean))],
      listTitles: [...new Set(group.appearances.map((appearance) => appearance.title))],
      discoveryCalendarIds: [...new Set(group.appearances.map((appearance) => appearance.calendarId))],
      originatingCalendarId: parsed.event.originatingCalendarId,
      allDay: schedule.allDay,
    });
  }

  return {
    window,
    calendars,
    listWindows,
    candidates,
    uniqueEventIds: groups.size,
    detailAttempts: groups.size,
    detailSuccesses: candidates.length,
    detailFailures,
  };
}
