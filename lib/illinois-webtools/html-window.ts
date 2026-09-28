import { WEBTOOLS_TIME_ZONE } from "@/lib/illinois-webtools/html-schedule";
import { zonedWallTimeToUtcDate } from "@/lib/illinois-webtools/time";

export type WebtoolsWindow = {
  timeZone: typeof WEBTOOLS_TIME_ZONE;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
  startQuery: string;
  endQuery: string;
};

type Parts = { year: number; month: number; day: number };

function chicagoDate(instant: Date): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WEBTOOLS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function addDays(parts: Parts, days: number): Parts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function iso(parts: Parts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function queryDate(parts: Parts): string {
  return `${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}/${parts.year}`;
}

function midnight(parts: Parts): Date {
  return zonedWallTimeToUtcDate(parts.year, parts.month, parts.day, 0, 0, 0, WEBTOOLS_TIME_ZONE);
}

export const WEBTOOLS_DISCOVERY_WINDOW_DAYS = 30;

export type WebtoolsDateSpan = {
  startDate: string;
  endDate: string;
  startQuery: string;
  endQuery: string;
  dayCount: number;
};

function parseIsoDate(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function dayIndex(parts: Parts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function webtoolsDateSpan(startDate: string, endDate: string): WebtoolsDateSpan {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) {
    throw new Error(`Invalid Webtools date span ${startDate}..${endDate}`);
  }
  const dayCount = dayIndex(end) - dayIndex(start) + 1;
  if (dayCount < 1) {
    throw new Error(`Webtools date span ends before it starts: ${startDate}..${endDate}`);
  }
  return {
    startDate: iso(start),
    endDate: iso(end),
    startQuery: queryDate(start),
    endQuery: queryDate(end),
    dayCount,
  };
}

/** Inclusive, non-overlapping slices of at most `sizeDays` covering the collection window. */
export function webtoolsDiscoverySpans(collection: WebtoolsWindow, sizeDays = WEBTOOLS_DISCOVERY_WINDOW_DAYS): WebtoolsDateSpan[] {
  if (!Number.isInteger(sizeDays) || sizeDays < 1) {
    throw new Error(`Invalid discovery window size: ${sizeDays}`);
  }
  const spans: WebtoolsDateSpan[] = [];
  let cursor = collection.startDate;
  while (cursor <= collection.endDate) {
    const start = parseIsoDate(cursor);
    if (!start) {
      throw new Error(`Invalid window start ${cursor}`);
    }
    const proposed = iso(addDays(start, sizeDays - 1));
    const endDate = proposed < collection.endDate ? proposed : collection.endDate;
    spans.push(webtoolsDateSpan(cursor, endDate));
    const end = parseIsoDate(endDate);
    if (!end) {
      throw new Error(`Invalid window end ${endDate}`);
    }
    cursor = iso(addDays(end, 1));
  }
  return spans;
}

/**
 * Split an inclusive span into two contiguous spans.
 * The left side gets the smaller half when the day count is odd, and the right
 * side starts the day after the left side ends.
 */
export function splitWebtoolsDateSpan(span: WebtoolsDateSpan): [WebtoolsDateSpan, WebtoolsDateSpan] | null {
  if (span.dayCount <= 1) {
    return null;
  }
  const start = parseIsoDate(span.startDate);
  if (!start) {
    return null;
  }
  const leftDays = Math.floor(span.dayCount / 2);
  const leftEnd = addDays(start, leftDays - 1);
  const rightStart = addDays(leftEnd, 1);
  return [webtoolsDateSpan(iso(start), iso(leftEnd)), webtoolsDateSpan(iso(rightStart), span.endDate)];
}

/** Inclusive Chicago dates from today through `daysAhead` days later. */
export function webtoolsCollectionWindow(now: Date, daysAhead = 180): WebtoolsWindow {
  const start = chicagoDate(now);
  const end = addDays(start, daysAhead);
  return {
    timeZone: WEBTOOLS_TIME_ZONE,
    startDate: iso(start),
    endDate: iso(end),
    start: midnight(start),
    endExclusive: midnight(addDays(start, daysAhead + 1)),
    startQuery: queryDate(start),
    endQuery: queryDate(end),
  };
}

export function scheduleOverlapsWindow(startIso: string, endIso: string, window: WebtoolsWindow): boolean {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) {
    return false;
  }
  const parsedEnd = Date.parse(endIso);
  const finish = Number.isNaN(parsedEnd) ? start : Math.max(start, parsedEnd);
  const windowStart = window.start.getTime();
  const windowEnd = window.endExclusive.getTime();
  if (finish === start) {
    return start >= windowStart && start < windowEnd;
  }
  return start < windowEnd && finish > windowStart;
}
