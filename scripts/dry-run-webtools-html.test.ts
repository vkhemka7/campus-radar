import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Webtools HTML dry-run script", () => {
  test("cannot write to Supabase or request an ICS feed", () => {
    const source = readFileSync("scripts/dry-run-webtools-html.ts", "utf8");
    expect(source).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(source).not.toMatch(/collectWebtools/);
    expect(source).not.toMatch(/reconcileEventOccurrences/);
    expect(source).not.toMatch(/\.upsert\(/);
    expect(source).not.toMatch(/icalOutlook|\/ical|\/export|\/outlook|\/eventXML|\/userRole/);
    expect(source).toMatch(/createSupabaseClient/);
  });
});
