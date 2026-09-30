import { describe, expect, test, vi } from "vitest";
import { classifyEvent } from "@/lib/event-relevance";
import type { CareerInterest } from "@/lib/career-interests";
import type { CampusEvent } from "@/lib/events";
import type { BrowsingEvent } from "@/lib/get-events";
import {
  DIGEST_EVENT_LIMIT,
  buildUserDigestItems,
  formatDigestEmail,
  runEventDigest,
  sendResendEmail,
} from "@/lib/digest";

const catalog: CareerInterest[] = [
  { slug: "software-engineering", label: "Software Engineering", sortOrder: 10 },
  { slug: "fintech", label: "Fintech", sortOrder: 80 },
];

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-30T12:00:00.000Z");

function event(id: string, title: string, startTime: string): CampusEvent {
  return {
    id,
    title,
    company: "",
    description: "",
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

function occurrence(id: string, title: string, startTime: string): BrowsingEvent {
  const row = event(id, title, startTime);
  return { occurrenceId: id, event: row, provenance: [row], relevance: classifyEvent(row) };
}

const software = occurrence("soft", "Software Engineering Internship Workshop", "2026-10-03T17:00:00.000Z");
const payments = occurrence("pay", "Payments and Fintech Recruiting Session", "2026-10-04T17:00:00.000Z");
const past = occurrence("past", "Software Engineering Internship Workshop", "2026-09-01T17:00:00.000Z");
const fair = occurrence("fair", "Engineering Career Fair", "2026-10-05T17:00:00.000Z");

function tables(overrides: {
  interests?: { user_id: string; interest_slug: string }[];
  states?: { user_id: string; occurrence_id: string; status: string }[];
  sent?: { user_id: string; occurrence_id: string }[];
  emails?: Record<string, string | undefined>;
  insertError?: boolean;
}) {
  const sent = [...(overrides.sent ?? [])];
  const emails = overrides.emails ?? { [userA]: "student@example.test" };
  return {
    sent,
    emails,
    from(table: string) {
      return {
        select: async () => {
          if (table === "career_interests") {
            return {
              data: catalog.map((interest) => ({
                slug: interest.slug, label: interest.label, sort_order: interest.sortOrder,
              })),
              error: null,
            };
          }
          if (table === "profile_career_interests") {
            return { data: overrides.interests ?? [{ user_id: userA, interest_slug: "software-engineering" }], error: null };
          }
          if (table === "user_occurrence_states") {
            return { data: overrides.states ?? [], error: null };
          }
          if (table === "user_digest_sends") {
            return { data: sent, error: null };
          }
          return { data: null, error: { message: "unknown table" } };
        },
        insert: async (rows: { user_id: string; occurrence_id: string }[]) => {
          if (overrides.insertError) return { error: { message: "insert failed" } };
          sent.push(...rows);
          return { error: null };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: emails[id] ? { email: emails[id] } : null },
          error: null,
        }),
      },
    },
  };
}

describe("buildUserDigestItems", () => {
  const events = [past, software, payments, fair];

  test("selects upcoming For You matches and caps the list", () => {
    const items = buildUserDigestItems(events, catalog, ["software-engineering"], { now, limit: 1 });
    expect(items.map((item) => item.occurrence.occurrenceId)).toEqual(["soft"]);
    expect(items[0]?.explanation).toContain("Software Engineering");
    expect(DIGEST_EVENT_LIMIT).toBe(8);
  });

  test("excludes already-sent occurrences", () => {
    const items = buildUserDigestItems(events, catalog, ["software-engineering"], {
      now,
      alreadySentIds: new Set(["soft"]),
    });
    expect(items.map((item) => item.occurrence.occurrenceId)).not.toContain("soft");
    expect(items.map((item) => item.occurrence.occurrenceId)).toContain("fair");
  });

  test("excludes not_interested occurrences", () => {
    const items = buildUserDigestItems(events, catalog, ["software-engineering"], {
      now,
      notInterestedIds: new Set(["soft"]),
    });
    expect(items.map((item) => item.occurrence.occurrenceId)).not.toContain("soft");
  });

  test("drops events that have already started", () => {
    const items = buildUserDigestItems(events, catalog, ["software-engineering"], { now });
    expect(items.map((item) => item.occurrence.occurrenceId)).not.toContain("past");
  });
});

describe("formatDigestEmail", () => {
  test("includes title, time, location, reason, and links", () => {
    const items = buildUserDigestItems([software], catalog, ["software-engineering"], { now });
    const { subject, text } = formatDigestEmail(items, "https://campus.example/");
    expect(subject).toBe("CampusRadar: 1 upcoming event for you");
    expect(text).toContain("Software Engineering Internship Workshop");
    expect(text).toContain("Where: Siebel");
    expect(text).toContain("Why:");
    expect(text).toContain("https://campus.example/?view=for-you");
    expect(text).toContain("https://calendars.illinois.edu/detail/2654/soft");
  });
});

describe("runEventDigest", () => {
  test("records delivery only after a successful send", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const db = tables({});
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail,
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software] }),
    });
    expect(summary).toMatchObject({ status: "success", users_processed: 1, emails_sent: 1, skipped: 0, failures: 0 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail.mock.calls[0][0].to).toBe("student@example.test");
    expect(db.sent).toEqual([{ user_id: userA, occurrence_id: "soft" }]);
  });

  test("does not record when the provider reports failure", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: false });
    const db = tables({});
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail,
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software] }),
    });
    expect(summary).toMatchObject({ status: "failure", emails_sent: 0, failures: 1 });
    expect(db.sent).toEqual([]);
  });

  test("does not record when sendEmail throws", async () => {
    const db = tables({});
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail: async () => { throw new Error("network"); },
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software] }),
    });
    expect(summary.failures).toBe(1);
    expect(db.sent).toEqual([]);
  });

  test("does not count a send as complete when recording fails", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const db = tables({ insertError: true });
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail,
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software] }),
    });
    expect(summary).toMatchObject({ emails_sent: 0, failures: 1 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(db.sent).toEqual([]);
  });

  test("skips users with nothing new to send", async () => {
    const sendEmail = vi.fn();
    const db = tables({
      states: [{ user_id: userA, occurrence_id: "soft", status: "not_interested" }],
      sent: [{ user_id: userA, occurrence_id: "fair" }],
    });
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail,
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software, fair, past] }),
    });
    expect(summary).toMatchObject({ users_processed: 1, skipped: 1, emails_sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("continues after one failure", async () => {
    const sendEmail = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const db = tables({
      interests: [
        { user_id: userA, interest_slug: "software-engineering" },
        { user_id: userB, interest_slug: "software-engineering" },
      ],
      emails: { [userA]: "a@example.test", [userB]: "b@example.test" },
    });
    const summary = await runEventDigest({
      supabase: db as never,
      sendEmail,
      siteUrl: "https://campus.example",
      now,
      loadEvents: async () => ({ ok: true, events: [software] }),
    });
    expect(summary).toMatchObject({ users_processed: 2, emails_sent: 1, failures: 1 });
    expect(db.sent).toEqual([{ user_id: userB, occurrence_id: "soft" }]);
  });

  test("fails closed when upcoming events cannot be loaded", async () => {
    const summary = await runEventDigest({
      supabase: tables({}) as never,
      sendEmail: async () => ({ ok: true }),
      siteUrl: "https://campus.example",
      loadEvents: async () => ({ ok: false, error: "Events could not be loaded." }),
    });
    expect(summary).toMatchObject({ status: "failure", users_processed: 0, error: "Events could not be loaded." });
  });
});

describe("sendResendEmail", () => {
  test("posts to Resend and treats non-OK as failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendResendEmail({
      apiKey: "re_test", from: "CampusRadar <noreply@example.test>",
      to: "student@example.test", subject: "Hi", text: "Body",
    })).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      from: "CampusRadar <noreply@example.test>",
      to: ["student@example.test"],
      subject: "Hi",
      text: "Body",
    });
    expect(await sendResendEmail({
      apiKey: "re_test", from: "CampusRadar <noreply@example.test>",
      to: "student@example.test", subject: "Hi", text: "Body",
    })).toEqual({ ok: false });
    vi.unstubAllGlobals();
  });
});
