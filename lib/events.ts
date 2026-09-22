/**
 * Shared shape of a campus career event in the Next.js app.
 *
 * Times are ISO-8601 date-time strings. `timezone` is an IANA name such as
 * America/Chicago and is used when formatting times for display.
 *
 * Named CampusEvent to avoid clashing with the browser's built-in Event type.
 */
export type CampusEvent = {
  id: string;
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
  source: string;
  externalId: string;
  discoveredAt: string;
};
