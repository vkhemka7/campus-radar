import { describe, expect, test } from "vitest";
import { discoverWebtoolsHtml } from "@/lib/illinois-webtools/discover-html";
import { webtoolsDetailFetchUrl, webtoolsListUrl, type WebtoolsHtmlFetcher } from "@/lib/illinois-webtools/html-fetch";
import { webtoolsCollectionWindow, webtoolsDiscoverySpans } from "@/lib/illinois-webtools/html-window";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const EMPTY = `<div id="ws-calendar-content"><p id="no-events">There are no events for this criteria</p></div>`;

function listHtml(heading: string, entries: { id: string; time: string; title?: string }[]): string {
  const items = entries
    .map(
      (entry) =>
        `<li class="entry"><h3><a href="/detail/2654?eventId=${entry.id}">${entry.title ?? `Event ${entry.id}`}</a></h3><div class="entry-time"><dd>${entry.time}</dd></div></li>`,
    )
    .join("");
  return `<div id="ws-calendar-content"><h2>${heading}</h2><ul>${items}</ul></div>`;
}

function capped(count: number): string {
  return listHtml(
    "Monday, September 28, 2026",
    Array.from({ length: count }, (_, index) => ({ id: String(9000 + index), time: "6:30 pm" })),
  );
}

function detail(id: string, date: string): string {
  return `<meta content="https://calendars.illinois.edu/detail/2654/${id}" property="og:url"><h1>Event ${id}</h1><div class="date">${date}</div>`;
}

function fetcherFor(pages: (url: URL) => string): { fetcher: WebtoolsHtmlFetcher; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetcher: {
      async fetchHtml(url: string) {
        urls.push(url);
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/detail/")) {
          const eventId = parsed.pathname.split("/").at(-1) ?? "";
          return { ok: true, url, status: 200, html: detail(eventId, "Sep 28, 2026 6:30 pm") };
        }
        return { ok: true, url, status: 200, html: pages(parsed) };
      },
    },
  };
}

describe("bounded Webtools HTML discovery", () => {
  test("requests a normal 30-day window once when it is under the row cap", async () => {
    const { fetcher, urls } = fetcherFor((url) => {
      if (url.searchParams.get("startDate") === "09/28/2026" && url.searchParams.get("endDate") === "10/27/2026") {
        return listHtml("Monday, September 28, 2026", [{ id: "33563355", time: "6:30 pm" }]);
      }
      return EMPTY;
    });
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });
    const spans = webtoolsDiscoverySpans(webtoolsCollectionWindow(NOW));

    expect(urls.filter((url) => url.includes("/list/"))).toEqual(
      spans.map((span) => webtoolsListUrl("2654", span.startQuery, span.endQuery)),
    );
    expect(found.listWindows.some((window) => window.action === "split" || window.action === "failed-closed")).toBe(false);
    expect(found.calendars[0]).toMatchObject({ ok: true, uniqueEventIds: 1, capHits: 0 });
    expect(found.detailAttempts).toBe(1);
  });

  test("splits a window that returns exactly 100 rows and keeps only the smaller results", async () => {
    const { fetcher, urls } = fetcherFor((url) => {
      const start = url.searchParams.get("startDate");
      const end = url.searchParams.get("endDate");
      if (start === "09/28/2026" && end === "10/27/2026") {
        return capped(100);
      }
      if (start === "09/28/2026" && end === "10/12/2026") {
        return listHtml("Monday, September 28, 2026", [{ id: "111", time: "6:30 pm" }]);
      }
      if (start === "10/13/2026" && end === "10/27/2026") {
        return listHtml("Monday, October 13, 2026", [{ id: "222", time: "6:30 pm" }]);
      }
      return EMPTY;
    });
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });

    expect(urls).toContain(webtoolsListUrl("2654", "09/28/2026", "10/12/2026"));
    expect(urls).toContain(webtoolsListUrl("2654", "10/13/2026", "10/27/2026"));
    expect(found.listWindows).toContainEqual({
      calendarId: "2654",
      startDate: "2026-09-28",
      endDate: "2026-10-27",
      listRows: 100,
      action: "split",
    });
    expect(found.candidates.map((event) => event.eventId).sort()).toEqual(["111", "222"]);
    expect(found.calendars[0]).toMatchObject({ ok: true, capHits: 1 });
    expect(urls.filter((url) => url.includes("/detail/"))).toEqual([
      webtoolsDetailFetchUrl("2654", "111"),
      webtoolsDetailFetchUrl("2654", "222"),
    ]);
  });

  test("combines appearances from both halves of a split window", async () => {
    const { fetcher } = fetcherFor((url) => {
      const start = url.searchParams.get("startDate");
      const end = url.searchParams.get("endDate");
      if (start === "09/28/2026" && end === "10/27/2026") {
        return capped(100);
      }
      if (start === "09/28/2026" && end === "10/12/2026") {
        return listHtml("Monday, September 28, 2026", [{ id: "111", time: "6:30 pm" }]);
      }
      if (start === "10/13/2026" && end === "10/27/2026") {
        return listHtml("Monday, October 13, 2026", [
          { id: "111", time: "1:00 pm" },
          { id: "222", time: "2:00 pm" },
        ]);
      }
      return EMPTY;
    });
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });
    const combined = found.candidates.find((event) => event.eventId === "111");

    expect(found.candidates).toHaveLength(2);
    expect(combined?.listDays).toEqual(["2026-09-28", "2026-10-13"]);
    expect(combined?.displayedTimes).toEqual(["6:30 pm", "1:00 pm"]);
    expect(found.detailAttempts).toBe(2);
  });

  test("dedupes the same event id discovered in separate date windows", async () => {
    const { fetcher, urls } = fetcherFor((url) => {
      const start = url.searchParams.get("startDate");
      if (start === "09/28/2026") {
        return listHtml("Monday, September 28, 2026", [{ id: "33563355", time: "6:30 pm" }]);
      }
      if (start === "10/28/2026") {
        return listHtml("Monday, October 28, 2026", [{ id: "33563355", time: "6:30 pm" }]);
      }
      return EMPTY;
    });
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });

    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]?.listDays).toEqual(["2026-09-28", "2026-10-28"]);
    expect(found.detailAttempts).toBe(1);
    expect(urls.filter((url) => url.includes("/detail/"))).toEqual([webtoolsDetailFetchUrl("2654", "33563355")]);
  });

  test("fails a calendar when a single day still returns 100 rows", async () => {
    const { fetcher, urls } = fetcherFor((url) => {
      const start = url.searchParams.get("startDate");
      const end = url.searchParams.get("endDate");
      if (start === "09/28/2026") {
        return capped(100);
      }
      if (start === end) {
        return EMPTY;
      }
      return EMPTY;
    });
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });

    expect(found.calendars[0]?.ok).toBe(false);
    expect(found.calendars[0]?.error).toMatch(/100 rows on 2026-09-28/);
    expect(found.listWindows).toContainEqual({
      calendarId: "2654",
      startDate: "2026-09-28",
      endDate: "2026-09-28",
      listRows: 100,
      action: "failed-closed",
    });
    expect(found.candidates).toHaveLength(0);
    expect(urls.some((url) => url.includes("/detail/"))).toBe(false);
  });

  test("corroborates a detail clock that has no meridiem from the list row", async () => {
    const { fetcher } = fetcherFor((url) => {
      if (url.searchParams.get("startDate") === "09/28/2026" && url.searchParams.get("endDate") === "10/27/2026") {
        return listHtml("Wednesday, October 7, 2026", [{ id: "33553793", time: "11:00 am", title: "Career Fair" }]);
      }
      return EMPTY;
    });
    fetcher.fetchHtml = async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/detail/")) {
        return { ok: true, url, status: 200, html: detail("33553793", "Oct 7, 2026 11:00") };
      }
      return { ok: true, url, status: 200, html: parsed.searchParams.get("endDate") === "10/27/2026"
        ? listHtml("Wednesday, October 7, 2026", [{ id: "33553793", time: "11:00 am", title: "Career Fair" }])
        : EMPTY };
    };
    const found = await discoverWebtoolsHtml({ calendars: [{ id: "2654", label: "Siebel" }], fetcher, now: NOW });

    expect(found.detailFailures).toEqual([]);
    expect(found.candidates[0]).toMatchObject({
      eventId: "33553793",
      startTime: "2026-10-07T16:00:00.000Z",
      endTime: "2026-10-07T16:00:00.000Z",
    });
  });
});
