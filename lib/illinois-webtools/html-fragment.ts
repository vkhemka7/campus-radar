const DISALLOWED_PATH = /^\/(export|ical|outlook|userRole|eventXML)(\/|$)/i;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

export function collapseText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function visibleText(html: string): string {
  const withBreaks = html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n");
  const decoded = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " ")).replace(/\u00a0/g, " ");
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isDisallowedWebtoolsUrl(url: URL): boolean {
  return url.hostname.toLowerCase() === "calendars.illinois.edu" && DISALLOWED_PATH.test(url.pathname);
}

/** Absolute http(s) URL, excluding Webtools export/calendar endpoints. */
export function absoluteHttpUrl(href: string): string | null {
  const decoded = decodeHtmlEntities(href).trim();
  if (!/^https?:\/\//i.test(decoded)) {
    return null;
  }

  try {
    const url = new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (isDisallowedWebtoolsUrl(url)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function firstAbsoluteHttpUrl(html: string): string | null {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1];
    if (!href) {
      continue;
    }
    const url = absoluteHttpUrl(href);
    if (url) {
      return url;
    }
  }
  return null;
}

export function findClosingTagIndex(html: string, tag: string, contentStart: number): number {
  const re = new RegExp(`<(/)?${tag}\\b[^>]*>`, "gi");
  re.lastIndex = contentStart;
  let depth = 1;

  for (let match = re.exec(html); match; match = re.exec(html)) {
    const token = match[0];
    if (/\/\s*>$/.test(token)) {
      continue;
    }
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        return match.index;
      }
    } else {
      depth += 1;
    }
  }

  return -1;
}

function afterTag(html: string, closeAt: number): number {
  const end = html.indexOf(">", closeAt);
  return end < 0 ? -1 : end + 1;
}

export type ElementSlice = { open: string; inner: string };

export function collectByClass(html: string, tag: string, className: string): ElementSlice[] | null {
  const results: ElementSlice[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");

  for (let match = re.exec(html); match; match = re.exec(html)) {
    const open = match[0];
    const classAttr = /class=["']([^"']*)["']/i.exec(open)?.[1] ?? "";
    const selfClosing = /\/\s*>$/.test(open);
    const contentStart = match.index + open.length;
    const bounds = selfClosing
      ? { contentEnd: contentStart, after: contentStart }
      : closingBounds(html, tag, contentStart);
    if (!bounds) {
      return null;
    }
    if (classAttr.split(/\s+/).includes(className)) {
      results.push({
        open,
        inner: selfClosing ? "" : html.slice(contentStart, bounds.contentEnd),
      });
      re.lastIndex = bounds.after;
    }
  }

  return results;
}

export function innerHtmlByClass(html: string, tag: string, className: string): string | null {
  return collectByClass(html, tag, className)?.[0]?.inner ?? null;
}

export function elementInnerById(html: string, id: string): string | null {
  const match = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(html);
  if (!match || match.index === undefined) {
    return null;
  }
  const tag = match[1];
  if (!tag) {
    return null;
  }
  const contentStart = match.index + match[0].length;
  const closeAt = findClosingTagIndex(html, tag, contentStart);
  if (closeAt < 0) {
    return null;
  }
  return html.slice(contentStart, closeAt);
}

function closingBounds(html: string, tag: string, contentStart: number): { contentEnd: number; after: number } | null {
  const contentEnd = findClosingTagIndex(html, tag, contentStart);
  if (contentEnd < 0) {
    return null;
  }
  const after = afterTag(html, contentEnd);
  if (after < 0) {
    return null;
  }
  return { contentEnd, after };
}
