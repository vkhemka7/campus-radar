function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 *
 * JavaScript's Date parser would otherwise treat a string like
 * "2026-09-23T18:00:00" as the *computer's* local timezone, which is wrong
 * for campus events that are in America/Chicago.
 */
export function zonedWallTimeToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = tzOffsetMs(new Date(utcGuess), timeZone);
  const instant = utcGuess - offsetMs;
  const offsetMs2 = tzOffsetMs(new Date(instant), timeZone);

  if (offsetMs === offsetMs2) {
    return new Date(instant);
  }

  return new Date(utcGuess - offsetMs2);
}

export function parseIcsDateTime(
  value: string,
  timeZone: string,
): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(
    value,
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  const isUtc = match[7] === "Z";

  if (isUtc) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  return zonedWallTimeToUtcDate(
    year,
    month,
    day,
    hour,
    minute,
    second,
    timeZone,
  );
}
