import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parseIcsEvents } from "@/lib/illinois-webtools/parse-ics";
import { normalizeIllinoisWebtoolsEvents } from "@/lib/illinois-webtools/normalize";
import { classifyEvent } from "@/lib/event-relevance";

const base = { title: "", description: "", category: "", company: "", source: "Illinois Webtools" };

describe("conservative career classification", () => {
  test.each(["Verkada Tech Talk", "Technical Talk"])("recognizes %s without claiming employer involvement", (title) => {
    expect(classifyEvent({ ...base, title })).toEqual({
      classification: "relevant",
      reasons: [{
        ruleId: "technical-talk-title",
        field: "title",
        matchedText: title === "Technical Talk" ? "technical talk" : "tech talk",
        explanation: "Technical talk indicated by the event title.",
      }],
    });
  });

  test("incidental description wording does not trigger the title-only rule", () => {
    expect(classifyEvent({
      ...base,
      title: "Machine Learning Seminar",
      description: "The speaker previously gave a tech talk. Their internships included Meta and Amazon.",
    })).toEqual({ classification: "uncertain", reasons: [] });
  });

  test.each(["Biotech Talk", "Technical Talkative Systems"])("requires whole phrases: %s", (title) => {
    expect(classifyEvent({ ...base, title }).classification).toBe("uncertain");
  });

  test.each([
    "Capital One Coffee, Careers & Connections",
    "Coffee, Careers and Connections",
    "Career Connections",
    "Professional Networking Evening",
    "Employer Networking Session",
  ])("recognizes explicit title evidence without an employer dictionary: %s", (title) => {
    expect(classifyEvent({ ...base, title })).toMatchObject({
      classification: "relevant",
      reasons: expect.arrayContaining([
        expect.objectContaining({ ruleId: "career-connections", field: "title" }),
      ]),
    });
  });

  test("academic speaker biography mentions do not establish relevance", () => {
    // Representative regression text, not a copy of the live description.
    expect(classifyEvent({
      ...base,
      title: "Machine Learning Seminar: Jeonghwan Kim",
      category: "Seminar",
      description: "This seminar explores machine learning research. Speaker biography: research experience includes Capital One, Meta, and Amazon, with internships in industry. Professional networking and career connections shaped the speaker's research career.",
    })).toEqual({ classification: "uncertain", reasons: [] });
  });

  test.each(["Computer Networking Seminar", "Connections in Machine Learning", "Careers & Connectionship"])("does not broaden generic or partial title matches: %s", (title) => {
    expect(classifyEvent({ ...base, title }).classification).toBe("uncertain");
  });

  test.each([
    ["Google Interview Prep Workshop", "relevant"],
    ["Employer Information Session", "relevant"],
    ["Engineering Career Fair", "relevant"],
    ["Internship Information Session", "relevant"],
    ["RÉSUMÉ—REVIEW Workshop", "relevant"],
    ["Recruiter Office Hours: Resume Reviews", "relevant"],
    ["CS CARES Office Hour", "not_relevant"],
    ["Department Faculty Meeting", "not_relevant"],
    ["Administrative Session", "not_relevant"],
    ["Verkada Tech Talk", "relevant"],
    ["Machine Learning Seminar", "uncertain"],
    ["Peer Mentoring Center", "uncertain"],
    ["Computer Networking Seminar", "uncertain"],
    ["Research Interview Methods", "uncertain"],
    ["Workshop", "uncertain"],
    ["Career Fairytale", "uncertain"],
  ])("%s → %s", (title, classification) => {
    expect(classifyEvent({ ...base, title }).classification).toBe(classification);
  });

  test("returns stable evidence and explanations", () => {
    const input = { ...base, title: "Google Interview Prep Workshop" };
    expect(classifyEvent(input)).toEqual({ classification: "relevant", reasons: [{
      ruleId: "interview-preparation", field: "title", matchedText: "interview prep", explanation: "Offers interview preparation.",
    }] });
    expect(classifyEvent(input)).toEqual(classifyEvent(input));
  });
  test("routine title overrides incidental positive description and category", () => {
    expect(classifyEvent({ ...base, title: "Committee Meeting", description: "Discuss the career fair.", category: "Career Fair" }).classification).toBe("not_relevant");
  });
  test("explicit category and description phrases can qualify an otherwise unclear event", () => {
    expect(classifyEvent({ ...base, category: "Career Fair" }).classification).toBe("relevant");
    expect(classifyEvent({ ...base, description: "Join our resume review." }).reasons[0].field).toBe("description");
  });
  test("industry talk requires context, company alone is insufficient", () => {
    expect(classifyEvent({ ...base, title: "Technical Talk", company: "Example Company" }).classification).toBe("relevant");
    expect(classifyEvent({ ...base, company: "Example Company" }).classification).toBe("uncertain");
    expect(classifyEvent({ ...base, description: "An industry technical talk." }).classification).toBe("relevant");
    expect(classifyEvent({ ...base, description: "A technical talk. Company biography follows." }).classification).toBe("uncertain");
  });
  test("professional networking requires context in the same sentence", () => {
    expect(classifyEvent({ ...base, title: "Networking with alumni" }).classification).toBe("relevant");
    expect(classifyEvent({ ...base, description: "Computer networking. Alumni are welcome." }).classification).toBe("uncertain");
  });
});

// Saved 3D.2 source snapshots, with reviewed 3D.3 relevance expectations.
describe("2026-09-22 additional Webtools snapshots", () => {
  test.each([
    ["5115", "research-park", 8, 8],
    ["6499", "las-career-services", 8, 0],
    ["6805", "ece-student-events", 2, 0],
  ] as const)("calendar %s matches the reviewed relevant/uncertain split", (id, name, relevant, uncertain) => {
    const events = normalizeIllinoisWebtoolsEvents(parseIcsEvents(
      readFileSync(`collectors/illinois-webtools/fixtures/${name}-sample.ics`, "utf8"),
    ), id);
    const results = events.map(classifyEvent);
    expect(results.filter(({ classification }) => classification === "relevant")).toHaveLength(relevant);
    expect(results.filter(({ classification }) => classification === "uncertain")).toHaveLength(uncertain);
    const relevantIds = events.filter((_, index) => results[index].classification === "relevant").map(({ external_id }) => external_id);
    const expectedIds: Record<string, string[]> = {
      "5115": ["33519110", "33561685", "33538309", "33539685", "33539396", "33539686", "33539398", "33539687"],
      "6499": ["33555584", "33558853", "33555587", "33552091", "33557470", "33562269", "33553540", "33553537"],
      "6805": ["33563482", "33563719"],
    };
    expect(relevantIds).toEqual(expectedIds[id].map((uid) => `${uid}@illinois.edu`));
  });
});

// Synthetic examples exercise rule boundaries independently of live calendars.
describe("3D.3 contextual rule families", () => {
  test.each([
    ["Summer Research Internships", "", "opportunity"],
    ["Research opportunities", "", "opportunity"],
    ["Fellowship applications", "", "opportunity-application"],
    ["Open house", "Apply for jobs: applications for jobs open today.", "opportunity-application"],
    ["Open house", "Join us to learn about paid summer fellowships.", "opportunity"],
    ["Open house", "We are hiring for entry-level positions.", "opportunity"],
    ["Open house", "Explore career opportunities with our team.", "opportunity"],
    ["Company presentation", "", "employer-encounter"],
    ["Employer visit", "", "employer-encounter"],
    ["Employer-led workshop", "", "employer-encounter"],
    ["Meet with company representatives", "", "employer-encounter"],
    ["Open house", "Join us to meet our recruiters.", "employer-encounter"],
    ["Recruiter networking", "", "recruiter-networking"],
    ["Meet alumni for career advice", "", "professional-mentorship"],
    ["Reception", "Join us to connect with industry professionals for mentorship.", "professional-mentorship"],
    ["Reception", "A career reception for students and companies to connect and network.", "career-reception"],
    ["Startup pitch night", "", "startup-program"],
    ["Entrepreneurship program", "", "startup-program"],
    ["Startup accelerator", "", "startup-program"],
    ["Business incubator", "", "startup-program"],
    ["Venture workshop", "", "startup-program"],
    ["Founders Week fireside chat", "", "startup-program"],
    ["Fireside chat", "Our guest will share advice for aspiring entrepreneurs.", "startup-learning"],
    ["Hackathon", "", "technical-community"],
    ["Developer meetup", "", "technical-community"],
    ["Engineering meetup", "", "technical-community"],
    ["Hands-on technical workshop", "", "technical-community"],
    ["Workshop", "Join our technical workshop to build a working robot.", "technical-practice"],
  ])("recognizes %s / %s", (title, description, ruleId) => {
    expect(classifyEvent({ ...base, title, description })).toMatchObject({
      classification: "relevant", reasons: expect.arrayContaining([expect.objectContaining({ ruleId })]),
    });
  });

  test.each([
    ["Engineering student picnic", "Join us for networking and pizza."],
    ["Business workshop", "Professional skills and technology for everyone."],
    ["Technology seminar", "Learn about the researcher's career."],
    ["Academic seminar", "Applications of machine learning to job scheduling."],
    ["Seminar: Research opportunities in quantum computing", ""],
    ["Wellness workshop", "Join our stress management session about internships."],
    ["Fellowship dinner", "Join our community fellowship."],
    ["Alumni social hour", "Connect and network with alumni and friends."],
    ["Company happy hour", "Join us to network with other companies."],
    ["Office hours", "Join us to learn about internships."],
    ["Research seminar", "The speaker previously led a startup workshop."],
    ["Research seminar", "Bio: Join her startup accelerator and apply for internships."],
    ["Research seminar", "About the speaker: He leads a developer meetup."],
    ["Research seminar", "The speaker received paid summer fellowships."],
    ["Peer mentoring", "Mentors provide advice regarding internships."],
    ["Workshop", "Join our community. The speaker has attended hackathons."],
    ["Workshop", "Technical workshop. Join us to build community."],
    ["Seminar", "Learn about research. Internship applications are discussed elsewhere."],
    ["Recruiting update", "We are not hiring for jobs."],
    ["Startup workshop cancelled", ""],
  ])("does not promote %s / %s", (title, description) => {
    expect(classifyEvent({ ...base, title, description }).classification).not.toBe("relevant");
  });

  test("new rule families do not promote broad category or company metadata", () => {
    expect(classifyEvent({ ...base, title: "Picnic", category: "Hackathon", company: "Startup accelerator" }).classification).toBe("uncertain");
  });
  test("repeated opportunity evidence is deduplicated", () => {
    const event = { ...base, title: "Open house", description: "Learn about internships. Apply for internships." };
    const result = classifyEvent(event);
    expect(result.reasons.filter(({ ruleId }) => ruleId === "opportunity")).toHaveLength(1);
    expect(result).toEqual(classifyEvent(event));
  });
});
