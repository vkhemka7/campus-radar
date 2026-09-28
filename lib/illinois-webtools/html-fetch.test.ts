import { describe, expect, test } from "vitest";
import {
  createWebtoolsHtmlFetcher,
  isAllowedWebtoolsReadUrl,
  webtoolsDetailFetchUrl,
  webtoolsListUrl,
} from "@/lib/illinois-webtools/html-fetch";
import { COLLECTOR_USER_AGENT } from "@/lib/illinois-webtools/constants";

function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe("Webtools HTML fetch guard", () => {
  test("allows list and detail URLs and refuses ICS and export endpoints", () => {
    const list = webtoolsListUrl("2654", "09/28/2026", "03/27/2027");
    expect(list).toContain("/list/2654?");
    expect(list).toContain("listType=summary");
    expect(isAllowedWebtoolsReadUrl(list)).toBe(true);
    expect(isAllowedWebtoolsReadUrl(webtoolsDetailFetchUrl("2654", "33563355"))).toBe(true);
    for (const path of ["/icalOutlook/2654.ics", "/ical/2654.ics", "/export/2654/1", "/outlook/2654", "/eventXML/2654/1", "/userRole/2654"]) {
      expect(isAllowedWebtoolsReadUrl(`https://calendars.illinois.edu${path}`)).toBe(false);
    }
  });

  test("does not request a disallowed redirect", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input));
      return new Response("", {
        status: 302,
        headers: { location: "https://calendars.illinois.edu/icalOutlook/2654.ics" },
      });
    };
    const fetcher = createWebtoolsHtmlFetcher({ fetch: fetchImpl, ...clock(), minIntervalMs: 1000 });
    await expect(fetcher.fetchHtml(webtoolsListUrl("2654", "09/28/2026", "03/27/2027"))).rejects.toThrow(/Refusing/);
    expect(requested).toHaveLength(1);
    expect(requested[0]).not.toMatch(/ical|export|outlook|eventXML|userRole/i);
  });

  test("retries 503 twice at most and honors Retry-After", async () => {
    const headers: HeadersInit[] = [];
    let attempt = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers.push(init?.headers ?? {});
      attempt += 1;
      return attempt === 1
        ? new Response("", { status: 503, headers: { "retry-after": "5" } })
        : new Response("<p>ok</p>", { status: 200 });
    };
    const pauses: number[] = [];
    let time = 0;
    const fetcher = createWebtoolsHtmlFetcher({
      fetch: fetchImpl,
      now: () => time,
      sleep: async (ms: number) => {
        pauses.push(ms);
        time += ms;
      },
    });
    const result = await fetcher.fetchHtml(webtoolsDetailFetchUrl("1551", "33546590"));
    expect(result.ok).toBe(true);
    expect(attempt).toBe(2);
    expect(pauses).toContain(5000);
    expect(headers[0]).toMatchObject({ "user-agent": COLLECTOR_USER_AGENT });
  });

  test("does not retry a 404 and keeps at least one second between requests", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    };
    const pauses: number[] = [];
    let time = 0;
    const fetcher = createWebtoolsHtmlFetcher({
      fetch: fetchImpl,
      now: () => time,
      sleep: async (ms: number) => {
        pauses.push(ms);
        time += ms;
      },
    });
    const first = await fetcher.fetchHtml(webtoolsDetailFetchUrl("2654", "1"));
    const second = await fetcher.fetchHtml(webtoolsDetailFetchUrl("2654", "2"));
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(calls).toBe(2);
    expect(pauses).toEqual([1000]);
  });
});
