import { createFileRoute } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Filter,
  Loader2,
  Search,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";
import {
  GuideRatesSection,
  ruleSummary,
  type GuideRateRule,
} from "@/components/admin/GuideRatesSection";

export const Route = createFileRoute("/admin/payouts")({
  head: () => ({ meta: [{ title: "Payouts — One Flow Admin" }] }),
  component: PayoutsPage,
});

const TZ = "Africa/Johannesburg";
const PAGE_SIZE = 20;

type Status = "pending" | "approved" | "paid";

type LineItem = {
  class_id?: string;
  class_name: string;
  class_type: string;
  starts_at: string;
  location: string | null;
  participants: number;
  capacity: number;
  rate_zar: number;
  /** Taught for free: listed on the invoice at R0. */
  free?: boolean;
  /** A complimentary (free) class on the schedule. */
  complimentary?: boolean;
  /** Nobody booked: whether the guide stayed or left (Empty classes). */
  empty_outcome?: "stayed" | "left" | null;
};

type InvoiceRow = {
  id: string;
  guide_id: string;
  guideName: string;
  guideEmail: string;
  submitted_at: string;
  period_start: string | null;
  period_end: string | null;
  line_items: LineItem[];
  total_amount: number;
  status: Status;
  approved_at: string | null;
  paid_at: string | null;
  notes: string | null;
  rates_confirmed?: boolean;
  rates_comment?: string | null;
};

type Role = "director" | "management" | "guide" | "other";

function classifyRole(role: string | null | undefined): Role {
  const r = (role ?? "").toLowerCase();
  if (r === "director") return "director";
  if (r === "management") return "management";
  if (r === "guide") return "guide";
  return "other";
}

/** Submitted after the 27th of the month the pay cycle ends in. */
function isLateInvoice(i: { submitted_at: string; period_end: string | null }): boolean {
  if (!i.period_end || !i.submitted_at) return false;
  const due = new Date(`${i.period_end.slice(0, 8)}27T23:59:59+02:00`).getTime();
  return new Date(i.submitted_at).getTime() > due;
}

function formatRand(n: number): string {
  const x = Number(n) || 0;
  return `R${x.toLocaleString("en-ZA", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_BADGE: Record<Status, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
};

function PayoutsPage() {
  const [role, setRole] = useState<Role>("other");
  const [me, setMe] = useState<string | null>(null);
  const [meName, setMeName] = useState<string>("");

  // Director side
  const [tab, setTab] = useState<string>("submitted");
  /** Also teaches (a guide role alongside another role): can submit their own invoice. */
  const [teaches, setTeaches] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [guideFilter, setGuideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"submitted_desc" | "guide_name_asc" | "amount_desc" | "status">(
    "submitted_desc",
  );
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<InvoiceRow | null>(null);

  // Guide side
  const [guideClasses, setGuideClasses] = useState<LineItem[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  /** The guide's own rates (set by Directors), and their confirmation for this invoice. */
  const [myRates, setMyRates] = useState<GuideRateRule[]>([]);
  const [ratesConfirmed, setRatesConfirmed] = useState(false);
  const [ratesComment, setRatesComment] = useState("");
  /**
   * Pay cycle: the 26th of one month to the 25th of the next. Invoices are due by the 27th.
   * "current" is the cycle ending this month's 25th (or next month's, from the 28th);
   * "previous" is the one before.
   */
  const [period, setPeriod] = useState<"current" | "previous">("current");
  const periodRange = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
    let y = Number(today.slice(0, 4));
    let m = Number(today.slice(5, 7));
    const day = Number(today.slice(8, 10));
    if (day >= 28) m += 1;
    if (period === "previous") m -= 1;
    const norm = (yy: number, mm: number) => {
      while (mm > 12) {
        mm -= 12;
        yy += 1;
      }
      while (mm < 1) {
        mm += 12;
        yy -= 1;
      }
      return [yy, mm] as const;
    };
    [y, m] = norm(y, m);
    const [py, pm] = norm(y, m - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${py}-${pad(pm)}-26`;
    const end = `${y}-${pad(m)}-25`;
    const nextStart = `${y}-${pad(m)}-26`;
    const due = `${y}-${pad(m)}-27`;
    const fmt = (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    return {
      start,
      end,
      nextStart,
      due,
      label: `${fmt(start)} – ${fmt(end)}`,
      dueLabel: new Date(`${due}T12:00:00Z`).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "long",
      }),
      overdue: today > due,
      open: today <= end,
    };
  }, [period]);

  useEffect(() => {
    void (async () => {
      const user = await getUser();
      if (!user) return;
      setMe(user.id);
      const { data } = await supabase
        .from("profiles")
        .select("role, secondary_roles, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle();
      const rec = data as {
        role?: string;
        secondary_roles?: string[] | null;
        first_name?: string;
        last_name?: string;
      } | null;
      // Directors see every invoice. Anyone else who teaches (even with another role) sees their own.
      const roleSet = new Set(
        [rec?.role, ...(rec?.secondary_roles ?? [])].map((x) => String(x ?? "").toLowerCase()),
      );
      setRole(
        roleSet.has("director")
          ? "director"
          : roleSet.has("guide")
            ? "guide"
            : classifyRole(
                effectiveRole({
                  role: rec?.role ?? null,
                  secondary_roles: rec?.secondary_roles ?? null,
                }),
              ),
      );
      setMeName(`${rec?.first_name ?? ""} ${rec?.last_name ?? ""}`.trim() || "Guide");
      setTeaches(roleSet.has("guide"));
    })();
  }, []);

  // Payouts: only Directors approve and pay (matches the database rule).
  const isAdmin = role === "director";
  const isGuide = role === "guide";

  // Load invoices (admin or guide-self).
  const loadInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    const query = supabase
      .from("guide_invoices")
      .select(
        "id, guide_id, submitted_at, period_start, period_end, line_items, total_amount, status, approved_at, paid_at, notes, rates_confirmed, rates_comment, guide:guide_id(first_name, last_name, email)",
      )
      .order("submitted_at", { ascending: false })
      .limit(500);
    const { data, error } = await query;
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load invoices"));
      setInvoices([]);
      setLoadingInvoices(false);
      return;
    }
    const rows: InvoiceRow[] = (data ?? []).map((raw: Record<string, unknown>) => {
      const p = (Array.isArray(raw.guide) ? raw.guide[0] : raw.guide) as {
        first_name?: string;
        last_name?: string;
        email?: string;
      } | null;
      const li: LineItem[] = Array.isArray(raw.line_items) ? (raw.line_items as LineItem[]) : [];
      return {
        id: String(raw.id),
        guide_id: String(raw.guide_id),
        guideName: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.toString().trim() || "Guide",
        guideEmail: p?.email ?? "",
        submitted_at: String(raw.submitted_at ?? ""),
        period_start: (raw.period_start as string | null) ?? null,
        period_end: (raw.period_end as string | null) ?? null,
        line_items: li,
        total_amount: Number(raw.total_amount ?? 0),
        status: (String(raw.status ?? "pending") as Status) || "pending",
        approved_at: (raw.approved_at as string | null) ?? null,
        paid_at: (raw.paid_at as string | null) ?? null,
        notes: (raw.notes as string | null) ?? null,
        rates_confirmed: raw.rates_confirmed === true,
        rates_comment: (raw.rates_comment as string | null) ?? null,
      };
    });
    setInvoices(rows);
    setLoadingInvoices(false);
  }, []);

  useEffect(() => {
    if (role === "other") return;
    void loadInvoices();
  }, [loadInvoices, role]);

  // Load guide's taught classes for the current 30-day window.
  const loadGuideClasses = useCallback(async () => {
    if (!me) return;
    setLoadingClasses(true);
    const fromIso = new Date(`${periodRange.start}T00:00:00+02:00`).toISOString();
    const toIso = new Date(
      Math.min(new Date(`${periodRange.nextStart}T00:00:00+02:00`).getTime(), Date.now()),
    ).toISOString();
    const { data: classRows, error } = await supabase
      .from("classes")
      .select(
        "id, name, class_type, starts_at, location, capacity, booked_count, guide_id, is_free",
      )
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .eq("is_cancelled", false)
      .or(`guide_id.eq.${me},guide_name.ilike.${meName}`)
      .order("starts_at", { ascending: false });
    // Empty classes: shown with "Stayed" or "Left"; ones the guide left are greyed out and can't be claimed.
    const ids = (classRows ?? []).map((c: Record<string, unknown>) => String(c.id));
    const { data: emptyRows } = ids.length
      ? await supabase.from("empty_class_checkins").select("class_id, outcome").in("class_id", ids)
      : { data: [] };
    const outcomeById = new Map(
      ((emptyRows ?? []) as { class_id: string; outcome: "stayed" | "left" }[]).map((r) => [
        r.class_id,
        r.outcome,
      ]),
    );
    const leftIds = new Set<string>();
    // Classes already on one of their invoices (not rejected) can't be invoiced twice.
    const { data: myInvoices } = await supabase
      .from("guide_invoices")
      .select("line_items, status")
      .eq("guide_id", me);
    for (const inv of (myInvoices ?? []) as {
      line_items: LineItem[] | null;
      status: string | null;
    }[]) {
      if (inv.status === "rejected") continue;
      for (const li of inv.line_items ?? []) if (li.class_id) leftIds.add(li.class_id);
    }
    setLoadingClasses(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load classes"));
      return;
    }
    const items: LineItem[] = (classRows ?? [])
      .filter((c: Record<string, unknown>) => !leftIds.has(String(c.id)))
      .map((c: Record<string, unknown>) => ({
        class_id: String(c.id),
        class_name: String(c.name ?? ""),
        class_type: String(c.class_type ?? ""),
        starts_at: String(c.starts_at ?? ""),
        location: (c.location as string | null) ?? null,
        participants: Number(c.booked_count ?? 0),
        capacity: Number(c.capacity ?? 0),
        rate_zar: 0,
        complimentary: c.is_free === true,
        empty_outcome: outcomeById.get(String(c.id)) ?? null,
      }));
    setGuideClasses(items);
    const initialRates: Record<string, string> = {};
    for (const it of items) initialRates[it.class_id ?? ""] = "";
    setRates(initialRates);
  }, [me, meName, periodRange]);

  useEffect(() => {
    if (isGuide || teaches) void loadGuideClasses();
  }, [isGuide, teaches, loadGuideClasses]);

  useEffect(() => {
    if (!me || !(isGuide || teaches)) return;
    void supabase
      .from("guide_rates")
      .select("*")
      .eq("guide_profile_id", me)
      .order("sort_order")
      .then(({ data }) => setMyRates((data ?? []) as GuideRateRule[]));
  }, [me, isGuide, teaches]);

  const guideSplit = useMemo(() => {
    const studio: LineItem[] = [];
    const wellzone: LineItem[] = [];
    for (const it of guideClasses) {
      if (it.class_type === "wellzone" || it.class_type === "sauna_journey") wellzone.push(it);
      else studio.push(it);
    }
    return { studio, wellzone };
  }, [guideClasses]);

  const guideTotal = useMemo(() => {
    return guideClasses.reduce((sum, it) => {
      const r = Number(rates[it.class_id ?? ""] || 0);
      return sum + (Number.isFinite(r) ? r : 0);
    }, 0);
  }, [guideClasses, rates]);

  const submitGuideInvoice = async () => {
    setSubmitting(true);
    try {
      const lineItems = guideClasses
        .map((it) => {
          const v = rates[it.class_id ?? ""] ?? "";
          return v === "free"
            ? { ...it, rate_zar: 0, free: true }
            : { ...it, rate_zar: Number(v || 0), free: false };
        })
        .filter((it) => it.empty_outcome !== "left" && (it.free || it.rate_zar > 0));
      if (lineItems.length === 0) {
        toast.error("Add a rate, or mark Free, for at least one class");
        setSubmitting(false);
        return;
      }
      if (!ratesConfirmed) {
        toast.error("Please tick to confirm your rates first");
        setSubmitting(false);
        return;
      }
      const total = lineItems.reduce((s, it) => s + it.rate_zar, 0);
      const periodStart = new Date(`${periodRange.start}T12:00:00Z`);
      const periodEnd = new Date(`${periodRange.end}T12:00:00Z`);
      const { data: inserted, error } = await supabase
        .from("guide_invoices")
        .insert({
          guide_id: me,
          line_items: lineItems,
          total_amount: total,
          period_start: periodStart.toISOString().slice(0, 10),
          period_end: periodEnd.toISOString().slice(0, 10),
          status: "pending",
          rates_confirmed: ratesConfirmed,
          rates_comment: ratesComment.trim() || null,
          rates_snapshot: myRates,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;

      // Email full invoice breakdown to deeds@oneflow.co.za.
      const breakdown = lineItems
        .map(
          (it) =>
            `<li>${formatDay(it.starts_at)} — ${it.class_name} (${it.class_type}) — ${it.free ? "Free" : `R${it.rate_zar}`}</li>`,
        )
        .join("");
      await supabase.functions.invoke("send-email", {
        body: {
          to: "deeds@oneflow.co.za",
          template: "marketing",
          data: {
            subject: `Guide invoice — ${meName} — ${formatRand(total)}`,
            body_html: `
              <p>Guide ${meName} has submitted an invoice.</p>
              <p>Period: ${formatDay(periodStart.toISOString())} – ${formatDay(periodEnd.toISOString())}</p>
              <p><strong>Total: ${formatRand(total)}</strong></p>
              <ul>${breakdown}</ul>
              <p>Invoice ID: ${(inserted as { id?: string } | null)?.id ?? ""}</p>
            `,
          },
        },
      });

      toast.success("Invoice submitted");
      setConfirmSubmitOpen(false);
      setRates({});
      await loadInvoices();
      await loadGuideClasses();
    } catch (e: unknown) {
      console.error("payout submit failed", e);
      toast.error(supabaseErrorMessage(e, "Submit failed — please try again"));
    } finally {
      setSubmitting(false);
    }
  };

  const guideOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const i of invoices) set.set(i.guide_id, i.guideName);
    return [...set.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = invoices.filter((i) => {
      if (ql && !i.guideName.toLowerCase().includes(ql)) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (guideFilter !== "all" && i.guide_id !== guideFilter) return false;
      if (dateFrom && i.submitted_at < new Date(dateFrom).toISOString()) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (i.submitted_at > end.toISOString()) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "guide_name_asc":
          return (
            a.guideName.localeCompare(b.guideName) || b.submitted_at.localeCompare(a.submitted_at)
          );
        case "amount_desc":
          return b.total_amount - a.total_amount || b.submitted_at.localeCompare(a.submitted_at);
        case "status": {
          const sr = a.status.localeCompare(b.status);
          if (sr !== 0) return sr;
          return b.submitted_at.localeCompare(a.submitted_at);
        }
        case "submitted_desc":
        default:
          return b.submitted_at.localeCompare(a.submitted_at);
      }
    });
    return out;
  }, [invoices, q, statusFilter, guideFilter, dateFrom, dateTo, sort]);

  const adminInvoiceFilterCount =
    (q.trim() ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (guideFilter !== "all" ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const clearAdminInvoiceFilters = () => {
    setQ("");
    setStatusFilter("all");
    setGuideFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, guideFilter, dateFrom, dateTo, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const pageRows = filteredInvoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const setStatus = async (inv: InvoiceRow, next: Status) => {
    const user = await getUser();
    const patch: Record<string, unknown> = { status: next };
    if (next === "approved") {
      patch.approved_by = user?.id ?? null;
      patch.approved_at = new Date().toISOString();
    }
    if (next === "paid") {
      patch.paid_at = new Date().toISOString();
    }
    const { error } = await supabase.from("guide_invoices").update(patch).eq("id", inv.id);
    if (error) {
      console.error("payout operation failed", error);
      toast.error(supabaseErrorMessage(error, "Operation failed — please try again"));
      return;
    }
    toast.success(`Invoice marked ${next}`);
    await loadInvoices();
    if (detail && detail.id === inv.id) {
      setDetail({ ...inv, ...patch, status: next });
    }
  };

  if (role === "other") {
    return (
      <div>
        <PageHeader title="Payouts" />
        <p className="text-sm text-muted-foreground">You don't have access to payouts.</p>
      </div>
    );
  }

  // The invoice screen for anyone who teaches (also shown to directors who teach, as "My invoice").
  const guideView = (
    <div>
      <PageHeader
        title="Submit invoice"
        description={`Hi ${meName}, add your rate for each class you taught ${periodRange.label}. Due by ${periodRange.dueLabel}.`}
        actions={
          <Button
            type="button"
            onClick={() => setConfirmSubmitOpen(true)}
            disabled={
              submitting ||
              !ratesConfirmed ||
              (guideTotal <= 0 && !Object.values(rates).includes("free"))
            }
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Submit invoice ({formatRand(guideTotal)})
          </Button>
        }
      />

      <section className="mb-4 rounded-2xl border border-border bg-card p-4">
        <h4 className="font-display text-base font-semibold">Your rates</h4>
        {myRates.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No rates have been set for you yet. Add a comment below if you&apos;d like the studio to
            set them.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {myRates.map((r) => (
              <li key={r.id ?? `${r.class_group}-${r.min_attendance}`}>
                {ruleSummary(r)}
                {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[#5f7a52]"
            checked={ratesConfirmed}
            onChange={(e) => setRatesConfirmed(e.target.checked)}
          />
          <span className="font-medium">
            {myRates.length === 0
              ? "I've read this and added a comment if needed"
              : "I confirm these are my rates"}
          </span>
        </label>
        <textarea
          value={ratesComment}
          onChange={(e) => setRatesComment(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Comment (optional), e.g. my Reformer rate changed in November"
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </section>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Invoice month">
        {(["previous", "current"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={
              period === p
                ? "rounded-full border border-[#5f7a52] bg-[#5f7a52] px-4 py-1.5 text-sm font-semibold text-white"
                : "rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold"
            }
          >
            {p === "previous" ? "Previous cycle" : "This cycle"}
          </button>
        ))}
      </div>
      <p
        className={
          periodRange.overdue
            ? "mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            : "mb-4 rounded-xl border border-[#d4af37]/50 bg-[#d4af37]/10 px-3 py-2 text-sm"
        }
      >
        {periodRange.label} ·{" "}
        {periodRange.overdue
          ? `Was due by ${periodRange.dueLabel}. Submit as soon as you can.`
          : periodRange.open
            ? `This cycle is still running. Submit on the 26th or 27th, by ${periodRange.dueLabel}.`
            : `Submit by ${periodRange.dueLabel}.`}
      </p>

      {loadingClasses ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : guideClasses.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card py-16 text-center">
          <CircleDollarSign className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">
            No classes to invoice for {periodRange.label}. Classes already on an invoice aren&apos;t
            listed again.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <ClassRateGroup
            title="Studio classes"
            items={guideSplit.studio}
            rates={rates}
            setRate={(id, v) => setRates((r) => ({ ...r, [id]: v }))}
          />
          <ClassRateGroup
            title="Wellzone"
            items={guideSplit.wellzone}
            rates={rates}
            setRate={(id, v) => setRates((r) => ({ ...r, [id]: v }))}
          />
          <div className="rounded-2xl border border-[#c5d4b8]/80 bg-[#f4f7f0]/70 p-5 text-right shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#3d4f36]">
              Running total
            </p>
            <p className="mt-1 font-display text-3xl font-bold">{formatRand(guideTotal)}</p>
          </div>
        </div>
      )}

      <h3 className="mt-8 mb-3 font-display text-lg font-semibold">My invoices</h3>
      <InvoicesList
        loading={loadingInvoices}
        rows={invoices.filter((i) => i.guide_id === me)}
        isAdmin={false}
        onOpen={(inv) => setDetail(inv)}
      />

      <Dialog open={isGuide && !!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <InvoiceDetail
          inv={detail}
          isAdmin={false}
          onApprove={() => detail && void setStatus(detail, "approved")}
          onMarkPaid={() => detail && void setStatus(detail, "paid")}
        />
      </Dialog>

      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Total: {formatRand(guideTotal)}. Once submitted, the directors will review and
              approve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void submitGuideInvoice();
              }}
              disabled={submitting}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (isGuide) return guideView;

  // Director / management view
  return (
    <div>
      <PageHeader
        title="Payouts"
        description={loadingInvoices ? "Loading…" : `${invoices.length} invoices`}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="submitted">
            Submitted ({invoices.filter((i) => i.status === "pending").length})
          </TabsTrigger>
          <TabsTrigger value="inbox">All invoices</TabsTrigger>
          {isAdmin ? <TabsTrigger value="rates">Guide rates</TabsTrigger> : null}
          {teaches ? <TabsTrigger value="mine">My invoice</TabsTrigger> : null}
        </TabsList>
        {isAdmin ? (
          <TabsContent value="rates" className="mt-0">
            <GuideRatesSection />
          </TabsContent>
        ) : null}
        {teaches ? (
          <TabsContent value="mine" className="mt-0">
            {guideView}
          </TabsContent>
        ) : null}
        <TabsContent value="submitted" className="mt-0">
          <p className="mb-3 text-sm text-muted-foreground">
            Invoices guides have submitted that are waiting for approval. Pay cycle: 26th to 25th,
            due by the 27th.
            <span className="font-medium text-destructive"> Late</span> means submitted after the
            27th.
          </p>
          <InvoicesList
            loading={loadingInvoices}
            rows={invoices.filter((i) => i.status === "pending")}
            isAdmin={isAdmin}
            showLate
            onOpen={(inv) => setDetail(inv)}
            onApprove={(inv) => void setStatus(inv, "approved")}
            onMarkPaid={(inv) => void setStatus(inv, "paid")}
          />
        </TabsContent>
        <TabsContent value="inbox" className="mt-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Filters
              {adminInvoiceFilterCount > 0 ? (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {adminInvoiceFilterCount}
                </span>
              ) : null}
            </span>
            {adminInvoiceFilterCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={clearAdminInvoiceFilters}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear filters
              </Button>
            ) : null}
          </div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by guide…"
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={guideFilter} onValueChange={setGuideFilter}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder="Guide" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All guides</SelectItem>
                {guideOptions.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full sm:w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full sm:w-40"
              aria-label="To date"
            />
            <Select
              value={sort}
              onValueChange={(v) =>
                setSort(v as "submitted_desc" | "guide_name_asc" | "amount_desc" | "status")
              }
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted_desc">Submitted date (newest)</SelectItem>
                <SelectItem value="guide_name_asc">Guide name A–Z</SelectItem>
                <SelectItem value="amount_desc">Amount high–low</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <InvoicesList
            loading={loadingInvoices}
            rows={pageRows}
            isAdmin={isAdmin}
            onOpen={(inv) => setDetail(inv)}
            onApprove={(inv) => void setStatus(inv, "approved")}
            onMarkPaid={(inv) => void setStatus(inv, "paid")}
          />

          {!loadingInvoices && filteredInvoices.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Page {page} of {pageCount} · {filteredInvoices.length} total
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
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <InvoiceDetail
          inv={detail}
          isAdmin={isAdmin}
          onApprove={() => detail && void setStatus(detail, "approved")}
          onMarkPaid={() => detail && void setStatus(detail, "paid")}
        />
      </Dialog>
    </div>
  );
}

function InvoicesList({
  loading,
  rows,
  isAdmin,
  onOpen,
  onApprove,
  onMarkPaid,
  showLate = false,
}: {
  loading: boolean;
  rows: InvoiceRow[];
  isAdmin: boolean;
  showLate?: boolean;
  onOpen: (inv: InvoiceRow) => void;
  onApprove?: (inv: InvoiceRow) => void;
  onMarkPaid?: (inv: InvoiceRow) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card py-16 text-center">
        <CircleDollarSign className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-medium">Guide</th>
            <th className="px-5 py-3 font-medium">Submitted</th>
            <th className="px-5 py-3 font-medium">Period</th>
            <th className="px-5 py-3 font-medium">Total</th>
            <th className="px-5 py-3 font-medium">Status</th>
            {isAdmin && <th className="px-5 py-3 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr
              key={i.id}
              role="link"
              tabIndex={0}
              onClick={() => onOpen(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(i);
                }
              }}
              className="cursor-pointer border-t border-border hover:bg-muted/30"
            >
              <td className="px-5 py-3 font-semibold">
                {i.guideName}
                {showLate && isLateInvoice(i) ? (
                  <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                    Late
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                {formatDate(i.submitted_at)}
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                {i.period_start ? formatDay(i.period_start) : "—"} —{" "}
                {i.period_end ? formatDay(i.period_end) : "—"}
              </td>
              <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                {formatRand(i.total_amount)}
              </td>
              <td className="px-5 py-3">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    STATUS_BADGE[i.status],
                  )}
                >
                  {i.status}
                </span>
              </td>
              {isAdmin && (
                <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    {i.status === "pending" && onApprove && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => onApprove(i)}
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    )}
                    {i.status === "approved" && onMarkPaid && (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                        onClick={() => onMarkPaid(i)}
                      >
                        <Check className="h-3.5 w-3.5" /> Mark paid
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassRateGroup({
  title,
  items,
  rates,
  setRate,
}: {
  title: string;
  items: LineItem[];
  rates: Record<string, string>;
  setRate: (id: string, v: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h4 className="mb-3 font-display text-base font-semibold">{title}</h4>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li
            key={it.class_id}
            className={cn(
              "grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[1fr_auto]",
              it.empty_outcome === "left" && "opacity-45",
            )}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                <span className="truncate">{it.class_name}</span>
                {it.complimentary ? (
                  <span className="rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a6d12]">
                    Complimentary
                  </span>
                ) : null}
                {it.empty_outcome ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      it.empty_outcome === "left"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-[#5f7a52]/15 text-[#3d4f36]",
                    )}
                  >
                    {it.empty_outcome === "left" ? "Left" : "Stayed"}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDay(it.starts_at)} ·{" "}
                {new Date(it.starts_at).toLocaleTimeString("en-ZA", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: TZ,
                })}{" "}
                · {it.location ?? "—"} · {it.participants}/{it.capacity} participants
              </p>
            </div>
            {it.empty_outcome === "left" ? (
              <p className="text-xs text-muted-foreground sm:text-right">
                Nobody came and you left, so this class isn&apos;t paid.
              </p>
            ) : (
              <div className="flex items-center gap-2 sm:justify-end">
                <Label htmlFor={`rate-${it.class_id}`} className="text-xs text-muted-foreground">
                  Rate (ZAR)
                </Label>
                <Input
                  id={`rate-${it.class_id}`}
                  type="number"
                  min={0}
                  disabled={rates[it.class_id ?? ""] === "free"}
                  value={
                    rates[it.class_id ?? ""] === "free" ? "" : (rates[it.class_id ?? ""] ?? "")
                  }
                  placeholder={rates[it.class_id ?? ""] === "free" ? "Free" : ""}
                  onChange={(e) => setRate(it.class_id ?? "", e.target.value)}
                  className="w-28 text-right"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRate(it.class_id ?? "", rates[it.class_id ?? ""] === "free" ? "" : "free")
                  }
                  className={
                    rates[it.class_id ?? ""] === "free"
                      ? "rounded-full border border-[#5f7a52] bg-[#5f7a52] px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                  }
                  title="I taught this class for free"
                >
                  Free
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvoiceDetail({
  inv,
  isAdmin,
  onApprove,
  onMarkPaid,
}: {
  inv: InvoiceRow | null;
  isAdmin: boolean;
  onApprove: () => void;
  onMarkPaid: () => void;
}) {
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{inv ? `Invoice — ${inv.guideName}` : "Invoice"}</DialogTitle>
      </DialogHeader>
      {inv && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Submitted: {formatDate(inv.submitted_at)}</span>
            <span>
              Period: {inv.period_start ? formatDay(inv.period_start) : "—"} —{" "}
              {inv.period_end ? formatDay(inv.period_end) : "—"}
            </span>
            <span>Status: {inv.status}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Participants</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {inv.line_items.map((li, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="px-3 py-2">{formatDay(li.starts_at)}</td>
                    <td className="px-3 py-2">{li.class_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{li.class_type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {li.participants}/{li.capacity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {li.free ? "Free" : formatRand(li.rate_zar)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatRand(inv.total_amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-sm font-semibold">
              {inv.rates_confirmed ? "✓ Guide confirmed their rates" : "Rates not confirmed"}
            </p>
            {inv.rates_comment ? (
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                “{inv.rates_comment}”
              </p>
            ) : null}
          </div>
          {inv.notes && (
            <div>
              <Label>Notes</Label>
              <Textarea readOnly value={inv.notes} className="mt-1" />
            </div>
          )}
        </div>
      )}
      <DialogFooter>
        {isAdmin && inv?.status === "pending" && (
          <Button type="button" variant="outline" className="gap-2" onClick={onApprove}>
            <Check className="h-4 w-4" /> Approve
          </Button>
        )}
        {isAdmin && inv?.status === "approved" && (
          <Button
            type="button"
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            onClick={onMarkPaid}
          >
            <Check className="h-4 w-4" /> Mark paid
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
