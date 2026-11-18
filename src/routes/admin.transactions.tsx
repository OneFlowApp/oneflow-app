import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Receipt,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { civilAddDaysYmd, dayBoundsForDateKey, STUDIO_TIMEZONE, todayDateKey } from "@/lib/timezone";
import { markManualCreditRefunded, refundYocoCredit } from "@/lib/refunds";
import {
  isRecordedYocoPayment,
  isYocoCheckoutPlaceholder,
  yocoCheckoutId,
  yocoReferenceId,
} from "@/lib/yocoDisplay";
import { CopyableYocoId } from "@/components/admin/CopyableCheckoutId";

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({ meta: [{ title: "Transactions — One Flow Admin" }] }),
  component: TransactionsPage,
});

const TZ = STUDIO_TIMEZONE;
const PAGE_SIZE = 20;

type TxRow = {
  id: string;
  date: string;
  memberId: string | null;
  memberName: string;
  productId: string | null;
  productName: string;
  amount: number;
  paymentMethod: string;
  yocoPaymentId: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  /** All credit rows of this purchase (a multi-part pack is one sale). Empty for upgrade records. */
  creditIds: string[];
  paidWhere: PaidWhere;
  note: string | null;
};

type PaidWhere = "online" | "green_point" | "studio" | "comp";

const PAID_WHERE_LABEL: Record<PaidWhere, string> = {
  online: "Online (Yoco)",
  green_point: "Paid at De Waterkant",
  studio: "Paid at Longkloof desk",
  comp: "Comp / assigned",
};

function paidWhereFromId(id: string | null): PaidWhere {
  if (isRecordedYocoPayment(id)) return "online";
  if (id === "manual_green_point") return "green_point";
  if (id === "manual_studio") return "studio";
  return "comp";
}

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc";

function formatRand(n: number): string {
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

/** Credits without a Yoco payment ID are studio-assigned (comped, staff packages, admin grants). */
function paymentMethodLabel(method: string): string {
  if (method === "yoco") return "Yoco";
  if (method === "manual") return "Admin assigned";
  return method;
}

function isRealOnlineRevenue(row: TxRow): boolean {
  return isRecordedYocoPayment(row.yocoPaymentId) && !row.refundedAt;
}

/** Paid at the counter (De Waterkant or Longkloof desk) and loaded in the dashboard, with an amount. */
function isCounterRevenue(row: TxRow): boolean {
  return (row.paidWhere === "green_point" || row.paidWhere === "studio") && !row.refundedAt && row.amount > 0;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function jhbDayBoundsAt(daysAgo: number): { start: string; end: string } {
  const dateKey = civilAddDaysYmd(todayDateKey(TZ), -daysAgo);
  const { startUtcIso, endUtcIso } = dayBoundsForDateKey(dateKey, TZ);
  return { start: startUtcIso, end: endUtcIso };
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TransactionsPage() {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [page, setPage] = useState(1);
  const [revenueToday, setRevenueToday] = useState(0);
  const [revenueWeek, setRevenueWeek] = useState(0);
  const [revenueMonth, setRevenueMonth] = useState(0);
  const [refundTarget, setRefundTarget] = useState<TxRow | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const monthStart = jhbDayBoundsAt(29);

    const upgradesPromise = supabase
      .from("credit_access_upgrades")
      .select("id, created_at, profile_id, product_name, paid_where, amount_zar, reference, profile:profile_id(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(1000);
    const [creditsRes, offlineRes] = await Promise.all([
      supabase
        .from("user_credits")
        .select(
          "id, created_at, purchased_at, profile_id, product_id, product_name, yoco_payment_id, refunded_at, refund_reason, amount_paid_zar, payment_note, profile:profile_id(first_name, last_name), product:product_id(name, price_zar)",
        )
        .order("created_at", { ascending: false })
        .limit(3000),
      supabase
        .from("offline_revenue")
        .select("occurred_at, amount_zar")
        .gte("occurred_at", monthStart.start),
    ]);

    const { data, error } = creditsRes;

    if (error) {
      console.error("transactions load failed", error);
      toast.error(supabaseErrorMessage(error, "Could not load transactions"));
      setRows([]);
      setLoading(false);
      return;
    }

    if (offlineRes.error) {
      console.error("offline revenue load failed", offlineRes.error);
      toast.error(supabaseErrorMessage(offlineRes.error, "Could not load offline revenue"));
    }

    const offlineRows = (offlineRes.data ?? []) as { occurred_at: string; amount_zar: number }[];

    // One line per purchase: the parts of a multi-part pack (e.g. The Seeker) share one sale.
    const groups = new Map<string, TxRow>();
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const profile = (Array.isArray(raw.profile) ? raw.profile[0] : raw.profile) as
        | { first_name?: string; last_name?: string }
        | null;
      const product = (Array.isArray(raw.product) ? raw.product[0] : raw.product) as
        | { name?: string; price_zar?: number }
        | null;
      const memberName =
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || "—";
      const partName = (raw.product_name as string | null)?.trim() || product?.name || "—";
      const yoco = (raw.yoco_payment_id as string | null) ?? null;
      const paidWhere = paidWhereFromId(yoco);
      const date =
        (raw.purchased_at as string | null) ?? (raw.created_at as string) ?? new Date().toISOString();
      const key = [
        raw.profile_id,
        raw.product_id ?? partName,
        paidWhere === "online" ? yoco : `${yoco}|${date}|${String(raw.created_at ?? "").slice(0, 16)}`,
      ].join("|");
      const paid = Number(raw.amount_paid_zar ?? 0) || 0;
      const existing = groups.get(key);
      if (existing) {
        existing.creditIds.push(String(raw.id));
        if (paidWhere === "green_point" || paidWhere === "studio") existing.amount += paid;
        if (!existing.note && raw.payment_note) existing.note = String(raw.payment_note);
        if (product?.name) existing.productName = product.name;
        continue;
      }
      groups.set(key, {
        id: String(raw.id),
        date,
        memberId: (raw.profile_id as string | null) ?? null,
        memberName,
        productId: (raw.product_id as string | null) ?? null,
        productName: partName,
        amount:
          paidWhere === "online"
            ? Number(product?.price_zar ?? 0) || 0
            : paidWhere === "comp"
              ? 0
              : paid,
        paymentMethod: paidWhere === "online" ? "yoco" : "manual",
        yocoPaymentId: yoco,
        refundedAt: (raw.refunded_at as string | null) ?? null,
        refundReason: (raw.refund_reason as string | null) ?? null,
        creditIds: [String(raw.id)],
        paidWhere,
        note: (raw.payment_note as string | null) ?? null,
      });
    }

    // Upgrades to Access to: Longkloof & Green Point done in the dashboard.
    const { data: upgradeData } = await upgradesPromise;
    for (const u of (upgradeData ?? []) as Record<string, unknown>[]) {
      const profile = (Array.isArray(u.profile) ? u.profile[0] : u.profile) as
        | { first_name?: string; last_name?: string }
        | null;
      const where = String(u.paid_where);
      groups.set(`upgrade|${u.id}`, {
        id: `upgrade-${u.id}`,
        date: String(u.created_at),
        memberId: (u.profile_id as string | null) ?? null,
        memberName: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || "—",
        productId: null,
        productName: `Upgrade: Longkloof & Green Point${u.product_name ? ` (${u.product_name})` : ""}`,
        amount: Number(u.amount_zar ?? 0) || 0,
        paymentMethod: "manual",
        yocoPaymentId: null,
        refundedAt: null,
        refundReason: null,
        creditIds: [],
        paidWhere: where === "green_point" ? "green_point" : where === "studio" ? "studio" : "comp",
        note: (u.reference as string | null) ?? null,
      });
    }

    const mapped: TxRow[] = [...groups.values()];

    setRows(mapped);

    const today = jhbDayBoundsAt(0);
    const weekStart = jhbDayBoundsAt(6);

    const sumIn = (startIso: string, endIso: string) => {
      const online = mapped
        .filter((r) => (isRealOnlineRevenue(r) || isCounterRevenue(r)) && r.date >= startIso && r.date <= endIso)
        .reduce((acc, r) => acc + r.amount, 0);
      const offline = offlineRows
        .filter((r) => r.occurred_at >= startIso && r.occurred_at <= endIso)
        .reduce((acc, r) => acc + (Number(r.amount_zar) || 0), 0);
      return online + offline;
    };

    setRevenueToday(sumIn(today.start, today.end));
    setRevenueWeek(sumIn(weekStart.start, today.end));
    setRevenueMonth(sumIn(monthStart.start, today.end));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSorted = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (ql) {
        const hay =
          `${r.memberName} ${r.productName} ${r.yocoPaymentId ?? ""} ${yocoCheckoutId(r.yocoPaymentId) ?? ""} ${yocoReferenceId(r.yocoPaymentId) ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (methodFilter !== "all" && r.paidWhere !== methodFilter) return false;
      if (dateFrom && r.date < new Date(dateFrom).toISOString()) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (r.date > end.toISOString()) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "date_asc":
          return a.date.localeCompare(b.date);
        case "amount_desc":
          return b.amount - a.amount;
        case "amount_asc":
          return a.amount - b.amount;
        case "name_asc":
          return a.memberName.localeCompare(b.memberName);
        case "date_desc":
        default:
          return b.date.localeCompare(a.date);
      }
    });
    return out;
  }, [rows, q, methodFilter, dateFrom, dateTo, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, methodFilter, dateFrom, dateTo, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openRefund = (row: TxRow) => {
    setRefundTarget(row);
    setRefundReason("");
  };

  const closeRefund = () => {
    if (refundBusy) return;
    setRefundTarget(null);
    setRefundReason("");
  };

  const processRefund = async () => {
    if (!refundTarget) return;
    setRefundBusy(true);
    try {
      const result = refundTarget.yocoPaymentId
        ? await refundYocoCredit({
            userCreditId: refundTarget.id,
            reason: refundReason.trim() || undefined,
          })
        : (await markManualCreditRefunded({
            userCreditId: refundTarget.id,
            amountZar: refundTarget.amount,
            reason: refundReason.trim() || undefined,
          }),
          { yocoRefundId: null, amountZar: refundTarget.amount });
      // The other parts of the same pack are marked refunded too (the money is only refunded once).
      for (const otherId of refundTarget.creditIds.filter((cid) => cid !== refundTarget.id)) {
        await markManualCreditRefunded({
          userCreditId: otherId,
          amountZar: 0,
          reason: refundReason.trim() || "refunded_with_pack",
        }).catch(() => undefined);
      }

      const at = new Date().toISOString();
      setRows((prev) =>
        prev.map((r) =>
          r.id === refundTarget.id
            ? {
                ...r,
                refundedAt: at,
                refundReason: refundReason.trim() || "admin_refund",
              }
            : r,
        ),
      );
      toast.success(
        refundTarget.yocoPaymentId
          ? `Refunded R${result.amountZar.toLocaleString("en-ZA")} via Yoco.`
          : "Marked as refunded.",
      );
      setRefundTarget(null);
      setRefundReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setRefundBusy(false);
    }
  };

  const exportCsv = () => {
    const header = [
      "Date",
      "Buyer",
      "Product",
      "Amount (ZAR)",
      "Payment method",
      "Yoco checkout ID (Online Reference)",
      "Yoco reference ID",
    ];
    const body = filteredSorted.map((r) => [
      formatDate(r.date),
      r.memberName,
      r.productName,
      r.amount.toString(),
      PAID_WHERE_LABEL[r.paidWhere],
      yocoCheckoutId(r.yocoPaymentId) ?? "",
      yocoReferenceId(r.yocoPaymentId) ?? "",
    ]);
    downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        description={
          loading
            ? "Loading…"
            : `${filteredSorted.length} transactions · buyer, product, and Yoco checkout ID for every online sale`
        }
        actions={
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={exportCsv}
            disabled={loading || filteredSorted.length === 0}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Revenue today" value={formatRand(revenueToday)} />
        <StatCard label="Revenue this week" value={formatRand(revenueWeek)} />
        <StatCard label="Revenue this month" value={formatRand(revenueMonth)} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search buyer, product, or checkout ID…"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Paid anywhere</SelectItem>
            <SelectItem value="online">Online (Yoco)</SelectItem>
            <SelectItem value="green_point">Paid at De Waterkant</SelectItem>
            <SelectItem value="studio">Paid at Longkloof desk</SelectItem>
            <SelectItem value="comp">Comp / assigned</SelectItem>
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
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">Newest first</SelectItem>
            <SelectItem value="date_asc">Oldest first</SelectItem>
            <SelectItem value="amount_desc">Amount: high to low</SelectItem>
            <SelectItem value="amount_asc">Amount: low to high</SelectItem>
            <SelectItem value="name_asc">Member A–Z</SelectItem>
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
            <Receipt className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">No transactions match your filters.</p>
          </div>
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Buyer</th>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Checkout ID</th>
                <th className="px-5 py-3 font-medium">Reference ID</th>
                <th className="px-5 py-3 font-medium">Method</th>
                <th className="px-5 py-3 font-medium text-right">Refund</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const checkoutId = yocoCheckoutId(r.yocoPaymentId);
                const referenceId = yocoReferenceId(r.yocoPaymentId);
                const hasYocoIds = isRecordedYocoPayment(r.yocoPaymentId);
                return (
                <tr
                  key={r.id}
                  className={`border-t border-border ${r.refundedAt ? "bg-muted/30" : ""}`}
                >
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                    {formatDate(r.date)}
                  </td>
                  <td className="max-w-[160px] px-5 py-3">
                    <p className="truncate font-semibold text-foreground">{r.memberName}</p>
                  </td>
                  <td className="max-w-[200px] px-5 py-3">
                    <p className="truncate font-medium text-foreground">{r.productName}</p>
                  </td>
                  <td
                    className={`whitespace-nowrap px-5 py-3 text-base font-semibold tabular-nums ${r.refundedAt ? "text-muted-foreground line-through" : ""}`}
                  >
                    {formatRand(r.amount)}
                  </td>
                  <td className="max-w-[200px] px-5 py-3">
                    {checkoutId ? (
                      <CopyableYocoId
                        id={checkoutId}
                        label="Checkout ID"
                        csvColumn="Online Reference"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-5 py-3">
                    {referenceId ? (
                      <div className="flex flex-col gap-1">
                        <CopyableYocoId
                          id={referenceId}
                          label="Reference ID"
                          csvColumn="Reference"
                        />
                        <a
                          href={`https://portal.yoco.com/payments/${referenceId}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-[#a3b693] hover:underline"
                        >
                          View in Yoco
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ) : hasYocoIds && checkoutId ? (
                      <span className="text-xs text-muted-foreground">After payment</span>
                    ) : r.paymentMethod === "yoco" || isYocoCheckoutPlaceholder(r.yocoPaymentId) ? (
                      <span className="text-xs text-amber-800">Not captured</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex rounded-full bg-[#e8efe3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]">
                      {PAID_WHERE_LABEL[r.paidWhere]}
                    </span>
                    {r.note ? <p className="mt-1 text-[10px] text-muted-foreground">{r.note}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {r.refundedAt ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive"
                        title={r.refundReason ?? undefined}
                      >
                        Refunded
                      </span>
                    ) : r.creditIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        onClick={() => openRefund(r)}
                      >
                        <RotateCcw className="h-3 w-3" /> Refund
                      </Button>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
      </div>

      <AlertDialog
        open={!!refundTarget}
        onOpenChange={(o) => {
          if (!o) closeRefund();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {refundTarget?.yocoPaymentId ? "Refund this Yoco payment?" : "Mark as refunded?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget
                ? refundTarget.yocoPaymentId
                  ? `This will refund ${formatRand(refundTarget.amount)} to ${refundTarget.memberName} via Yoco and zero out remaining credits on this pass.`
                  : `This wasn't a Yoco payment, so nothing is sent to Yoco. The pass will be marked refunded (${formatRand(refundTarget.amount)}) and remaining credits zeroed for record-keeping.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="refund-reason">
              Reason (optional)
            </label>
            <Textarea
              id="refund-reason"
              rows={3}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. member requested cancellation, duplicate charge…"
              disabled={refundBusy}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={refundBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void processRefund();
              }}
              disabled={refundBusy}
            >
              {refundBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Process refund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
  );
}
