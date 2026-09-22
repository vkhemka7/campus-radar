import type { CampusEvent } from "@/lib/events";

type EvidenceField = "title" | "description" | "category" | "company";
export type RelevanceReason = {
  ruleId: string;
  field: EvidenceField;
  matchedText: string;
  explanation: string;
};
export type EventRelevance = {
  classification: "relevant" | "not_relevant" | "uncertain";
  reasons: RelevanceReason[];
};
type EventText = Pick<CampusEvent, "title" | "description" | "category" | "company" | "source">;
type Rule = { id: string; pattern: RegExp; explanation: string };

// Deliberately small phrase rules: broad words like "interview" or "workshop"
// alone are not enough. No employer-name dictionary or numerical score.
const careerRules: Rule[] = [
  { id: "recruiting", pattern: /\b(?:recruiting|recruitment|hiring) (?:event|session|fair|information session)\b|\b(?:employer|company) (?:info|information) session\b/, explanation: "Explicit recruiting or employer information session." },
  { id: "career-fair", pattern: /\b(?:career|job|internship) fairs?\b/, explanation: "Career, job, or internship fair." },
  { id: "internships", pattern: /\binternship (?:opportunities|information session|info session|workshop)\b/, explanation: "Information about internship opportunities." },
  { id: "interview-preparation", pattern: /\binterview (?:prep|preparation|practice|workshop)\b|\bmock interviews?\b/, explanation: "Offers interview preparation." },
  { id: "resume-preparation", pattern: /\bresume (?:reviews?|workshop|writing|clinic)\b|\bcareer workshop\b/, explanation: "Offers resume or career preparation." },
];
const routineRule: Rule = {
  id: "routine-activity",
  pattern: /\boffice hours?\b|\b(?:department|departmental|faculty|committee|administrative) meetings?\b|\badministrative sessions?\b/,
  explanation: "Routine office hours, meeting, or administrative activity without an explicit career purpose in the title.",
};
const careerConnectionsTitleRule: Rule = {
  id: "career-connections",
  pattern: /\bcareers?\s+(?:(?:&|and)\s+)?connections\b|\b(?:professional|employer) networking\b/,
  explanation: "Explicit career connections or professional networking event.",
};
const technicalTalkTitleRule: Rule = {
  id: "technical-talk-title",
  pattern: /\b(?:tech|technical) talk\b/,
  explanation: "Technical talk indicated by the event title.",
};
const talkPattern = /\b(?:tech|technical|industry) (?:talk|presentation)\b/;
const industryPattern = /\b(?:company|employer|industry)\b/;
const networkingPattern = /\bnetworking\b/;
const professionalPattern = /\b(?:employers?|recruiters?|industry professionals?|alumni)\b/;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}

function matchRule(rule: Rule, text: string, field: EvidenceField): RelevanceReason[] {
  const match = normalize(text).match(rule.pattern);
  return match ? [{ ruleId: rule.id, field, matchedText: match[0], explanation: rule.explanation }] : [];
}

function positiveReasons(event: EventText, field: "title" | "description" | "category"): RelevanceReason[] {
  const text = event[field];
  const reasons = careerRules.flatMap((rule) => matchRule(rule, text, field));
  // Title-only evidence describes the event itself, rather than a speaker bio.
  if (field === "title") {
    reasons.push(...matchRule(careerConnectionsTitleRule, text, field));
    reasons.push(...matchRule(technicalTalkTitleRule, text, field));
  }
  // Contextual rules use the same title or description sentence, never distant
  // words from a biography and an unrelated part of the event description.
  if (field === "category") return reasons;
  const segments = field === "description" ? text.split(/[.!?\n]+/) : [text];
  for (const segment of segments) {
    const normalized = normalize(segment);
    if (talkPattern.test(normalized) && (industryPattern.test(normalized) || event.company.trim())) {
      reasons.push({ ruleId: "industry-talk", field, matchedText: segment.trim(), explanation: "Technical talk with company or industry context." });
      if (!industryPattern.test(normalized)) {
        reasons.push({ ruleId: "industry-talk-company", field: "company", matchedText: event.company, explanation: "A company is listed for this talk." });
      }
    }
    if (networkingPattern.test(normalized) && professionalPattern.test(normalized)) {
      reasons.push({ ruleId: "professional-networking", field, matchedText: segment.trim(), explanation: "Networking with employers, recruiters, industry professionals, or alumni." });
    }
  }
  return reasons;
}

export function classifyEvent(event: EventText): EventRelevance {
  const titleReasons = positiveReasons(event, "title");
  if (titleReasons.length) return { classification: "relevant", reasons: titleReasons };
  const negativeReasons = matchRule(routineRule, event.title, "title");
  if (negativeReasons.length) return { classification: "not_relevant", reasons: negativeReasons };
  const reasons = [...positiveReasons(event, "category"), ...positiveReasons(event, "description")];
  // Keep the first evidence for each rule, even if a description repeats it.
  const uniqueReasons = reasons.filter((reason, index) => reasons.findIndex((item) => item.ruleId === reason.ruleId) === index);
  return { classification: uniqueReasons.length ? "relevant" : "uncertain", reasons: uniqueReasons };
}
