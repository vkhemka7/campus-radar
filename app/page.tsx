import Link from "next/link";
import { EVENT_RESULT_LIMIT, getEvents, type BrowsingEvent } from "@/lib/get-events";

export const dynamic = "force-dynamic";

function formatEventTime(isoDateTime: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(isoDateTime));
}

function EventCard({ event, provenance, relevance }: BrowsingEvent) {
  const registrationUrls = [...new Set(provenance.map(({ registrationUrl }) => registrationUrl).filter(Boolean))];
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {event.category}
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {event.title}
      </h2>
      {relevance.classification === "relevant" ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Why included: {relevance.reasons.slice(0, 2).map((reason) => reason.explanation).join(" ")}
        </p>
      ) : null}
      {event.company ? (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          {event.company}
        </p>
      ) : null}
      {event.description ? (
        <details className="group mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <summary className="cursor-pointer">
            <span className="line-clamp-3 group-open:hidden">{event.description}</span>
            <span className="font-medium underline group-open:hidden">Read description</span>
            <span className="hidden font-medium underline group-open:inline">Hide description</span>
          </summary>
          <p className="mt-2 whitespace-pre-line break-words">{event.description}</p>
        </details>
      ) : null}
      <dl className="mt-4 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <div>
          <dt className="inline font-medium text-zinc-800 dark:text-zinc-200">
            Starts:{" "}
          </dt>
          <dd className="inline">
            {formatEventTime(event.startTime, event.timezone)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-zinc-800 dark:text-zinc-200">
            Ends:{" "}
          </dt>
          <dd className="inline">
            {event.startTime === event.endTime
              ? "Not listed on the source calendar"
              : formatEventTime(event.endTime, event.timezone)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-zinc-800 dark:text-zinc-200">
            Location:{" "}
          </dt>
          <dd className="inline">{event.location}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-zinc-800 dark:text-zinc-200">
            Source:{" "}
          </dt>
          <dd className="inline">{[...new Set(provenance.map(({ source }) => source))].join(", ")}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
        {registrationUrls.map((url, index) => (
          <a
            key={url}
            href={url}
            className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-700 dark:hover:decoration-zinc-50"
          >
            Registration{registrationUrls.length > 1 ? ` ${index + 1}` : ""}
          </a>
        ))}
        {provenance.map((sourceEvent, index) => (
          <a
            key={`${sourceEvent.source}:${sourceEvent.externalId}`}
            href={sourceEvent.sourceUrl}
            className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-700 dark:hover:decoration-zinc-50"
          >
            Original source{provenance.length > 1 ? ` ${index + 1}` : ""}
          </a>
        ))}
      </div>
    </article>
  );
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const days = params.days === "7" ? 7 : params.days === "30" ? 30 : undefined;
  const view = params.view === "all" ? "all" : "career";
  const result = await getEvents({ search, days, view });
  const allParams = new URLSearchParams({ view: "all" });
  if (search) allParams.set("q", search);
  if (days) allParams.set("days", String(days));

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="w-full max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          UIUC
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          CampusRadar
        </h1>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Career events around campus, in one place — so relevant opportunities
          can find you instead of you hunting through calendars.
        </p>
        <form action="/" method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            View
            <select key={view} name="view" defaultValue={view} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
              <option value="career">Career &amp; Industry</option>
              <option value="all">All Events</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            Search event titles
            <input
              key={search}
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search titles"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Date range
            <select
              key={days ?? "all"}
              name="days"
              defaultValue={days ?? ""}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">Any upcoming</option>
              <option value="7">Next 7 days</option>
              <option value="30">Next 30 days</option>
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">
            Search
          </button>
          <Link href={`/?view=${view}`} className="py-2 text-sm underline">Clear filters</Link>
        </form>
        {view === "career" ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Career &amp; Industry uses simple text rules and may miss useful events.{" "}
            <Link href={`/?${allParams}`} className="underline">View all upcoming events</Link>
          </p>
        ) : null}
        {result.ok ? (
          <>
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              Showing up to {EVENT_RESULT_LIMIT} events, soonest first. Includes events happening now.
            </p>
            <section className="mt-8 space-y-4" aria-label="Upcoming and ongoing events">
              {result.events.length === 0 ? (
                <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  {view === "career"
                    ? "No Career & Industry matches. Try All Events to browse without the career filter."
                    : search || days
                    ? "No upcoming or ongoing events match your filters. Try another search or clear the filters."
                    : "No upcoming or ongoing events are available right now. Check back soon."}
                </p>
              ) : (
                result.events.map((occurrence) => (
                  <EventCard key={occurrence.occurrenceId} {...occurrence} />
                ))
              )}
            </section>
          </>
        ) : (
          <p
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {result.error}
          </p>
        )}
      </main>
    </div>
  );
}
