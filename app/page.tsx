import Link from "next/link";
import { OccurrenceStateControls } from "@/app/components/occurrence-state-controls";
import { readCareerInterests, readSelectedInterestSlugs } from "@/lib/career-interests";
import { getViewer, type Viewer } from "@/lib/current-user";
import { rankForYou, type ForYouRecommendation } from "@/lib/for-you";
import { EVENT_RESULT_LIMIT, getEvents, type BrowsingEvent, type GetEventsResult } from "@/lib/get-events";
import { googleCalendarDetails, googleCalendarEventUrl } from "@/lib/google-calendar";
import { readOccurrenceStates, type OccurrenceStatus } from "@/lib/occurrence-states";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type SavedStates =
  | { kind: "anonymous" }
  | { kind: "loaded"; states: Map<string, OccurrenceStatus> }
  | { kind: "unavailable" };

/** Reads the signed-in user's states. Anonymous visitors skip this. */
async function loadSavedStates(viewer: Viewer, occurrenceIds: string[]): Promise<SavedStates> {
  if (viewer.status !== "authenticated") return { kind: "anonymous" };
  if (occurrenceIds.length === 0) return { kind: "loaded", states: new Map() };

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { kind: "unavailable" };
  const rows: unknown[] = [];
  for (let offset = 0; offset < occurrenceIds.length; offset += 100) {
    const { data, error } = await client.supabase
      .from("user_occurrence_states")
      .select("occurrence_id, status")
      .eq("user_id", viewer.user.id)
      .in("occurrence_id", occurrenceIds.slice(offset, offset + 100));
    if (error) {
      console.error("Could not load saved event states:", error);
      return { kind: "unavailable" };
    }
    rows.push(...(data ?? []));
  }
  const states = readOccurrenceStates(rows);
  if (!states) {
    console.error("Could not load saved event states: invalid rows");
    return { kind: "unavailable" };
  }
  return { kind: "loaded", states };
}

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

function EventCard({
  occurrence: { occurrenceId, event, provenance, relevance },
  saved,
  recommendation,
}: {
  occurrence: BrowsingEvent;
  saved: SavedStates;
  recommendation?: string;
}) {
  const registrationUrls = [...new Set(provenance.map(({ registrationUrl }) => registrationUrl).filter(Boolean))];
  const calendarHref = googleCalendarEventUrl({
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    details: googleCalendarDetails([
      ...registrationUrls,
      ...provenance.map(({ sourceUrl }) => sourceUrl),
    ]),
  });
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {event.category}
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {event.title}
      </h2>
      {recommendation ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Why recommended: {recommendation}
        </p>
      ) : relevance.classification === "relevant" ? (
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
        {calendarHref ? (
          <a
            href={calendarHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-700 dark:hover:decoration-zinc-50"
          >
            Add to Google Calendar
          </a>
        ) : null}
      </div>
      {saved.kind === "loaded" ? (
        <OccurrenceStateControls occurrenceId={occurrenceId} status={saved.states.get(occurrenceId) ?? null} />
      ) : null}
    </article>
  );
}

type ForYouState =
  | { kind: "interests-error" }
  | { kind: "needs-interests" }
  | { kind: "events-error"; message: string }
  | { kind: "ready"; recommendations: ForYouRecommendation[]; saved: SavedStates };

async function loadForYou(viewer: Viewer & { status: "authenticated" }, search: string, days: 7 | 30 | undefined): Promise<ForYouState> {
  const client = await createRequestSupabaseClient();
  if (!client.ok) return { kind: "interests-error" };
  const [catalogResult, selectedResult] = await Promise.all([
    client.supabase.from("career_interests").select("slug, label, sort_order"),
    client.supabase.from("profile_career_interests").select("interest_slug").eq("user_id", viewer.user.id),
  ]);
  const catalog = catalogResult.error ? null : readCareerInterests(catalogResult.data);
  const selected = selectedResult.error ? null : readSelectedInterestSlugs(selectedResult.data);
  if (!catalog || !selected) {
    console.error("Could not load career interests:", catalogResult.error ?? selectedResult.error);
    return { kind: "interests-error" };
  }
  const savedSlugs = selected.filter((slug) => catalog.some((interest) => interest.slug === slug));
  if (savedSlugs.length === 0) return { kind: "needs-interests" };

  const result = await getEvents({ view: "for-you", search, days });
  if (!result.ok) return { kind: "events-error", message: result.error };
  const saved = await loadSavedStates(viewer, result.events.map(({ occurrenceId }) => occurrenceId));
  const notInterested = saved.kind === "loaded"
    ? new Set([...saved.states].filter(([, status]) => status === "not_interested").map(([occurrenceId]) => occurrenceId))
    : undefined;
  return {
    kind: "ready",
    recommendations: rankForYou(result.events, catalog, savedSlugs, { excludeOccurrenceIds: notInterested }),
    saved,
  };
}

function ForYouResults({
  forYou,
  saved,
  careerHref,
}: {
  forYou: ForYouState;
  saved: SavedStates;
  careerHref: string;
}) {
  if (forYou.kind === "interests-error") {
    return (
      <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        Career interests could not be loaded. Try again.
      </p>
    );
  }
  if (forYou.kind === "events-error") {
    return (
      <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        {forYou.message}
      </p>
    );
  }
  if (forYou.kind === "needs-interests") {
    return (
      <p className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        Choose career interests to see a For You ranking.{" "}
        <Link href="/account/interests" className="font-medium text-zinc-950 underline dark:text-zinc-50">
          Edit career interests
        </Link>
        . Career &amp; Industry and All Events stay available.
      </p>
    );
  }

  return (
    <>
      {forYou.recommendations.length > 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Showing up to {EVENT_RESULT_LIMIT} events. Interest matches come first.
        </p>
      ) : null}
      {saved.kind === "unavailable" ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          Your saved event plans could not be loaded. Events are still shown below.
        </p>
      ) : null}
      <section className="mt-8 space-y-4" aria-label="Events for you">
        {forYou.recommendations.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            No upcoming events matched your interests.{" "}
            <Link href={careerHref} className="font-medium text-zinc-950 underline dark:text-zinc-50">
              Browse Career &amp; Industry
            </Link>{" "}
            with the same search and date filters.
          </p>
        ) : (
          forYou.recommendations.map((item) => (
            <EventCard
              key={item.occurrence.occurrenceId}
              occurrence={item.occurrence}
              saved={saved}
              recommendation={item.explanation}
            />
          ))
        )}
      </section>
    </>
  );
}

function filterHref(view: "career" | "all" | "for-you", search: string, days: 7 | 30 | undefined) {
  const params = new URLSearchParams({ view });
  if (search) params.set("q", search);
  if (days) params.set("days", String(days));
  return `/?${params}`;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const days = params.days === "7" ? 7 : params.days === "30" ? 30 : undefined;
  const requested = params.view === "all" ? "all" : params.view === "for-you" ? "for-you" : "career";
  const viewer = await getViewer();
  const signedIn = viewer.status === "authenticated";
  const view = requested === "for-you" && !signedIn ? "career" : requested;
  const forYou = view === "for-you" && viewer.status === "authenticated" ? await loadForYou(viewer, search, days) : null;
  const result: GetEventsResult | null = forYou ? null : await getEvents({
    search,
    days,
    view: view === "for-you" ? "career" : view,
  });
  const saved = forYou?.kind === "ready"
    ? forYou.saved
    : await loadSavedStates(viewer, result?.ok ? result.events.map(({ occurrenceId }) => occurrenceId) : []);
  const careerHref = filterHref("career", search, days);

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
              {signedIn ? <option value="for-you">For You</option> : null}
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
            <Link href={filterHref("all", search, days)} className="underline">View all upcoming events</Link>
          </p>
        ) : view === "for-you" ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            For You puts saved-interest matches first. A career opportunity is a general career event, not an interest match.
          </p>
        ) : null}
        {forYou ? (
          <ForYouResults forYou={forYou} saved={saved} careerHref={careerHref} />
        ) : result?.ok ? (
          <>
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              Showing up to {EVENT_RESULT_LIMIT} events, soonest first. Includes events happening now.
            </p>
            {saved.kind === "anonymous" ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
                  Log in
                </Link>{" "}
                to mark events as Interested, Going, or Not Interested.
              </p>
            ) : saved.kind === "unavailable" ? (
              <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                Your saved event plans could not be loaded. Events are still shown below.
              </p>
            ) : null}
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
                  <EventCard key={occurrence.occurrenceId} occurrence={occurrence} saved={saved} />
                ))
              )}
            </section>
          </>
        ) : (
          <p
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {result?.error ?? "Events could not be loaded. Please try again later."}
          </p>
        )}
      </main>
    </div>
  );
}
