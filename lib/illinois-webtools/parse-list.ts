import {
  collapseText,
  collectByClass,
  decodeHtmlEntities,
  elementInnerById,
  innerHtmlByClass,
  isDisallowedWebtoolsUrl,
  stripNonContent,
  visibleText,
} from "@/lib/illinois-webtools/html-fragment";
import { parseWebtoolsListDay } from "@/lib/illinois-webtools/html-schedule";

export type WebtoolsListAppearance = {
  eventId: string;
  listCalendarId: string;
  day: string;
  displayedTime: string;
  recurring: boolean;
  detailUrl: string;
};

export type WebtoolsListEvent = {
  eventId: string;
  title: string;
  listCalendarId: string;
  recurring: boolean;
  earliestDay: string;
  latestDay: string;
  appearances: WebtoolsListAppearance[];
};

export type WebtoolsListParseResult =
  | { ok: true; empty: false; events: WebtoolsListEvent[] }
  | { ok: true; empty: true; events: [] }
  | { ok: false; reason: "pagination" | "unrecognized-list" | "malformed-list" };

type ParsedAppearance = WebtoolsListAppearance & { title: string };

const CONTINUATION_TEXT = /^(next page|more events|show more|load more|continued)$/i;

function hasContinuation(content: string): boolean {
  if (/<(?:a|link)\b[^>]*\brel=["']next["']/i.test(content)) {
    return true;
  }
  if (/\bclass=["'][^"']*\b(?:pager|pagination)\b[^"']*["']/i.test(content)) {
    return true;
  }

  for (const anchor of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = anchor[1] ?? "";
    const text = collapseText(visibleText(anchor[2] ?? ""));
    if (CONTINUATION_TEXT.test(text)) {
      return true;
    }
    const href = /href=["']([^"']*)["']/i.exec(attrs)?.[1];
    if (!href) {
      continue;
    }
    try {
      const url = new URL(decodeHtmlEntities(href), "https://calendars.illinois.edu");
      for (const key of url.searchParams.keys()) {
        if (/^(page|offset|startindex)$/i.test(key)) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

function hasEmptyMarker(content: string): boolean {
  return (
    /id=["']no-events["']/i.test(content) ||
    /There are no events for this criteria/i.test(content) ||
    /More events coming soon!/i.test(content)
  );
}

function isRecognizableEmpty(content: string): boolean {
  if ((collectByClass(content, "li", "entry") ?? []).length > 0) {
    return false;
  }
  if (/[?&](?:amp;)?eventId=\d+/i.test(content)) {
    return false;
  }
  return hasEmptyMarker(content);
}

function detailLink(href: string): { eventId: string; listCalendarId: string; detailUrl: string } | null {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(href).trim(), "https://calendars.illinois.edu");
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.hostname.toLowerCase() !== "calendars.illinois.edu" || isDisallowedWebtoolsUrl(url)) {
    return null;
  }

  const calendarId = /^\/detail\/(\d+)(?:\/\d+)?\/?$/.exec(url.pathname)?.[1];
  const eventId = [...url.searchParams.entries()].find(([key]) => key.toLowerCase() === "eventid")?.[1] ?? "";
  if (!calendarId || !/^\d+$/.test(eventId)) {
    return null;
  }

  return { eventId, listCalendarId: calendarId, detailUrl: url.toString() };
}

function parseEntry(open: string, inner: string, day: string): ParsedAppearance | null {
  const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(inner);
  const title = heading ? collapseText(visibleText(heading[1] ?? "")) : "";
  if (!title) {
    return null;
  }

  const links = [...inner.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => detailLink(match[1] ?? ""))
    .filter((link): link is NonNullable<typeof link> => link !== null);
  const eventIds = new Set(links.map((link) => link.eventId));
  const link = links[0];
  if (!link || eventIds.size !== 1) {
    return null;
  }

  const timeHtml = innerHtmlByClass(inner, "div", "entry-time");
  const timeDd = timeHtml ? /<dd\b[^>]*>([\s\S]*?)<\/dd>/i.exec(timeHtml)?.[1] : undefined;
  const classAttr = /class=["']([^"']*)["']/i.exec(open)?.[1] ?? "";
  const recurring =
    classAttr.split(/\s+/).includes("recurring-event") ||
    (collectByClass(inner, "span", "recurring-event-tag") ?? []).length > 0;

  return {
    eventId: link.eventId,
    title,
    listCalendarId: link.listCalendarId,
    day,
    displayedTime: collapseText(visibleText(timeDd ?? "")),
    recurring,
    detailUrl: link.detailUrl,
  };
}

function appearancesFromContent(content: string): ParsedAppearance[] | null {
  const headings = [...content.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)];
  const sections: { headingHtml: string | null; body: string }[] = [];

  if (headings.length === 0) {
    sections.push({ headingHtml: null, body: content });
  } else {
    const first = headings[0];
    if (first?.index && first.index > 0) {
      sections.push({ headingHtml: null, body: content.slice(0, first.index) });
    }
    for (let index = 0; index < headings.length; index += 1) {
      const current = headings[index];
      if (!current || current.index === undefined) {
        return null;
      }
      const next = headings[index + 1];
      const bodyStart = current.index + current[0].length;
      const bodyEnd = next?.index ?? content.length;
      sections.push({ headingHtml: current[0], body: content.slice(bodyStart, bodyEnd) });
    }
  }

  const appearances: ParsedAppearance[] = [];
  for (const section of sections) {
    const entries = collectByClass(section.body, "li", "entry");
    if (!entries) {
      return null;
    }
    if (entries.length === 0) {
      continue;
    }
    const day = section.headingHtml ? parseWebtoolsListDay(visibleText(section.headingHtml)) : null;
    if (!day) {
      return null;
    }
    for (const entry of entries) {
      const appearance = parseEntry(entry.open, entry.inner, day);
      if (!appearance) {
        return null;
      }
      appearances.push(appearance);
    }
  }

  return appearances;
}

function groupAppearances(appearances: ParsedAppearance[]): WebtoolsListEvent[] {
  const groups = new Map<string, WebtoolsListEvent>();

  for (const appearance of appearances) {
    const { title, ...row } = appearance;
    const existing = groups.get(row.eventId);
    if (!existing) {
      groups.set(row.eventId, {
        eventId: row.eventId,
        title,
        listCalendarId: row.listCalendarId,
        recurring: row.recurring,
        earliestDay: row.day,
        latestDay: row.day,
        appearances: [row],
      });
      continue;
    }

    existing.appearances.push(row);
    existing.recurring = existing.recurring || row.recurring;
    if (row.day < existing.earliestDay) {
      existing.earliestDay = row.day;
    }
    if (row.day > existing.latestDay) {
      existing.latestDay = row.day;
    }
  }

  return [...groups.values()];
}

export function parseWebtoolsListHtml(html: string): WebtoolsListParseResult {
  const content = elementInnerById(stripNonContent(html), "ws-calendar-content");
  if (content === null) {
    return { ok: false, reason: "unrecognized-list" };
  }
  if (hasContinuation(content)) {
    return { ok: false, reason: "pagination" };
  }

  const appearances = appearancesFromContent(content);
  if (!appearances) {
    return { ok: false, reason: "malformed-list" };
  }
  if (appearances.length === 0) {
    return isRecognizableEmpty(content)
      ? { ok: true, empty: true, events: [] }
      : { ok: false, reason: "malformed-list" };
  }
  if (hasEmptyMarker(content)) {
    return { ok: false, reason: "malformed-list" };
  }

  return { ok: true, empty: false, events: groupAppearances(appearances) };
}
