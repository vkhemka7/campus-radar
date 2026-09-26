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

// These rules describe an offering or encounter, not an isolated subject word.
// Descriptions additionally need an invitation/action in the same sentence.
const opportunityRules: Rule[] = [
  { id: "opportunity", pattern: /\binternships?\b|\b(?:paid|summer|research|graduate|postdoctoral) fellowships?\b|\bfellowship (?:opportunities|programs?|information sessions?)\b|\b(?:job|career|research|full time|employment) (?:opportunities|openings|positions)\b|\b(?:hiring|recruiting) (?:for|students|graduates)\b/, explanation: "An actionable internship, fellowship, research, or employment opportunity." },
  { id: "opportunity-application", pattern: /\b(?:internship|job|fellowship|research position) applications?\b|\bapplications? for (?:internships?|jobs?|fellowships?|research positions?)\b/, explanation: "Applications for a specific career or research opportunity." },
  { id: "employer-encounter", pattern: /\b(?:employer|company) (?:presentations?|visits?|led workshops?)\b|\b(?:meet|chat|connect|interact|speak|talk) (?:directly )?with (?:company|employer) representatives\b|\bmeet (?:our |the |their )?(?:recruiters?|hiring team)\b/, explanation: "Direct employer interaction or an employer-led event." },
  { id: "startup-program", pattern: /\b(?:startup|startups|founder|founders|entrepreneurship|entrepreneurial|venture) (?:week fireside chat|workshops?|programs?|bootcamps?|pitch(?:ing)?|networking|incorporation|fireside chat)\b|\b(?:startup|business) (?:incubator|accelerator)\b|\b(?:sbir|sttr) (?:webinar|workshop)\b/, explanation: "Explicit startup, entrepreneurship, or venture-building program." },
  { id: "technical-community", pattern: /\bhackathons?\b|\b(?:developer|engineering|blockchain|programming|coding|software|robotics) meetups?\b|\b(?:data\s*\+\s*ai|machine learning|python|javascript|open source) (?:user groups?|workshops?)\b|\b(?:hands on|practical) (?:technical|coding|programming|robotics) workshops?\b/, explanation: "Technical community participation or practical technical skill-building." },
];
const offeringPattern = /\b(?:join|attend|apply|applications? (?:are )?open|sign up|register|learn about|learn more about|explore|offers?|offering|hiring|recruiting|seeking|accepting applications|we will|we'll|you will|you'll)\b/;
const incidentalPattern = /\b(?:previously|formerly|last year|past|biography|bio|was awarded|received|has worked|has attended|no longer|not offering|not hiring|cancelled|canceled)\b/;

function extendedReasons(text: string, field: "title" | "description"): RelevanceReason[] {
  const normalized = normalize(text);
  if (incidentalPattern.test(normalized)
    || /\b(?:wellness|stress management|social hour|happy hour|office hours?|committee meeting|seminar|colloquium)\b/.test(normalized)) return [];
  const reasons = field === "title" || offeringPattern.test(normalized)
    ? opportunityRules.flatMap((rule) => matchRule(rule, text, field)) : [];
  const add = (ruleId: string, explanation: string) => reasons.push({ ruleId, field, matchedText: text.trim(), explanation });
  // An explicit career reception can include socializing, but a generic alumni
  // social or company happy hour is not sufficient evidence of career value.
  if (/\b(?:network(?:ing)?|connect)\b/.test(normalized)
    && /\b(?:recruiters?|employers?)\b/.test(normalized)
    && (field === "title" || offeringPattern.test(normalized))) {
    add("recruiter-networking", "An invitation to connect with recruiters or employers.");
  }
  if (/\bcareer reception\b/.test(normalized) && /\bcompanies\b/.test(normalized)
    && /\b(?:network|connect)\b/.test(normalized)) {
    add("career-reception", "Career reception connecting participants with companies.");
  }
  if (/\b(?:connect|meet|network)\b/.test(normalized) && /\b(?:alumni|industry professionals)\b/.test(normalized)
    && /\b(?:career advice|career paths|mentorship)\b/.test(normalized)
    && (field === "title" || offeringPattern.test(normalized))) {
    add("professional-mentorship", "Professional or alumni interaction with an explicit career or mentorship purpose.");
  }
  if (/\b(?:entrepreneurship|entrepreneurs?|startups?|founders?)\b/.test(normalized)
    && /\b(?:share|discuss|learn|advice|workshop|pitch|networking)\b/.test(normalized)
    && (field === "title" || offeringPattern.test(normalized) || /\bwill (?:share|discuss)\b/.test(normalized))) {
    add("startup-learning", "Startup-focused learning, advice, pitching, or networking.");
  }
  if (/\b(?:technical|coding|programming|software|robotics|python|javascript) workshop\b/.test(normalized)
    && /\b(?:hands on|build|practice|learn|develop|implement)\b/.test(normalized)
    && (field === "title" || offeringPattern.test(normalized))) {
    add("technical-practice", "Technical workshop with explicit practical skill-building.");
  }
  return reasons;
}

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
  // Do not let speaker biographies supply evidence for the new rule families.
  const eventText = field === "description" ? text.split(/\b(?:bio(?:graphy)?\s*:|about the speakers?\b)/i)[0] : text;
  for (const segment of field === "description" ? eventText.split(/[.!?\n]+/) : [eventText]) {
    reasons.push(...extendedReasons(segment, field));
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
