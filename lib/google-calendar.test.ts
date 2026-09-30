import { describe, expect, test } from "vitest";
import { googleCalendarDetails, googleCalendarEventUrl } from "@/lib/google-calendar";

describe("googleCalendarEventUrl", () => {
  test("builds a template URL with UTC stamps and encoded fields", () => {
    const href = googleCalendarEventUrl({
      title: "Google Interview Prep & Workshop",
      startTime: "2026-09-28T22:30:00.000Z",
      endTime: "2026-09-29T00:00:00.000Z",
      location: "Siebel Center, Room 2405",
      details: "https://calendars.illinois.edu/detail/2654/1\nhttps://example.test/register",
    });
    expect(href).toBeTruthy();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Google Interview Prep & Workshop");
    expect(url.searchParams.get("dates")).toBe("20260928T223000Z/20260929T000000Z");
    expect(url.searchParams.get("location")).toBe("Siebel Center, Room 2405");
    expect(url.searchParams.get("details")).toBe(
      "https://calendars.illinois.edu/detail/2654/1\nhttps://example.test/register",
    );
  });

  test("preserves Chicago wall time already stored as a UTC instant", () => {
    const href = googleCalendarEventUrl({
      title: "Info session",
      startTime: "2026-01-15T20:00:00.000Z",
      endTime: "2026-01-15T21:00:00.000Z",
    });
    expect(new URL(href!).searchParams.get("dates")).toBe("20260115T200000Z/20260115T210000Z");
  });

  test("uses one hour when the source listed no distinct end time", () => {
    const start = "2026-09-28T22:30:00.000Z";
    const href = googleCalendarEventUrl({ title: "Office hours", startTime: start, endTime: start });
    expect(new URL(href!).searchParams.get("dates")).toBe("20260928T223000Z/20260928T233000Z");
  });

  test("uses one hour when end is missing, invalid, or before start", () => {
    const start = "2026-09-28T22:30:00.000Z";
    expect(new URL(googleCalendarEventUrl({ title: "A", startTime: start, endTime: "" })!).searchParams.get("dates"))
      .toBe("20260928T223000Z/20260928T233000Z");
    expect(new URL(googleCalendarEventUrl({ title: "A", startTime: start, endTime: "not-a-date" })!).searchParams.get("dates"))
      .toBe("20260928T223000Z/20260928T233000Z");
    expect(new URL(googleCalendarEventUrl({ title: "A", startTime: start, endTime: "2026-09-28T21:00:00.000Z" })!).searchParams.get("dates"))
      .toBe("20260928T223000Z/20260928T233000Z");
  });

  test("returns null when start cannot be parsed", () => {
    expect(googleCalendarEventUrl({ title: "A", startTime: "", endTime: "2026-09-28T22:30:00.000Z" })).toBeNull();
  });

  test("omits empty location and details", () => {
    const url = new URL(googleCalendarEventUrl({ title: "Talk", startTime: "2026-09-28T22:30:00.000Z", endTime: "2026-09-28T23:30:00.000Z" })!);
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("details")).toBe(false);
  });
});

describe("googleCalendarDetails", () => {
  test("keeps unique non-empty URLs in order", () => {
    expect(googleCalendarDetails(["https://a.test", "", "https://b.test", "https://a.test"])).toBe(
      "https://a.test\nhttps://b.test",
    );
  });
});
