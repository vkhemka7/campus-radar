export type CareerInterest = {
  slug: string;
  label: string;
  sortOrder: number;
};

export type InterestSaveState =
  | { status: "success"; message: string; slugs: string[] }
  | { status: "error"; message: string };

export type InterestSelectionPlan = {
  toAdd: string[];
  toRemove: string[];
};

const invalidSelectionMessage = "Choose interests from the list.";

export function readCareerInterests(rows: unknown): CareerInterest[] | null {
  if (!Array.isArray(rows)) return null;
  const interests: CareerInterest[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) return null;
    const { slug, label, sort_order: sortOrder } = row;
    if (typeof slug !== "string" || slug.length === 0) return null;
    if (typeof label !== "string" || label.length === 0) return null;
    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder)) return null;
    if (seen.has(slug)) return null;
    seen.add(slug);
    interests.push({ slug, label, sortOrder });
  }

  interests.sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));
  return interests;
}

export function readSelectedInterestSlugs(rows: unknown): string[] | null {
  if (!Array.isArray(rows)) return null;
  const slugs: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) return null;
    const slug = row.interest_slug;
    if (typeof slug !== "string" || slug.length === 0 || seen.has(slug)) return null;
    seen.add(slug);
    slugs.push(slug);
  }

  return slugs;
}

/**
 * Accepts only slugs present in the catalog loaded from career_interests.
 * An empty submission is a valid request to clear every saved interest.
 */
export function parseInterestSelection(
  values: readonly FormDataEntryValue[],
  validSlugs: ReadonlySet<string>,
): { ok: true; slugs: string[] } | { ok: false; message: string } {
  const slugs: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") return { ok: false, message: invalidSelectionMessage };
    const slug = value.trim();
    if (!validSlugs.has(slug)) return { ok: false, message: invalidSelectionMessage };
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }

  return { ok: true, slugs };
}

/**
 * Rows are inserted and deleted because profile_career_interests has no UPDATE grant.
 * The caller applies toAdd, then toRemove, so a failed delete leaves a recoverable superset.
 */
export function planInterestUpdate(current: readonly string[], desired: readonly string[]): InterestSelectionPlan {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  return {
    toAdd: desired.filter((slug) => !currentSet.has(slug)),
    toRemove: current.filter((slug) => !desiredSet.has(slug)),
  };
}

export function sameInterestSelection(actual: readonly string[], desired: readonly string[]): boolean {
  const actualSet = new Set(actual);
  const desiredSet = new Set(desired);
  if (actualSet.size !== desiredSet.size) return false;
  for (const slug of desiredSet) {
    if (!actualSet.has(slug)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
