/**
 * DEVELOPMENT MOCK DATA ONLY.
 *
 * These events are fake fixtures for building the CampusRadar homepage.
 * They are not real UIUC events and must not be treated as production data.
 */

/**
 * Shared shape of a campus career event.
 *
 * Times are stored as ISO-8601 date-time strings (for example,
 * "2026-09-23T18:00:00") so the fixture file stays easy to read.
 * `timezone` tells the browser which campus timezone to display them in.
 *
 * Named CampusEvent to avoid clashing with the browser's built-in Event type.
 */
export type CampusEvent = {
  title: string;
  company: string;
  description: string;
  category: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  registrationUrl: string;
  sourceUrl: string;
  source: string;
  discoveredAt: string;
};

export const MOCK_EVENTS: CampusEvent[] = [
  {
    title: "Google Interview Prep Workshop",
    company: "Google",
    description:
      "Mock workshop covering coding-interview practice for software internship recruiting.",
    category: "Interview preparation",
    startTime: "2026-09-23T18:00:00",
    endTime: "2026-09-23T19:30:00",
    timezone: "America/Chicago",
    location: "Siebel Center, Room 2405",
    registrationUrl: "https://example.com/mock/google-interview-prep",
    sourceUrl: "https://example.com/mock/sources/google-interview-prep",
    source: "Mock UIUC Engineering Calendar",
    discoveredAt: "2026-09-19T12:00:00",
  },
  {
    title: "Jane Street Tech Talk: Systems at Scale",
    company: "Jane Street",
    description:
      "Mock tech talk about infrastructure and systems work in a trading environment.",
    category: "Tech talk",
    startTime: "2026-09-24T17:00:00",
    endTime: "2026-09-24T18:00:00",
    timezone: "America/Chicago",
    location: "ECE Building, Room 1002",
    registrationUrl: "https://example.com/mock/jane-street-tech-talk",
    sourceUrl: "https://example.com/mock/sources/jane-street-tech-talk",
    source: "Mock CS Department Events",
    discoveredAt: "2026-09-19T12:05:00",
  },
  {
    title: "Capital One Software Engineering Info Session",
    company: "Capital One",
    description:
      "Mock recruiting session for students interested in software engineering internships in fintech.",
    category: "Company information session",
    startTime: "2026-09-25T12:00:00",
    endTime: "2026-09-25T13:00:00",
    timezone: "America/Chicago",
    location: "Grainger Library, Room 329",
    registrationUrl: "https://example.com/mock/capital-one-info-session",
    sourceUrl: "https://example.com/mock/sources/capital-one-info-session",
    source: "Mock Engineering Career Services",
    discoveredAt: "2026-09-19T12:10:00",
  },
];
