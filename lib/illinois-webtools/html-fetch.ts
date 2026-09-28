import { COLLECTOR_USER_AGENT } from "@/lib/illinois-webtools/constants";

const ALLOWED_PATH = /^\/(?:list\/\d+|detail\/\d+\/\d+)\/?$/;
const RETRY_STATUSES = new Set([429, 502, 503]);
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 120_000;

export class DisallowedWebtoolsUrlError extends Error {
  constructor(url: string) {
    super(`Refusing Webtools URL outside the public list/detail pages: ${url}`);
    this.name = "DisallowedWebtoolsUrlError";
  }
}

export function isAllowedWebtoolsReadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "calendars.illinois.edu" &&
    ALLOWED_PATH.test(url.pathname)
  );
}

export function assertAllowedWebtoolsReadUrl(value: string): URL {
  if (!isAllowedWebtoolsReadUrl(value)) {
    throw new DisallowedWebtoolsUrlError(value);
  }
  return new URL(value);
}

export function webtoolsListUrl(calendarId: string, startQuery: string, endQuery: string): string {
  if (!/^\d+$/.test(calendarId)) {
    throw new DisallowedWebtoolsUrlError(calendarId);
  }
  const url = new URL(`https://calendars.illinois.edu/list/${calendarId}`);
  url.searchParams.set("listType", "summary");
  url.searchParams.set("startDate", startQuery);
  url.searchParams.set("endDate", endQuery);
  return assertAllowedWebtoolsReadUrl(url.toString()).toString();
}

export function webtoolsDetailFetchUrl(calendarId: string, eventId: string): string {
  if (!/^\d+$/.test(calendarId) || !/^\d+$/.test(eventId)) {
    throw new DisallowedWebtoolsUrlError(`${calendarId}/${eventId}`);
  }
  return assertAllowedWebtoolsReadUrl(`https://calendars.illinois.edu/detail/${calendarId}/${eventId}`).toString();
}

export type WebtoolsHtmlResponse =
  | { ok: true; url: string; status: number; html: string }
  | { ok: false; url: string; status: number; error: string };

export type WebtoolsHtmlFetcher = {
  fetchHtml(url: string): Promise<WebtoolsHtmlResponse>;
};

function retryDelayMs(header: string | null, retryIndex: number, now: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - now), MAX_RETRY_WAIT_MS);
    }
  }
  return retryIndex === 0 ? 2000 : 8000;
}

export function createWebtoolsHtmlFetcher(options?: {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}): WebtoolsHtmlFetcher {
  const fetchImpl = options?.fetch ?? fetch;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options?.now ?? Date.now;
  const minIntervalMs = options?.minIntervalMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const userAgent = options?.userAgent ?? COLLECTOR_USER_AGENT;
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let chain: Promise<unknown> = Promise.resolve();

  async function once(
    url: URL,
    redirectsLeft: number,
  ): Promise<{ status: number; html: string; retryAfter: string | null; finalUrl: string }> {
    const wait = Math.max(0, lastRequestAt + minIntervalMs - now());
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = now();
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html", "user-agent": userAgent },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectsLeft <= 0) {
        return { status: response.status, html: "", retryAfter: null, finalUrl: url.toString() };
      }
      const next = assertAllowedWebtoolsReadUrl(new URL(location, url).toString());
      return once(next, redirectsLeft - 1);
    }
    return {
      status: response.status,
      html: response.ok ? await response.text() : "",
      retryAfter: response.headers.get("retry-after"),
      finalUrl: url.toString(),
    };
  }

  async function fetchHtml(rawUrl: string): Promise<WebtoolsHtmlResponse> {
    const url = assertAllowedWebtoolsReadUrl(rawUrl);
    let lastStatus = 0;
    let lastError = "Request failed.";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await once(url, 3);
        if (response.status === 200) {
          return { ok: true, url: response.finalUrl, status: 200, html: response.html };
        }
        lastStatus = response.status;
        lastError = `HTTP ${response.status}`;
        if (!RETRY_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
          return { ok: false, url: url.toString(), status: response.status, error: lastError };
        }
        await sleep(retryDelayMs(response.retryAfter, attempt, now()));
      } catch (error) {
        if (error instanceof DisallowedWebtoolsUrlError) {
          throw error;
        }
        lastStatus = 0;
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === MAX_RETRIES) {
          return { ok: false, url: url.toString(), status: 0, error: lastError };
        }
        await sleep(retryDelayMs(null, attempt, now()));
      }
    }
    return { ok: false, url: url.toString(), status: lastStatus, error: lastError };
  }

  return {
    fetchHtml(rawUrl: string) {
      const run = chain.then(() => fetchHtml(rawUrl), () => fetchHtml(rawUrl));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
