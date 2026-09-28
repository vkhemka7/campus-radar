import { describe, expect, test } from "vitest";
import {
  assessWebtoolsIdentity,
  eventIdFromWebtoolsSourceUrl,
  htmlEventIdToExternalId,
  plainWebtoolsEventId,
} from "@/lib/illinois-webtools/identity";

describe("Webtools HTML identity", () => {
  test("maps an HTML event id onto the existing external id", () => {
    expect(htmlEventIdToExternalId("33563355")).toBe("33563355@illinois.edu");
    expect(plainWebtoolsEventId("33563355@illinois.edu")).toBe("33563355");
    expect(
      assessWebtoolsIdentity(
        {
          externalId: "33563355@illinois.edu",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/33563355",
        },
        "33563355",
      ),
    ).toEqual({
      status: "match",
      eventId: "33563355",
      externalId: "33563355@illinois.edu",
    });
  });

  test("does not rewrite recurrence-qualified, non-Webtools, or malformed ids", () => {
    expect(plainWebtoolsEventId("33563355@illinois.edu::20260928T173000")).toBeNull();
    expect(htmlEventIdToExternalId("33563355@illinois.edu::20260928T173000")).toBeNull();
    expect(plainWebtoolsEventId("handshake:64265")).toBeNull();
    expect(plainWebtoolsEventId("abc@illinois.edu")).toBeNull();
    expect(plainWebtoolsEventId("33563355")).toBeNull();
    expect(eventIdFromWebtoolsSourceUrl("https://calendars.illinois.edu/detail/2654/33563355?rn=1")).toBeNull();
    expect(eventIdFromWebtoolsSourceUrl("https://calendars.illinois.edu/detail/2654/33563355")).toBe("33563355");

    expect(
      assessWebtoolsIdentity({ externalId: "33563355@illinois.edu::20260928T173000" }, "33563355"),
    ).toEqual({ status: "leave-unchanged", reason: "recurrence" });
    expect(assessWebtoolsIdentity({ externalId: "handshake:64265" }, "33563355")).toEqual({
      status: "leave-unchanged",
      reason: "non-webtools",
    });
    expect(assessWebtoolsIdentity({ externalId: "abc@illinois.edu" }, "33563355")).toEqual({
      status: "leave-unchanged",
      reason: "malformed",
    });
    expect(
      assessWebtoolsIdentity(
        {
          externalId: "33563355@illinois.edu",
          sourceUrl: "https://calendars.illinois.edu/detail/2654/99999999",
        },
        "33563355",
      ),
    ).toEqual({ status: "conflict" });
  });
});
