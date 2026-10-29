/**
 * Reads `public.class_categories` + `public.class_types` and hydrates the synchronous
 * label / theme / behaviour lookups in `@/lib/allowedClassTypes`.
 *
 * Kept separate from that module so the canonical class-type logic stays free of a
 * Supabase dependency and remains importable from tests and non-browser contexts.
 */
import {
  hydrateClassTypeCatalog,
  type ClassCatalogEntry,
} from "@/lib/allowedClassTypes";
import { supabase } from "@/lib/supabase";

export type ClassCategoryRow = {
  id: string;
  slug: string;
  name: string;
  colour: string | null;
  sort_order: number;
  /** Enum types in this category inherit. Seeded categories match their slug. */
  legacy_class_type: string;
};

export type ClassTypeRow = {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  /** `public.class_type` enum value written to `classes.class_type` for this type. */
  legacy_class_type: string;
  is_free_intro: boolean;
  is_guided: boolean;
  colour: string | null;
  is_active: boolean;
  sort_order: number;
  /** Set when the type was deleted in Master → Class types. Kept so past classes keep their name. */
  deleted_at?: string | null;
};

export type ClassCatalog = {
  categories: ClassCategoryRow[];
  types: ClassTypeRow[];
  /** Category row per type id, for grouping and colour inheritance. */
  categoryById: Map<string, ClassCategoryRow>;
};

export const EMPTY_CLASS_CATALOG: ClassCatalog = {
  categories: [],
  types: [],
  categoryById: new Map(),
};

const CATEGORY_COLUMNS = "id, slug, name, colour, sort_order, legacy_class_type";
const TYPE_COLUMNS =
  "id, category_id, slug, name, legacy_class_type, is_free_intro, is_guided, colour, is_active, sort_order, deleted_at";

/**
 * Fetch both levels. Returns an empty catalog on failure rather than throwing — every
 * consumer falls back to the seeded literals, which are today's behaviour.
 */
export async function fetchClassCatalog(): Promise<{
  catalog: ClassCatalog;
  error: Error | null;
}> {
  const [catRes, typeRes] = await Promise.all([
    supabase.from("class_categories").select(CATEGORY_COLUMNS).order("sort_order"),
    supabase.from("class_types").select(TYPE_COLUMNS).order("sort_order"),
  ]);

  let categoryRows = catRes.data;
  let categoryError = catRes.error;
  if (categoryError && /legacy_class_type/.test(categoryError.message ?? "")) {
    const retry = await supabase
      .from("class_categories")
      .select("id, slug, name, colour, sort_order")
      .order("sort_order");
    categoryRows = retry.data;
    categoryError = retry.error;
  }

  const error = (categoryError ?? typeRes.error) as Error | null;
  if (error) {
    console.error("fetchClassCatalog", error);
    return { catalog: EMPTY_CLASS_CATALOG, error };
  }

  const categories = ((categoryRows ?? []) as Omit<ClassCategoryRow, "legacy_class_type">[]).map(
    (c) => ({
      ...c,
      legacy_class_type:
        (c as { legacy_class_type?: string }).legacy_class_type?.trim() || c.slug,
    }),
  );
  const types = (typeRes.data ?? []) as ClassTypeRow[];
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return { catalog: { categories, types, categoryById }, error: null };
}

/** Flatten categories + types onto slugs for `hydrateClassTypeCatalog`. */
export function catalogEntries(catalog: ClassCatalog): ClassCatalogEntry[] {
  const entries: ClassCatalogEntry[] = catalog.categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    label: c.name,
    categorySlug: c.slug,
    accent: c.colour,
    isFreeIntro: false,
    legacyClassType: c.legacy_class_type,
  }));

  for (const t of catalog.types) {
    const category = catalog.categoryById.get(t.category_id);
    entries.push({
      id: t.id,
      slug: t.slug,
      label: t.name,
      categorySlug: category?.slug ?? "",
      accent: t.colour,
      isFreeIntro: t.is_free_intro,
      legacyClassType: t.legacy_class_type,
    });
  }

  return entries;
}

/**
 * Load the catalog and push it into the synchronous lookups. Call at app boot and again
 * after Master edits a type, so a rename lands without a reload.
 */
export async function loadAndHydrateClassCatalog(): Promise<ClassCatalog> {
  const { catalog } = await fetchClassCatalog();
  hydrateClassTypeCatalog(catalogEntries(catalog));
  return catalog;
}

/** Types the client can still schedule, grouped for pickers. Retired types are excluded. */
export function activeTypesByCategory(
  catalog: ClassCatalog,
): { category: ClassCategoryRow; types: ClassTypeRow[] }[] {
  return catalog.categories
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((category) => ({
      category,
      types: catalog.types
        .filter((t) => t.category_id === category.id && t.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    }));
}

/** Derived title: "Category: Type", or just the category when the type is unknown. */
export function deriveClassTitle(
  catalog: ClassCatalog,
  args: { classTypeId: string | null | undefined; categoryName: string | null },
): string {
  const type = args.classTypeId
    ? catalog.types.find((t) => t.id === args.classTypeId)
    : undefined;
  if (!type) return args.categoryName ?? "";
  const category = catalog.categoryById.get(type.category_id);
  if (!category) return type.name;
  return `${category.name}: ${type.name}`;
}
