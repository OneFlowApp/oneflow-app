import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatStudioDateOnly } from "@/lib/timezone";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  allowedClassTypeCheckboxOptions,
  defaultAllowedClassTypesForCreditCategory,
} from "@/lib/allowedClassTypes";
import {
  BUNDLE_COMPONENT_OPTIONS,
  buildBundleComponentCreditRow,
  buildProductCreditRows,
  isMultiCreditBundleProduct,
  resolveBundlePackageTitle,
  type BundleComponentKind,
  type UserCreditInsertRow,
} from "@/lib/multiCreditProducts";
import {
  USER_CREDIT_ADMIN_SELECT,
  addDaysToCreditDateInput,
  resolveAssignCreditPeriod,
  todayCreditDateInput,
} from "@/lib/userCreditAdmin";
import {
  CREDIT_CATEGORY_ORDERED,
  PRODUCT_CATEGORY_SLUG_LABEL,
  normalizeProductCategoryKey,
  type CreditCategoryOrdered,
} from "@/lib/productCategories";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export type AssignPackageTarget = {
  profileId: string;
  displayName: string;
  email: string | null;
  firstName?: string | null;
};

type PackageAssignFailure = {
  displayName: string;
  profileId: string;
  email: string | null;
  reason: string;
};

function isUuidProfileId(id: string): boolean {
  const s = id.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function recordPackageAssignFailure(
  target: AssignPackageTarget,
  context: string,
  error: unknown,
  failures: PackageAssignFailure[],
): void {
  const reason = supabaseErrorMessage(error, "Unknown error");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code ?? "").trim()
      : "";
  const reasonWithCode = code && !reason.includes(code) ? `${reason} [${code}]` : reason;
  console.error(`[AssignPackageDialog] ${context}`, {
    profileId: target.profileId,
    displayName: target.displayName,
    email: target.email,
    reason: reasonWithCode,
    error,
  });
  failures.push({
    displayName: target.displayName,
    profileId: target.profileId,
    email: target.email,
    reason: reasonWithCode,
  });
}

function summarizePackageFailures(failures: PackageAssignFailure[]): string {
  if (failures.length === 0) return "";
  if (failures.length === 1) {
    const f = failures[0]!;
    return `${f.displayName} (${f.profileId}): ${f.reason}`;
  }
  return failures
    .map((f) => `• ${f.displayName} (${f.profileId}): ${f.reason}`)
    .join("\n")
    .slice(0, 2500);
}

type ProductPick = {
  id: string;
  name: string;
  category: string | null;
  credit_count: number | null;
  validity_days: number | null;
  allowed_class_types: string[] | null;
  is_active?: boolean;
};

const CUSTOM_CATEGORY_ITEMS: { value: CreditCategoryOrdered; label: string }[] =
  CREDIT_CATEGORY_ORDERED.map((value) => ({
    value,
    label: PRODUCT_CATEGORY_SLUG_LABEL[value],
  }));

const CLASS_TYPE_OPTIONS = allowedClassTypeCheckboxOptions();

const UNLIMITED_PRODUCT_THRESHOLD = 999;
const UNLIMITED_MANUAL_TOTAL = 999_999;

type BundleExtraDraft = {
  id: string;
  kind: BundleComponentKind;
  credits: string;
  unlimited: boolean;
};

function newBundleExtraDraft(kind: BundleComponentKind = "cafe"): BundleExtraDraft {
  return {
    id: crypto.randomUUID(),
    kind,
    credits: kind === "cafe" ? "10" : "10",
    unlimited: kind === "mat" || kind === "towel",
  };
}

function PackagePeriodFields({
  idPrefix,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  idPrefix: string;
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/15 p-3 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <p className="text-sm font-medium">Package period</p>
        <p className="text-xs text-muted-foreground">
          Start defaults to today. End is prefilled from product validity when available.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-start`}>Start date</Label>
        <Input
          id={`${idPrefix}-start`}
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-end`}>End date</Label>
        <Input
          id={`${idPrefix}-end`}
          type="date"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
      </div>
    </div>
  );
}

function bundleRowSummary(row: UserCreditInsertRow): string {
  if (row.mat_access && !row.is_unlimited) return "Mat access";
  if (row.towel_access && !row.is_unlimited) return "Towel access";
  if (row.is_unlimited) return "Unlimited";
  return `${row.credits_remaining} credits`;
}

function normalizeClassTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter(Boolean);
}

function productCreditsLine(count: number, unlimited: boolean): string {
  if (unlimited) return "Unlimited credits are now available and ready to use.";
  return `${count} credits are now available and ready to use.`;
}

function formatAssignedCreditSummary(row: AssignedCreditRow): string {
  const name = row.product_name ?? "Package";
  const credits = row.is_unlimited
    ? "Unlimited"
    : `${row.credits_remaining ?? 0} / ${row.credits_total ?? 0} credits`;
  const exp = row.expires_at ? ` · expires ${formatStudioDateOnly(row.expires_at)}` : "";
  return `${name}: ${credits}${exp}`;
}

export type AssignedCreditRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  credits_remaining: number | null;
  credits_total: number | null;
  is_unlimited: boolean | null;
  expires_at: string | null;
  mat_access?: boolean | null;
  towel_access?: boolean | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AssignPackageTarget | null;
  /** When set, assigns the same package to every target (target is ignored). */
  bulkTargets?: AssignPackageTarget[] | null;
  canAssign: boolean;
  /** Include add-on products (e.g. mat/towel monthly) in the catalog. */
  includeAddons?: boolean;
  onAssigned?: () => void;
  /** Called after each successful insert (for live profile sheet credits). */
  onCreditInserted?: (row: AssignedCreditRow, profileId: string) => void;
};

export function AssignPackageDialog({
  open,
  onOpenChange,
  target,
  bulkTargets,
  canAssign,
  includeAddons = false,
  onAssigned,
  onCreditInserted,
}: Props) {
  const [tab, setTab] = useState<"existing" | "custom">("existing");
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [existingCategory, setExistingCategory] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [existingNote, setExistingNote] = useState("");
  const [assignStartDate, setAssignStartDate] = useState("");
  const [assignEndDate, setAssignEndDate] = useState("");

  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<CreditCategoryOrdered>("yoga");
  const [customCredits, setCustomCredits] = useState("10");
  const [customUnlimited, setCustomUnlimited] = useState(false);
  const [customValidityDays, setCustomValidityDays] = useState("");
  const [customClassTypes, setCustomClassTypes] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState("");
  // Custom package contents use the same access groups as Admin → Products.
  const [accessGroups, setAccessGroups] = useState<{ id: string; name: string; class_types: string[] }[]>([]);
  const [customGroupIds, setCustomGroupIds] = useState<string[]>([]);
  const [saveAsProduct, setSaveAsProduct] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTab, setConfirmTab] = useState<"existing" | "custom">("existing");
  const [assignResultOpen, setAssignResultOpen] = useState(false);
  const [assignResultRows, setAssignResultRows] = useState<AssignedCreditRow[]>([]);
  const [assignResultMemberName, setAssignResultMemberName] = useState("");
  const [bundleExtras, setBundleExtras] = useState<BundleExtraDraft[]>([]);
  const prevOpenRef = useRef(false);

  const assignees = useMemo(() => {
    if (bulkTargets && bulkTargets.length > 0) return bulkTargets;
    if (target) return [target];
    return [];
  }, [bulkTargets, target]);

  const assigneeKey = useMemo(
    () =>
      assignees
        .map((a) => a.profileId)
        .slice()
        .sort()
        .join("|"),
    [assignees],
  );

  const resetForms = useCallback(() => {
    setTab("existing");
    setExistingCategory("");
    setSelectedProductId("");
    setExistingNote("");
    setAssignStartDate(todayCreditDateInput());
    setAssignEndDate("");
    setCustomName("");
    setCustomCategory("yoga");
    setCustomCredits("10");
    setCustomUnlimited(false);
    setCustomValidityDays("");
    setCustomClassTypes([...defaultAllowedClassTypesForCreditCategory("yoga")]);
    setCustomNote("");
    setCustomGroupIds([]);
    setSaveAsProduct(false);
    setConfirmOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("access_groups")
        .select("id, name, class_types")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[AssignPackageDialog] access groups", error);
        return;
      }
      setAccessGroups(
        (data ?? []).map((g: Record<string, unknown>) => ({
          id: String(g.id),
          name: String(g.name ?? ""),
          class_types: Array.isArray(g.class_types) ? (g.class_types as string[]).map(String) : [],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Class types and category for the ticked access groups. */
  const customAccess = useMemo(() => {
    const ticked = accessGroups.filter((g) => customGroupIds.includes(g.id));
    const types = [...new Set(ticked.flatMap((g) => g.class_types))];
    const wellzoneOnly =
      ticked.length > 0 &&
      ticked.every((g) => ["wellzone", "sauna journey"].includes(g.name.trim().toLowerCase()));
    return {
      types,
      category: (wellzoneOnly ? "wellzone" : "yoga") as CreditCategoryOrdered,
      label: ticked.map((g) => g.name).join(" + "),
    };
  }, [accessGroups, customGroupIds]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      resetForms();
    }
    if (!open && wasOpen) {
      resetForms();
    }
  }, [open, resetForms]);

  useEffect(() => {
    if (!open || assignees.length === 0) return;

    void (async () => {
      setProducts([]);
      setProductsLoading(true);
      let query = supabase
        .from("products")
        .select("id, name, credit_count, category, validity_days, allowed_class_types, is_addon, is_active")
        // Staff packs and saved custom packages are switched off for sale but still assignable.
        .order("sort_order", { ascending: true })
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (!includeAddons) {
        query = query.eq("is_addon", false);
      }
      const { data, error } = await query;

      if (error) {
        console.error(error);
        toast.error(supabaseErrorMessage(error, "Could not load products"));
        setProducts([]);
      } else {
        const rows = (data ?? []) as Record<string, unknown>[];
        setProducts(
          rows.map((raw) => ({
            id: String(raw.id),
            name: String(raw.name ?? ""),
            category: raw.category == null ? null : String(raw.category),
            credit_count: raw.credit_count == null ? null : Number(raw.credit_count),
            validity_days: raw.validity_days == null ? null : Number(raw.validity_days),
            allowed_class_types: normalizeClassTypes(raw.allowed_class_types),
            is_active: raw.is_active !== false,
          })),
        );
      }
      setProductsLoading(false);
    })();
  }, [open, assigneeKey, includeAddons]);

  const categorySlugsInCatalog = useMemo(() => {
    const s = new Set<string>();
    for (const p of products) {
      s.add(normalizeProductCategoryKey(p.category));
    }
    return s;
  }, [products]);

  const existingCategoryOptions = useMemo(() => {
    const ordered: string[] = [...CREDIT_CATEGORY_ORDERED].filter((k) =>
      categorySlugsInCatalog.has(k),
    );
    if (categorySlugsInCatalog.has("other")) {
      ordered.push("other");
    }
    return ordered;
  }, [categorySlugsInCatalog]);

  const productsInSelectedCategory = useMemo(() => {
    if (!existingCategory) return [];
    return products
      .filter((p) => normalizeProductCategoryKey(p.category) === existingCategory)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [products, existingCategory]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const isBundleAssign = Boolean(
    selectedProduct &&
      isMultiCreditBundleProduct(selectedProduct.id, selectedProduct.name),
  );

  const resolvedAssignPeriod = useMemo(
    () => resolveAssignCreditPeriod(assignStartDate, assignEndDate),
    [assignStartDate, assignEndDate],
  );

  const bundlePreviewRows = useMemo((): UserCreditInsertRow[] => {
    if (!selectedProduct || !isBundleAssign) return [];
    const rawCount =
      typeof selectedProduct.credit_count === "number"
        ? selectedProduct.credit_count
        : Number(selectedProduct.credit_count ?? 0);
    const isUnlimited = rawCount >= UNLIMITED_PRODUCT_THRESHOLD;
    const total = isUnlimited ? rawCount : Math.trunc(rawCount);
    const expiresAt = resolvedAssignPeriod.ok ? resolvedAssignPeriod.expiresAt : null;
    return buildProductCreditRows({
      productName: selectedProduct.name,
      profileId: "00000000-0000-4000-8000-000000000000",
      productId: selectedProduct.id,
      expiresAt,
      paymentId: "preview",
      category: selectedProduct.category ?? "yoga",
      allowedClassTypes: selectedProduct.allowed_class_types?.length
        ? selectedProduct.allowed_class_types
        : [...defaultAllowedClassTypesForCreditCategory(selectedProduct.category)],
      creditsTotal: total,
      creditsRemaining: total,
      isUnlimited,
    });
  }, [selectedProduct, isBundleAssign, resolvedAssignPeriod]);

  useEffect(() => {
    setBundleExtras([]);
  }, [selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) return;
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;
    const start = todayCreditDateInput();
    setAssignStartDate(start);
    setAssignEndDate(
      product.validity_days && product.validity_days > 0
        ? addDaysToCreditDateInput(start, product.validity_days)
        : "",
    );
  }, [selectedProductId, products]);

  const validateAssignPeriod = (): boolean => {
    if (!resolvedAssignPeriod.ok) {
      toast.error(resolvedAssignPeriod.message);
      return false;
    }
    return true;
  };

  const buildBundleExtraInsertRows = (
    product: ProductPick,
    profileId: string,
    expiresAt: string | null,
    purchasedAt: string,
  ): UserCreditInsertRow[] => {
    if (bundleExtras.length === 0) return [];
    const title = resolveBundlePackageTitle(product.id, bundlePreviewRows);
    const rows: UserCreditInsertRow[] = [];
    for (const extra of bundleExtras) {
      const accessOnly = extra.kind === "mat" || extra.kind === "towel";
      const unlimited = extra.unlimited || accessOnly;
      let total = unlimited ? UNLIMITED_PRODUCT_THRESHOLD : Math.trunc(Number(extra.credits));
      if (!unlimited && (!Number.isFinite(total) || total < 1)) continue;
      if (accessOnly && !extra.unlimited) total = 1;
      rows.push(
        buildBundleComponentCreditRow({
          profileId,
          productId: product.id,
          bundleTitle: title,
          component: extra.kind,
          creditsTotal: total,
          creditsRemaining: total,
          isUnlimited: unlimited,
          expiresAt,
          paymentId: "manual_component",
          purchasedAt,
        }),
      );
    }
    return rows;
  };

  const validateBundleExtras = (): boolean => {
    for (const extra of bundleExtras) {
      const accessOnly = extra.kind === "mat" || extra.kind === "towel";
      if (extra.unlimited || accessOnly) continue;
      const n = Math.trunc(Number(extra.credits));
      if (!Number.isFinite(n) || n < 1) {
        toast.error(`Enter at least 1 credit for extra ${BUNDLE_COMPONENT_OPTIONS.find((o) => o.value === extra.kind)?.label ?? extra.kind}.`);
        return false;
      }
    }
    return true;
  };

  const toggleClassType = (value: string) => {
    setCustomClassTypes((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  };

  const sendPackageEmail = async (
    to: string | null | undefined,
    firstName: string,
    packageName: string,
    creditsDescription: string,
    note: string,
  ) => {
    const em = (to ?? "").trim();
    if (!em) {
      toast.message("Package assigned — no email on file to notify.");
      return;
    }
    const { error } = await supabase.functions.invoke("send-email", {
      body: {
        to: em,
        template: "package_assigned",
        data: {
          first_name: firstName,
          package_name: packageName,
          credits_description: creditsDescription,
          note: note.trim() || undefined,
        },
      },
    });
    if (error) {
      console.error(error);
      toast.error(
        supabaseErrorMessage(error, "Package saved but email could not be sent — please try again"),
      );
    }
  };

  const assignExisting = async () => {
    if (!canAssign || assignees.length === 0) return;
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) {
      toast.error("Select a product.");
      return;
    }
    const rawCount =
      typeof product.credit_count === "number"
        ? product.credit_count
        : Number(product.credit_count ?? 0);
    if (!Number.isFinite(rawCount) || rawCount < 0) {
      toast.error("This product has no valid credit count.");
      return;
    }
    const isUnlimited = rawCount >= UNLIMITED_PRODUCT_THRESHOLD;
    const total = isUnlimited ? rawCount : Math.trunc(rawCount);

    setSubmitting(true);
    const failures: PackageAssignFailure[] = [];
    let insertedForSummary: AssignedCreditRow[] = [];

    const profileIds = [...new Set(assignees.map((a) => a.profileId.trim()))].filter(
      isUuidProfileId,
    );
    let existingProfileSet = new Set<string>();
    if (profileIds.length > 0) {
      const { data: existingProfiles, error: profilesLookupErr } = await supabase
        .from("profiles")
        .select("id")
        .in("id", profileIds);
      if (profilesLookupErr) {
        console.error(
          "[AssignPackageDialog] profiles pre-check (existing product)",
          profilesLookupErr,
        );
      }
      existingProfileSet = new Set(
        (existingProfiles ?? []).map((r) => String((r as { id: string }).id)),
      );
    }

    const period = resolveAssignCreditPeriod(assignStartDate, assignEndDate);
    if (!period.ok) {
      toast.error(period.message);
      setSubmitting(false);
      return;
    }
    const { purchasedAt, expiresAt } = period;

    // Packs built in Admin → Products with several included items get one balance per item,
    // the same as when the pack is bought online.
    const { data: allowanceData } = await supabase
      .from("product_allowances")
      .select("label, class_types, credits, sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    const allowances = ((allowanceData ?? []) as {
      label: string | null;
      class_types: string[] | null;
      credits: number | null;
    }[]).filter((x) => (x.class_types ?? []).length > 0);

    for (const t of assignees) {
      if (!isUuidProfileId(t.profileId)) {
        recordPackageAssignFailure(
          t,
          "user_credits insert (existing product)",
          new Error("Invalid profile id — cannot attach credits"),
          failures,
        );
        continue;
      }
      if (!existingProfileSet.has(t.profileId.trim())) {
        recordPackageAssignFailure(
          t,
          "user_credits insert (existing product)",
          new Error("No profile row for this member — cannot attach credits"),
          failures,
        );
        continue;
      }
      const baseCreditRows = allowances.length > 1
        ? allowances.flatMap((al) => {
            const c = Math.max(1, Math.trunc(Number(al.credits) || 1));
            const unl = c >= UNLIMITED_PRODUCT_THRESHOLD;
            return buildProductCreditRows({
              productName: `${product.name} - ${al.label?.trim() || "Included"}`,
              profileId: t.profileId,
              productId: product.id,
              expiresAt,
              paymentId: "manual_assignment",
              purchasedAt,
              category: product.category ?? "yoga",
              allowedClassTypes: al.class_types ?? [],
              creditsTotal: c,
              creditsRemaining: c,
              isUnlimited: unl,
            });
          })
        : buildProductCreditRows({
        productName: product.name,
        profileId: t.profileId,
        productId: product.id,
        expiresAt,
        paymentId: "manual_assignment",
        purchasedAt,
        category: product.category ?? "yoga",
        allowedClassTypes: product.allowed_class_types?.length
          ? product.allowed_class_types
          : [...defaultAllowedClassTypesForCreditCategory(product.category)],
        creditsTotal: total,
        creditsRemaining: total,
        isUnlimited,
      });
      const extraCreditRows = buildBundleExtraInsertRows(product, t.profileId, expiresAt, purchasedAt);
      const creditRows = [...baseCreditRows, ...extraCreditRows];

      const { data: inserted, error } = await supabase
        .from("user_credits")
        .insert(creditRows)
        .select(USER_CREDIT_ADMIN_SELECT);

      if (error) {
        recordPackageAssignFailure(t, "user_credits insert (existing product)", error, failures);
        continue;
      }
      const insertedRows = (inserted ?? []) as AssignedCreditRow[];
      for (const row of insertedRows) {
        onCreditInserted?.(row, t.profileId);
      }
      if (assignees.length === 1) {
        insertedForSummary = insertedRows;
      }

      const first = (t.firstName?.trim() || t.displayName.split(/\s+/)[0] || "there") as string;
      const creditsDesc = creditRows.some((r) => r.is_unlimited)
        ? "Unlimited yoga studio credits plus Wellzone, Sauna Journey, and Café credits are now available."
        : productCreditsLine(total, isUnlimited);
      await sendPackageEmail(t.email, first, product.name, creditsDesc, existingNote);
    }
    setSubmitting(false);
    setConfirmOpen(false);

    if (failures.length > 0) {
      toast.error(
        failures.length === assignees.length
          ? "Could not assign package to any selected member."
          : `Could not assign to ${failures.length} member(s). Others were saved.`,
        { description: summarizePackageFailures(failures), duration: 16_000 },
      );
      onOpenChange(false);
      onAssigned?.();
    } else {
      const names = assignees.map((a) => a.displayName).join(", ");
      toast.success(
        assignees.length === 1
          ? `${product.name} assigned to ${assignees[0]!.displayName}`
          : `${product.name} assigned to ${assignees.length} members`,
        { description: assignees.length === 1 ? undefined : names.slice(0, 120) },
      );
      if (assignees.length === 1 && insertedForSummary.length > 0) {
        setAssignResultRows(insertedForSummary);
        setAssignResultMemberName(assignees[0]!.displayName);
        setAssignResultOpen(true);
        onOpenChange(false);
      } else {
        onOpenChange(false);
        onAssigned?.();
      }
    }
  };

  const assignCustom = async () => {
    if (!canAssign || assignees.length === 0) return;
    const name = customName.trim();
    if (!name) {
      toast.error("Package name is required.");
      return;
    }
    if (!customUnlimited) {
      const n = Math.trunc(Number(customCredits));
      if (!Number.isFinite(n) || n < 1) {
        toast.error("Enter a valid number of credits (at least 1).");
        return;
      }
    }
    if (!validateAssignPeriod()) return;

    const isUnlimited = customUnlimited;
    const total = isUnlimited ? UNLIMITED_MANUAL_TOTAL : Math.trunc(Number(customCredits));
    if (customGroupIds.length === 0) {
      toast.error("Tick at least one access group.");
      return;
    }

    setSubmitting(true);
    const failures: PackageAssignFailure[] = [];

    // Optionally keep this package as a product for future use (switched off, so it is not on Pricing).
    let savedProductId: string | null = null;
    if (saveAsProduct) {
      const startMs = assignStartDate ? new Date(assignStartDate).getTime() : Date.now();
      const endMs = assignEndDate ? new Date(assignEndDate).getTime() : NaN;
      const typedDays = Math.trunc(Number(customValidityDays));
      const validityDays =
        Number.isFinite(typedDays) && typedDays > 0
          ? typedDays
          : Number.isFinite(endMs) && endMs > startMs
            ? Math.max(1, Math.round((endMs - startMs) / 86_400_000))
            : 30;
      const { data: prod, error: prodErr } = await supabase
        .from("products")
        .insert({
          name,
          description: customNote.trim() || null,
          category: customAccess.category,
          price_zar: 0,
          credit_count: isUnlimited ? 999 : total,
          validity_days: validityDays,
          allowed_class_types: customAccess.types,
          is_active: false,
          is_staff_only: false,
          is_addon: false,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (prodErr || !prod) {
        toast.error(`Could not save the package: ${supabaseErrorMessage(prodErr, "please try again")}`);
        setSubmitting(false);
        return;
      }
      savedProductId = String((prod as { id: unknown }).id);
      const { error: allowErr } = await supabase.from("product_allowances").insert({
        product_id: savedProductId,
        label: customAccess.label || name,
        group_ids: customGroupIds,
        credits: isUnlimited ? 999 : total,
        sort_order: 0,
      });
      if (allowErr) {
        await supabase.from("products").delete().eq("id", savedProductId);
        toast.error(`Could not save the package: ${supabaseErrorMessage(allowErr, "please try again")}`);
        setSubmitting(false);
        return;
      }
    }
    let insertedForSummary: AssignedCreditRow[] = [];

    const profileIds = [...new Set(assignees.map((a) => a.profileId.trim()))].filter(
      isUuidProfileId,
    );
    let existingProfileSet = new Set<string>();
    if (profileIds.length > 0) {
      const { data: existingProfiles, error: profilesLookupErr } = await supabase
        .from("profiles")
        .select("id")
        .in("id", profileIds);
      if (profilesLookupErr) {
        console.error(
          "[AssignPackageDialog] profiles pre-check (custom package)",
          profilesLookupErr,
        );
      }
      existingProfileSet = new Set(
        (existingProfiles ?? []).map((r) => String((r as { id: string }).id)),
      );
    }

    const period = resolveAssignCreditPeriod(assignStartDate, assignEndDate);
    if (!period.ok) {
      toast.error(period.message);
      setSubmitting(false);
      return;
    }
    const { purchasedAt, expiresAt } = period;

    for (const t of assignees) {
      if (!isUuidProfileId(t.profileId)) {
        recordPackageAssignFailure(
          t,
          "user_credits insert (custom package)",
          new Error("Invalid profile id — cannot attach credits"),
          failures,
        );
        continue;
      }
      if (!existingProfileSet.has(t.profileId.trim())) {
        recordPackageAssignFailure(
          t,
          "user_credits insert (custom package)",
          new Error("No profile row for this member — cannot attach credits"),
          failures,
        );
        continue;
      }
      const { data: inserted, error } = await supabase
        .from("user_credits")
        .insert({
          profile_id: t.profileId,
          product_id: savedProductId,
          product_name: name,
          category: customAccess.category,
          allowed_class_types: customAccess.types,
          credits_total: total,
          credits_remaining: total,
          is_unlimited: isUnlimited,
          expires_at: expiresAt,
          yoco_payment_id: "manual_assignment",
          purchased_at: purchasedAt,
        })
        .select(USER_CREDIT_ADMIN_SELECT)
        .maybeSingle();

      if (error) {
        recordPackageAssignFailure(t, "user_credits insert (custom package)", error, failures);
        continue;
      }
      const insertedRow = inserted as AssignedCreditRow | null;
      if (insertedRow) {
        onCreditInserted?.(insertedRow, t.profileId);
        if (assignees.length === 1) {
          insertedForSummary = [insertedRow];
        }
      }

      const first = (t.firstName?.trim() || t.displayName.split(/\s+/)[0] || "there") as string;
      await sendPackageEmail(
        t.email,
        first,
        name,
        isUnlimited
          ? "Unlimited credits are now available and ready to use."
          : productCreditsLine(total, false),
        customNote,
      );
    }
    setSubmitting(false);
    setConfirmOpen(false);

    if (failures.length > 0) {
      toast.error(
        failures.length === assignees.length
          ? "Could not assign package to any selected member."
          : `Could not assign to ${failures.length} member(s). Others were saved.`,
        { description: summarizePackageFailures(failures), duration: 16_000 },
      );
      onOpenChange(false);
      onAssigned?.();
    } else {
      toast.success(
        (assignees.length === 1
          ? `${name} assigned to ${assignees[0]!.displayName}`
          : `${name} assigned to ${assignees.length} members`) +
          (savedProductId ? ". Saved in Products (switched off)." : ""),
      );
      if (assignees.length === 1 && insertedForSummary.length > 0) {
        setAssignResultRows(insertedForSummary);
        setAssignResultMemberName(assignees[0]!.displayName);
        setAssignResultOpen(true);
        onOpenChange(false);
      } else {
        onOpenChange(false);
        onAssigned?.();
      }
    }
  };

  const closeAssignResult = () => {
    setAssignResultOpen(false);
    setAssignResultRows([]);
    setAssignResultMemberName("");
    onAssigned?.();
  };

  const primaryAssignee = assignees[0];

  const existingConfirmCopy = useMemo(() => {
    const product = products.find((p) => p.id === selectedProductId);
    if (!product || !primaryAssignee) return "";
    const raw =
      typeof product.credit_count === "number"
        ? product.credit_count
        : Number(product.credit_count ?? 0);
    const unlimited = raw >= UNLIMITED_PRODUCT_THRESHOLD;
    const creditsPart = unlimited ? "Unlimited credits" : `${Math.trunc(raw)} credits`;
    const who =
      assignees.length === 1
        ? primaryAssignee.displayName
        : `${primaryAssignee.displayName} and ${assignees.length - 1} other ${assignees.length === 2 ? "member" : "members"}`;
    const extraPart =
      bundleExtras.length > 0
        ? ` plus ${bundleExtras.length} extra component${bundleExtras.length === 1 ? "" : "s"}`
        : "";
    return `This will add ${product.name} (${creditsPart}${extraPart}) to ${who} at no charge.`;
  }, [products, selectedProductId, assignees, primaryAssignee, bundleExtras.length]);

  const customConfirmCopy = useMemo(() => {
    const name = customName.trim();
    if (!name || !primaryAssignee) return "";
    const totalLabel = customUnlimited
      ? "Unlimited"
      : `${Math.trunc(Number(customCredits) || 0)} credits`;
    const who =
      assignees.length === 1
        ? primaryAssignee.displayName
        : `${primaryAssignee.displayName} and ${assignees.length - 1} other ${assignees.length === 2 ? "member" : "members"}`;
    return `This will add ${name} (${totalLabel}) to ${who} at no charge.`;
  }, [customName, customUnlimited, customCredits, assignees, primaryAssignee]);

  const openAssignConfirm = (kind: "existing" | "custom") => {
    if (kind === "existing") {
      if (!existingCategory) {
        toast.error("Select a category.");
        return;
      }
      if (!selectedProductId) {
        toast.error("Select a product.");
        return;
      }
      if (!validateBundleExtras()) return;
      if (!validateAssignPeriod()) return;
    } else {
      const name = customName.trim();
      if (!name) {
        toast.error("Package name is required.");
        return;
      }
      if (!customUnlimited) {
        const n = Math.trunc(Number(customCredits));
        if (!Number.isFinite(n) || n < 1) {
          toast.error("Enter a valid number of credits (at least 1).");
          return;
        }
      }
      if (customGroupIds.length === 0) {
        toast.error("Tick at least one access group.");
        return;
      }
      if (!validateAssignPeriod()) return;
    }
    setConfirmTab(kind);
    setConfirmOpen(true);
  };

  if (assignees.length === 0 || !primaryAssignee) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-lg overflow-y-auto"
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-radix-select-content]") || t.closest('[role="listbox"]')) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-radix-select-content]") || t.closest('[role="listbox"]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Assign package</DialogTitle>
            <p className="text-left text-sm text-muted-foreground">
              {assignees.length > 1 ? (
                <>
                  <span className="font-medium text-foreground">
                    {assignees.length} members selected
                  </span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {assignees
                      .map((a) => a.displayName)
                      .join(", ")
                      .slice(0, 140)}
                    {assignees.map((a) => a.displayName).join(", ").length > 140 ? "…" : ""}
                  </span>
                </>
              ) : (
                primaryAssignee.displayName
              )}
              <span className="block text-xs">No payment — manual credit grant</span>
            </p>
          </DialogHeader>

          {!canAssign ? (
            <p className="text-sm text-muted-foreground">
              Only directors and management can assign packages.
            </p>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as "existing" | "custom")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger type="button" value="existing">
                  Existing package
                </TabsTrigger>
                <TabsTrigger type="button" value="custom">
                  Custom package
                </TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="space-y-4 pt-2">
                <div className="grid gap-2">
                  <Label>Category</Label>
                  {productsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading products…</p>
                  ) : (
                    <Select
                      value={existingCategory || undefined}
                      onValueChange={(v) => {
                        setExistingCategory(v);
                        setSelectedProductId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingCategoryOptions.map((slug) => (
                          <SelectItem key={slug} value={slug}>
                            {PRODUCT_CATEGORY_SLUG_LABEL[slug] ?? slug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Product</Label>
                  {productsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading products…</p>
                  ) : !existingCategory ? (
                    <p className="text-sm text-muted-foreground">Choose a category first.</p>
                  ) : productsInSelectedCategory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No products in this category.</p>
                  ) : (
                    <Select
                      value={selectedProductId || undefined}
                      onValueChange={setSelectedProductId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {productsInSelectedCategory.map((p) => {
                          const cc =
                            p.credit_count == null
                              ? "—"
                              : p.credit_count >= UNLIMITED_PRODUCT_THRESHOLD
                                ? "Unlimited"
                                : String(p.credit_count);
                          return (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · {cc} credits
                              {p.is_active === false ? " · not on sale" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <PackagePeriodFields
                  idPrefix="assign-existing"
                  startDate={assignStartDate}
                  endDate={assignEndDate}
                  onStartChange={setAssignStartDate}
                  onEndChange={setAssignEndDate}
                />
                {isBundleAssign && selectedProduct ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                    <div>
                      <p className="text-sm font-medium">Included with this package</p>
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {bundlePreviewRows.map((row) => (
                          <li key={row.product_name}>
                            <span className="font-medium text-foreground">{row.product_name}</span>
                            {" · "}
                            {bundleRowSummary(row)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="border-t border-border pt-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">Extra components (optional)</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() =>
                            setBundleExtras((prev) => [...prev, newBundleExtraDraft("cafe")])
                          }
                        >
                          <Plus className="h-3 w-3 shrink-0" aria-hidden />
                          Add component
                        </Button>
                      </div>
                      {bundleExtras.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          e.g. +10 café credits, extra Wellzone, mat or towel on top of the bundle.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {bundleExtras.map((extra) => {
                            const accessOnly = extra.kind === "mat" || extra.kind === "towel";
                            return (
                              <li
                                key={extra.id}
                                className="grid gap-2 rounded-md border border-border bg-background/80 p-2 sm:grid-cols-[1fr_88px_auto_auto]"
                              >
                                <Select
                                  value={extra.kind}
                                  onValueChange={(v) => {
                                    const kind = v as BundleComponentKind;
                                    setBundleExtras((prev) =>
                                      prev.map((row) =>
                                        row.id === extra.id
                                          ? {
                                              ...row,
                                              kind,
                                              unlimited:
                                                kind === "mat" ||
                                                kind === "towel" ||
                                                row.unlimited,
                                            }
                                          : row,
                                      ),
                                    );
                                  }}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {BUNDLE_COMPONENT_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {!accessOnly && !extra.unlimited ? (
                                  <Input
                                    type="number"
                                    min={1}
                                    className="h-9"
                                    value={extra.credits}
                                    onChange={(e) =>
                                      setBundleExtras((prev) =>
                                        prev.map((row) =>
                                          row.id === extra.id
                                            ? { ...row, credits: e.target.value }
                                            : row,
                                        ),
                                      )
                                    }
                                    aria-label="Credits"
                                  />
                                ) : (
                                  <span className="flex h-9 items-center text-xs text-muted-foreground">
                                    {accessOnly ? "Access" : "∞"}
                                  </span>
                                )}
                                <div className="flex items-center gap-1.5">
                                  <Switch
                                    id={`extra-unlimited-${extra.id}`}
                                    checked={extra.unlimited || accessOnly}
                                    disabled={accessOnly}
                                    onCheckedChange={(v) =>
                                      setBundleExtras((prev) =>
                                        prev.map((row) =>
                                          row.id === extra.id ? { ...row, unlimited: v } : row,
                                        ),
                                      )
                                    }
                                  />
                                  <Label
                                    htmlFor={`extra-unlimited-${extra.id}`}
                                    className="text-xs"
                                  >
                                    Unlimited
                                  </Label>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 text-destructive"
                                  aria-label="Remove extra component"
                                  onClick={() =>
                                    setBundleExtras((prev) =>
                                      prev.filter((row) => row.id !== extra.id),
                                    )
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="assign-existing-note">Optional note</Label>
                  <Textarea
                    id="assign-existing-note"
                    value={existingNote}
                    onChange={(e) => setExistingNote(e.target.value)}
                    rows={2}
                    placeholder="Shown in the member email if provided"
                  />
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      submitting || productsLoading || !existingCategory || !selectedProductId
                    }
                    className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                    onClick={() => openAssignConfirm("existing")}
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Assign
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="custom" className="space-y-4 pt-2">
                <div className="grid gap-2">
                  <Label htmlFor="assign-custom-name">Package name</Label>
                  <Input
                    id="assign-custom-name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. Guest pass"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>What's included</Label>
                  <p className="text-xs text-muted-foreground">
                    Tick the access groups this package covers. Ticked groups share one pool of sessions.
                  </p>
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                    {accessGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Loading access groups…</p>
                    ) : (
                      accessGroups.map((g) => (
                        <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={customGroupIds.includes(g.id)}
                            onCheckedChange={(c) =>
                              setCustomGroupIds((prev) =>
                                c === true ? [...new Set([...prev, g.id])] : prev.filter((x) => x !== g.id),
                              )
                            }
                          />
                          {g.name}
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="grid flex-1 gap-2">
                    <Label htmlFor="assign-custom-credits">Number of credits</Label>
                    <Input
                      id="assign-custom-credits"
                      type="number"
                      min={1}
                      disabled={customUnlimited}
                      value={customCredits}
                      onChange={(e) => setCustomCredits(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch
                      id="assign-custom-unlimited"
                      checked={customUnlimited}
                      onCheckedChange={setCustomUnlimited}
                    />
                    <Label htmlFor="assign-custom-unlimited" className="cursor-pointer text-sm">
                      Unlimited
                    </Label>
                  </div>
                </div>
                <PackagePeriodFields
                  idPrefix="assign-custom"
                  startDate={assignStartDate}
                  endDate={assignEndDate}
                  onStartChange={setAssignStartDate}
                  onEndChange={setAssignEndDate}
                />
                <div className="grid gap-2">
                  <Label htmlFor="assign-custom-validity">Validity days (shortcut)</Label>
                  <Input
                    id="assign-custom-validity"
                    type="number"
                    min={1}
                    placeholder="Fills end date from start"
                    value={customValidityDays}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomValidityDays(v);
                      const days = Math.trunc(Number(v));
                      if (!Number.isFinite(days) || days < 1) return;
                      const start = assignStartDate.trim() || todayCreditDateInput();
                      if (!assignStartDate.trim()) setAssignStartDate(start);
                      setAssignEndDate(addDaysToCreditDateInput(start, days));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="assign-custom-note">Optional note</Label>
                  <Textarea
                    id="assign-custom-note"
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    rows={2}
                    placeholder="Shown in the member email if provided"
                  />
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting}
                    className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                    onClick={() => openAssignConfirm("custom")}
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Assign
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm assignment</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm text-muted-foreground">
              {confirmTab === "existing" ? existingConfirmCopy : customConfirmCopy}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmTab === "custom" ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={saveAsProduct}
                onCheckedChange={(c) => setSaveAsProduct(c === true)}
              />
              <span>
                <span className="block font-medium">Save this package for future use?</span>
                <span className="block text-xs text-muted-foreground">
                  Adds it to Admin → Products, switched off so it does not show on Pricing. Set a
                  price and switch it on there if you want to sell it.
                </span>
              </span>
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={submitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={submitting}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d] focus:ring-[#a3b693]"
              onClick={(e) => {
                e.preventDefault();
                void (confirmTab === "existing" ? assignExisting() : assignCustom());
              }}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Assigning…
                </span>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={assignResultOpen}
        onOpenChange={(o) => {
          if (!o) closeAssignResult();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Package assigned</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {assignResultRows.length > 1
              ? `${assignResultRows.length} credit rows created for ${assignResultMemberName}:`
              : `Credits added for ${assignResultMemberName}:`}
          </p>
          <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {assignResultRows.map((row) => (
              <li key={row.id}>{formatAssignedCreditSummary(row)}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              onClick={closeAssignResult}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
