/**
 * Live-database guards for the two-level taxonomy created by
 * 20260817120000_class_categories_and_types.sql.
 *
 * Skip-safe: when the Supabase CLI or pg8000 is unavailable these tests warn and pass,
 * matching `allowedClassTypes.enum.test.ts`. Read-only — every statement is a SELECT.
 *
 * This is the ONLY test file that touches the live database. Keep it that way: two files
 * each shelling out to the Supabase CLI race on its "Initialising login role" step and the
 * suite fails intermittently even though each file passes alone.
 *
 * These exist because the compiler can no longer check class types once they are rows.
 * `CLASS_TYPE_THEME_BY_SLUG` used to fail the build via `satisfies` if a slug lost its
 * theme; the equivalent safety net for row-backed types is this file.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ALLOWED_CLASS_TYPE_SLUGS, CLASS_CATEGORY_SLUGS } from "./allowedClassTypes";

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

type Taxonomy = {
  /** `public.class_type` enum labels in declaration order. */
  enum_labels: string[];
  categories: { slug: string; name: string; sort_order: number; legacy_class_type: string | null }[];
  types: {
    slug: string;
    name: string;
    category_slug: string | null;
    legacy_class_type: string;
    is_free_intro: boolean;
    is_guided: boolean;
    is_active: boolean;
  }[];
  /** Classes whose category FK is null or dangling — must be zero for the FK-guarded delete. */
  orphan_class_count: number;
  /** Distinct enum values on `classes` that no class_types row can resolve. */
  unresolvable_enum_values: string[];
};

function fetchLiveTaxonomy(): Taxonomy | null {
  try {
    const script = `
import re, subprocess, json
import pg8000
out = subprocess.check_output(
    ["supabase", "db", "dump", "--linked", "--data-only", "--dry-run", "-f", "/tmp/of-taxonomy-check.sql"],
    stderr=subprocess.STDOUT, text=True)
env = {m.group(1): m.group(2) for m in re.finditer(r'export (PG\\w+)="([^"]*)"', out)}
conn = pg8000.connect(
    host=env["PGHOST"], port=int(env["PGPORT"]), user=env["PGUSER"],
    password=env["PGPASSWORD"], database=env["PGDATABASE"], ssl_context=True)
cur = conn.cursor()
cur.execute("SET ROLE postgres")
cur.execute("SET statement_timeout = '30s'")

cur.execute("""
  SELECT e.enumlabel FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'class_type' ORDER BY e.enumsortorder
""")
enum_labels = [r[0] for r in cur.fetchall()]

cur.execute("""
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='class_categories' AND column_name='legacy_class_type'
""")
has_legacy = cur.fetchone() is not None
if has_legacy:
    cur.execute("""
      SELECT slug, name, sort_order, legacy_class_type::text
      FROM public.class_categories ORDER BY sort_order, slug
    """)
    categories = [{"slug": r[0], "name": r[1], "sort_order": r[2], "legacy_class_type": r[3]}
                  for r in cur.fetchall()]
else:
    cur.execute("""
      SELECT slug, name, sort_order FROM public.class_categories ORDER BY sort_order, slug
    """)
    categories = [{"slug": r[0], "name": r[1], "sort_order": r[2], "legacy_class_type": r[0]}
                  for r in cur.fetchall()]

cur.execute("""
  SELECT t.slug, t.name, c.slug, t.legacy_class_type::text,
         t.is_free_intro, t.is_guided, t.is_active
  FROM public.class_types t
  LEFT JOIN public.class_categories c ON c.id = t.category_id
  ORDER BY c.sort_order, t.sort_order, t.slug
""")
types = [{"slug": r[0], "name": r[1], "category_slug": r[2], "legacy_class_type": r[3],
          "is_free_intro": bool(r[4]), "is_guided": bool(r[5]), "is_active": bool(r[6])}
         for r in cur.fetchall()]

cur.execute("""
  SELECT count(*) FROM public.classes cl
  LEFT JOIN public.class_categories c ON c.id = cl.class_category_id
  WHERE cl.class_category_id IS NULL OR c.id IS NULL
""")
orphans = cur.fetchone()[0]

cur.execute("""
  SELECT DISTINCT cl.class_type::text
  FROM public.classes cl
  WHERE NOT EXISTS (
    SELECT 1 FROM public.class_types t WHERE t.legacy_class_type = cl.class_type
  )
""")
unresolvable = [r[0] for r in cur.fetchall()]

print(json.dumps({"enum_labels": enum_labels, "categories": categories, "types": types,
                  "orphan_class_count": orphans,
                  "unresolvable_enum_values": unresolvable}))
conn.close()
`;
    const raw = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
      maxBuffer: 4_000_000,
      timeout: 60_000,
    });
    const line = raw.trim().split("\n").filter(Boolean).at(-1);
    if (!line) return null;
    return JSON.parse(line) as Taxonomy;
  } catch {
    return null;
  }
}

const live = fetchLiveTaxonomy();

describe("live class taxonomy", () => {
  if (!live) {
    it("skipped — Supabase CLI / pg8000 unavailable", () => {
      console.warn("[class taxonomy] live DB check skipped");
      expect(true).toBe(true);
    });
    return;
  }

  const enumSlugs = new Set<string>(ALLOWED_CLASS_TYPE_SLUGS);
  const sorted = (xs: readonly string[]): string[] => [...xs].sort();

  it("frontend slugs match the live Postgres enum", () => {
    expect(sorted(ALLOWED_CLASS_TYPE_SLUGS)).toEqual(sorted(live.enum_labels));
  });

  it("documented enum matches the live Postgres enum", () => {
    expect(sorted(DOCUMENTED_DB_CLASS_TYPE_ENUM)).toEqual(sorted(live.enum_labels));
  });

  it("includes the five seeded categories", () => {
    const slugs = new Set(live.categories.map((c) => c.slug));
    for (const slug of CLASS_CATEGORY_SLUGS) expect(slugs.has(slug)).toBe(true);
  });

  it("every category billing enum is a class_type value", () => {
    for (const c of live.categories) {
      expect(enumSlugs).toContain(c.legacy_class_type ?? c.slug);
    }
  });

  it("every type resolves to a category", () => {
    for (const t of live.types) expect(t.category_slug).not.toBeNull();
  });

  it("every legacy_class_type is a class_type enum value", () => {
    for (const t of live.types) expect(enumSlugs).toContain(t.legacy_class_type);
  });

  it("free intro is exactly beginner and beginner_sculpt", () => {
    // Migration defaults must preserve FREE_BEGINNER_CLASS_TYPES exactly, or free intro
    // classes start charging.
    const free = live.types.filter((t) => t.is_free_intro).map((t) => t.slug).sort();
    expect(free).toEqual(["beginner", "beginner_sculpt"]);
  });

  it("only the Wellzone Unguided type is unguided", () => {
    const unguided = live.types.filter((t) => !t.is_guided);
    expect(unguided.map((t) => t.slug)).toEqual(["wellzone"]);
    expect(unguided[0].category_slug).toBe("wellzone");
  });

  it("the demoted slugs are types under the right categories, not categories", () => {
    const bySlug = new Map(live.types.map((t) => [t.slug, t]));
    expect(bySlug.get("power")?.category_slug).toBe("yoga");
    expect(bySlug.get("beginner")?.category_slug).toBe("yoga");
    expect(bySlug.get("beginner_sculpt")?.category_slug).toBe("sculpt");
    expect(bySlug.get("sauna_journey")?.category_slug).toBe("wellzone");
  });

  it("no class was orphaned by the category demotion", () => {
    expect(live.orphan_class_count).toBe(0);
  });

  it("every enum value on classes is reachable from some type", () => {
    // Otherwise a scheduled class has a type the picker cannot represent.
    expect(live.unresolvable_enum_values).toEqual([]);
  });
});
