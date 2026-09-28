import { describe, expect, test } from "vitest";
import {
  parseInterestSelection,
  planInterestUpdate,
  readCareerInterests,
  readSelectedInterestSlugs,
  sameInterestSelection,
} from "@/lib/career-interests";

const catalog = new Set(["software-engineering", "product", "research"]);

describe("career interest selection", () => {
  test("reads catalog rows in sort order and rejects malformed rows", () => {
    expect(
      readCareerInterests([
        { slug: "research", label: "Research", sort_order: 30 },
        { slug: "product", label: "Product", sort_order: 10 },
      ]),
    ).toEqual([
      { slug: "product", label: "Product", sortOrder: 10 },
      { slug: "research", label: "Research", sortOrder: 30 },
    ]);
    expect(readCareerInterests([{ slug: "product", label: "Product", sort_order: 1.5 }])).toBeNull();
    expect(
      readCareerInterests([
        { slug: "product", label: "Product", sort_order: 10 },
        { slug: "product", label: "Product again", sort_order: 20 },
      ]),
    ).toBeNull();
    expect(readCareerInterests(null)).toBeNull();
  });

  test("reads saved slugs and rejects duplicate or incomplete rows", () => {
    expect(readSelectedInterestSlugs([{ interest_slug: "research" }, { interest_slug: "product" }])).toEqual([
      "research",
      "product",
    ]);
    expect(readSelectedInterestSlugs([{ interest_slug: "research" }, { interest_slug: "research" }])).toBeNull();
    expect(readSelectedInterestSlugs([{ slug: "research" }])).toBeNull();
  });

  test("parses a submitted selection against the loaded catalog", () => {
    const formData = new FormData();
    formData.append("interest", " research ");
    formData.append("interest", "product");
    formData.append("interest", "research");

    expect(parseInterestSelection(formData.getAll("interest"), catalog)).toEqual({
      ok: true,
      slugs: ["research", "product"],
    });
    expect(parseInterestSelection([], catalog)).toEqual({ ok: true, slugs: [] });
  });

  test("rejects slugs that are not in the catalog", () => {
    const formData = new FormData();
    formData.append("interest", "product");
    formData.append("interest", "not-a-real-interest");
    expect(parseInterestSelection(formData.getAll("interest"), catalog)).toEqual({
      ok: false,
      message: "Choose interests from the list.",
    });

    formData.set("interest", new Blob(["product"]), "interest.txt");
    expect(parseInterestSelection(formData.getAll("interest"), catalog).ok).toBe(false);
  });

  test("plans inserts and deletes so the stored set matches the submission", () => {
    const current = ["research", "product", "software-engineering"];
    const desired = ["product", "consulting"];
    const plan = planInterestUpdate(current, desired);

    expect(plan).toEqual({
      toAdd: ["consulting"],
      toRemove: ["research", "software-engineering"],
    });

    const removing = new Set(plan.toRemove);
    const next = [...current.filter((slug) => !removing.has(slug)), ...plan.toAdd];
    expect(sameInterestSelection(next, desired)).toBe(true);
    expect(sameInterestSelection(["consulting", "product"], ["product", "consulting"])).toBe(true);
    expect(planInterestUpdate(["product"], ["product"])).toEqual({ toAdd: [], toRemove: [] });
    expect(planInterestUpdate(["product", "research"], [])).toEqual({
      toAdd: [],
      toRemove: ["product", "research"],
    });
  });
});
