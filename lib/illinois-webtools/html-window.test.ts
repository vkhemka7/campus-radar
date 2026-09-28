import { describe, expect, test } from "vitest";
import {
  scheduleOverlapsWindow,
  splitWebtoolsDateSpan,
  webtoolsCollectionWindow,
  webtoolsDateSpan,
  webtoolsDiscoverySpans,
} from "@/lib/illinois-webtools/html-window";

function nextIso(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new Error(day);
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return shifted.toISOString().slice(0, 10);
}

describe("Webtools collection window", () => {
  test("uses Chicago today through 180 days, including the evening before midnight", () => {
    const window = webtoolsCollectionWindow(new Date("2026-09-28T15:00:00.000Z"));
    expect(window.startDate).toBe("2026-09-28");
    expect(window.startQuery).toBe("09/28/2026");
    expect(window.start.toISOString()).toBe("2026-09-28T05:00:00.000Z");
    expect(window.endDate).toBe("2027-03-27");
    expect(window.endQuery).toBe("03/27/2027");
    expect(window.endExclusive.toISOString()).toBe("2027-03-28T05:00:00.000Z");
    expect(webtoolsCollectionWindow(new Date("2026-09-28T04:30:00.000Z")).startDate).toBe("2026-09-27");
  });

  test("counts an overlapping stored schedule and ignores history outside the window", () => {
    const window = webtoolsCollectionWindow(new Date("2026-09-28T15:00:00.000Z"));
    expect(scheduleOverlapsWindow("2026-09-28T23:30:00.000Z", "2026-09-28T23:30:00.000Z", window)).toBe(true);
    expect(scheduleOverlapsWindow("2026-09-27T23:00:00.000Z", "2026-09-28T18:00:00.000Z", window)).toBe(true);
    expect(scheduleOverlapsWindow("2026-03-01T18:00:00.000Z", "2026-03-01T19:00:00.000Z", window)).toBe(false);
    expect(scheduleOverlapsWindow("2027-04-01T18:00:00.000Z", "2027-04-01T19:00:00.000Z", window)).toBe(false);
  });

  test("covers the 180-day horizon in non-overlapping 30-day windows", () => {
    const window = webtoolsCollectionWindow(new Date("2026-09-28T15:00:00.000Z"));
    const spans = webtoolsDiscoverySpans(window);
    expect(spans[0]).toMatchObject({
      startDate: "2026-09-28",
      endDate: "2026-10-27",
      startQuery: "09/28/2026",
      endQuery: "10/27/2026",
      dayCount: 30,
    });
    expect(spans.every((span) => span.dayCount >= 1 && span.dayCount <= 30)).toBe(true);
    expect(spans.at(-1)?.endDate).toBe("2027-03-27");
    expect(spans.reduce((sum, span) => sum + span.dayCount, 0)).toBe(181);
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]?.startDate).toBe(nextIso(spans[index - 1]?.endDate ?? ""));
    }
  });

  test("splits a window on the following day without sharing or skipping a date", () => {
    const [left, right] = splitWebtoolsDateSpan(webtoolsDateSpan("2026-09-28", "2026-10-27")) ?? [];
    expect(left).toMatchObject({ startDate: "2026-09-28", endDate: "2026-10-12", dayCount: 15 });
    expect(right).toMatchObject({ startDate: "2026-10-13", endDate: "2026-10-27", dayCount: 15 });
    expect(nextIso(left?.endDate ?? "")).toBe(right?.startDate);

    const odd = splitWebtoolsDateSpan(webtoolsDateSpan("2026-09-28", "2026-09-30"));
    expect(odd?.[0]).toMatchObject({ startDate: "2026-09-28", endDate: "2026-09-28", dayCount: 1 });
    expect(odd?.[1]).toMatchObject({ startDate: "2026-09-29", endDate: "2026-09-30", dayCount: 2 });
    expect(splitWebtoolsDateSpan(webtoolsDateSpan("2026-09-28", "2026-09-28"))).toBeNull();
  });
});
