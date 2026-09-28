import type { CareerInterest } from "@/lib/career-interests";
import type { BrowsingEvent } from "@/lib/get-events";
import type { CampusEvent } from "@/lib/events";

export const FOR_YOU_RESULT_LIMIT = 30;

export type ForYouRecommendation = {
  occurrence: BrowsingEvent;
  /** Used for ordering and tests. The homepage does not render this. */
  score: number;
  explanation: string;
};

type PhraseSet = {
  title: readonly string[];
  strong: readonly string[];
};

// Title phrases match any source title. Strong phrases may also match a
// description, category, or company, and only after the career classifier
// has already marked the occurrence relevant. Short tokens stay title-only.
const INTEREST_PHRASES: Record<string, PhraseSet> = {
  "software-engineering": {
    title: ["software engineering", "software engineer", "software", "backend", "back end", "frontend", "front end", "full stack"],
    strong: ["software engineering", "backend"],
  },
  "systems-infrastructure": {
    title: ["scalable systems", "distributed systems", "computer systems", "operating systems", "computer networking", "infrastructure", "site reliability", "cloud computing", "kubernetes"],
    strong: ["scalable systems", "distributed systems", "computer systems", "operating systems", "computer networking", "infrastructure", "site reliability", "cloud computing", "kubernetes"],
  },
  "ai-machine-learning": {
    title: ["machine learning", "artificial intelligence", "deep learning", "neural network", "foundation model", "ai"],
    strong: ["machine learning", "deep learning", "artificial intelligence"],
  },
  "data-analytics": {
    title: ["data analytics", "data science", "data engineering", "analytics", "data"],
    strong: ["data analytics", "data science", "data engineering"],
  },
  cybersecurity: {
    title: ["cybersecurity", "cyber security", "information security", "computer security"],
    strong: ["cybersecurity", "computer security", "cryptography"],
  },
  "hardware-embedded": {
    title: ["hardware", "embedded", "fpga", "firmware", "semiconductor", "robotics", "verilog", "vlsi", "asic", "microcontroller"],
    strong: ["hardware", "embedded", "fpga", "firmware", "semiconductor", "robotics", "verilog", "vlsi", "asic", "microcontroller"],
  },
  product: {
    title: ["product management", "product manager", "product discovery", "product design", "product"],
    strong: ["product management", "product discovery"],
  },
  fintech: {
    title: ["fintech", "financial technology", "payments"],
    strong: ["fintech", "financial technology", "payments"],
  },
  // Plurals cover audited titles such as "Founders Week" without matching inside other words.
  "startups-entrepreneurship": {
    title: ["startup", "startups", "founder", "founders", "entrepreneurship", "venture", "incubator", "accelerator", "sbir", "sttr"],
    strong: ["startup", "startups", "founder", "founders", "entrepreneurship", "venture", "incubator", "accelerator", "sbir", "sttr"],
  },
  research: {
    title: ["research internship", "research internships", "summer research", "undergraduate research", "research opportunity", "research position"],
    strong: ["research internship", "research internships", "summer research", "undergraduate research", "research opportunity", "research position"],
  },
  consulting: {
    title: ["consulting", "consultant", "management consulting", "case competition"],
    strong: ["consulting", "management consulting"],
  },
};

const compiledPhrases = new Map<string, { title: RegExp[]; strong: RegExp[] }>(
  Object.entries(INTEREST_PHRASES).map(([slug, phrases]) => [slug, {
    title: phrases.title.map(phrasePattern),
    strong: phrases.strong.map(phrasePattern),
  }]),
);

const incidentalPattern = /\b(?:previously|formerly|last year|past|biography|bio|was awarded|received|has worked|has attended|no longer|not offering|not hiring|cancelled|canceled)\b/;
const biographySplit = /\b(?:bio(?:graphy)?\s*:|about the speakers?\b)/i;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}

function phrasePattern(phrase: string): RegExp {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`);
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalize(text);
  return normalized.length > 0 && patterns.some((pattern) => pattern.test(normalized));
}

function strongTextMatches(event: CampusEvent, patterns: readonly RegExp[]): boolean {
  if (fieldMatches(event.category, patterns) || fieldMatches(event.company, patterns)) return true;
  const body = event.description.split(biographySplit)[0] ?? "";
  return body.split(/[.!?\n]+/).some((sentence) => {
    const normalized = normalize(sentence);
    return normalized.length > 0 && !incidentalPattern.test(normalized) && patterns.some((pattern) => pattern.test(normalized));
  });
}

function fieldMatches(text: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalize(text);
  return normalized.length > 0 && !incidentalPattern.test(normalized) && patterns.some((pattern) => pattern.test(normalized));
}

function sourceRows(occurrence: BrowsingEvent): CampusEvent[] {
  return occurrence.provenance.length > 0 ? occurrence.provenance : [occurrence.event];
}

type InterestMatch = {
  interest: CareerInterest;
  kind: "title" | "strong";
};

function interestMatches(occurrence: BrowsingEvent, selected: readonly CareerInterest[]): InterestMatch[] {
  const rows = sourceRows(occurrence);
  const relevant = occurrence.relevance.classification === "relevant";
  const matched: InterestMatch[] = [];
  for (const interest of selected) {
    const phrases = compiledPhrases.get(interest.slug);
    if (!phrases) continue;
    if (rows.some((row) => matchesAny(row.title, phrases.title))) {
      matched.push({ interest, kind: "title" });
    } else if (relevant && rows.some((row) => strongTextMatches(row, phrases.strong))) {
      matched.push({ interest, kind: "strong" });
    }
  }
  return matched;
}

function interestExplanation(labels: readonly string[]): string {
  if (labels.length === 1) return `Matches your ${labels[0]} interest.`;
  if (labels.length === 2) return `Matches your ${labels[0]} and ${labels[1]} interests.`;
  const leading = labels.slice(0, -1).join(", ");
  return `Matches your ${leading}, and ${labels[labels.length - 1]} interests.`;
}

function careerExplanation(occurrence: BrowsingEvent): string {
  const text = occurrence.relevance.reasons.slice(0, 2).map((reason) => reason.explanation).join(" ");
  return text ? `Career opportunity: ${text}` : "Career opportunity.";
}

function startMillis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * Ranks upcoming occurrences for the interests a user saved.
 * Interested and Going are not inputs. Not Interested occurrence ids are dropped.
 * A generic career backfill explains itself as a career opportunity, never as an interest match.
 */
export function rankForYou(
  events: readonly BrowsingEvent[],
  catalog: readonly CareerInterest[],
  selectedSlugs: readonly string[],
  options: { excludeOccurrenceIds?: ReadonlySet<string> } = {},
): ForYouRecommendation[] {
  const selectedSet = new Set(selectedSlugs);
  const selected = catalog.filter((interest) => selectedSet.has(interest.slug))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));
  if (selected.length === 0) return [];

  const excluded = options.excludeOccurrenceIds ?? new Set<string>();
  const ranked: ForYouRecommendation[] = [];
  for (const occurrence of events) {
    if (excluded.has(occurrence.occurrenceId)) continue;
    if (occurrence.relevance.classification === "not_relevant") continue;
    const matched = interestMatches(occurrence, selected);
    const score = matched.reduce((total, match) => total + (match.kind === "title" ? 5 : 2), 0)
      + (occurrence.relevance.classification === "relevant" ? 1 : 0);
    if (score <= 0) continue;
    const labels = matched.map((match) => match.interest.label);
    ranked.push({
      occurrence,
      score,
      explanation: labels.length > 0 ? interestExplanation(labels) : careerExplanation(occurrence),
    });
  }

  ranked.sort((left, right) =>
    right.score - left.score
    || startMillis(left.occurrence.event.startTime) - startMillis(right.occurrence.event.startTime)
    || left.occurrence.occurrenceId.localeCompare(right.occurrence.occurrenceId));
  return ranked.slice(0, FOR_YOU_RESULT_LIMIT);
}
