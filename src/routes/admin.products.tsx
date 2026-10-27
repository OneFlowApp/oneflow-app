import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { groupProductsByDisplayCategory, productCategorySlugLabel } from "@/lib/productCategories";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [{ title: "Products — One Flow Admin" }],
  }),
  component: ProductsPage,
});

const SAGE = "#a3b693";
const SAGE_BORDER = "border-[#c5d4b8]/80";

const UNLIMITED_CREDITS = 999;

type AccessScope = "longkloof" | "open_access";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  price_zar: number;
  credit_count: number | null;
  validity_days: number | null;
  allowed_class_types: string[] | null;
  is_addon: boolean;
  is_staff_only: boolean;
  is_active: boolean;
  sort_order: number | null;
  pricing_section_id: string | null;
  access_scope: AccessScope;
  upgrade_price_zar: number | null;
  member_price_zar: number | null;
  mat_included: boolean;
  shower_towel_included: boolean;
};

type AccessGroup = {
  id: string;
  name: string;
  class_types: string[];
};

type PricingSection = {
  id: string;
  name: string;
};

/** One "What's included" line; maps to a `product_allowances` row. */
type AllowanceItem = {
  key: string;
  label: string;
  groupIds: string[];
  unlimited: boolean;
  credits: string;
};

const NO_PRICING_SECTION = "__none__";

/** Access groups that make a new pack a Wellzone product (matched by name). */
const WELLZONE_GROUP_NAMES = new Set(["wellzone", "sauna journey"]);

let allowanceKeySeq = 0;

function newAllowanceItem(partial: Partial<Omit<AllowanceItem, "key">> = {}): AllowanceItem {
  allowanceKeySeq += 1;
  return {
    key: `allowance-${allowanceKeySeq}`,
    label: "",
    groupIds: [],
    unlimited: false,
    credits: "10",
    ...partial,
  };
}

function nullableNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Blank → null; otherwise a non-negative number, or `undefined` when invalid. */
function parseOptionalZar(value: string): number | null | undefined {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function formatPriceZar(zar: number) {
  const n = Number(zar);
  if (Number.isNaN(n)) return "R—";
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

function tableCategoryLabel(category: string | null | undefined) {
  return productCategorySlugLabel(category);
}

/** Parse PostgreSQL `text[]` text representation, e.g. `{yoga,sculpt}` or `{"yoga","sculpt"}`. */
function parsePostgresTextArrayString(s: string): string[] {
  const t = s.trim();
  if (t === "" || t === "{}") return [];
  if (!t.startsWith("{") || !t.endsWith("}")) return [];
  const inner = t.slice(1, -1);
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => {
      const p = part.trim();
      if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1).replace(/""/g, '"');
      return p;
    })
    .filter(Boolean);
}

function normalizeClassTypes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed: unknown = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      /* not JSON */
    }
    if (t.startsWith("{") && t.endsWith("}")) return parsePostgresTextArrayString(t);
  }
  return [];
}

/** Postgres `text[]`: pass a real JS string[] to PostgREST (never a single JSON string). */
function toPgTextArray(values: string[]): string[] {
  return [...values].map((v) => String(v).trim()).filter(Boolean);
}

function creditsDisplay(count: number | null) {
  if (count == null) return "—";
  const n = typeof count === "number" ? count : Number(count);
  if (!Number.isFinite(n)) return "—";
  if (n >= UNLIMITED_CREDITS) return "Unlimited";
  return String(Math.trunc(n));
}

function validityDisplay(days: number | null) {
  if (days == null || !Number.isFinite(Number(days))) return "—";
  const d = Math.trunc(Number(days));
  return `${d} day${d === 1 ? "" : "s"}`;
}

function emptyForm() {
  return {
    name: "",
    description: "",
    priceZar: "",
    validityDays: "30",
    isAddon: false,
    isActive: true,
    pricingSectionId: NO_PRICING_SECTION,
    accessScope: "longkloof" as AccessScope,
    upgradePriceZar: "",
    memberPriceZar: "",
    matIncluded: false,
    showerTowelIncluded: false,
  };
}

type ProductSortKey = "name_asc" | "price_asc" | "price_desc" | "category";

function compareProductName(a: ProductRow, b: ProductRow): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function isProductDeleteBlockedByFk(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "23503") return true;
  return /foreign key|violates foreign key constraint|still referenced/i.test(e.message ?? "");
}

function AdminProductTableRow({
  product: p,
  sectionName,
  togglingId,
  onPersistActive,
  onEdit,
  onDelete,
}: {
  product: ProductRow;
  sectionName: string | null;
  togglingId: string | null;
  onPersistActive: (id: string, next: boolean) => void;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
}) {
  return (
    <tr className="border-t border-border">
      <td className="max-w-[140px] truncate px-4 py-3 font-semibold sm:max-w-xs sm:px-5 md:max-w-md">
        <div className="flex items-center gap-2">
          <span className="truncate">{p.name}</span>
          {p.access_scope === "open_access" && (
            <span className="inline-flex shrink-0 rounded-full bg-[#3d4f36] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Open Access
            </span>
          )}
        </div>
        {sectionName && (
          <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{sectionName}</p>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 sm:px-5">
        <span className="inline-flex rounded-full bg-[#e8efe3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]">
          {tableCategoryLabel(p.category)}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 tabular-nums sm:px-5">
        {formatPriceZar(p.price_zar)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 sm:px-5">{creditsDisplay(p.credit_count)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground sm:px-5">
        {validityDisplay(p.validity_days)}
      </td>
      <td className="px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Switch
            checked={p.is_active}
            disabled={togglingId === p.id}
            onCheckedChange={(checked) => void onPersistActive(p.id, checked)}
            className="data-[state=checked]:bg-[#a3b693]"
            aria-label={p.is_active ? "Deactivate product" : "Activate product"}
          />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {p.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right sm:px-5">
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 border-[#c5d4b8] bg-card"
            onClick={() => onEdit(p)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(p)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<ProductSortKey>("category");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [deleteFkBlocked, setDeleteFkBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceZar, setPriceZar] = useState("");
  const [validityDays, setValidityDays] = useState("30");
  const [isAddon, setIsAddon] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [pricingSectionId, setPricingSectionId] = useState(NO_PRICING_SECTION);
  const [accessScope, setAccessScope] = useState<AccessScope>("longkloof");
  const [upgradePriceZar, setUpgradePriceZar] = useState("");
  const [memberPriceZar, setMemberPriceZar] = useState("");
  const [matIncluded, setMatIncluded] = useState(false);
  const [showerTowelIncluded, setShowerTowelIncluded] = useState(false);
  const [allowanceItems, setAllowanceItems] = useState<AllowanceItem[]>(() => [newAllowanceItem()]);
  const [allowancesLoading, setAllowancesLoading] = useState(false);

  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([]);
  const [pricingSections, setPricingSections] = useState<PricingSection[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, category, description, price_zar, credit_count, validity_days, allowed_class_types, is_addon, is_staff_only, is_active, sort_order, pricing_section_id, access_scope, upgrade_price_zar, member_price_zar, mat_included, shower_towel_included",
      )
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("products load failed", error);
      toast.error(supabaseErrorMessage(error, "Could not load products"));
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped: ProductRow[] = (data ?? []).map((raw: Record<string, unknown>) => ({
      id: String(raw.id),
      name: String(raw.name ?? ""),
      category: String(raw.category ?? ""),
      description: raw.description == null ? null : String(raw.description),
      price_zar: Number(raw.price_zar ?? 0),
      credit_count: raw.credit_count == null ? null : Number(raw.credit_count),
      validity_days: raw.validity_days == null ? null : Number(raw.validity_days),
      allowed_class_types: normalizeClassTypes(raw.allowed_class_types),
      is_addon: Boolean(raw.is_addon),
      is_staff_only: Boolean(raw.is_staff_only),
      is_active: raw.is_active !== false,
      sort_order: raw.sort_order == null ? null : Number(raw.sort_order),
      pricing_section_id: raw.pricing_section_id == null ? null : String(raw.pricing_section_id),
      access_scope: raw.access_scope === "open_access" ? "open_access" : "longkloof",
      upgrade_price_zar: nullableNumber(raw.upgrade_price_zar),
      member_price_zar: nullableNumber(raw.member_price_zar),
      mat_included: Boolean(raw.mat_included),
      shower_towel_included: Boolean(raw.shower_towel_included),
    }));

    setRows(mapped);
    setLoading(false);
  }, []);

  const loadLookups = useCallback(async () => {
    const [groupsRes, sectionsRes] = await Promise.all([
      supabase
        .from("access_groups")
        .select("id, name, class_types, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("pricing_sections")
        .select("id, name, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);
    if (groupsRes.error) {
      console.error("access_groups load failed", groupsRes.error);
      toast.error(supabaseErrorMessage(groupsRes.error, "Could not load access groups"));
    } else {
      setAccessGroups(
        (groupsRes.data ?? []).map((raw: Record<string, unknown>) => ({
          id: String(raw.id),
          name: String(raw.name ?? ""),
          class_types: normalizeClassTypes(raw.class_types),
        })),
      );
    }
    if (sectionsRes.error) {
      console.error("pricing_sections load failed", sectionsRes.error);
      toast.error(supabaseErrorMessage(sectionsRes.error, "Could not load pricing sections"));
    } else {
      setPricingSections(
        (sectionsRes.data ?? []).map((raw: Record<string, unknown>) => ({
          id: String(raw.id),
          name: String(raw.name ?? ""),
        })),
      );
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLookups();
  }, [load, loadLookups]);

  const pricingSectionNameById = useMemo(
    () => new Map(pricingSections.map((s) => [s.id, s.name])),
    [pricingSections],
  );

  const sectionNameFor = (p: ProductRow) =>
    p.pricing_section_id ? (pricingSectionNameById.get(p.pricing_section_id) ?? null) : null;

  const groupedProductSections = useMemo(
    () => groupProductsByDisplayCategory(rows, (a, b) => compareProductName(a, b)),
    [rows],
  );

  const flatSortedProducts = useMemo(() => {
    if (sort === "category") return null;
    const sorted = [...rows];
    switch (sort) {
      case "price_asc":
        sorted.sort((a, b) => a.price_zar - b.price_zar || compareProductName(a, b));
        break;
      case "price_desc":
        sorted.sort((a, b) => b.price_zar - a.price_zar || compareProductName(a, b));
        break;
      case "name_asc":
      default:
        sorted.sort(compareProductName);
    }
    return sorted;
  }, [rows, sort]);

  const resetFormToDefaults = useCallback(() => {
    const d = emptyForm();
    setName(d.name);
    setDescription(d.description);
    setPriceZar(d.priceZar);
    setValidityDays(d.validityDays);
    setIsAddon(d.isAddon);
    setIsActive(d.isActive);
    setPricingSectionId(d.pricingSectionId);
    setAccessScope(d.accessScope);
    setUpgradePriceZar(d.upgradePriceZar);
    setMemberPriceZar(d.memberPriceZar);
    setMatIncluded(d.matIncluded);
    setShowerTowelIncluded(d.showerTowelIncluded);
    setAllowanceItems([newAllowanceItem()]);
  }, []);

  const populateFromRow = useCallback((p: ProductRow) => {
    setName(p.name);
    setDescription(p.description ?? "");
    setPriceZar(String(p.price_zar ?? ""));
    setValidityDays(String(p.validity_days ?? ""));
    setIsAddon(p.is_addon);
    setIsActive(p.is_active);
    setPricingSectionId(p.pricing_section_id ?? NO_PRICING_SECTION);
    setAccessScope(p.access_scope);
    setUpgradePriceZar(p.upgrade_price_zar == null ? "" : String(p.upgrade_price_zar));
    setMemberPriceZar(p.member_price_zar == null ? "" : String(p.member_price_zar));
    setMatIncluded(p.mat_included);
    setShowerTowelIncluded(p.shower_towel_included);
  }, []);

  /** Loads the pack's `product_allowances` rows into the "What's included" builder. */
  const loadAllowancesFor = useCallback(async (productId: string) => {
    setAllowancesLoading(true);
    setAllowanceItems([]);
    const { data, error } = await supabase
      .from("product_allowances")
      .select("id, label, group_ids, credits, sort_order")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true });
    setAllowancesLoading(false);
    if (error) {
      console.error("product_allowances load failed", error);
      toast.error(supabaseErrorMessage(error, "Could not load included items"));
      setAllowanceItems([newAllowanceItem()]);
      return;
    }
    const items = (data ?? []).map((raw: Record<string, unknown>) => {
      const c = Number(raw.credits ?? 0);
      const unlimited = c >= UNLIMITED_CREDITS;
      return newAllowanceItem({
        label: String(raw.label ?? ""),
        groupIds: normalizeClassTypes(raw.group_ids),
        unlimited,
        credits: unlimited ? "10" : String(Math.trunc(c)),
      });
    });
    setAllowanceItems(items.length > 0 ? items : [newAllowanceItem()]);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setEditingId(null);
  }, []);

  const openAdd = () => {
    setEditingId(null);
    resetFormToDefaults();
    setAllowancesLoading(false);
    setSheetOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditingId(p.id);
    populateFromRow(p);
    setSheetOpen(true);
    void loadAllowancesFor(p.id);
  };

  const updateAllowanceItem = (key: string, patch: Partial<Omit<AllowanceItem, "key">>) => {
    setAllowanceItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const toggleAllowanceGroup = (key: string, groupId: string, checked: boolean) => {
    setAllowanceItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const has = it.groupIds.includes(groupId);
        if (checked && !has) return { ...it, groupIds: [...it.groupIds, groupId] };
        if (!checked && has) return { ...it, groupIds: it.groupIds.filter((g) => g !== groupId) };
        return it;
      }),
    );
  };

  const addAllowanceItem = () => setAllowanceItems((prev) => [...prev, newAllowanceItem()]);

  const removeAllowanceItem = (key: string) =>
    setAllowanceItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)));

  const memberPriceError = useMemo(() => {
    const member = parseOptionalZar(memberPriceZar);
    if (member === undefined) return "Enter a valid member price";
    if (member == null) return null;
    const price = Number(priceZar);
    if (priceZar.trim() && Number.isFinite(price) && member >= price) {
      return "Member price must be lower than the normal price";
    }
    return null;
  }, [memberPriceZar, priceZar]);

  const persistActive = async (id: string, next: boolean) => {
    setTogglingId(id);
    const { error } = await supabase.from("products").update({ is_active: next }).eq("id", id);
    setTogglingId(null);
    if (error) {
      console.error("products persistActive failed", error);
      toast.error(supabaseErrorMessage(error, "Could not update product"));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: next } : r)));
    toast.success(next ? "Product activated" : "Product hidden from pricing");
  };

  const openDeleteDialog = (product: ProductRow) => {
    setDeleteFkBlocked(false);
    setDeleteTarget(product);
  };

  const confirmDeleteProduct = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("products").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      if (isProductDeleteBlockedByFk(error)) {
        setDeleteFkBlocked(true);
        return;
      }
      toast.error(supabaseErrorMessage(error, "Could not delete product"));
      return;
    }
    toast.success(`Deleted ${deleteTarget.name}`);
    setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteFkBlocked(false);
  };

  const deactivateFromDeleteDialog = async () => {
    if (!deleteTarget) return;
    await persistActive(deleteTarget.id, false);
    setDeleteTarget(null);
    setDeleteFkBlocked(false);
  };

  const saveProduct = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required");
      return;
    }
    const price = Number(priceZar);
    if (!priceZar.trim() || !Number.isFinite(price) || price < 0) {
      toast.error("Enter a valid price in ZAR");
      return;
    }
    const vd = Math.max(0, Math.floor(Number(validityDays)));
    if (!Number.isFinite(vd)) {
      toast.error("Enter valid validity days");
      return;
    }

    const memberPrice = parseOptionalZar(memberPriceZar);
    if (memberPrice === undefined) {
      toast.error("Enter a valid member price");
      return;
    }
    if (memberPrice != null && memberPrice >= price) {
      toast.error("Member price must be lower than the normal price");
      return;
    }
    const upgradePriceParsed =
      accessScope === "open_access" ? null : parseOptionalZar(upgradePriceZar);
    if (upgradePriceParsed === undefined) {
      toast.error("Enter a valid Open Access upgrade price");
      return;
    }

    if (allowancesLoading) {
      toast.error("Included items are still loading");
      return;
    }
    if (allowanceItems.length === 0) {
      toast.error("Add at least one included item");
      return;
    }
    const allowancePayload: { label: string; group_ids: string[]; credits: number }[] = [];
    for (const [i, it] of allowanceItems.entries()) {
      const label = it.label.trim();
      if (!label) {
        toast.error(`Included item ${i + 1} needs a label`);
        return;
      }
      const groupIds = it.groupIds.filter((g) => accessGroups.some((ag) => ag.id === g));
      if (groupIds.length === 0) {
        toast.error(`Tick at least one access group for "${label}"`);
        return;
      }
      let c = UNLIMITED_CREDITS;
      if (!it.unlimited) {
        c = Number(it.credits);
        if (!Number.isInteger(c) || c < 1) {
          toast.error(`Sessions for "${label}" must be a whole number of at least 1`);
          return;
        }
      }
      allowancePayload.push({ label, group_ids: groupIds, credits: c });
    }

    const tickedGroupIds = new Set(allowancePayload.flatMap((a) => a.group_ids));
    const tickedGroups = accessGroups.filter((g) => tickedGroupIds.has(g.id));
    // Legacy fields kept in sync so older screens keep working.
    const allowedPayload = toPgTextArray([...new Set(tickedGroups.flatMap((g) => g.class_types))]);
    const creditCount = allowancePayload[0].credits;

    const existingRow = editingId ? rows.find((r) => r.id === editingId) : null;

    const commonPayload = {
      name: trimmed,
      description: description.trim() ? description.trim() : null,
      price_zar: price,
      credit_count: creditCount,
      validity_days: vd,
      allowed_class_types: allowedPayload,
      is_addon: isAddon,
      is_active: isActive,
      pricing_section_id: pricingSectionId === NO_PRICING_SECTION ? null : pricingSectionId,
      access_scope: accessScope,
      upgrade_price_zar: upgradePriceParsed,
      member_price_zar: memberPrice,
      mat_included: matIncluded,
      shower_towel_included: showerTowelIncluded,
    };

    setSaving(true);
    let productId: string;
    if (editingId) {
      const { error } = await supabase
        .from("products")
        .update({
          ...commonPayload,
          is_staff_only: existingRow?.is_staff_only ?? false,
        })
        .eq("id", editingId);
      if (error) {
        console.error("products update failed", error);
        toast.error(
          `Save failed: ${supabaseErrorMessage(error, "Save failed — please try again")}`,
        );
        setSaving(false);
        return;
      }
      productId = editingId;
    } else {
      const allWellzone =
        tickedGroups.length > 0 &&
        tickedGroups.every((g) => WELLZONE_GROUP_NAMES.has(g.name.trim().toLowerCase()));
      const { data, error } = await supabase
        .from("products")
        .insert({
          ...commonPayload,
          category: allWellzone ? "wellzone" : "yoga",
          is_staff_only: false,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("products insert failed", error);
        toast.error(
          `Save failed: ${supabaseErrorMessage(error, "Save failed — please try again")}`,
        );
        setSaving(false);
        return;
      }
      productId = String((data as { id: unknown }).id);
    }

    const allowancesOk = await replaceAllowances(productId, allowancePayload, !editingId);
    if (!allowancesOk) {
      setSaving(false);
      if (!editingId) await load();
      return;
    }

    toast.success(editingId ? "Product updated" : "Product created");
    closeSheet();
    await load();
    setSaving(false);
  };

  /**
   * Replaces the pack's `product_allowances` rows. If the insert fails, restores the previous rows
   * (or removes a just-created pack) so a pack is never left with zero included items.
   */
  const replaceAllowances = async (
    productId: string,
    items: { label: string; group_ids: string[]; credits: number }[],
    isNewProduct: boolean,
  ): Promise<boolean> => {
    let previous: Record<string, unknown>[] = [];
    if (!isNewProduct) {
      const { data, error } = await supabase
        .from("product_allowances")
        .select("label, group_ids, credits, sort_order")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true });
      if (error) {
        console.error("product_allowances backup failed", error);
        toast.error(
          `Product saved, but included items could not be updated: ${supabaseErrorMessage(error, "please try again")}`,
        );
        return false;
      }
      previous = data ?? [];

      const { error: delError } = await supabase
        .from("product_allowances")
        .delete()
        .eq("product_id", productId);
      if (delError) {
        console.error("product_allowances delete failed", delError);
        toast.error(
          `Product saved, but included items could not be updated: ${supabaseErrorMessage(delError, "please try again")}`,
        );
        return false;
      }
    }

    const { error: insError } = await supabase.from("product_allowances").insert(
      items.map((it, i) => ({
        product_id: productId,
        label: it.label,
        group_ids: it.group_ids,
        credits: it.credits,
        sort_order: i,
      })),
    );
    if (!insError) return true;

    console.error("product_allowances insert failed", insError);
    if (isNewProduct) {
      await supabase.from("products").delete().eq("id", productId);
      toast.error(
        `Save failed — included items could not be saved: ${supabaseErrorMessage(insError, "please try again")}`,
      );
      return false;
    }
    if (previous.length > 0) {
      const { error: restoreError } = await supabase.from("product_allowances").insert(
        previous.map((r) => ({
          product_id: productId,
          label: r.label,
          group_ids: r.group_ids,
          credits: r.credits,
          sort_order: r.sort_order,
        })),
      );
      if (restoreError) console.error("product_allowances restore failed", restoreError);
    }
    toast.error(
      `Product saved, but included items could not be updated: ${supabaseErrorMessage(insError, "please try again")}`,
    );
    return false;
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title="Products"
        description={loading ? "Loading…" : `${rows.length} products`}
        actions={
          <Button
            type="button"
            onClick={openAdd}
            className={cn("shrink-0 gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]", SAGE_BORDER)}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            Add product
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-md">
          <Select value={sort} onValueChange={(v) => setSort(v as ProductSortKey)}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">By category (grouped)</SelectItem>
              <SelectItem value="name_asc">Name A–Z (full list)</SelectItem>
              <SelectItem value="price_asc">Price — low to high (full list)</SelectItem>
              <SelectItem value="price_desc">Price — high to low (full list)</SelectItem>
            </SelectContent>
          </Select>
          {sort === "category" ? (
            <p className="text-xs text-muted-foreground">
              Products are grouped by pricing area; A–Z within each group.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              One list — sorted across every product, regardless of category.
            </p>
          )}
        </div>
      </div>

      <div
        className={cn("min-w-0 overflow-x-auto rounded-2xl border bg-card shadow-sm", SAGE_BORDER)}
      >
        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2
              className="h-8 w-8 animate-spin"
              style={{ color: SAGE }}
              aria-label="Loading"
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#e8efe3]/60">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium sm:px-5">Name</th>
                <th className="px-4 py-3 font-medium sm:px-5">Category</th>
                <th className="px-4 py-3 font-medium sm:px-5">Price</th>
                <th className="px-4 py-3 font-medium sm:px-5">Credits</th>
                <th className="px-4 py-3 font-medium sm:px-5">Validity</th>
                <th className="px-4 py-3 font-medium sm:px-5">Active</th>
                <th className="px-4 py-3 font-medium sm:px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sort === "category"
                ? groupedProductSections.map((section) => (
                    <Fragment key={section.label}>
                      <tr className="border-t border-[#c5d4b8]/80 bg-[#e8efe3]/40">
                        <td
                          colSpan={7}
                          className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-[#3d4f36] sm:px-5"
                        >
                          {section.label}
                        </td>
                      </tr>
                      {section.items.map((p) => (
                        <AdminProductTableRow
                          key={p.id}
                          product={p}
                          sectionName={sectionNameFor(p)}
                          togglingId={togglingId}
                          onPersistActive={persistActive}
                          onEdit={openEdit}
                          onDelete={openDeleteDialog}
                        />
                      ))}
                    </Fragment>
                  ))
                : (flatSortedProducts ?? []).map((p) => (
                    <AdminProductTableRow
                      key={p.id}
                      product={p}
                      sectionName={sectionNameFor(p)}
                      togglingId={togglingId}
                      onPersistActive={persistActive}
                      onEdit={openEdit}
                      onDelete={openDeleteDialog}
                    />
                  ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          No products yet. Add one to get started.
        </p>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteFkBlocked(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteFkBlocked ? "Cannot delete product" : "Delete product?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFkBlocked ? (
                <>
                  This product has been purchased by members and cannot be deleted. You can
                  deactivate it instead.
                </>
              ) : (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? This
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            {deleteFkBlocked ? (
              <AlertDialogAction
                className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                onClick={(e) => {
                  e.preventDefault();
                  void deactivateFromDeleteDialog();
                }}
              >
                Deactivate
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault();
                  void confirmDeleteProduct();
                }}
              >
                {deleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Deleting…
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={sheetOpen} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-[#c5d4b8]/80"
        >
          <SheetHeader>
            <SheetTitle className="font-display text-xl">
              {editingId ? "Edit product" : "Add product"}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4 px-1 pb-4">
            <div>
              <Label htmlFor="prod-name">Name</Label>
              <input
                id="prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                placeholder="e.g. 10 Class Pack"
              />
            </div>

            <div>
              <Label htmlFor="prod-desc">Description</Label>
              <Textarea
                id="prod-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5 min-h-[88px] focus-visible:ring-[#a3b693]"
                placeholder="Shown on the pricing page"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="prod-price">Price (ZAR)</Label>
                <input
                  id="prod-price"
                  type="number"
                  min={0}
                  step={1}
                  value={priceZar}
                  onChange={(e) => setPriceZar(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                />
              </div>
              <div>
                <Label htmlFor="prod-valid">Validity (days)</Label>
                <input
                  id="prod-valid"
                  type="number"
                  min={0}
                  step={1}
                  value={validityDays}
                  onChange={(e) => setValidityDays(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="prod-member-price">Member price (R)</Label>
              <input
                id="prod-member-price"
                type="number"
                min={0}
                step={1}
                value={memberPriceZar}
                onChange={(e) => setMemberPriceZar(e.target.value)}
                aria-invalid={!!memberPriceError}
                className={cn(
                  "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]",
                  memberPriceError && "border-destructive focus:border-destructive",
                )}
                placeholder="Leave blank for none"
              />
              {memberPriceError && (
                <p className="mt-1 text-xs text-destructive">{memberPriceError}</p>
              )}
            </div>

            <div>
              <Label>Pricing section</Label>
              <Select value={pricingSectionId} onValueChange={setPricingSectionId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRICING_SECTION}>None</SelectItem>
                  {pricingSections.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      {sec.name}
                    </SelectItem>
                  ))}
                  {pricingSectionId !== NO_PRICING_SECTION &&
                    !pricingSections.some((sec) => sec.id === pricingSectionId) && (
                      <SelectItem value={pricingSectionId}>(Inactive section)</SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Access</Label>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
                {(
                  [
                    { value: "longkloof", label: "Longkloof only" },
                    { value: "open_access", label: "Open Access: Longkloof + Green Point" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={accessScope === opt.value}
                    onClick={() => setAccessScope(opt.value)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      accessScope === opt.value
                        ? "border-[#a3b693] bg-[#e8efe3] font-semibold text-[#3d4f36]"
                        : "border-border bg-background hover:bg-muted/30",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {accessScope !== "open_access" && (
              <div>
                <Label htmlFor="prod-upgrade-price">Open Access upgrade price (R)</Label>
                <input
                  id="prod-upgrade-price"
                  type="number"
                  min={0}
                  step={1}
                  value={upgradePriceZar}
                  onChange={(e) => setUpgradePriceZar(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                  placeholder="Leave blank if no upgrade is offered"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>What&apos;s included</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ticked groups in one item share a single pool of sessions.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1 border-[#c5d4b8] bg-card"
                  onClick={addAllowanceItem}
                  disabled={allowancesLoading}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add item
                </Button>
              </div>

              {allowancesLoading ? (
                <div className="mt-2 flex justify-center rounded-lg border border-border py-6">
                  <Loader2
                    className="h-5 w-5 animate-spin"
                    style={{ color: SAGE }}
                    aria-label="Loading included items"
                  />
                </div>
              ) : (
                <ul className="mt-2 space-y-3">
                  {allowanceItems.map((it, idx) => (
                    <li key={it.key} className="rounded-xl border border-border bg-muted/20 p-3">
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`${it.key}-label`}>Label</Label>
                          <input
                            id={`${it.key}-label`}
                            value={it.label}
                            onChange={(e) => updateAllowanceItem(it.key, { label: e.target.value })}
                            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                            placeholder="e.g. On The Mat, Wellzone, Reformer"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeAllowanceItem(it.key)}
                          disabled={allowanceItems.length <= 1}
                          aria-label={`Remove item ${idx + 1}`}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>

                      <div className="mt-3">
                        <p className="text-xs font-medium text-muted-foreground">Access groups</p>
                        {accessGroups.length === 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            No active access groups found.
                          </p>
                        ) : (
                          <ul className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {accessGroups.map((g) => {
                              const id = `${it.key}-group-${g.id}`;
                              return (
                                <li key={g.id} className="flex items-center gap-2">
                                  <Checkbox
                                    id={id}
                                    checked={it.groupIds.includes(g.id)}
                                    onCheckedChange={(c) =>
                                      toggleAllowanceGroup(it.key, g.id, c === true)
                                    }
                                  />
                                  <label htmlFor={id} className="text-sm leading-none">
                                    {g.name}
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <Label htmlFor={`${it.key}-unlimited`} className="text-foreground">
                          Unlimited
                        </Label>
                        <Switch
                          id={`${it.key}-unlimited`}
                          checked={it.unlimited}
                          onCheckedChange={(v) => updateAllowanceItem(it.key, { unlimited: v })}
                          className="data-[state=checked]:bg-[#a3b693]"
                        />
                      </div>
                      {!it.unlimited && (
                        <div className="mt-3">
                          <Label htmlFor={`${it.key}-credits`}>Sessions</Label>
                          <input
                            id={`${it.key}-credits`}
                            type="number"
                            min={1}
                            step={1}
                            value={it.credits}
                            onChange={(e) =>
                              updateAllowanceItem(it.key, { credits: e.target.value })
                            }
                            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#a3b693]"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-3 py-2">
              <Label htmlFor="prod-mat" className="text-foreground">
                Mat &amp; towel included
              </Label>
              <Switch
                id="prod-mat"
                checked={matIncluded}
                onCheckedChange={setMatIncluded}
                className="data-[state=checked]:bg-[#a3b693]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-3 py-2">
              <Label htmlFor="prod-shower" className="text-foreground">
                Shower towels included
              </Label>
              <Switch
                id="prod-shower"
                checked={showerTowelIncluded}
                onCheckedChange={setShowerTowelIncluded}
                className="data-[state=checked]:bg-[#a3b693]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-3 py-2">
              <div>
                <Label htmlFor="prod-addon" className="text-foreground">
                  Add-on (e.g. mat hire)
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Hidden from main pricing grid when off-sale flow uses it.
                </p>
              </div>
              <Switch
                id="prod-addon"
                checked={isAddon}
                onCheckedChange={setIsAddon}
                className="data-[state=checked]:bg-[#a3b693]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-3 py-2">
              <Label htmlFor="prod-active" className="text-foreground">
                Active on pricing page
              </Label>
              <Switch
                id="prod-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                className="data-[state=checked]:bg-[#a3b693]"
              />
            </div>
          </div>

          <SheetFooter className="flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeSheet} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || allowancesLoading || !!memberPriceError}
              onClick={() => void saveProduct()}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Create product"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
