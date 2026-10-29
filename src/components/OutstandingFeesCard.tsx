import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUser } from "@/lib/supabase";

type FeeRow = {
  id: string;
  kind: "late_cancel" | "no_show";
  amount_zar: number;
  credit_held: boolean;
  blocks_booking: boolean;
  due_by: string | null;
  created_at: string;
};

function formatZar(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shows a member's unpaid late cancel and no-show fees with a button to pay them.
 * Renders nothing when there is nothing owed.
 */
export function OutstandingFeesCard() {
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    const user = await getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("member_fees")
      .select("id, kind, amount_zar, credit_held, blocks_booking, due_by, created_at")
      .eq("profile_id", user.id)
      .eq("status", "unpaid")
      .order("created_at", { ascending: true });
    if (error) {
      // Table not there yet (before the database update) or no access: show nothing.
      console.warn("outstanding fees", error.message);
      return;
    }
    setFees((data ?? []) as FeeRow[]);
  }, []);

  useEffect(() => {
    void load();
    // Back from paying: the payment can take a few seconds to confirm, so check again briefly.
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("fees_paid")) return;
    let tries = 0;
    const t = window.setInterval(() => {
      tries += 1;
      void load();
      if (tries >= 10) window.clearInterval(t);
    }, 3000);
    return () => window.clearInterval(t);
  }, [load]);

  if (fees.length === 0) return null;

  const total = fees.reduce((s, f) => s + Number(f.amount_zar || 0), 0);
  const blocking = fees.some((f) => f.blocks_booking);
  const held = fees.filter((f) => f.credit_held && f.due_by);
  const firstDue = held
    .map((f) => f.due_by as string)
    .sort()[0];

  const pay = async () => {
    const user = await getUser();
    if (!user) return;
    setPaying(true);
    const origin = window.location.origin;
    const { data, error } = await supabase.functions.invoke("yoco-checkout", {
      body: {
        type: "fees",
        profile_id: user.id,
        success_url: `${origin}/me?fees_paid=1`,
        cancel_url: `${origin}/me`,
      },
    });
    setPaying(false);
    const redirect =
      (data as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (data as { redirect_url?: string } | null)?.redirect_url;
    if (error || !redirect) {
      toast.error(error?.message ?? "Could not start payment");
      return;
    }
    window.location.href = redirect;
  };

  return (
    <div className="mb-4 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-50">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-semibold">Outstanding fees: {formatZar(total)}</p>
          {fees.map((f) => (
            <p key={f.id} className="text-xs">
              {f.kind === "no_show" ? "No-show fee" : "Late cancellation fee"} · {formatZar(f.amount_zar)}
            </p>
          ))}
          {blocking ? (
            <p className="text-xs font-medium">You can book again once this is paid.</p>
          ) : null}
          {firstDue ? (
            <p className="text-xs font-medium">
              Pay by {formatDue(firstDue)} to keep your credit. After that the credit is used.
            </p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void pay()}
        disabled={paying}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#a3b693] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {paying ? "Opening payment…" : `Pay ${formatZar(total)} now`}
      </button>
    </div>
  );
}
