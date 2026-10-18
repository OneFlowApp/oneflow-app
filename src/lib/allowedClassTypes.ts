/**
 * Canonical studio class-type module.
 *
 * Two levels since 20260817120000_class_categories_and_types.sql:
 * `class_categories` (fixed: Yoga, Sculpt, Pilates, Wellzone, Events) → `class_types`
 * (client-editable in Master). Labels, themes and behaviour flags below are seeded with
 * today's literals and then REPLACED at app boot by `hydrateClassTypeCatalog()` — see
 * `src/lib/classTypeCatalog.ts`. Consumers stay synchronous and unchanged; before
 * hydration lands (or if it fails) the seeds are exactly today's behaviour.
 *
 * `ALLOWED_CLASS_TYPE_SLUGS` deliberately does NOT grow with new types. It mirrors the
 * Postgres enum `public.class_type`, which is still the column type of
 * `classes.class_type`, `products.allowed_class_types` and `user_credits.allowed_class_types`.
 * A class of a newly created type stores its type's `legacy_class_type` enum value, so
 * credit eligibility is unaffected. Edge functions that cannot import this file duplicate
 * the enum slug list — see `supabase/functions/invite-guide/index.ts` (`DISCIPLINE_SLUGS`).
 *
 * Do not merge with product `credit_category` — that is a separate concept.
 */
import { normalizeProductCategoryKey } from "@/lib/productCategories";

/** Mirrors Postgres `class_type` enum — order need not match DB sortorder. */
export const ALLOWED_CLASS_TYPE_SLUGS = [
  "yoga",
  "sculpt",
  "pilates",
  "wellzone",
  "sauna_journey",
  "power",
  "beginner",
  "beginner_sculpt",
  "event",
  "reformer",
] as const;

export type AllowedClassTypeSlug = (typeof ALLOWED_CLASS_TYPE_SLUGS)[number];

/** Seeded category slugs. Extra categories may be added in Master by inheriting one of these. */
export const CLASS_CATEGORY_SLUGS = [
  "yoga",
  "sculpt",
  "pilates",
  "wellzone",
  "event",
  "reformer",
] as const;

export type ClassCategorySlug = (typeof CLASS_CATEGORY_SLUGS)[number];

/**
 * Label per slug, for categories and types alike.
 *
 * Mutable: `hydrateClassTypeCatalog()` adds rows and overwrites names when the client
 * renames a type in Master. Seeded with the enum labels so a cold start, a failed fetch
 * or a signed-out render still reads correctly.
 */
export const CLASS_TYPE_SLUG_LABEL: Record<string, string> = {
  yoga: "Yoga",
  sculpt: "Sculpt",
  pilates: "Pilates",
  wellzone: "Wellzone",
  sauna_journey: "Sauna Journey",
  power: "Power",
  beginner: "Beginner",
  beginner_sculpt: "Beginner sculpt",
  event: "Event",
  reformer: "Reformer",
};

/**
 * Full enum set (e.g. all_access packages, guide disciplines).
 *
 * Enum values only — this is written into `class_type[]` columns, so it must never gain
 * a client-created type slug.
 */
export const ALL_ALLOWED_CLASS_TYPES: readonly AllowedClassTypeSlug[] = [
  ...ALLOWED_CLASS_TYPE_SLUGS,
];

/**
 * Guide `disciplines` + invite-guide allow-list — full enum.
 * Keep identical to ALLOWED_CLASS_TYPE_SLUGS (and invite-guide DISCIPLINE_SLUGS).
 */
export const GUIDE_DISCIPLINE_SLUGS: readonly AllowedClassTypeSlug[] = [
  ...ALLOWED_CLASS_TYPE_SLUGS,
];

/** Checkbox labels for `guides.disciplines` (display strings). */
export const GUIDE_DISCIPLINE_LABELS: readonly string[] = ALLOWED_CLASS_TYPE_SLUGS.map(
  (slug) => CLASS_TYPE_SLUG_LABEL[slug],
);

/**
 * Studio pack / Seeker yoga-side types (excludes Wellzone & Sauna Journey).
 * Shared by product defaults and The Seeker multi-credit rows.
 *
 * Enum values only, for the same reason as ALL_ALLOWED_CLASS_TYPES.
 */
export const SEEKER_YOGA_CLASS_TYPES: readonly AllowedClassTypeSlug[] = [
  "yoga",
  "sculpt",
  "pilates",
  "power",
  "beginner",
  "beginner_sculpt",
  "event",
];

/** Wellzone credit category / sauna reminder branch. Enum values only. */
export const WELLZONE_CLASS_TYPES: readonly AllowedClassTypeSlug[] = [
  "wellzone",
  "sauna_journey",
];

/** Intro classes booked without credits or payment. Enum values only. */
export const FREE_BEGINNER_CLASS_TYPES: readonly AllowedClassTypeSlug[] = [
  "beginner",
  "beginner_sculpt",
];

/**
 * Behaviour sets, keyed by any catalog slug (category or type).
 *
 * These replace the hardcoded arrays above as the runtime source of truth once hydrated:
 * `is_free_intro` on the type row feeds FREE_INTRO_SET, and category `wellzone` membership
 * feeds WELLZONE_SET. The arrays above remain the enum values written to credit rows.
 */
const FREE_INTRO_SET = new Set<string>(FREE_BEGINNER_CLASS_TYPES);
const WELLZONE_SET = new Set<string>(WELLZONE_CLASS_TYPES);

/** Category slug per catalog slug. Categories map to themselves. */
const CATEGORY_BY_SLUG: Record<string, string> = {
  yoga: "yoga",
  sculpt: "sculpt",
  pilates: "pilates",
  wellzone: "wellzone",
  sauna_journey: "wellzone",
  power: "yoga",
  beginner: "yoga",
  beginner_sculpt: "sculpt",
  event: "event",
  reformer: "reformer",
};

export type ClassTypeTheme = {
  /** Left accent stripe (hex) */
  accent: string;
  /** Subtle card background wash (Tailwind class). Empty for hydrated types. */
  tint: string;
  /**
   * Inline background for hydrated types, as `#rrggbbaa`. Empty when `tint` carries the
   * wash. Tailwind cannot generate a class for a colour that only exists in the database,
   * so client-created types wash via `style` instead.
   */
  tintBg: string;
};

/**
 * Shared class-card badge (top-right pill) — label only, not colour-coded.
 * Same style for every class type.
 */
export const CLASS_TYPE_BADGE_CLASS =
  "border border-[#c5d4b8] bg-primary-soft text-[#3d4f36]";

/** Alpha suffix for accent-derived washes — roughly the weight of a Tailwind `-50`. */
const TINT_ALPHA = "14";

/**
 * Enum-slug themes. `satisfies` still fails the build if an enum slug loses its theme;
 * only client-created types fall through to the category default.
 */
const ENUM_CLASS_TYPE_THEME = {
  yoga: { accent: "#7a9a68", tint: "bg-[#f4f8f1]", tintBg: "" },
  sculpt: { accent: "#d97706", tint: "bg-amber-50", tintBg: "" },
  pilates: { accent: "#7c3aed", tint: "bg-violet-50", tintBg: "" },
  wellzone: { accent: "#0284c7", tint: "bg-sky-50", tintBg: "" },
  sauna_journey: { accent: "#ea580c", tint: "bg-orange-50", tintBg: "" },
  power: { accent: "#44403c", tint: "bg-stone-100", tintBg: "" },
  beginner: { accent: "#8fa67d", tint: "bg-[#f7faf4]", tintBg: "" },
  beginner_sculpt: { accent: "#e8a54b", tint: "bg-[#fff8ed]", tintBg: "" },
  event: { accent: "#9333ea", tint: "bg-purple-50", tintBg: "" },
  reformer: { accent: "#b45309", tint: "bg-amber-50", tintBg: "" },
} as const satisfies Record<AllowedClassTypeSlug, ClassTypeTheme>;

/**
 * Theme keyed by any catalog slug. Mutable — hydration adds client-created types.
 * A slug with no entry falls back to its category's theme, then to FALLBACK_THEME.
 */
export const CLASS_TYPE_THEME_BY_SLUG: Record<string, ClassTypeTheme> = {
  ...ENUM_CLASS_TYPE_THEME,
};

const FALLBACK_THEME: ClassTypeTheme = {
  accent: "#a3b693",
  tint: "bg-muted/40",
  tintBg: "",
};

export function isAllowedClassTypeSlug(value: string): value is AllowedClassTypeSlug {
  return (ALLOWED_CLASS_TYPE_SLUGS as readonly string[]).includes(value);
}

/** True for any slug in the catalog — enum values plus client-created types. */
export function isKnownClassTypeSlug(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLASS_TYPE_SLUG_LABEL, value);
}

export function humanizeClassTypeSlug(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Normalize slug or display label → catalog slug when known. */
export function resolveClassTypeSlug(typeOrSlug: string | null | undefined): string | null {
  const raw = (typeOrSlug ?? "").trim();
  if (!raw) return null;
  const asSlug = raw.toLowerCase().replace(/\s+/g, "_");
  if (isKnownClassTypeSlug(asSlug)) return asSlug;
  const lower = raw.toLowerCase();
  for (const slug of Object.keys(CLASS_TYPE_SLUG_LABEL)) {
    if (CLASS_TYPE_SLUG_LABEL[slug].toLowerCase() === lower) return slug;
  }
  return null;
}

/** Category slug for any catalog slug, or null when unknown. */
export function classCategorySlugFor(
  typeOrSlug: string | null | undefined,
): string | null {
  const slug = resolveClassTypeSlug(typeOrSlug);
  return slug ? (CATEGORY_BY_SLUG[slug] ?? null) : null;
}

/** Display label for a category slug, e.g. `wellzone` → "Wellzone". */
export function classCategoryLabel(categorySlug: string | null | undefined): string {
  const slug = (categorySlug ?? "").trim();
  if (!slug) return "";
  return CLASS_TYPE_SLUG_LABEL[slug] ?? humanizeClassTypeSlug(slug);
}

export function displayClassType(raw: string | null | undefined): string {
  const slug = resolveClassTypeSlug(raw);
  if (slug) return CLASS_TYPE_SLUG_LABEL[slug];
  const key = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (!key) return CLASS_TYPE_SLUG_LABEL.yoga;
  return humanizeClassTypeSlug(key);
}

export function classTypeTheme(typeOrSlug: string | null | undefined): ClassTypeTheme {
  const slug = resolveClassTypeSlug(typeOrSlug);
  if (!slug) return FALLBACK_THEME;
  const own = CLASS_TYPE_THEME_BY_SLUG[slug];
  if (own) return own;
  const category = CATEGORY_BY_SLUG[slug];
  const inherited = category ? CLASS_TYPE_THEME_BY_SLUG[category] : undefined;
  if (!inherited) return FALLBACK_THEME;
  // Inherit the colour but not the category's Tailwind wash, so the type reads as
  // related to its category without being mistaken for the category itself.
  return { accent: inherited.accent, tint: "", tintBg: `${inherited.accent}${TINT_ALPHA}` };
}

/** Shared neutral badge classes for every class type (cards + admin pills). */
export function classTypeBadgeClass(_slug?: string | null): string {
  return CLASS_TYPE_BADGE_CLASS;
}

/** Accent per slug. Mutable alongside CLASS_TYPE_THEME_BY_SLUG. */
export const CLASS_TYPE_SLUG_ACCENT: Record<string, string> = Object.fromEntries(
  Object.entries(ENUM_CLASS_TYPE_THEME).map(([slug, theme]) => [slug, theme.accent]),
);

/**
 * @deprecated Prefer CLASS_TYPE_THEME_BY_SLUG. Kept for label-keyed callers during Pass 1.
 */
export const CLASS_TYPE_THEME: Record<string, ClassTypeTheme> = Object.fromEntries(
  ALLOWED_CLASS_TYPE_SLUGS.map((slug) => [
    CLASS_TYPE_SLUG_LABEL[slug],
    CLASS_TYPE_THEME_BY_SLUG[slug],
  ]),
);

export function allowedClassTypeCheckboxOptions(): {
  value: AllowedClassTypeSlug;
  label: string;
}[] {
  return ALLOWED_CLASS_TYPE_SLUGS.map((slug) => ({
    value: slug,
    label: CLASS_TYPE_SLUG_LABEL[slug],
  }));
}

export function defaultAllowedClassTypesForCreditCategory(
  category: string | null | undefined,
): AllowedClassTypeSlug[] {
  const k = normalizeProductCategoryKey(category);
  if (k === "all_access") return [...ALL_ALLOWED_CLASS_TYPES];
  if (k === "yoga" || k === "power" || k === "mat_towel") return [...SEEKER_YOGA_CLASS_TYPES];
  if (k === "wellzone") return [...WELLZONE_CLASS_TYPES];
  return [...ALL_ALLOWED_CLASS_TYPES];
}

export function userCreditCoversClassType(args: {
  category: string | null | undefined;
  allowed_class_types: string[] | null | undefined;
  classType: string;
}): boolean {
  const cat = normalizeProductCategoryKey(args.category);
  if (cat === "mat_towel" || cat === "cafe") return false;
  if (cat === "all_access") return true;
  const allowed = args.allowed_class_types;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(args.classType);
}

/**
 * Books with no credit and no payment.
 *
 * Backed by `class_types.is_free_intro` once hydrated; seeded with `beginner` and
 * `beginner_sculpt`, which is exactly today's FREE_BEGINNER_CLASS_TYPES.
 */
export function isFreeBeginnerClass(classType: string | null | undefined): boolean {
  return FREE_INTRO_SET.has(String(classType ?? "").toLowerCase());
}

/**
 * Wellzone credit category + sauna confirmation-email branch.
 *
 * Backed by category membership once hydrated (every type under Wellzone, guided or not).
 */
export function isWellzoneSaunaClassType(classType: string | null | undefined): boolean {
  const s = String(classType ?? "")
    .trim()
    .toLowerCase();
  if (WELLZONE_SET.has(s)) return true;
  // Legacy fuzzy match for free-text / old rows
  return s.includes("sauna");
}

export function bookingConfirmationTemplateForClassType(
  classType: string | null | undefined,
): "booking_confirmation_sauna" | "booking_confirmation_class" {
  return isWellzoneSaunaClassType(classType)
    ? "booking_confirmation_sauna"
    : "booking_confirmation_class";
}

/** One row of the hydrated catalog. Categories and types are flattened onto slugs. */
export type ClassCatalogEntry = {
  /** Row id, so `classes.class_type_id` resolves to a slug without a join. */
  id: string;
  slug: string;
  label: string;
  categorySlug: string;
  /** Null inherits the category accent. */
  accent: string | null;
  isFreeIntro: boolean;
  /** Enum a class of this type stores. Categories store the value types inherit. */
  legacyClassType?: string;
};

/** `class_types.id` → slug, populated by hydration. */
const SLUG_BY_ROW_ID: Record<string, string> = {};

/** Resolve a `classes.class_type_id` to its catalog slug, or null before hydration. */
export function classTypeSlugById(id: string | null | undefined): string | null {
  if (!id) return null;
  return SLUG_BY_ROW_ID[id] ?? null;
}

/**
 * Replace the seeded literals with database rows. Idempotent; safe to call again after
 * the client edits a type in Master so the change lands without a reload.
 *
 * Only slugs present in `entries` are touched — the enum seeds survive a partial fetch,
 * so a class type that somehow never made it into the table still renders.
 */
export function hydrateClassTypeCatalog(entries: readonly ClassCatalogEntry[]): void {
  if (entries.length === 0) return;

  for (const entry of entries) {
    const slug = entry.slug.trim().toLowerCase();
    if (!slug) continue;

    if (entry.id) SLUG_BY_ROW_ID[entry.id] = slug;
    CLASS_TYPE_SLUG_LABEL[slug] = entry.label.trim() || humanizeClassTypeSlug(slug);

    const category = entry.categorySlug.trim().toLowerCase();
    if (category) CATEGORY_BY_SLUG[slug] = category;

    if (entry.accent) {
      const theme = CLASS_TYPE_THEME_BY_SLUG[slug];
      CLASS_TYPE_THEME_BY_SLUG[slug] = {
        accent: entry.accent,
        // Keep the hand-tuned Tailwind wash when this slug already had one.
        tint: theme?.tint ?? "",
        tintBg: theme?.tint ? "" : `${entry.accent}${TINT_ALPHA}`,
      };
      CLASS_TYPE_SLUG_ACCENT[slug] = entry.accent;
    } else if (!CLASS_TYPE_THEME_BY_SLUG[slug]) {
      // Leave unset so classTypeTheme() inherits the category colour on read.
      delete CLASS_TYPE_SLUG_ACCENT[slug];
    }

    // Set membership follows the row both ways, but only for slugs the fetch returned.
    // A seeded slug missing from `entries` keeps today's behaviour rather than silently
    // losing it — the failure mode there is people being charged for a free intro class.
    if (entry.isFreeIntro) FREE_INTRO_SET.add(slug);
    else FREE_INTRO_SET.delete(slug);

    // Only move a slug out of the Wellzone set on a row that actually names a category.
    // An unresolved category would otherwise drop `sauna_journey`, silently switching the
    // sauna confirmation email and the late check-in window back to the class defaults.
    const billing = (entry.legacyClassType ?? "").trim().toLowerCase();
    if (category === "wellzone" || billing === "wellzone" || billing === "sauna_journey") {
      WELLZONE_SET.add(slug);
    } else if (category) WELLZONE_SET.delete(slug);
  }
}
