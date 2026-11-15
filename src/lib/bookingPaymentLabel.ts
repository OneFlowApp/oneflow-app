import type { SupabaseClient } from "@supabase/supabase-js";

export type BookingCreditInfo = {
  product_name: string | null;
  credits_total: number | null;
  credits_remaining: number | null;
  is_unlimited: boolean | null;
};

/** The pack each booking used, looked up in one go. */
export async function fetchBookingCredits(
  supabase: SupabaseClient,
  creditIds: (string | null | undefined)[],
): Promise<Map<string, BookingCreditInfo>> {
  const ids = [...new Set(creditIds.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, BookingCreditInfo>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("user_credits")
      .select("id, product_name, credits_total, credits_remaining, is_unlimited")
      .in("id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as (BookingCreditInfo & { id: string })[]) map.set(r.id, r);
  }
  return map;
}

/** "Single class · Reformer Drop In", "Package · Reformer Kloof 8 (5 left)", "Free class", "Flow Points". */
export function bookingPaymentLabel(paymentMethod: string | null, credit: BookingCreditInfo | null | undefined): string {
  const m = String(paymentMethod ?? "").toLowerCase();
  if (m === "free") return "Free class";
  if (m === "flow_points") return "Flow Points";
  if (credit) {
    const name = credit.product_name?.trim() || "Pack";
    if (credit.is_unlimited) return `Package · ${name} (unlimited)`;
    if (Number(credit.credits_total) === 1) return `Single class · ${name}`;
    const left = credit.credits_remaining;
    return `Package · ${name}${left != null ? ` (${left} left)` : ""}`;
  }
  if (m === "credit") return "Pack credit";
  return m ? m.replace(/_/g, " ") : "—";
}
