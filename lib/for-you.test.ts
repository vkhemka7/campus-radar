import { describe, expect, test } from "vitest";
import type { CareerInterest } from "@/lib/career-interests";
import { FOR_YOU_RESULT_LIMIT, rankForYou, type ForYouRecommendation } from "@/lib/for-you";
import { classifyEvent, type EventRelevance, type RelevanceReason } from "@/lib/event-relevance";
import type { BrowsingEvent } from "@/lib/get-events";
import type { CampusEvent } from "@/lib/events";

const catalog: CareerInterest[] = [
  { slug: "software-engineering", label: "Software Engineering", sortOrder: 10 },
  { slug: "systems-infrastructure", label: "Systems / Infrastructure", sortOrder: 20 },
  { slug: "ai-machine-learning", label: "AI / Machine Learning", sortOrder: 30 },
  { slug: "data-analytics", label: "Data / Analytics", sortOrder: 40 },
  { slug: "cybersecurity", label: "Cybersecurity", sortOrder: 50 },
  { slug: "hardware-embedded", label: "Hardware / Embedded", sortOrder: 60 },
  { slug: "product", label: "Product", sortOrder: 70 },
  { slug: "fintech", label: "Fintech", sortOrder: 80 },
  { slug: "startups-entrepreneurship", label: "Startups / Entrepreneurship", sortOrder: 90 },
  { slug: "research", label: "Research", sortOrder: 100 },
  { slug: "consulting", label: "Consulting", sortOrder: 110 },
];

function event(id: string, title: string, startTime: string, description = ""): CampusEvent {
  return {
    id,
    title,
    company: "",
    description,
    category: "",
    startTime,
    endTime: startTime,
    timezone: "America/Chicago",
    location: "Siebel",
    registrationUrl: "",
    sourceUrl: `https://calendars.illinois.edu/detail/2654/${id}`,
    source: "Illinois Webtools",
    externalId: id,
    discoveredAt: "2026-09-01T00:00:00.000Z",
  };
}

function occurrence(id: string, title: string, startTime: string, description = ""): BrowsingEvent {
  const row = event(id, title, startTime, description);
  return { occurrenceId: id, event: row, provenance: [row], relevance: classifyEvent(row) };
}

function withRelevance(item: BrowsingEvent, classification: EventRelevance["classification"], explanations: string[]): BrowsingEvent {
  const reasons: RelevanceReason[] = explanations.map((explanation) => ({
    ruleId: "test",
    field: "title",
    matchedText: "test",
    explanation,
  }));
  return { ...item, relevance: { classification, reasons } };
}

function ids(ranked: ForYouRecommendation[]): string[] {
  return ranked.map((item) => item.occurrence.occurrenceId);
}

describe("interest ranking", () => {
  const fpga = occurrence("fpga", "FPGA and Embedded Systems Workshop", "2026-10-03T15:00:00.000Z");
  const fair = occurrence("fair", "Engineering Career Fair", "2026-10-01T15:00:00.000Z");
  const fintech = occurrence("fintech", "Payments and Fintech Recruiting Session", "2026-10-02T15:00:00.000Z");

  test("hardware and fintech rank the same events differently", () => {
    const events = [fair, fintech, fpga];
    const hardware = rankForYou(events, catalog, ["hardware-embedded"]);
    const finance = rankForYou(events, catalog, ["fintech"]);

    expect(fpga.relevance.classification).toBe("uncertain");
    expect(fair.relevance.classification).toBe("relevant");
    expect(ids(hardware)).toEqual(["fpga", "fair", "fintech"]);
    expect(hardware[0].score).toBe(5);
    expect(hardware[0].explanation).toBe("Matches your Hardware / Embedded interest.");
    expect(hardware[1].explanation).toBe("Career opportunity: Career, job, or internship fair.");
    expect(hardware[2].explanation.startsWith("Career opportunity:")).toBe(true);
    expect(hardware[2].explanation).not.toContain("Matches your");

    expect(ids(finance)).toEqual(["fintech", "fair"]);
    expect(finance[0].explanation).toBe("Matches your Fintech interest.");
    expect(finance[0].explanation).not.toContain("Career opportunity");
    expect(finance.map((item) => item.occurrence.occurrenceId)).not.toContain("fpga");
    expect(finance[1].explanation).not.toContain("Matches your");
  });

  test("an uncertain title match is included only for the matching interest", () => {
    const seminar = occurrence("ml", "Machine Learning Seminar", "2026-10-01T15:00:00.000Z");
    expect(seminar.relevance.classification).toBe("uncertain");
    const events = [seminar, fair];
    const ai = rankForYou(events, catalog, ["ai-machine-learning"]);
    expect(ids(ai)).toEqual(["ml", "fair"]);
    expect(ai[0].score).toBe(5);
    expect(ai[0].explanation).toBe("Matches your AI / Machine Learning interest.");
    expect(ids(rankForYou(events, catalog, ["fintech"]))).toEqual(["fair"]);
  });

  test("scalable systems matches systems and not product", () => {
    const seminar = occurrence(
      "systems",
      "CAP Seminar Series: Architecting Efficient and Scalable Systems for Physical Intelligence and Visual Computing.",
      "2026-10-04T15:00:00.000Z",
    );
    expect(seminar.relevance.classification).toBe("uncertain");
    expect(ids(rankForYou([seminar, fair], catalog, ["systems-infrastructure"]))).toEqual(["systems", "fair"]);
    expect(ids(rankForYou([seminar, fair], catalog, ["product"]))).toEqual(["fair"]);
  });

  test("a title that matches two interests outranks a single title match", () => {
    const group = occurrence("data-ai", "Data + AI User Group", "2026-10-08T15:00:00.000Z");
    const seminar = occurrence("ml", "Machine Learning Seminar", "2026-10-01T15:00:00.000Z");
    expect(group.relevance.classification).toBe("relevant");
    const ranked = rankForYou([seminar, group], catalog, ["data-analytics", "ai-machine-learning"]);
    expect(ids(ranked)).toEqual(["data-ai", "ml"]);
    expect(ranked[0].score).toBe(11);
    expect(ranked[0].explanation).toBe("Matches your AI / Machine Learning and Data / Analytics interests.");
    expect(ranked[1].score).toBe(5);
  });

  test("three title matches use catalog order and an oxford comma", () => {
    const meetup = occurrence(
      "three",
      "Software Engineering and Machine Learning for Data Analytics",
      "2026-10-01T15:00:00.000Z",
    );
    const [ranked] = rankForYou([meetup], catalog, ["data-analytics", "software-engineering", "ai-machine-learning"]);
    expect(ranked.explanation).toBe(
      "Matches your Software Engineering, AI / Machine Learning, and Data / Analytics interests.",
    );
  });

  test("research park is generic career evidence, not a research interest match", () => {
    const park = occurrence("park", "Research Park Career Fair", "2026-10-01T15:00:00.000Z");
    const oak = occurrence("oak", "Summer Research Internships at Oak Ridge", "2026-10-09T15:00:00.000Z");
    const ranked = rankForYou([park, oak], catalog, ["research"]);
    expect(park.relevance.classification).toBe("relevant");
    expect(ids(ranked)).toEqual(["oak", "park"]);
    expect(ranked[0].explanation).toBe("Matches your Research interest.");
    expect(ranked[1].explanation).toBe("Career opportunity: Career, job, or internship fair.");
    expect(ranked[1].explanation).not.toContain("Research");
  });

  test("does not treat short lookalikes as interest matches", () => {
    const events = [
      occurrence("production", "Production Workshop", "2026-10-01T15:00:00.000Z"),
      occurrence("metadata", "Metadata Seminar", "2026-10-02T15:00:00.000Z"),
      occurrence("available", "Available Seats", "2026-10-03T15:00:00.000Z"),
      occurrence("networking", "Networking with alumni", "2026-10-04T15:00:00.000Z"),
    ];
    const ranked = rankForYou(events, catalog, ["product", "data-analytics", "ai-machine-learning", "systems-infrastructure"]);
    expect(ids(ranked)).toEqual(["networking"]);
    expect(ranked[0].explanation.startsWith("Career opportunity:")).toBe(true);
    expect(ranked[0].explanation).not.toContain("Matches your");
  });

  test("founders week matches startups", () => {
    const chat = occurrence("founders", "Founders Week fireside chat", "2026-10-01T20:00:00.000Z");
    const [ranked] = rankForYou([chat], catalog, ["startups-entrepreneurship"]);
    expect(ranked.explanation).toBe("Matches your Startups / Entrepreneurship interest.");
    expect(rankForYou([chat], catalog, ["fintech"])[0]?.explanation ?? "").not.toContain("Matches your");
  });

  test("hyphenated title phrases match after normalization", () => {
    const backend = occurrence("backend", "Back-End Workshop", "2026-10-02T15:00:00.000Z");
    expect(backend.relevance.classification).toBe("uncertain");
    const ranked = rankForYou([backend], catalog, ["software-engineering"]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].explanation).toBe("Matches your Software Engineering interest.");
    expect(rankForYou([backend], catalog, ["systems-infrastructure"])).toEqual([]);
  });
});

describe("relevance gates", () => {
  test("not_relevant events are never resurrected by an interest phrase", () => {
    const officeHours = occurrence("office", "FPGA Office Hours", "2026-10-01T15:00:00.000Z");
    expect(officeHours.relevance.classification).toBe("not_relevant");
    const forced = withRelevance(officeHours, "not_relevant", ["Routine office hours."]);
    expect(rankForYou([officeHours, forced], catalog, ["hardware-embedded"])).toEqual([]);
  });

  test("flu clinic and peer mentoring are excluded", () => {
    const events = [
      occurrence("flu", "Research Park Flu Shot Clinic", "2026-10-01T15:00:00.000Z"),
      occurrence("peer", "Peer Mentoring Center", "2026-10-02T15:00:00.000Z"),
    ];
    expect(events.map((item) => item.relevance.classification)).toEqual(["uncertain", "uncertain"]);
    expect(rankForYou(events, catalog, catalog.map((interest) => interest.slug))).toEqual([]);
  });

  test("a relevant description can match an interest, including across provenance", () => {
    const chat = withRelevance(
      occurrence("chat", "LAS - AlphaSights Coffee Chat", "2026-10-01T15:00:00.000Z", "Sign up to learn about consulting firms."),
      "relevant",
      ["An actionable internship, fellowship, research, or employment opportunity."],
    );
    const ranked = rankForYou([chat], catalog, ["consulting"]);
    expect(ranked[0].score).toBe(3);
    expect(ranked[0].explanation).toBe("Matches your Consulting interest.");
    expect(ranked[0].explanation).not.toContain("Career opportunity");
  });

  test("consulting mentioned only in a speaker biography does not match", () => {
    const chat = withRelevance(
      occurrence(
        "bio",
        "Industry Open House",
        "2026-10-01T15:00:00.000Z",
        "Welcome students. Speaker biography: she built a consulting practice.",
      ),
      "relevant",
      ["Career, job, or internship fair."],
    );
    const ranked = rankForYou([chat], catalog, ["consulting"]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(1);
    expect(ranked[0].explanation).toBe("Career opportunity: Career, job, or internship fair.");
  });

  test("an incidental sentence does not supply description evidence", () => {
    const chat = withRelevance(
      occurrence(
        "past",
        "Industry Open House",
        "2026-10-01T15:00:00.000Z",
        "She previously worked in consulting. Students are welcome to attend.",
      ),
      "relevant",
      ["Career, job, or internship fair."],
    );
    const ranked = rankForYou([chat], catalog, ["consulting"]);
    expect(ranked[0].explanation).toBe("Career opportunity: Career, job, or internship fair.");
    expect(ranked[0].score).toBe(1);
  });

  test("an uncertain description mention does not match", () => {
    const chat = withRelevance(
      occurrence("uncertain", "Coffee Chat", "2026-10-01T15:00:00.000Z", "Learn about consulting."),
      "uncertain",
      [],
    );
    expect(rankForYou([chat], catalog, ["consulting"])).toEqual([]);
  });

  test("a phrase on another source row in the occurrence still counts", () => {
    const sparse = event("sparse", "Open house", "2026-10-03T15:00:00.000Z");
    const detailed = event("detailed", "FPGA Workshop", "2026-10-03T15:00:00.000Z");
    const combined: BrowsingEvent = {
      occurrenceId: "shared",
      event: sparse,
      provenance: [sparse, detailed],
      relevance: { classification: "uncertain", reasons: [] },
    };
    const ranked = rankForYou([combined], catalog, ["hardware-embedded"]);
    expect(ranked[0].explanation).toBe("Matches your Hardware / Embedded interest.");
  });

  test("generic backfill keeps at most two career explanations and no interest claim", () => {
    const fair = withRelevance(occurrence("fair", "Engineering Career Fair", "2026-10-01T15:00:00.000Z"), "relevant", [
      "First career reason.",
      "Second career reason.",
      "Third career reason.",
    ]);
    const [ranked] = rankForYou([fair], catalog, ["fintech"]);
    expect(ranked.score).toBe(1);
    expect(ranked.explanation).toBe("Career opportunity: First career reason. Second career reason.");
    expect(ranked.explanation).not.toContain("Matches your");
    expect(ranked.explanation).not.toContain(String(ranked.score));
  });
});

describe("occurrence state and ordering", () => {
  const fpga = occurrence("fpga", "FPGA and Embedded Systems Workshop", "2026-10-03T15:00:00.000Z");
  const fair = occurrence("fair", "Engineering Career Fair", "2026-10-01T15:00:00.000Z");
  const laterFair = occurrence("later-fair", "Internship Fair", "2026-10-05T15:00:00.000Z");

  test("not interested removes only that occurrence", () => {
    const events = [fpga, fair, laterFair];
    const ranked = rankForYou(events, catalog, ["hardware-embedded"]);
    const excluded = rankForYou(events, catalog, ["hardware-embedded"], {
      excludeOccurrenceIds: new Set(["fpga"]),
    });
    expect(ids(excluded)).toEqual(["fair", "later-fair"]);
    expect(excluded.map((item) => item.score)).toEqual(
      ranked.filter((item) => item.occurrence.occurrenceId !== "fpga").map((item) => item.score),
    );
  });

  test("interested and going do not change ranking", () => {
    const events = [fair, fpga];
    const ranked = rankForYou(events, catalog, ["hardware-embedded"]);
    expect(rankForYou(events, catalog, ["hardware-embedded"], { excludeOccurrenceIds: new Set() })).toEqual(ranked);
    expect(ids(ranked)).toEqual(["fpga", "fair"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test("ties break by earlier start time and then occurrence id", () => {
    const events = [
      withRelevance(occurrence("b", "Career Fair", "2026-10-02T15:00:00.000Z"), "relevant", ["Career, job, or internship fair."]),
      withRelevance(occurrence("c", "Career Fair", "2026-10-01T15:00:00.000Z"), "relevant", ["Career, job, or internship fair."]),
      withRelevance(occurrence("a", "Career Fair", "2026-10-01T15:00:00.000Z"), "relevant", ["Career, job, or internship fair."]),
    ];
    const first = rankForYou(events, catalog, ["consulting"]);
    const second = rankForYou(events, catalog, ["consulting"]);
    expect(ids(first)).toEqual(["a", "c", "b"]);
    expect(second).toEqual(first);
    expect(new Set(first.map((item) => item.score))).toEqual(new Set([1]));
  });

  test("explanations do not contain the numeric score", () => {
    const ranked = rankForYou([
      occurrence("data-ai", "Data + AI User Group", "2026-10-08T15:00:00.000Z"),
      occurrence("fair", "Engineering Career Fair", "2026-10-01T15:00:00.000Z"),
      occurrence("fpga", "FPGA and Embedded Systems Workshop", "2026-10-03T15:00:00.000Z"),
    ], catalog, ["hardware-embedded", "ai-machine-learning", "data-analytics"]);
    expect(ranked.length).toBeGreaterThan(0);
    for (const item of ranked) {
      expect(item.explanation).not.toContain(String(item.score));
      expect(item.explanation).not.toMatch(/\bscore\b/i);
      expect(item.explanation.startsWith("Matches your ") || item.explanation.startsWith("Career opportunity:")).toBe(true);
    }
  });

  test("no selected interests produces no ranking", () => {
    const events = [occurrence("fair", "Engineering Career Fair", "2026-10-01T15:00:00.000Z")];
    expect(rankForYou(events, catalog, [])).toEqual([]);
    expect(rankForYou(events, catalog, ["not-a-catalog-slug"])).toEqual([]);
  });

  test("returns at most 30 occurrences", () => {
    const start = Date.parse("2026-10-01T15:00:00.000Z");
    const events = Array.from({ length: FOR_YOU_RESULT_LIMIT + 5 }, (_, index) => withRelevance(
      occurrence(
        `fair-${String(index).padStart(2, "0")}`,
        "Career Fair",
        new Date(start + index * 60 * 60 * 1000).toISOString(),
      ),
      "relevant",
      ["Career, job, or internship fair."],
    ));
    const ranked = rankForYou(events, catalog, ["fintech"]);
    expect(ids(ranked)).toEqual(events.slice(0, FOR_YOU_RESULT_LIMIT).map((item) => item.occurrenceId));
  });
});
