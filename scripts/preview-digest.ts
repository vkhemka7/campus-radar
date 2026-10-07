/** Offline preview only: no env files, clients, or email delivery. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatDigestEmail } from "../lib/digest";
import type { ForYouRecommendation } from "../lib/for-you";
import type { CampusEvent } from "../lib/events";

const directory = resolve(process.argv[2] || "/tmp/campusradar-preview");
const titles = [
  "Meet the teams building what’s next",
  "From campus project to first startup: an evening with Illinois founders",
  "Your next chapter in software engineering",
];
const items: ForYouRecommendation[] = titles.map((title, index) => {
  const event: CampusEvent = {
    id: `preview-${index}`,
    title,
    company: "Illinois Research Park",
    category: "Networking",
    description: "Meet people working on problems you care about.",
    startTime: "2026-10-08T22:00:00Z",
    endTime: "2026-10-08T23:30:00Z",
    timezone: "America/Chicago",
    location: "EnterpriseWorks · 60 Hazelwood Drive",
    registrationUrl: "",
    sourceUrl: "https://calendars.illinois.edu/",
    source: "Illinois Webtools",
    externalId: `preview-${index}`,
    discoveredAt: "2026-10-07T12:00:00Z",
  };
  return {
    occurrence: {
      occurrenceId: event.id,
      event,
      provenance: [event],
      relevance: { classification: "relevant", reasons: [] },
    },
    score: 1,
    explanation: "Matches your interest in Startups / Entrepreneurship.",
  };
});
const email = formatDigestEmail(
  items,
  "https://campusradar.example",
  new Date("2026-10-07T17:00:00Z"),
);
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "digest.html"), email.html);
writeFileSync(resolve(directory, "digest.txt"), email.text);
console.log(`Offline digest preview: ${directory}/digest.html`);
