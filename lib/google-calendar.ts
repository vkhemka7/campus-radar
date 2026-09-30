const TEMPLATE = "https://calendar.google.com/calendar/render";
const HOUR_MS = 60 * 60 * 1000;

export type GoogleCalendarEventInput = {
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  details?: string;
};

/**
 * Google Calendar template dates are UTC `YYYYMMDDTHHMMSSZ`.
 * Stored times are ISO instants; converting through UTC keeps the same moment
 * the app already displays in `event.timezone`.
 */
function googleUtcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function parseInstant(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function googleCalendarEventUrl(input: GoogleCalendarEventInput): string | null {
  const start = parseInstant(input.startTime);
  if (start === null) return null;

  const parsedEnd = parseInstant(input.endTime);
  const end =
    parsedEnd !== null && parsedEnd > start ? parsedEnd : start + HOUR_MS;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${googleUtcStamp(start)}/${googleUtcStamp(end)}`,
  });
  if (input.location) params.set("location", input.location);
  if (input.details) params.set("details", input.details);
  return `${TEMPLATE}?${params}`;
}

export function googleCalendarDetails(urls: readonly string[]): string {
  return [...new Set(urls.filter(Boolean))].join("\n");
}
