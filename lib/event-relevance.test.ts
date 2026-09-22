import { describe, expect, test } from "vitest";
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
