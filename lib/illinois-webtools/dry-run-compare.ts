import { classifyEvent } from "@/lib/event-relevance";
import { ILLINOIS_WEBTOOLS_SOURCE } from "@/lib/illinois-webtools/constants";
import type { DetailFailure, HtmlCalendarDiscovery, HtmlCandidate, HtmlDiscovery } from "@/lib/illinois-webtools/discover-html";
import { WEBTOOLS_TIME_ZONE } from "@/lib/illinois-webtools/html-schedule";
import { scheduleOverlapsWindow } from "@/lib/illinois-webtools/html-window";
import {
  assessWebtoolsIdentity,
  eventIdFromWebtoolsSourceUrl,
  plainWebtoolsEventId,
  webtoolsDetailPath,
} from "@/lib/illinois-webtools/identity";

export type StoredWebtoolsRow = {
  id: string;
  externalId: string;
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
};

type DiffKind =
  | "same"
  | "whitespace"
  | "richer"
  | "shorter"
  | "rewritten"
  | "gained"
  | "lost"
  | "changed"
  | "equivalent-url"
  | "hour-shift"
  | "all-day-boundary"
  | "material";

const FIELDS = [
  "external_id",
  "title",
  "start_time",
  "end_time",
  "location",
  "category",
  "description",
  "source_url",
  "company",
  "registration_url",
] as const;

type FieldName = (typeof FIELDS)[number];

export type FieldExample = {
  externalId: string;
  title: string;
  field: FieldName;
  kind: DiffKind;
  stored: string;
  html: string;
};

export type UnusualEvent = {
  eventId: string;
  externalId: string;
  title: string;
  dateText: string;
  emptyDate: boolean;
  recurring: boolean;
  listDays: string[];
  displayedTimes: string[];
  listTitles: string[];
  discoveryCalendarIds: string[];
  allDay: boolean;
  startTime: string;
  endTime: string;
};

export type DryRunReport = {
  window: { startDate: string; endDate: string; start: string; endExclusive: string };
  calendars: HtmlCalendarDiscovery[];
  listWindows: HtmlDiscovery["listWindows"];
  uniqueHtmlEvents: number;
  detailAttempts: number;
  detailSuccesses: number;
  detailFailures: DetailFailure[];
  identity: { matched: number; htmlOnly: number; conflicts: number; storedOnlyInWindow: number };
  fieldDifferences: Record<FieldName, Record<string, number>>;
  fieldExamples: FieldExample[];
  timeValidation: {
    startSame: number;
    endSame: number;
    startHourShift: number;
    endHourShift: number;
    endAllDayBoundary: number;
    startMaterial: number;
    endMaterial: number;
  };
  recurrence: {
    emptyDate: UnusualEvent[];
    multiDayIds: UnusualEvent[];
    recurring: UnusualEvent[];
    sameTitleDifferentIds: { title: string; eventIds: string[]; events: UnusualEvent[] }[];
  };
  originating: {
    matched: number;
    originatingDiffersFromDiscovery: number;
    originatingMissing: number;
    storedCalendarDiffersFromOriginating: number;
    examples: { externalId: string; title: string; discovery: string[]; originating: string | null; stored: string | null }[];
  };
  registration: {
    matchedBlankStored: number;
    htmlHasRegistration: number;
    wouldGain: number;
    hosts: { host: string; count: number }[];
  };
  classification: {
    transitions: Record<string, number>;
    examples: { externalId: string; title: string; from: string; to: string; storedRules: string[]; htmlRules: string[] }[];
  };
  htmlOnly: { externalId: string; title: string; startTime: string; discoveryCalendarIds: string[] }[];
  storedOnly: { externalId: string; title: string; startTime: string; sourceUrl: string; reason: string }[];
  gate: { decision: "READY_FOR_CUTOVER" | "BLOCKED"; blockers: string[] };
};

function skeleton(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function chicagoMidnight(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WEBTOOLS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.hour === "00" && map.minute === "00" && map.second === "00";
}

function classifyInstant(stored: string, html: string, allowAllDayBoundary: boolean): DiffKind {
  const left = Date.parse(stored);
  const right = Date.parse(html);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return "material";
  }
  const delta = Math.abs(left - right);
  if (delta === 0) {
    return "same";
  }
  if (delta === 3_600_000) {
    return "hour-shift";
  }
  if (allowAllDayBoundary && chicagoMidnight(stored) && chicagoMidnight(html)) {
    return "all-day-boundary";
  }
  return "material";
}

function classifyText(stored: string, html: string): DiffKind {
  if (stored === html) {
    return "same";
  }
  const left = skeleton(stored);
  const right = skeleton(html);
  if (left === right) {
    return "whitespace";
  }
  if (!left && right) {
    return "richer";
  }
  if (left && right.includes(left) && right.length > left.length) {
    return "richer";
  }
  if (right && left.includes(right) && left.length > right.length) {
    return "shorter";
  }
  if (!right && left) {
    return "shorter";
  }
  return "rewritten";
}

function classifyRegistration(stored: string, html: string): DiffKind {
  if (stored === html) {
    return "same";
  }
  if (!stored.trim() && html.trim()) {
    return "gained";
  }
  if (stored.trim() && !html.trim()) {
    return "lost";
  }
  return stored.trim() === html.trim() ? "whitespace" : "changed";
}

function classifySourceUrl(stored: string, html: string): DiffKind {
  if (stored === html) {
    return "same";
  }
  const left = webtoolsDetailPath(stored);
  const right = webtoolsDetailPath(html);
  if (left && right && left.eventId === right.eventId) {
    return "equivalent-url";
  }
  return "material";
}

function fieldKind(field: FieldName, stored: StoredWebtoolsRow, html: HtmlCandidate, startKind: DiffKind): DiffKind {
  if (field === "external_id") {
    return stored.externalId === html.externalId ? "same" : "material";
  }
  if (field === "title") {
    const kind = classifyText(stored.title, html.title);
    return kind === "same" || kind === "whitespace" ? kind : "material";
  }
  if (field === "start_time") {
    return classifyInstant(stored.startTime, html.startTime, false);
  }
  if (field === "end_time") {
    return classifyInstant(stored.endTime, html.endTime, startKind === "same" || startKind === "all-day-boundary");
  }
  if (field === "location") {
    return classifyText(stored.location, html.location);
  }
  if (field === "category") {
    return classifyText(stored.category, html.category);
  }
  if (field === "description") {
    return classifyText(stored.description, html.description);
  }
  if (field === "source_url") {
    return classifySourceUrl(stored.sourceUrl, html.sourceUrl);
  }
  if (field === "company") {
    return classifyText(stored.company, html.company);
  }
  return classifyRegistration(stored.registrationUrl, html.registrationUrl);
}

function storedValue(field: FieldName, row: StoredWebtoolsRow): string {
  const values: Record<FieldName, string> = {
    external_id: row.externalId,
    title: row.title,
    start_time: row.startTime,
    end_time: row.endTime,
    location: row.location,
    category: row.category,
    description: row.description,
    source_url: row.sourceUrl,
    company: row.company,
    registration_url: row.registrationUrl,
  };
  return values[field];
}

function htmlValue(field: FieldName, event: HtmlCandidate): string {
  const values: Record<FieldName, string> = {
    external_id: event.externalId,
    title: event.title,
    start_time: event.startTime,
    end_time: event.endTime,
    location: event.location,
    category: event.category,
    description: event.description,
    source_url: event.sourceUrl,
    company: event.company,
    registration_url: event.registrationUrl,
  };
  return values[field];
}

function unusual(event: HtmlCandidate): UnusualEvent {
  return {
    eventId: event.eventId,
    externalId: event.externalId,
    title: event.title,
    dateText: event.dateText,
    emptyDate: event.emptyDate,
    recurring: event.recurring,
    listDays: event.listDays,
    displayedTimes: event.displayedTimes,
    listTitles: event.listTitles,
    discoveryCalendarIds: event.discoveryCalendarIds,
    allDay: event.allDay,
    startTime: event.startTime,
    endTime: event.endTime,
  };
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function relatedRows(rows: StoredWebtoolsRow[], eventId: string): StoredWebtoolsRow[] {
  return rows.filter((row) => {
    if (row.externalId.includes("::")) {
      return false;
    }
    return plainWebtoolsEventId(row.externalId) === eventId || webtoolsDetailPath(row.sourceUrl)?.eventId === eventId;
  });
}

function bump(counts: Record<string, number>, kind: string) {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

function selectorWipe(storedNonEmpty: number, htmlEmpty: number): boolean {
  return storedNonEmpty >= 20 && htmlEmpty / storedNonEmpty > 0.5;
}

export function compareWebtoolsHtmlDryRun(input: {
  discovery: HtmlDiscovery;
  rows: StoredWebtoolsRow[];
}): DryRunReport {
  const { discovery } = input;
  const rows = input.rows.filter((row) => row.externalId || row.sourceUrl);
  const failedIds = new Set(discovery.detailFailures.map((failure) => failure.eventId));
  const fieldDifferences = Object.fromEntries(FIELDS.map((field) => [field, {}])) as DryRunReport["fieldDifferences"];
  const fieldExamples: FieldExample[] = [];
  const timeValidation = {
    startSame: 0,
    endSame: 0,
    startHourShift: 0,
    endHourShift: 0,
    endAllDayBoundary: 0,
    startMaterial: 0,
    endMaterial: 0,
  };
  let descriptionStored = 0;
  let descriptionCleared = 0;
  let locationStored = 0;
  let locationCleared = 0;
  let categoryStored = 0;
  let categoryCleared = 0;
  const transitions: Record<string, number> = {};
  const transitionExamples: DryRunReport["classification"]["examples"] = [];
  const originatingExamples: DryRunReport["originating"]["examples"] = [];
  let originatingDiffers = 0;
  let originatingMissing = 0;
  let storedCalendarDiffers = 0;
  let matchedBlankStored = 0;
  let htmlHasRegistration = 0;
  let wouldGain = 0;
  const hosts = new Map<string, number>();
  const matchedIds = new Set<string>();
  const conflictRowIds = new Set<string>();
  const htmlOnly: DryRunReport["htmlOnly"] = [];
  let conflicts = 0;

  for (const event of discovery.candidates) {
    const related = relatedRows(rows, event.eventId);
    if (related.length > 1) {
      conflicts += 1;
      for (const row of related) conflictRowIds.add(row.id);
      continue;
    }
    const row = related[0];
    if (!row) {
      htmlOnly.push({
        externalId: event.externalId,
        title: event.title,
        startTime: event.startTime,
        discoveryCalendarIds: event.discoveryCalendarIds,
      });
      continue;
    }
    const assessment = assessWebtoolsIdentity(
      { externalId: row.externalId, sourceUrl: row.sourceUrl },
      event.eventId,
    );
    if (assessment.status !== "match") {
      conflicts += 1;
      conflictRowIds.add(row.id);
      continue;
    }

    matchedIds.add(row.id);
    const startKind = classifyInstant(row.startTime, event.startTime, false);
    if (startKind === "same") timeValidation.startSame += 1;
    if (startKind === "hour-shift") timeValidation.startHourShift += 1;
    if (startKind === "material") timeValidation.startMaterial += 1;
    const endKind = classifyInstant(row.endTime, event.endTime, startKind === "same");
    if (endKind === "same") timeValidation.endSame += 1;
    if (endKind === "hour-shift") timeValidation.endHourShift += 1;
    if (endKind === "all-day-boundary") timeValidation.endAllDayBoundary += 1;
    if (endKind === "material") timeValidation.endMaterial += 1;
    for (const field of FIELDS) {
      const kind = fieldKind(field, row, event, startKind);
      bump(fieldDifferences[field], kind);
      const notable = kind === "material" || kind === "hour-shift" || kind === "rewritten" || kind === "lost";
      const seen = fieldExamples.filter((example) => example.field === field && example.kind === kind).length;
      if (notable && seen < 8) {
        fieldExamples.push({
          externalId: event.externalId,
          title: event.title,
          field,
          kind,
          stored: storedValue(field, row).slice(0, 180),
          html: htmlValue(field, event).slice(0, 180),
        });
      }
    }

    if (row.description.trim()) {
      descriptionStored += 1;
      if (!event.description.trim()) descriptionCleared += 1;
    }
    if (row.location.trim()) {
      locationStored += 1;
      if (!event.location.trim()) locationCleared += 1;
    }
    if (row.category.trim()) {
      categoryStored += 1;
      if (!event.category.trim()) categoryCleared += 1;
    }

    const storedClass = classifyEvent({ ...row, source: ILLINOIS_WEBTOOLS_SOURCE });
    const htmlClass = classifyEvent({
      title: event.title,
      description: event.description,
      category: event.category,
      company: event.company,
      source: ILLINOIS_WEBTOOLS_SOURCE,
    });
    const transition = `${storedClass.classification} -> ${htmlClass.classification}`;
    bump(transitions, transition);
    if (storedClass.classification !== htmlClass.classification && transitionExamples.length < 24) {
      transitionExamples.push({
        externalId: event.externalId,
        title: event.title,
        from: storedClass.classification,
        to: htmlClass.classification,
        storedRules: storedClass.reasons.map((reason) => reason.ruleId),
        htmlRules: htmlClass.reasons.map((reason) => reason.ruleId),
      });
    }

    const originating = event.originatingCalendarId;
    const discoveryIds = event.discoveryCalendarIds;
    if (!originating) {
      originatingMissing += 1;
    } else if (discoveryIds.some((id) => id !== originating)) {
      originatingDiffers += 1;
    }
    const storedCalendar = webtoolsDetailPath(row.sourceUrl)?.calendarId ?? null;
    if (originating && storedCalendar && originating !== storedCalendar) {
      storedCalendarDiffers += 1;
    }
    if (originatingExamples.length < 12 && originating && discoveryIds.some((id) => id !== originating)) {
      originatingExamples.push({
        externalId: event.externalId,
        title: event.title,
        discovery: discoveryIds,
        originating,
        stored: storedCalendar,
      });
    }

    if (!row.registrationUrl.trim()) matchedBlankStored += 1;
    if (event.registrationUrl.trim()) {
      htmlHasRegistration += 1;
      const host = hostOf(event.registrationUrl);
      if (host) hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
    if (!row.registrationUrl.trim() && event.registrationUrl.trim()) wouldGain += 1;
  }

  const storedOnly: DryRunReport["storedOnly"] = [];
  for (const row of rows) {
    if (!scheduleOverlapsWindow(row.startTime, row.endTime, discovery.window) || matchedIds.has(row.id)) {
      continue;
    }
    const plainId = plainWebtoolsEventId(row.externalId);
    const sourceId = eventIdFromWebtoolsSourceUrl(row.sourceUrl);
    if (plainId && sourceId && plainId !== sourceId) {
      if (!conflictRowIds.has(row.id)) {
        conflicts += 1;
        conflictRowIds.add(row.id);
      }
      continue;
    }
    if (conflictRowIds.has(row.id)) {
      continue;
    }
    let reason = "not discovered in the HTML window";
    if (row.externalId.includes("::")) {
      reason = "recurrence-qualified external id left unchanged";
    } else if (plainId && failedIds.has(plainId)) {
      reason = "detail fetch or parse failed";
    } else if (!plainId) {
      reason = "external id is not a plain Webtools id";
    }
    storedOnly.push({
      externalId: row.externalId,
      title: row.title,
      startTime: row.startTime,
      sourceUrl: row.sourceUrl,
      reason,
    });
  }

  const sameTitle = new Map<string, HtmlCandidate[]>();
  for (const event of discovery.candidates) {
    const key = skeleton(event.title);
    sameTitle.set(key, [...(sameTitle.get(key) ?? []), event]);
  }

  const unexplainedStored = storedOnly.filter((row) => row.reason === "not discovered in the HTML window").length;
  const matched = matchedIds.size;
  const blockers: string[] = [];
  if (conflicts > 0) blockers.push(`${conflicts} identity conflicts`);
  if (discovery.calendars.some((calendar) => !calendar.ok)) blockers.push("a calendar list failed");
  if (discovery.listWindows.some((item) => item.action === "failed-closed")) {
    blockers.push("a single-day summary list still returned 100 rows");
  }
  const detailRate = discovery.detailAttempts === 0 ? 0 : discovery.detailFailures.length / discovery.detailAttempts;
  if (discovery.detailFailures.length >= 8 || (discovery.detailAttempts >= 20 && detailRate > 0.05)) {
    blockers.push(`${discovery.detailFailures.length} detail failures`);
  }
  if (discovery.uniqueEventIds !== discovery.candidates.length + discovery.detailFailures.length) {
    blockers.push("discovered ids were collapsed or dropped");
  }
  if (timeValidation.startHourShift >= 5 || (matched >= 30 && timeValidation.startHourShift / matched > 0.02)) {
    blockers.push(`${timeValidation.startHourShift} start times shifted by one hour`);
  }
  if (timeValidation.startMaterial >= 8 || (matched >= 20 && timeValidation.startMaterial / matched > 0.05)) {
    blockers.push(`${timeValidation.startMaterial} material start-time mismatches`);
  }
  const materialTitles = fieldDifferences.title.material ?? 0;
  if (materialTitles >= 10 || (matched >= 20 && materialTitles / matched > 0.1)) {
    blockers.push(`${materialTitles} material title mismatches`);
  }
  const htmlOnlyCount = htmlOnly.length;
  if ((matched === 0 && discovery.candidates.length >= 10) || (htmlOnlyCount >= 15 && htmlOnlyCount > matched)) {
    blockers.push(`${htmlOnlyCount} HTML-only events against ${matched} matches`);
  }
  const storedBase = matched + unexplainedStored;
  if (unexplainedStored >= 15 && storedBase > 0 && unexplainedStored / storedBase > 0.2) {
    blockers.push(`${unexplainedStored} stored events in the window were not in HTML`);
  }
  if (selectorWipe(descriptionStored, descriptionCleared)) blockers.push("HTML descriptions were empty for most stored descriptions");
  if (selectorWipe(locationStored, locationCleared)) blockers.push("HTML locations were empty for most stored locations");
  if (selectorWipe(categoryStored, categoryCleared)) blockers.push("HTML categories were empty for most stored categories");
  if ((fieldDifferences.external_id.material ?? 0) > 0) blockers.push("matched rows changed external_id");

  return {
    window: {
      startDate: discovery.window.startDate,
      endDate: discovery.window.endDate,
      start: discovery.window.start.toISOString(),
      endExclusive: discovery.window.endExclusive.toISOString(),
    },
    calendars: discovery.calendars,
    listWindows: discovery.listWindows,
    uniqueHtmlEvents: discovery.candidates.length,
    detailAttempts: discovery.detailAttempts,
    detailSuccesses: discovery.detailSuccesses,
    detailFailures: discovery.detailFailures,
    identity: { matched, htmlOnly: htmlOnlyCount, conflicts, storedOnlyInWindow: storedOnly.length },
    fieldDifferences,
    fieldExamples,
    timeValidation,
    recurrence: {
      emptyDate: discovery.candidates.filter((event) => event.emptyDate).map(unusual),
      multiDayIds: discovery.candidates.filter((event) => event.listDays.length > 1).map(unusual),
      recurring: discovery.candidates.filter((event) => event.recurring).map(unusual),
      sameTitleDifferentIds: [...sameTitle.values()]
        .filter((events) => new Set(events.map((event) => event.eventId)).size > 1)
        .map((events) => ({
          title: events[0]?.title ?? "",
          eventIds: events.map((event) => event.eventId),
          events: events.map(unusual),
        })),
    },
    originating: {
      matched,
      originatingDiffersFromDiscovery: originatingDiffers,
      originatingMissing,
      storedCalendarDiffersFromOriginating: storedCalendarDiffers,
      examples: originatingExamples,
    },
    registration: {
      matchedBlankStored,
      htmlHasRegistration,
      wouldGain,
      hosts: [...hosts.entries()].map(([host, count]) => ({ host, count })).sort((left, right) => right.count - left.count),
    },
    classification: { transitions, examples: transitionExamples },
    htmlOnly,
    storedOnly,
    gate: { decision: blockers.length ? "BLOCKED" : "READY_FOR_CUTOVER", blockers },
  };
}
