import { EmptyState } from "@/app/components/empty-state";
import Link from "next/link";
import { EventCard, type SavedStates } from "@/app/components/event-card";
import {
  readCareerInterests,
  readSelectedInterestSlugs,
} from "@/lib/career-interests";
import { getViewer, type Viewer } from "@/lib/current-user";
import { rankForYou, type ForYouRecommendation } from "@/lib/for-you";
import {
  EVENT_RESULT_LIMIT,
  getEvents,
  type GetEventsResult,
} from "@/lib/get-events";
import { readOccurrenceStates } from "@/lib/occurrence-states";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Reads the signed-in user's states. Anonymous visitors skip this. */
async function loadSavedStates(
  viewer: Viewer,
  occurrenceIds: string[],
): Promise<SavedStates> {
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

type ForYouState =
  | { kind: "interests-error" }
  | { kind: "needs-interests" }
  | { kind: "events-error"; message: string }
  | {
      kind: "ready";
      recommendations: ForYouRecommendation[];
      saved: SavedStates;
    };

async function loadForYou(
  viewer: Viewer & { status: "authenticated" },
  search: string,
  days: 7 | 30 | undefined,
): Promise<ForYouState> {
  const client = await createRequestSupabaseClient();
  if (!client.ok) return { kind: "interests-error" };
  const [catalogResult, selectedResult] = await Promise.all([
    client.supabase.from("career_interests").select("slug, label, sort_order"),
    client.supabase
      .from("profile_career_interests")
      .select("interest_slug")
      .eq("user_id", viewer.user.id),
  ]);
  const catalog = catalogResult.error
    ? null
    : readCareerInterests(catalogResult.data);
  const selected = selectedResult.error
    ? null
    : readSelectedInterestSlugs(selectedResult.data);
  if (!catalog || !selected) {
    console.error(
      "Could not load career interests:",
      catalogResult.error ?? selectedResult.error,
    );
    return { kind: "interests-error" };
  }
  const savedSlugs = selected.filter((slug) =>
    catalog.some((interest) => interest.slug === slug),
  );
  if (savedSlugs.length === 0) return { kind: "needs-interests" };

  const result = await getEvents({ view: "for-you", search, days });
  if (!result.ok) return { kind: "events-error", message: result.error };
  const saved = await loadSavedStates(
    viewer,
    result.events.map(({ occurrenceId }) => occurrenceId),
  );
  const notInterested =
    saved.kind === "loaded"
      ? new Set(
          [...saved.states]
            .filter(([, status]) => status === "not_interested")
            .map(([occurrenceId]) => occurrenceId),
        )
      : undefined;
  return {
    kind: "ready",
    recommendations: rankForYou(result.events, catalog, savedSlugs, {
      excludeOccurrenceIds: notInterested,
    }),
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
      <p role="alert" className="notice notice-error">
        Career interests could not be loaded. Try again.
      </p>
    );
  }
  if (forYou.kind === "events-error") {
    return (
      <p role="alert" className="notice notice-error">
        {forYou.message}
      </p>
    );
  }
  if (forYou.kind === "needs-interests") {
    return (
      <EmptyState
        title="Make this feed yours."
        href="/account/interests"
        action="Choose your interests"
      >
        Pick the fields you want to see first. You can keep browsing every
        event, too.
      </EmptyState>
    );
  }

  return (
    <>
      {forYou.recommendations.length > 0 ? (
        <p className="feed-note">
          {forYou.recommendations.length} recommendations · Interest matches
          first · Up to {EVENT_RESULT_LIMIT} results
        </p>
      ) : null}
      {saved.kind === "unavailable" ? (
        <p role="alert" className="notice notice-error">
          Your saved event plans could not be loaded. Events are still shown
          below.
        </p>
      ) : null}
      <section className="event-list" aria-label="Events for you">
        {forYou.recommendations.length === 0 ? (
          <EmptyState
            title="Nothing on your radar just yet."
            href={careerHref}
            action="Browse career events"
          >
            No upcoming events match your interests and filters. Try a wider
            search or check back for new listings.
          </EmptyState>
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

function filterHref(
  view: "career" | "all" | "for-you",
  search: string,
  days: 7 | 30 | undefined,
) {
  const params = new URLSearchParams({ view });
  if (search) params.set("q", search);
  if (days) params.set("days", String(days));
  return `/?${params}`;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const days = params.days === "7" ? 7 : params.days === "30" ? 30 : undefined;
  const requested =
    params.view === "all"
      ? "all"
      : params.view === "for-you"
        ? "for-you"
        : "career";
  const viewer = await getViewer();
  const signedIn = viewer.status === "authenticated";
  const view = requested === "for-you" && !signedIn ? "career" : requested;
  const forYou =
    view === "for-you" && viewer.status === "authenticated"
      ? await loadForYou(viewer, search, days)
      : null;
  const result: GetEventsResult | null = forYou
    ? null
    : await getEvents({
        search,
        days,
        view: view === "for-you" ? "career" : view,
      });
  const saved =
    forYou?.kind === "ready"
      ? forYou.saved
      : await loadSavedStates(
          viewer,
          result?.ok
            ? result.events.map(({ occurrenceId }) => occurrenceId)
            : [],
        );
  const careerHref = filterHref("career", search, days);

  return (
    <main id="main-content" className="page-shell">
      <section className="feed-intro">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> University of Illinois
            Urbana-Champaign
          </p>
          <h1>
            Good things.
            <br />
            <span>On your radar.</span>
          </h1>
          <p className="intro-copy">
            Career moves, new connections, and a reason to leave your room. The
            worthwhile things happening at Illinois, in one place.
          </p>
        </div>
        <div className="intro-stamp" aria-hidden="true">
          <span className="radar-art">
            <i />
          </span>
          <span>
            LESS SEARCHING.
            <br />
            MORE SHOWING UP.
          </span>
        </div>
      </section>
      <div className="discovery-layout">
        <div className="feed-column">
          <nav className="feed-tabs" aria-label="Discover events">
            <Link
              href={filterHref("career", search, days)}
              aria-current={view === "career" ? "page" : undefined}
            >
              Career &amp; Industry
            </Link>
            <Link
              href={filterHref("all", search, days)}
              aria-current={view === "all" ? "page" : undefined}
            >
              All events
            </Link>
            <Link
              href={signedIn ? filterHref("for-you", search, days) : "/login"}
              aria-current={view === "for-you" ? "page" : undefined}
            >
              For you <span aria-hidden="true">↗</span>
            </Link>
          </nav>
          <form action="/" method="get" className="feed-filters">
            <input type="hidden" name="view" value={view} />
            <label className="search-field">
              <span className="sr-only">Search event titles</span>
              <input
                key={search}
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Find a talk, company, or opportunity…"
              />
            </label>
            <label>
              <span className="sr-only">Date range</span>
              <select key={days ?? "all"} name="days" defaultValue={days ?? ""}>
                <option value="">Any upcoming</option>
                <option value="7">Next 7 days</option>
                <option value="30">Next 30 days</option>
              </select>
            </label>
            <button className="button" type="submit">
              Find events
            </button>
            {(search || days) && (
              <Link className="clear-filters" href={`/?view=${view}`}>
                Clear filters
              </Link>
            )}
          </form>
          <div className="feed-heading">
            <h2>
              {view === "for-you"
                ? "Picked for your interests"
                : view === "all"
                  ? "Around campus"
                  : "Your next opportunity"}
            </h2>
            <span>THE CAMPUS EDIT</span>
          </div>
          {forYou ? (
            <ForYouResults
              forYou={forYou}
              saved={saved}
              careerHref={careerHref}
            />
          ) : result?.ok ? (
            <>
              {result.events.length > 0 ? (
                <p className="feed-note">
                  {result.events.length}{" "}
                  {result.events.length === 1 ? "event" : "events"} · Soonest
                  first · Up to {EVENT_RESULT_LIMIT} results
                </p>
              ) : null}
              {saved.kind === "anonymous" ? (
                <p className="feed-note">
                  <Link href="/login">Log in</Link> to keep track of what
                  catches your eye.
                </p>
              ) : saved.kind === "unavailable" ? (
                <p role="alert" className="notice notice-error">
                  Your saved event plans could not be loaded. Events are still
                  shown below.
                </p>
              ) : null}
              <section
                className="event-list"
                aria-label="Upcoming and ongoing events"
              >
                {result.events.length === 0 ? (
                  <EmptyState
                    title={
                      search || days
                        ? "No matches this time."
                        : "A quiet moment on campus."
                    }
                    href={
                      view === "career"
                        ? filterHref("all", search, days)
                        : `/?view=${view}`
                    }
                    action={
                      view === "career"
                        ? "Browse all events"
                        : "Reset your filters"
                    }
                  >
                    {search || days
                      ? "Try another title or a wider date range. Your next thing may be just outside these filters."
                      : "There are no upcoming events in this view right now. Check back soon for the next campus edit."}
                  </EmptyState>
                ) : (
                  result.events.map((occurrence) => (
                    <EventCard
                      key={occurrence.occurrenceId}
                      occurrence={occurrence}
                      saved={saved}
                    />
                  ))
                )}
              </section>
            </>
          ) : (
            <p className="notice notice-error" role="alert">
              {result?.error ??
                "Events could not be loaded. Please try again later."}
            </p>
          )}
        </div>
        <aside className="discovery-rail">
          <section className="rail-note">
            <p className="eyebrow">A LITTLE MORE YOU</p>
            <h2>
              Your interests.
              <br />
              Your next thing.
            </h2>
            <p>
              Choose the fields you’re curious about. We’ll put matching
              opportunities first.
            </p>
            <Link
              className="button"
              href={signedIn ? "/account/interests" : "/signup"}
            >
              {signedIn ? "Tune your interests" : "Make it personal"}{" "}
              <span aria-hidden="true">↗</span>
            </Link>
          </section>
          <section className="rail-about">
            <p className="eyebrow">ONE CAMPUS. LESS TAB-HOPPING.</p>
            <h3>Connected to the source.</h3>
            <p>
              Events from Illinois campus calendars, brought together. Open any
              listing to check details and registration with the organizer.
            </p>
            <p>
              Career picks use text matches, so a useful event may slip through.{" "}
              <Link href={filterHref("all", search, days)}>
                Browse all events ↗
              </Link>
            </p>
          </section>
          <p className="rail-footer">
            CampusRadar / Illinois
            <br />A little direction for what’s next.
          </p>
        </aside>
      </div>
    </main>
  );
}
