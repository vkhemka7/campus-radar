import {
  absoluteHttpUrl,
  collapseText,
  decodeHtmlEntities,
  firstAbsoluteHttpUrl,
  innerHtmlByClass,
  isDisallowedWebtoolsUrl,
  stripNonContent,
  visibleText,
} from "@/lib/illinois-webtools/html-fragment";

export type WebtoolsDetailEvent = {
  eventId: string;
  title: string;
  dateText: string;
  location: string;
  category: string;
  description: string;
  sponsor: string;
  speaker: string;
  registrationUrl: string;
  contact: string;
  email: string;
  cost: string;
  originatingCalendarId: string | null;
};

export type WebtoolsDetailParseResult =
  | { ok: true; event: WebtoolsDetailEvent }
  | { ok: false; reason: "missing-title" | "missing-event-id" | "id-mismatch" };

function metaContent(html: string, property: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = /(?:property|name)=["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (name?.toLowerCase() !== property.toLowerCase()) {
      continue;
    }
    const content = /content=["']([^"']*)["']/i.exec(tag[0])?.[1];
    if (content) {
      return decodeHtmlEntities(content);
    }
  }
  return null;
}

function canonicalUrl(html: string): string | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (rel?.toLowerCase() !== "canonical") {
      continue;
    }
    const href = /href=["']([^"']*)["']/i.exec(tag[0])?.[1];
    if (href) {
      return decodeHtmlEntities(href);
    }
  }
  return null;
}

function eventIdFromDetailUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://calendars.illinois.edu");
    if (url.hostname.toLowerCase() !== "calendars.illinois.edu") {
      return null;
    }
    return /^\/detail\/\d+\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function pageEventId(html: string): { ok: true; id: string } | { ok: false; reason: "missing-event-id" | "id-mismatch" } {
  const candidates = [metaContent(html, "og:url"), canonicalUrl(html)].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    return { ok: false, reason: "missing-event-id" };
  }

  const ids = new Set<string>();
  for (const candidate of candidates) {
    const id = eventIdFromDetailUrl(candidate);
    if (!id) {
      return { ok: false, reason: "missing-event-id" };
    }
    ids.add(id);
  }

  if (ids.size !== 1) {
    return { ok: false, reason: "id-mismatch" };
  }

  return { ok: true, id: [...ids][0] ?? "" };
}

function definitionFields(html: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label = collapseText(visibleText(match[1] ?? "")).toLowerCase();
    if (!label || fields.has(label)) {
      continue;
    }
    fields.set(label, match[2] ?? "");
  }
  return fields;
}

function fieldText(fields: Map<string, string>, label: string): string {
  const html = fields.get(label);
  return html ? collapseText(visibleText(html)) : "";
}

function emailAddress(html: string): string {
  const mailto = /href=["']mailto:([^"']+)["']/i.exec(html);
  if (mailto?.[1]) {
    return decodeHtmlEntities(mailto[1]).split("?")[0]?.trim() ?? "";
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(visibleText(html))?.[0] ?? "";
}

function originatingCalendarId(html: string): string | null {
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href) {
      continue;
    }
    try {
      const url = new URL(decodeHtmlEntities(href), "https://calendars.illinois.edu");
      if (isDisallowedWebtoolsUrl(url)) {
        continue;
      }
      const id = /^\/list\/(\d+)\/?$/.exec(url.pathname)?.[1];
      if (id) {
        return id;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function joinOnlineUrl(html: string): string | null {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/^join online$/i.test(collapseText(visibleText(match[2] ?? "")))) {
      continue;
    }
    const url = absoluteHttpUrl(match[1] ?? "");
    if (url) {
      return url;
    }
  }
  return null;
}

export function parseWebtoolsDetailHtml(html: string, expectedEventId: string): WebtoolsDetailParseResult {
  const cleaned = stripNonContent(html);
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(cleaned);
  const title = heading ? collapseText(visibleText(heading[1] ?? "")) : "";
  if (!title) {
    return { ok: false, reason: "missing-title" };
  }

  const parsedId = pageEventId(cleaned);
  if (!parsedId.ok) {
    return parsedId;
  }
  if (parsedId.id !== expectedEventId) {
    return { ok: false, reason: "id-mismatch" };
  }

  const dateHtml = innerHtmlByClass(cleaned, "div", "date");
  const locationHtml = innerHtmlByClass(cleaned, "span", "location");
  const locationBlock = innerHtmlByClass(cleaned, "div", "location-new");
  const categoryHtml = innerHtmlByClass(cleaned, "div", "event-type");
  const descriptionHtml =
    innerHtmlByClass(cleaned, "dd", "ws-description") ?? innerHtmlByClass(cleaned, "div", "ws-description");
  const fields = definitionFields(cleaned);
  const registrationHtml = fields.get("registration") ?? "";
  const registrationUrl = firstAbsoluteHttpUrl(registrationHtml) ?? joinOnlineUrl(locationBlock ?? "") ?? "";

  return {
    ok: true,
    event: {
      eventId: parsedId.id,
      title,
      dateText: dateHtml === null ? "" : collapseText(visibleText(dateHtml)),
      location: collapseText(visibleText(locationHtml ?? locationBlock ?? "")),
      category: categoryHtml ? collapseText(visibleText(categoryHtml)) : "",
      description: descriptionHtml ? visibleText(descriptionHtml) : "",
      sponsor: fieldText(fields, "sponsor"),
      speaker: fieldText(fields, "speaker"),
      registrationUrl,
      contact: fieldText(fields, "contact"),
      email: emailAddress(fields.get("e-mail") ?? ""),
      cost: fieldText(fields, "cost"),
      originatingCalendarId: originatingCalendarId(fields.get("originating calendar") ?? ""),
    },
  };
}
