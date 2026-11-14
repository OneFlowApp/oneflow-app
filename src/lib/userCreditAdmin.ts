import {
  bundleComponentSortKey,
  creditRowBelongsToBundle,
  resolveBundlePackageTitle,
} from "@/lib/multiCreditProducts";

/** Format ISO timestamp for `<input type="date">` (UTC calendar date). */
export function creditExpiresToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse date input to end-of-day UTC ISO (or null if empty). */
export function dateInputToCreditExpires(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Parse date input to start-of-day UTC ISO (or null if empty). */
export function dateInputToCreditPurchased(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function todayCreditDateInput(): string {
  return creditExpiresToDateInput(new Date().toISOString());
}

/** Add calendar days to a date input value; returns another `YYYY-MM-DD` string. */
export function addDaysToCreditDateInput(startDateInput: string, days: number): string {
  const startIso = dateInputToCreditPurchased(startDateInput);
  if (!startIso || !Number.isFinite(days) || days < 1) return "";
  const d = new Date(startIso);
  d.setUTCDate(d.getUTCDate() + Math.trunc(days));
  return creditExpiresToDateInput(d.toISOString());
}

export function resolveAssignCreditPeriod(
  startDateInput: string,
  endDateInput: string,
): { ok: true; purchasedAt: string; expiresAt: string | null } | { ok: false; message: string } {
  const purchasedAt =
    dateInputToCreditPurchased(startDateInput) ?? new Date().toISOString();
  const expiresAt = dateInputToCreditExpires(endDateInput);
  if (startDateInput.trim() && endDateInput.trim() && expiresAt) {
    const startMs = new Date(purchasedAt).getTime();
    const endMs = new Date(expiresAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
      return { ok: false, message: "End date must be on or after the start date." };
    }
  }
  return { ok: true, purchasedAt, expiresAt };
}

export const UNLIMITED_CREDIT_DISPLAY = 999;

/** Columns loaded for admin profile credit management. */
export const USER_CREDIT_ADMIN_SELECT =
  "id, product_id, product_name, category, credits_remaining, credits_total, is_unlimited, expires_at, mat_access, towel_access, yoco_payment_id, created_at, access_scope";

export type AdminCreditRow = {
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
  yoco_payment_id?: string | null;
  created_at?: string | null;
  access_scope?: string | null;
};

export type CreditBundleDisplayGroup = {
  productId: string;
  title: string;
  rows: AdminCreditRow[];
};

export type CreditDisplayEntry =
  | { kind: "bundle"; group: CreditBundleDisplayGroup }
  | { kind: "standalone"; row: AdminCreditRow };

export function partitionCreditsForDisplay(credits: AdminCreditRow[]): CreditDisplayEntry[] {
  const bundleMap = new Map<string, AdminCreditRow[]>();
  const standalone: AdminCreditRow[] = [];

  for (const row of credits) {
    if (creditRowBelongsToBundle(row)) {
      const pid = row.product_id!.trim();
      const list = bundleMap.get(pid) ?? [];
      list.push(row);
      bundleMap.set(pid, list);
    } else {
      standalone.push(row);
    }
  }

  const entries: CreditDisplayEntry[] = [];
  for (const [productId, rows] of bundleMap) {
    const sorted = [...rows].sort(
      (a, b) => bundleComponentSortKey(a) - bundleComponentSortKey(b),
    );
    entries.push({
      kind: "bundle",
      group: {
        productId,
        title: resolveBundlePackageTitle(productId, sorted),
        rows: sorted,
      },
    });
  }
  entries.sort((a, b) => {
    const ta = a.kind === "bundle" ? a.group.title : a.row.product_name ?? "";
    const tb = b.kind === "bundle" ? b.group.title : b.row.product_name ?? "";
    return ta.localeCompare(tb);
  });
  for (const row of standalone) {
    entries.push({ kind: "standalone", row });
  }
  return entries;
}
