import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseWebtoolsDetailDate, resolveWebtoolsSchedule } from "@/lib/illinois-webtools/html-schedule";
import { parseWebtoolsDetailHtml } from "@/lib/illinois-webtools/parse-detail";
import { parseWebtoolsListHtml } from "@/lib/illinois-webtools/parse-list";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "collectors/illinois-webtools/fixtures/html", name), "utf8");
}

describe("Webtools HTML dates", () => {
  test("converts a timed start and end in America/Chicago", () => {
    const schedule = parseWebtoolsDetailDate("Sep 28, 2026 5:30 - 7:00 pm");
    expect(schedule?.allDay).toBe(false);
    expect(schedule?.start.toISOString()).toBe("2026-09-28T22:30:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });

  test("uses the start instant as the end when only a start time is present", () => {
    const schedule = parseWebtoolsDetailDate("Sep 28, 2026 6:30 pm");
    expect(schedule?.allDay).toBe(false);
    expect(schedule?.start.toISOString()).toBe("2026-09-28T23:30:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-09-28T23:30:00.000Z");
  });

  test("covers a single all-day date through the following midnight", () => {
    const schedule = parseWebtoolsDetailDate("Sep 28, 2026 All Day");
    expect(schedule?.allDay).toBe(true);
    expect(schedule?.start.toISOString()).toBe("2026-09-28T05:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-09-29T05:00:00.000Z");
  });

  test("covers an all-day range through the morning after the last date", () => {
    const detail = parseWebtoolsDetailHtml(fixture("detail-all-day-range.html"), "33559206");
    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }

    const schedule = parseWebtoolsDetailDate(detail.event.dateText);
    expect(detail.event.dateText).toBe("Sep 30, 2026 - Oct 1, 2026 All Day");
    expect(schedule?.allDay).toBe(true);
    expect(schedule?.start.toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  test("builds an empty detail date from the earliest and latest list days", () => {
    const schedule = resolveWebtoolsSchedule({
      dateText: "",
      listDays: ["2026-10-01", "2026-09-30", "2026-09-30"],
      displayedTime: "6:30 pm",
    });
    expect(schedule?.allDay).toBe(true);
    expect(schedule?.start.toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  test("keeps a displayed time when an empty detail date appears on one list day", () => {
    const schedule = resolveWebtoolsSchedule({
      dateText: "   ",
      listDays: ["2026-09-28"],
      displayedTime: "6:30 pm",
    });
    expect(schedule?.start.toISOString()).toBe("2026-09-28T23:30:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-09-28T23:30:00.000Z");
  });

  test("lets a detail date win over a wider list-day span", () => {
    const schedule = resolveWebtoolsSchedule({
      dateText: "Sep 30, 2026 - Oct 1, 2026 All Day",
      listDays: ["2026-09-01", "2026-12-01"],
      displayedTime: "All Day",
    });
    expect(schedule?.start.toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  test("does not infer a date from prose", () => {
    expect(parseWebtoolsDetailDate("Apply by October 4, 2026")).toBeNull();
    expect(resolveWebtoolsSchedule({ dateText: "", listDays: [] })).toBeNull();
  });

  test("converts Chicago wall times on both sides of a DST change", () => {
    const summer = parseWebtoolsDetailDate("Sep 28, 2026 6:30 pm");
    const winter = parseWebtoolsDetailDate("Jan 15, 2026 6:30 pm");
    const crossing = parseWebtoolsDetailDate("Oct 31, 2026 - Nov 1, 2026 All Day");

    expect(summer?.start.toISOString()).toBe("2026-09-28T23:30:00.000Z");
    expect(winter?.start.toISOString()).toBe("2026-01-16T00:30:00.000Z");
    expect(crossing?.start.toISOString()).toBe("2026-10-31T05:00:00.000Z");
    expect(crossing?.end.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  test("uses a corroborating list time when the detail clock has no meridiem", () => {
    const detail = parseWebtoolsDetailHtml(fixture("detail-clock-without-meridiem.html"), "33553793");
    const list = parseWebtoolsListHtml(fixture("list-clock-with-meridiem.html"));
    expect(detail.ok).toBe(true);
    expect(list.ok).toBe(true);
    if (!detail.ok || !list.ok || list.empty) {
      return;
    }

    expect(parseWebtoolsDetailDate(detail.event.dateText)).toBeNull();
    const appearance = list.events[0]?.appearances[0];
    const schedule = resolveWebtoolsSchedule({
      dateText: detail.event.dateText,
      listDays: [appearance?.day ?? ""],
      listAppearances: appearance ? [{ day: appearance.day, displayedTime: appearance.displayedTime }] : [],
    });
    expect(appearance?.displayedTime).toBe("11:00 am");
    expect(schedule?.start.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });

  test("fails closed when a missing meridiem has no unambiguous list time", () => {
    expect(parseWebtoolsDetailDate("Oct 7, 2026 11:00")).toBeNull();
    expect(
      resolveWebtoolsSchedule({
        dateText: "Oct 7, 2026 11:00",
        listDays: ["2026-10-07"],
        displayedTime: "11:00",
      }),
    ).toBeNull();
    expect(
      resolveWebtoolsSchedule({
        dateText: "Oct 7, 2026 11:00",
        listDays: ["2026-10-07"],
        displayedTime: "11:30 am",
      }),
    ).toBeNull();
    expect(
      resolveWebtoolsSchedule({
        dateText: "Oct 7, 2026 11:00",
        listDays: ["2026-10-07"],
        listAppearances: [
          { day: "2026-10-07", displayedTime: "11:00 am" },
          { day: "2026-10-07", displayedTime: "11:00 pm" },
        ],
      }),
    ).toBeNull();
    expect(
      resolveWebtoolsSchedule({
        dateText: "Oct 7, 2026 11:00 - 12:00",
        listDays: ["2026-10-07"],
        displayedTime: "11:00 am",
      }),
    ).toBeNull();
  });

  test("accepts a trailing Central label and still converts with America/Chicago", () => {
    const detail = parseWebtoolsDetailHtml(fixture("detail-central-time.html"), "33561685");
    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }

    const schedule = parseWebtoolsDetailDate(detail.event.dateText);
    expect(detail.event.dateText).toBe("Sep 29, 2026 2:00 - 3:00 pm Central Time");
    expect(schedule?.start.toISOString()).toBe("2026-09-29T19:00:00.000Z");
    expect(schedule?.end.toISOString()).toBe("2026-09-29T20:00:00.000Z");

    const winter = parseWebtoolsDetailDate("Jan 15, 2026 2:00 pm");
    expect(parseWebtoolsDetailDate("Jan 15, 2026 2:00 pm CST")?.start.toISOString()).toBe(winter?.start.toISOString());
    expect(parseWebtoolsDetailDate("Jan 15, 2026 2:00 pm CDT")?.start.toISOString()).toBe(winter?.start.toISOString());
    expect(parseWebtoolsDetailDate("Sep 29, 2026 2:00 - 3:00 pm CT")?.start.toISOString()).toBe("2026-09-29T19:00:00.000Z");
    expect(parseWebtoolsDetailDate("Sep 29, 2026 2:00 - 3:00 pm Eastern Time")).toBeNull();
    expect(parseWebtoolsDetailDate("Sep 29, 2026 2:00 - 3:00 pm Central Standard Time")).toBeNull();
    expect(parseWebtoolsDetailDate("Sep 29, 2026 2:00 - 3:00 pm UTC")).toBeNull();
  });
});
