import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ensureMarketingAdminAccess } from "@/lib/ensureMarketingAdminAccess";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/promotions")({
  beforeLoad: ({ location }) => ensureMarketingAdminAccess(location.pathname),
  head: () => ({ meta: [{ title: "Promo codes — One Flow Admin" }] }),
  component: PromotionsPage,
});

const TZ = "Africa/Johannesburg";
const PAGE_SIZE = 20;

type DiscountType = "percentage" | "fixed";
type AppliesTo = "all" | "yoga" | "wellzone";
type SortKey = "code_asc" | "expiry_soonest" | "uses_desc";

type PromoRow = {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  applies_to: AppliesTo;
  max_uses: number | null;
  uses_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function promoStatus(p: PromoRow): "active" | "inactive" | "expired" | "maxed" {
  if (!p.is_active) return "inactive";
  if (p.max_uses != null && p.uses_count >= p.max_uses) return "maxed";
  if (p.valid_until && new Date(p.valid_until).getTime() < Date.now()) return "expired";
  return "active";
}

const STATUS_BADGE: Record<ReturnType<typeof promoStatus>, string> = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-muted text-muted-foreground",
  expired: "bg-amber-100 text-amber-800",
  maxed: "bg-red-100 text-red-800",
};

function discountLabel(p: PromoRow): string {
  if (p.discount_type === "percentage") return `${p.discount_value}%`;
  return `R${Number(p.discount_value).toLocaleString("en-ZA")}`;
}

function appliesLabel(applies: AppliesTo): string {
  if (applies === "yoga") return "Yoga only";
  if (applies === "wellzone") return "Wellzone only";
  return "All products";
}

function PromotionsPage() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("code_asc");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("all");
  const [maxUses, setMaxUses] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("promotions")
      .select(
        "id, code, name, description, discount_type, discount_value, applies_to, max_uses, uses_count, valid_from, valid_until, is_active, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load promotions"));
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as PromoRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSorted = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows.filter((r) => !ql || r.code.toLowerCase().includes(ql));
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "uses_desc":
          return b.uses_count - a.uses_count || a.code.localeCompare(b.code);
        case "expiry_soonest": {
          const sa = a.valid_until ?? "9999-12-31T23:59:59.999Z";
          const sb = b.valid_until ?? "9999-12-31T23:59:59.999Z";
          const cmp = sa.localeCompare(sb);
          if (cmp !== 0) return cmp;
          return a.code.localeCompare(b.code);
        }
        case "code_asc":
        default:
          return a.code.localeCompare(b.code);
      }
    });
    return out;
  }, [rows, q, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetForm = () => {
    setCode("");
    setName("");
    setDescription("");
    setDiscountType("percentage");
    setDiscountValue("10");
    setAppliesTo("all");
    setMaxUses("");
    setValidFrom("");
    setValidUntil("");
    setIsActive(true);
  };

  const openAdd = () => {
    setEditingId(null);
    resetForm();
    setSheetOpen(true);
  };

  const openEdit = (p: PromoRow) => {
    setEditingId(p.id);
    setCode(p.code);
    setName(p.name?.trim() || p.code);
    setDescription(p.description ?? "");
    setDiscountType(p.discount_type);
    setDiscountValue(String(p.discount_value));
    setAppliesTo(p.applies_to);
    setMaxUses(p.max_uses == null ? "" : String(p.max_uses));
    setValidFrom(p.valid_from ? new Date(p.valid_from).toISOString().slice(0, 10) : "");
    setValidUntil(p.valid_until ? new Date(p.valid_until).toISOString().slice(0, 10) : "");
    setIsActive(p.is_active);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
  };

  const save = async () => {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      toast.error("Code is required");
      return;
    }
    const dv = Number(discountValue);
    if (!Number.isFinite(dv) || dv <= 0) {
      toast.error("Enter a valid discount value");
      return;
    }
    if (discountType === "percentage" && dv > 100) {
      toast.error("Percentage discount cannot exceed 100");
      return;
    }
    const mu = maxUses.trim() === "" ? null : Math.max(1, Math.floor(Number(maxUses)));
    if (mu != null && !Number.isFinite(mu)) {
      toast.error("Enter a valid max uses");
      return;
    }
    const vf = validFrom ? new Date(validFrom).toISOString() : null;
    const vu = validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null;

    setSaving(true);
    const user = await getUser();

    const promoName = name.trim() || trimmedCode;

    const payload = {
      code: trimmedCode,
      name: promoName,
      description: description.trim() || null,
      discount_type: discountType,
      discount_value: dv,
      applies_to: appliesTo,
      max_uses: mu,
      valid_from: vf,
      valid_until: vu,
      is_active: isActive,
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from("promotions")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Promotion updated");
      } else {
        const { error } = await supabase.from("promotions").insert({
          ...payload,
          uses_count: 0,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
        toast.success("Promotion created");
      }
      closeSheet();
      await load();
    } catch (e: unknown) {
      console.error("promotion save failed", e);
      toast.error(`Save failed: ${supabaseErrorMessage(e, "Save failed — please try again")}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: PromoRow, next: boolean) => {
    const { error } = await supabase
      .from("promotions")
      .update({ is_active: next })
      .eq("id", p.id);
    if (error) {
      console.error("promotion toggle failed", error);
      toast.error(supabaseErrorMessage(error, "Could not update promotion"));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, is_active: next } : r)));
    toast.success(next ? "Promotion activated" : "Promotion deactivated");
  };

  return (
    <div>
      <PageHeader
        title="Promo codes"
        description={
          loading
            ? "Loading…"
            : `${rows.length} code${rows.length === 1 ? "" : "s"} · shown on the Pricing page`
        }
        actions={
          <Button
            type="button"
            onClick={openAdd}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            <Plus className="h-4 w-4" /> New promo code
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by code…"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="code_asc">Code A–Z</SelectItem>
            <SelectItem value="expiry_soonest">Expiry soonest</SelectItem>
            <SelectItem value="uses_desc">Most used</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">
              No promo codes yet. Create one for customers to enter on the Pricing page.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Discount</th>
                <th className="px-5 py-3 font-medium">Applies to</th>
                <th className="px-5 py-3 font-medium">Uses</th>
                <th className="px-5 py-3 font-medium">Valid until</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => {
                const status = promoStatus(p);
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm font-bold">{p.code}</p>
                      {p.description && (
                        <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                      {discountLabel(p)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {appliesLabel(p.applies_to)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                      {p.uses_count}
                      {p.max_uses != null ? ` / ${p.max_uses}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                      {formatDate(p.valid_until)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          STATUS_BADGE[status],
                        )}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Switch
                          checked={p.is_active}
                          onCheckedChange={(next) => void toggleActive(p, next)}
                          aria-label={p.is_active ? "Deactivate" : "Activate"}
                          className="data-[state=checked]:bg-[#a3b693]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filteredSorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Page {page} of {pageCount} · {filteredSorted.length} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit promo code" : "New promo code"}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="promo-code">Code</Label>
              <div className="flex gap-2">
                <Input
                  id="promo-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="SUMMER25"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCode(generateCode())}
                  aria-label="Generate code"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="promo-name">Name</Label>
              <Input
                id="promo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to code if left blank"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="promo-desc">Description (optional)</Label>
              <Textarea
                id="promo-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Internal note — not shown to customers"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Discount type</Label>
                <Select
                  value={discountType}
                  onValueChange={(v) => setDiscountType(v as DiscountType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed (ZAR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="promo-value">
                  Value {discountType === "percentage" ? "(%)" : "(ZAR)"}
                </Label>
                <Input
                  id="promo-value"
                  type="number"
                  min={0}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Applies to</Label>
              <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as AppliesTo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  <SelectItem value="yoga">Yoga only</SelectItem>
                  <SelectItem value="wellzone">Wellzone only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="promo-maxuses">Max uses (blank for unlimited)</Label>
              <Input
                id="promo-maxuses"
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="promo-from">Valid from</Label>
                <Input
                  id="promo-from"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="promo-until">Valid until</Label>
                <Input
                  id="promo-until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
              <Label htmlFor="promo-active">Active</Label>
              <Switch
                id="promo-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                className="data-[state=checked]:bg-[#a3b693]"
              />
            </div>
          </div>

          <SheetFooter className="mt-6">
            <Button type="button" variant="outline" onClick={closeSheet} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save changes" : "Create promo code"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
