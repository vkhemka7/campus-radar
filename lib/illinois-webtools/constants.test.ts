import { describe, expect, test } from "vitest";
import { WEBTOOLS_CALENDARS } from "./constants";
import { htmlEventIdToExternalId } from "./identity";
import { normalizeHtmlWebtoolsEvent } from "./normalize";

const PRODUCTION_CALENDARS = [
  { id: "2654", label: "Siebel" },
  { id: "1551", label: "HireIllini Career Fairs" },
  { id: "5115", label: "Research Park" },
  { id: "6499", label: "LAS Career Services" },
  { id: "6805", label: "ECE Student Events" },
  { id: "7541", label: "AE Corporate Relations" },
  { id: "6327", label: "Illinois Entrepreneurship Master" },
] as const;

describe("production Webtools source configuration", () => {
  test("contains exactly the seven HTML calendars", () => {
    expect(WEBTOOLS_CALENDARS).toEqual([...PRODUCTION_CALENDARS]);
    expect(WEBTOOLS_CALENDARS).toHaveLength(7);
    expect(new Set(WEBTOOLS_CALENDARS.map(({ id }) => id)).size).toBe(7);
  });

  test("keeps the original five calendars and adds only 7541 and 6327", () => {
    const ids = WEBTOOLS_CALENDARS.map(({ id }) => id);
    expect(ids).toEqual(["2654", "1551", "5115", "6499", "6805", "7541", "6327"]);
    expect(ids.filter((id) => id === "7541" || id === "6327")).toEqual(["7541", "6327"]);
  });
});

describe("cross-calendar Webtools identity", () => {
  test("duplicate event IDs keep {eventId}@illinois.edu instead of calendar-specific ids", () => {
    const start = new Date("2026-11-06T13:00:00.000Z");
    const end = new Date("2026-11-06T15:00:00.000Z");
    const shared = {
      eventId: "33537921",
      title: "First Friday Breakfast - November",
      description: "",
      category: "Conference/Workshop",
      location: "EnterpriseWorks",
      registrationUrl: "",
      originatingCalendarId: "3462",
      start,
      end,
    };
    const fromResearchPark = normalizeHtmlWebtoolsEvent({ ...shared, listCalendarId: "5115" });
    const fromEntrepreneurship = normalizeHtmlWebtoolsEvent({ ...shared, listCalendarId: "6327" });

    expect(htmlEventIdToExternalId("33537921")).toBe("33537921@illinois.edu");
    expect(fromResearchPark?.external_id).toBe("33537921@illinois.edu");
    expect(fromEntrepreneurship?.external_id).toBe(fromResearchPark?.external_id);
    expect(fromResearchPark?.source).toBe("Illinois Webtools");
    expect(fromEntrepreneurship?.source).toBe("Illinois Webtools");
    expect(fromResearchPark?.external_id).not.toMatch(/5115|6327/);
  });
});
