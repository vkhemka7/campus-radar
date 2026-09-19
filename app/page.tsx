import { type CampusEvent } from "@/lib/events";
import { getEvents } from "@/lib/get-events";

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

function EventCard({ event }: { event: CampusEvent }) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {event.category}
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {event.title}
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        {event.company}
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {event.description}
      </p>
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
            {formatEventTime(event.endTime, event.timezone)}
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
          <dd className="inline">{event.source}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
        <a
          href={event.registrationUrl}
          className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-700 dark:hover:decoration-zinc-50"
        >
          Registration
        </a>
        <a
          href={event.sourceUrl}
          className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-700 dark:hover:decoration-zinc-50"
        >
          Original source
        </a>
      </div>
    </article>
  );
}

export default async function Home() {
  const result = await getEvents();

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
        {result.ok ? (
          <>
            <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              Events are loaded from the CampusRadar database. Current rows are
              development seed data, not live campus listings.
            </p>
            <section className="mt-8 space-y-4" aria-label="Upcoming events">
              {result.events.length === 0 ? (
                <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  No events are stored in the database yet. After you run the
                  seed SQL in Supabase, refresh this page.
                </p>
              ) : (
                result.events.map((event) => (
                  <EventCard key={event.id} event={event} />
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
