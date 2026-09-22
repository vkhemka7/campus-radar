export type IcsEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  categories: string;
  url: string;
  dtstart: string;
  dtend: string;
  tzid: string;
};

function unfoldIcs(ics: string): string[] {
  const normalized = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseProperty(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return null;
  }

  const nameAndParams = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semicolon = nameAndParams.indexOf(";");
  const name = (semicolon === -1 ? nameAndParams : nameAndParams.slice(0, semicolon)).toUpperCase();
  const params = semicolon === -1 ? "" : nameAndParams.slice(semicolon + 1);

  return { name, params, value };
}

function paramValue(params: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|;)${key}=([^;]+)`, "i").exec(params);
  return match?.[1];
}

/**
 * Parse VEVENT blocks from an iCalendar (ICS) string.
 *
 * Illinois Webtools often puts TZID on its own line instead of as a DTSTART
 * parameter. This parser accepts both forms.
 */
export function parseIcsEvents(ics: string): IcsEvent[] {
  const lines = unfoldIcs(ics);
  const events: IcsEvent[] = [];
  let current: Record<string, { params: string; value: string }> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current?.UID?.value) {
        const tzid =
          paramValue(current.DTSTART?.params ?? "", "TZID") ??
          current.TZID?.value ??
          "";

        events.push({
          uid: current.UID.value.trim(),
          summary: unescapeIcsText(current.SUMMARY?.value ?? ""),
          description: unescapeIcsText(current.DESCRIPTION?.value ?? ""),
          location: unescapeIcsText(current.LOCATION?.value ?? ""),
          categories: unescapeIcsText(current.CATEGORIES?.value ?? ""),
          url: current.URL?.value.trim() ?? "",
          dtstart: current.DTSTART?.value ?? "",
          dtend: current.DTEND?.value ?? "",
          tzid,
        });
      }

      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const property = parseProperty(line);
    if (!property) {
      continue;
    }

    current[property.name] = {
      params: property.params,
      value: property.value,
    };
  }

  return events;
}
