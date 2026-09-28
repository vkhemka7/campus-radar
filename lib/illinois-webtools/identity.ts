const PLAIN_WEBTOOLS_EXTERNAL_ID = /^(\d+)@illinois\.edu$/;
const MALFORMED_WEBTOOLS_EXTERNAL_ID = /^[^@\s]+@illinois\.edu$/;
const DETAIL_PATH = /^\/detail\/(\d+)\/(\d+)$/;

/**
 * Existing Webtools rows use `{eventId}@illinois.edu`.
 * A bare HTML id has to keep that form or the upsert would insert a second row.
 */
export function htmlEventIdToExternalId(eventId: string): string | null {
  if (!/^\d+$/.test(eventId)) {
    return null;
  }
  return `${eventId}@illinois.edu`;
}

/**
 * Numeric id for a plain Webtools UID.
 * Recurrence-qualified ids (`::`), other sources, and malformed values are left unchanged.
 */
export function plainWebtoolsEventId(externalId: string): string | null {
  if (externalId.includes("::")) {
    return null;
  }
  return PLAIN_WEBTOOLS_EXTERNAL_ID.exec(externalId)?.[1] ?? null;
}

/** Detail URL with no query and no hash. Query strings are not identity. */
export function eventIdFromWebtoolsSourceUrl(sourceUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "calendars.illinois.edu" || url.search !== "" || url.hash !== "") {
    return null;
  }

  return DETAIL_PATH.exec(url.pathname)?.[2] ?? null;
}

/** Calendar and event ids from a detail path. Query strings are ignored, not rejected. */
export function webtoolsDetailPath(sourceUrl: string): { calendarId: string; eventId: string } | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "calendars.illinois.edu") {
    return null;
  }
  const match = DETAIL_PATH.exec(url.pathname);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { calendarId: match[1], eventId: match[2] };
}

export function webtoolsDetailSourceUrl(calendarId: string, eventId: string): string | null {
  if (!/^\d+$/.test(calendarId) || !/^\d+$/.test(eventId)) {
    return null;
  }
  return `https://calendars.illinois.edu/detail/${calendarId}/${eventId}`;
}

export type WebtoolsIdentityAssessment =
  | { status: "match"; eventId: string; externalId: string }
  | { status: "unrelated" }
  | { status: "leave-unchanged"; reason: "recurrence" | "non-webtools" | "malformed" }
  | { status: "conflict" };

/**
 * Decide whether an existing row is the same Webtools event as an HTML id.
 * This does not rewrite `external_id`.
 */
export function assessWebtoolsIdentity(
  row: { externalId: string; sourceUrl?: string | null },
  htmlEventId: string,
): WebtoolsIdentityAssessment {
  if (!/^\d+$/.test(htmlEventId)) {
    return { status: "leave-unchanged", reason: "malformed" };
  }

  if (row.externalId.includes("::")) {
    return { status: "leave-unchanged", reason: "recurrence" };
  }

  const fromExternal = PLAIN_WEBTOOLS_EXTERNAL_ID.exec(row.externalId)?.[1] ?? null;
  if (!fromExternal) {
    const reason = MALFORMED_WEBTOOLS_EXTERNAL_ID.test(row.externalId) ? "malformed" : "non-webtools";
    return { status: "leave-unchanged", reason };
  }

  const fromUrl = row.sourceUrl ? eventIdFromWebtoolsSourceUrl(row.sourceUrl) : null;
  if (fromUrl && fromUrl !== fromExternal) {
    return { status: "conflict" };
  }

  if (fromExternal !== htmlEventId) {
    return { status: "unrelated" };
  }

  return { status: "match", eventId: fromExternal, externalId: row.externalId };
}
