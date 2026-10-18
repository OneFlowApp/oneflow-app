/**
 * Guard: frontend ALLOWED_CLASS_TYPE_SLUGS must not drift from Postgres class_type.
 *
 * - Always asserts theme/label coverage + equality with DOCUMENTED_DB_CLASS_TYPE_ENUM.
 * The live-database comparison lives in `classTaxonomy.live.test.ts`, which is the single
 * place that opens a production connection.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_CLASS_TYPE_SLUGS,
  CLASS_TYPE_THEME_BY_SLUG,
  CLASS_TYPE_SLUG_LABEL,
} from "./allowedClassTypes";

/**
 * Last-known Postgres `class_type` labels.
 * Update this AND `ALLOWED_CLASS_TYPE_SLUGS` when running ALTER TYPE … ADD VALUE.
 */
const DOCUMENTED_DB_CLASS_TYPE_ENUM = [
  "yoga",
  "sculpt",
  "wellzone",
  "sauna_journey",
  "power",
  "event",
  "beginner",
  "beginner_sculpt",
  "pilates",
  "reformer",
] as const;

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

describe("class_type canonical sync", () => {
  it("every slug has a label and theme entry", () => {
    for (const slug of ALLOWED_CLASS_TYPE_SLUGS) {
      expect(CLASS_TYPE_SLUG_LABEL[slug]).toBeTruthy();
      expect(CLASS_TYPE_THEME_BY_SLUG[slug]).toBeTruthy();
      expect(CLASS_TYPE_THEME_BY_SLUG[slug].accent).toMatch(/^#/);
    }
  });

  it("frontend slugs match documented Postgres enum (set equality)", () => {
    expect(sorted(ALLOWED_CLASS_TYPE_SLUGS)).toEqual(sorted(DOCUMENTED_DB_CLASS_TYPE_ENUM));
  });

});
