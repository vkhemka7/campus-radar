import { zonedWallTimeToUtcDate } from "@/lib/illinois-webtools/time";

export const WEBTOOLS_TIME_ZONE = "America/Chicago";

export type WebtoolsSchedule = {
  start: Date;
  end: Date;
  allDay: boolean;
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join("|");
const DATE_TOKEN = `((?:${MONTH})\\.?\\s+\\d{1,2},\\s+\\d{4})`;
const CLOCK = "(\\d{1,2}):(\\d{2})(?:\\s*([ap]m))?";
const CENTRAL_TIME_SUFFIX = /\s+(?:central time|cdt|cst|ct)$/i;

type Parts = { year: number; month: number; day: number };
type Clock = { hour: number; minute: number };
type Meridiem = "am" | "pm";

function collapse(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseWebtoolsListDay(heading: string): string | null {
  const match = new RegExp(
    `^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\\s+(${MONTH})\\.?\\s+(\\d{1,2}),\\s+(\\d{4})$`,
    "i",
  ).exec(collapse(heading));
  if (!match) {
    return null;
  }
  const parts = dateParts(match[1] ?? "", match[2] ?? "", match[3] ?? "");
  return parts ? isoDay(parts) : null;
}

function dateParts(monthName: string, dayText: string, yearText: string): Parts | null {
  const month = MONTHS[monthName.toLowerCase().replace(/\.$/, "")];
  const day = Number(dayText);
  const year = Number(yearText);
  if (!month || !isRealDate(year, month, day)) {
    return null;
  }
  return { year, month, day };
}

function parseDateToken(token: string): Parts | null {
  const match = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2}),\\s+(\\d{4})$`, "i").exec(collapse(token));
  if (!match) {
    return null;
  }
  return dateParts(match[1] ?? "", match[2] ?? "", match[3] ?? "");
}

function isoDay(parts: Parts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseIsoDay(day: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  return isRealDate(year, month, dayOfMonth) ? { year, month, day: dayOfMonth } : null;
}

function shiftDate(parts: Parts, days: number): Parts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function wallTime(parts: Parts, clock: Clock, timeZone: string): Date {
  return zonedWallTimeToUtcDate(parts.year, parts.month, parts.day, clock.hour, clock.minute, 0, timeZone);
}

function applyMeridiem(hour: number, minute: number, meridiem: Meridiem): Clock | null {
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }
  const normalized = hour % 12;
  return { hour: meridiem === "pm" ? normalized + 12 : normalized, minute };
}

function asMeridiem(value: string | undefined): Meridiem | undefined {
  const label = value?.toLowerCase();
  return label === "am" || label === "pm" ? label : undefined;
}

function resolveClocks(
  startHour: number,
  startMinute: number,
  startLabel: string | undefined,
  endHour: number,
  endMinute: number,
  endLabel: string | undefined,
): { start: Clock; end: Clock; endNextDay: boolean } | null {
  const explicitStart = asMeridiem(startLabel);
  const explicitEnd = asMeridiem(endLabel);
  const endMeridiem = explicitEnd ?? explicitStart;
  let startMeridiem = explicitStart ?? explicitEnd;
  if (!endMeridiem || !startMeridiem) {
    return null;
  }

  let start = applyMeridiem(startHour, startMinute, startMeridiem);
  const end = applyMeridiem(endHour, endMinute, endMeridiem);
  if (!start || !end) {
    return null;
  }

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (!explicitStart && startMinutes > endMinutes) {
    startMeridiem = startMeridiem === "pm" ? "am" : "pm";
    start = applyMeridiem(startHour, startMinute, startMeridiem);
    if (!start) {
      return null;
    }
  }

  return { start, end, endNextDay: start.hour * 60 + start.minute > end.hour * 60 + end.minute };
}

function clockMatch(source: RegExpMatchArray, hourIndex: number, minuteIndex: number, labelIndex: number) {
  return {
    hour: Number(source[hourIndex]),
    minute: Number(source[minuteIndex]),
    label: source[labelIndex],
  };
}

function stripCentralLabel(value: string): string {
  return value.replace(CENTRAL_TIME_SUFFIX, "").trim();
}

function faceClock(clock: Clock): { hour: number; minute: number; meridiem: Meridiem } {
  return {
    hour: clock.hour % 12 || 12,
    minute: clock.minute,
    meridiem: clock.hour >= 12 ? "pm" : "am",
  };
}

function facesFromDisplayedTime(displayedTime: string): { hour: number; minute: number; meridiem: Meridiem }[] | null {
  const text = stripCentralLabel(collapse(displayedTime));
  if (!text || /^all day$/i.test(text)) {
    return null;
  }

  const range = new RegExp(`^${CLOCK}\\s+[-–—]\\s+${CLOCK}$`, "i").exec(text);
  if (range) {
    const start = clockMatch(range, 1, 2, 3);
    const end = clockMatch(range, 4, 5, 6);
    const clocks = resolveClocks(start.hour, start.minute, start.label, end.hour, end.minute, end.label);
    return clocks ? [faceClock(clocks.start), faceClock(clocks.end)] : null;
  }

  const startOnly = new RegExp(`^${CLOCK}$`, "i").exec(text);
  if (startOnly) {
    const start = clockMatch(startOnly, 1, 2, 3);
    const clocks = resolveClocks(start.hour, start.minute, start.label, start.hour, start.minute, start.label);
    return clocks ? [faceClock(clocks.start)] : null;
  }

  return null;
}

type TimedDetail = {
  day: Parts;
  start: { hour: number; minute: number; label?: string };
  end: { hour: number; minute: number; label?: string };
};

function parseTimedDetail(text: string): TimedDetail | null {
  const range = new RegExp(`^${DATE_TOKEN}\\s+${CLOCK}\\s+[-–—]\\s+${CLOCK}$`, "i").exec(text);
  if (range) {
    const day = parseDateToken(range[1] ?? "");
    return day
      ? { day, start: clockMatch(range, 2, 3, 4), end: clockMatch(range, 5, 6, 7) }
      : null;
  }
  const startOnly = new RegExp(`^${DATE_TOKEN}\\s+${CLOCK}$`, "i").exec(text);
  if (startOnly) {
    const day = parseDateToken(startOnly[1] ?? "");
    const start = clockMatch(startOnly, 2, 3, 4);
    return day ? { day, start, end: start } : null;
  }
  return null;
}

function agreedMeridiem(
  hour: number,
  minute: number,
  times: readonly string[],
): Meridiem | null {
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }
  const found = new Set<Meridiem>();
  for (const time of times) {
    const faces = facesFromDisplayedTime(time);
    if (!faces) {
      continue;
    }
    for (const face of faces) {
      if (face.hour === hour && face.minute === minute) {
        found.add(face.meridiem);
      }
    }
  }
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

/**
 * All-day end is midnight after the last included date, so the final day stays in the span.
 */
function allDaySpan(first: Parts, last: Parts, timeZone: string): WebtoolsSchedule | null {
  const endDay = shiftDate(last, 1);
  return {
    start: wallTime(first, { hour: 0, minute: 0 }, timeZone),
    end: wallTime(endDay, { hour: 0, minute: 0 }, timeZone),
    allDay: true,
  };
}

function scheduleFromClocks(
  day: Parts,
  clocks: { start: Clock; end: Clock; endNextDay: boolean },
  timeZone: string,
): WebtoolsSchedule {
  const endDay = clocks.endNextDay ? shiftDate(day, 1) : day;
  return {
    start: wallTime(day, clocks.start, timeZone),
    end: wallTime(endDay, clocks.end, timeZone),
    allDay: false,
  };
}

export function parseWebtoolsDetailDate(
  dateText: string,
  timeZone: string = WEBTOOLS_TIME_ZONE,
): WebtoolsSchedule | null {
  const text = stripCentralLabel(collapse(dateText));
  if (!text) {
    return null;
  }

  const allDayRange = new RegExp(`^${DATE_TOKEN}\\s+[-–—]\\s+${DATE_TOKEN}\\s+all\\s+day$`, "i").exec(text);
  if (allDayRange) {
    const first = parseDateToken(allDayRange[1] ?? "");
    const last = parseDateToken(allDayRange[2] ?? "");
    if (!first || !last) {
      return null;
    }
    return allDaySpan(first, last, timeZone);
  }

  const timedRange = new RegExp(`^${DATE_TOKEN}\\s+${CLOCK}\\s+[-–—]\\s+${CLOCK}$`, "i").exec(text);
  if (timedRange) {
    const day = parseDateToken(timedRange[1] ?? "");
    const start = clockMatch(timedRange, 2, 3, 4);
    const end = clockMatch(timedRange, 5, 6, 7);
    const clocks = day
      ? resolveClocks(start.hour, start.minute, start.label, end.hour, end.minute, end.label)
      : null;
    return day && clocks ? scheduleFromClocks(day, clocks, timeZone) : null;
  }

  const allDay = new RegExp(`^${DATE_TOKEN}\\s+all\\s+day$`, "i").exec(text);
  if (allDay) {
    const day = parseDateToken(allDay[1] ?? "");
    return day ? allDaySpan(day, day, timeZone) : null;
  }

  const timedStart = new RegExp(`^${DATE_TOKEN}\\s+${CLOCK}$`, "i").exec(text);
  if (timedStart) {
    const day = parseDateToken(timedStart[1] ?? "");
    const start = clockMatch(timedStart, 2, 3, 4);
    const clocks = day ? resolveClocks(start.hour, start.minute, start.label, start.hour, start.minute, start.label) : null;
    return day && clocks ? scheduleFromClocks(day, clocks, timeZone) : null;
  }

  return null;
}

function parseDisplayedTime(
  day: Parts,
  displayedTime: string,
  timeZone: string,
): WebtoolsSchedule | null {
  const text = collapse(displayedTime);
  if (!text || /^all day$/i.test(text)) {
    return allDaySpan(day, day, timeZone);
  }

  const range = new RegExp(`^${CLOCK}\\s+[-–—]\\s+${CLOCK}$`, "i").exec(text);
  if (range) {
    const start = clockMatch(range, 1, 2, 3);
    const end = clockMatch(range, 4, 5, 6);
    const clocks = resolveClocks(start.hour, start.minute, start.label, end.hour, end.minute, end.label);
    return clocks ? scheduleFromClocks(day, clocks, timeZone) : null;
  }

  const startOnly = new RegExp(`^${CLOCK}$`, "i").exec(text);
  if (startOnly) {
    const start = clockMatch(startOnly, 1, 2, 3);
    const clocks = resolveClocks(start.hour, start.minute, start.label, start.hour, start.minute, start.label);
    return clocks ? scheduleFromClocks(day, clocks, timeZone) : null;
  }

  return null;
}

/**
 * Detail `.date` wins when it is present.
 * An empty detail date uses list days: one day keeps its displayed time, and
 * several days become an all-day span from the earliest day through the morning
 * after the latest. Description prose is not an input.
 */
function listTimesForDay(
  input: { listDays: readonly string[]; displayedTime?: string; listAppearances?: readonly { day: string; displayedTime: string }[] },
  day: string,
): string[] {
  const appearances = input.listAppearances?.filter((appearance) => appearance.day === day) ?? [];
  if (input.listAppearances && input.listAppearances.length > 0) {
    return appearances.map((appearance) => appearance.displayedTime);
  }
  if (input.displayedTime && input.listDays.includes(day) && new Set(input.listDays).size === 1) {
    return [input.displayedTime];
  }
  return [];
}

/**
 * A detail clock with no meridiem borrows AM/PM only from a list appearance on
 * the same day whose hour and minute match. Conflicting or missing list times
 * stay unparsed.
 */
function corroborateDetailMeridiem(
  dateText: string,
  input: { listDays: readonly string[]; displayedTime?: string; listAppearances?: readonly { day: string; displayedTime: string }[] },
  timeZone: string,
): WebtoolsSchedule | null {
  const text = stripCentralLabel(collapse(dateText));
  const timed = parseTimedDetail(text);
  if (!timed || timed.start.label || timed.end.label) {
    return null;
  }
  const times = listTimesForDay(input, isoDay(timed.day));
  const startMeridiem = agreedMeridiem(timed.start.hour, timed.start.minute, times);
  const endMeridiem = agreedMeridiem(timed.end.hour, timed.end.minute, times);
  if (!startMeridiem || !endMeridiem) {
    return null;
  }
  const clocks = resolveClocks(
    timed.start.hour,
    timed.start.minute,
    startMeridiem,
    timed.end.hour,
    timed.end.minute,
    endMeridiem,
  );
  return clocks ? scheduleFromClocks(timed.day, clocks, timeZone) : null;
}

export function resolveWebtoolsSchedule(input: {
  dateText: string;
  listDays: readonly string[];
  displayedTime?: string;
  listAppearances?: readonly { day: string; displayedTime: string }[];
  timeZone?: string;
}): WebtoolsSchedule | null {
  const timeZone = input.timeZone ?? WEBTOOLS_TIME_ZONE;
  if (collapse(input.dateText)) {
    return parseWebtoolsDetailDate(input.dateText, timeZone) ?? corroborateDetailMeridiem(input.dateText, input, timeZone);
  }

  const days = [...new Set(input.listDays)].filter((day) => parseIsoDay(day)).sort();
  if (days.length === 0) {
    return null;
  }

  const first = parseIsoDay(days[0] ?? "");
  const last = parseIsoDay(days[days.length - 1] ?? "");
  if (!first || !last) {
    return null;
  }

  if (days.length > 1) {
    return allDaySpan(first, last, timeZone);
  }

  return parseDisplayedTime(first, input.displayedTime ?? "", timeZone);
}
