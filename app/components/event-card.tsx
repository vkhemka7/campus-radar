import Link from "next/link";
import { OccurrenceStateControls } from "./occurrence-state-controls";
import type { BrowsingEvent } from "@/lib/get-events";
import type { OccurrenceStatus } from "@/lib/occurrence-states";
import {
  googleCalendarDetails,
  googleCalendarEventUrl,
} from "@/lib/google-calendar";

export type SavedStates =
  | { kind: "anonymous" }
  | { kind: "loaded"; states: Map<string, OccurrenceStatus> }
  | { kind: "unavailable" };

export function EventCard({
  occurrence: { occurrenceId, event, provenance, relevance },
  saved,
  recommendation,
}: {
  occurrence: BrowsingEvent;
  saved: SavedStates;
  recommendation?: string;
}) {
  const date = new Date(event.startTime);
  const format = (options: Intl.DateTimeFormatOptions, value = date) =>
    new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: event.timezone,
    }).format(value);
  const registrationUrls = [
    ...new Set(provenance.map((row) => row.registrationUrl).filter(Boolean)),
  ];
  const calendarHref = googleCalendarEventUrl({
    ...event,
    details: googleCalendarDetails([
      ...registrationUrls,
      ...provenance.map((row) => row.sourceUrl),
    ]),
  });
  const reason =
    recommendation ??
    (relevance.classification === "relevant"
      ? relevance.reasons
          .slice(0, 2)
          .map((reason) => reason.explanation)
          .join(" ")
      : "");
  const fullWhen = format({
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const endDate = new Date(event.endTime);
  const fullEnd = format(
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
    endDate,
  );
  const zone =
    new Intl.DateTimeFormat("en-US", {
      timeZone: event.timezone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const clock = (value = date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: event.timezone,
    }).formatToParts(value);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return {
      time: `${read("hour")}:${read("minute")}`,
      period: read("dayPeriod"),
    };
  };
  const startClock = clock();
  const endClock = clock(endDate);
  const sameDay =
    format({ month: "short", day: "numeric" }) ===
    format({ month: "short", day: "numeric" }, endDate);
  const visibleWhen =
    event.startTime === event.endTime
      ? `${startClock.time} ${startClock.period} ${zone}`.trim()
      : sameDay && startClock.period === endClock.period
        ? `${startClock.time}–${endClock.time} ${endClock.period} ${zone}`.trim()
        : sameDay
          ? `${startClock.time} ${startClock.period}–${endClock.time} ${endClock.period} ${zone}`.trim()
          : `${startClock.time} ${startClock.period} – ${format({ month: "short", day: "numeric" }, endDate)}, ${endClock.time} ${endClock.period} ${zone}`.trim();
  return (
    <article className="event-card" id={`event-${occurrenceId}`}>
      <div className="event-date" aria-hidden="true">
        <span>{format({ month: "short" })}</span>
        <strong>{format({ day: "numeric" })}</strong>
        <span>{format({ weekday: "short" })}</span>
      </div>
      <div className="event-content">
        <div className="event-eyebrow">
          <span className="category">{event.category || "On campus"}</span>
          {event.company && <span>{event.company}</span>}
        </div>
        <h3>{event.title}</h3>
        <div className="event-meta">
          <p>
            <time dateTime={event.startTime}>
              <span className="sr-only">
                {fullWhen}
                {event.startTime === event.endTime ? "" : `. Ends ${fullEnd}`}
              </span>
              <span aria-hidden="true">{visibleWhen}</span>
            </time>
          </p>
          <p>{event.location || "Location to be announced"}</p>
        </div>
        {reason && (
          <p className="event-reason">
            <span aria-hidden="true">↳ </span>
            {reason}
          </p>
        )}
        {event.description && (
          <div className="event-description">
            <p className="description-preview" aria-hidden="true">
              {event.description}
            </p>
            <details>
              <summary>
                <span className="description-toggle">
                  About this event <span aria-hidden="true">+</span>
                </span>
              </summary>
              <p>{event.description}</p>
            </details>
          </div>
        )}
        <div className="event-actions">
          {saved.kind === "loaded" ? (
            <OccurrenceStateControls
              occurrenceId={occurrenceId}
              status={saved.states.get(occurrenceId) ?? null}
            />
          ) : saved.kind === "anonymous" ? (
            <Link className="button secondary" href="/login">
              Log in to save ↗
            </Link>
          ) : (
            <span className="muted">Saving is temporarily unavailable</span>
          )}
          {calendarHref && (
            <a
              className="calendar-link"
              href={calendarHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Google Calendar</span>
              <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens a new tab)</span>
            </a>
          )}
        </div>
        <details className="event-sources">
          <summary>
            From{" "}
            {provenance[0]?.source || event.source || "the campus calendar"}
            {provenance.length > 1 ? ` · ${provenance.length} listings` : ""}
          </summary>
          <div className="source-content">
            <p>
              {event.startTime === event.endTime
                ? "End time isn’t listed. Calendar links allow one hour; check the original listing."
                : `Ends ${format({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }, new Date(event.endTime))}.`}
            </p>
            {registrationUrls.map((url, i) => (
              <a href={url} key={url}>
                Register
                {registrationUrls.length > 1 ? ` · option ${i + 1}` : ""} ↗
              </a>
            ))}
            {provenance.map((source, i) => (
              <a
                key={`${source.source}:${source.externalId}`}
                href={source.sourceUrl}
              >
                View original event
                {provenance.length > 1 ? ` · listing ${i + 1}` : ""} ↗
              </a>
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}
