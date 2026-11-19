import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Gift, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { formatRewardDate } from "@/lib/gameboard";
import { cn } from "@/lib/utils";

type Search = { bought?: string };

export const Route = createFileRoute("/gifts")({
  head: () => ({ meta: [{ title: "Your gifts — One Flow" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    bought: typeof s.bought === "string" ? s.bought : undefined,
  }),
  component: GiftsPage,
});

type PackGift = {
  id: string;
  token: string;
  product_name: string | null;
  amount_paid_zar: number | null;
  recipient_name: string | null;
  status: "open" | "claimed" | "expired" | "refunded";
  paid_at: string;
  claim_by: string | null;
  claimed_at: string | null;
  claimed_by_name: string | null;
};

async function shareLink(g: PackGift) {
  const url = `${window.location.origin}/pack-gift/${g.token}`;
  const text = `I bought you ${g.product_name ?? "a pass"} at One Flow. Claim it here:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "A gift from One Flow", text, url });
      return;
    } catch {
      // cancelled: copy instead
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  toast.success("Gift link copied. Send it to your friend!");
}

function GiftsPage() {
  const { bought } = Route.useSearch();
  const [gifts, setGifts] = useState<PackGift[] | null>(null);
  const [tries, setTries] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_pack_gifts");
    setGifts((data ?? []) as PackGift[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Just paid: the payment confirmation can take a few seconds to arrive.
  const newest = gifts?.[0];
  const waiting = Boolean(bought) && (!newest || Date.now() - new Date(newest.paid_at).getTime() > 10 * 60_000);
  useEffect(() => {
    if (!waiting || tries >= 10) return;
    const t = window.setTimeout(() => {
      setTries((n) => n + 1);
      void load();
    }, 3000);
    return () => window.clearTimeout(t);
  }, [waiting, tries, load]);

  return (
    <AppShell>
      <header className="safe-top flex items-center gap-2 px-5 pt-3 pb-3">
        <Link to="/pricing" className="-ml-2 rounded-full p-2 text-muted-foreground" aria-label="Back to passes">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-semibold">Your gifts</h1>
      </header>
      <main className="flex-1 space-y-3 px-5 pb-8">
        {bought && !waiting && newest?.status === "open" ? (
          <div className="rounded-3xl border border-[#d4af37]/50 bg-[#d4af37]/10 p-5 text-center">
            <Gift className="mx-auto h-8 w-8 text-[#8a6d12]" aria-hidden />
            <p className="mt-2 font-display text-lg font-semibold">Thank you! Your gift is ready</p>
            <p className="mt-1 text-sm text-muted-foreground">Send the link to your friend so they can claim it.</p>
            <button
              type="button"
              onClick={() => void shareLink(newest)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Share2 className="h-4 w-4" aria-hidden /> Share gift
            </button>
          </div>
        ) : null}

        {gifts === null || (waiting && tries < 10) ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            {waiting ? "Confirming your payment…" : null}
          </div>
        ) : gifts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {waiting
              ? "Your payment is still being confirmed. Check back in a minute, or contact the studio if your gift doesn't appear."
              : "No gifts yet. Tap “Buy as a gift for a friend” under any pass."}
          </p>
        ) : (
          <ul className="space-y-2">
            {gifts.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                <Gift className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {g.product_name}
                    {g.recipient_name ? <span className="font-normal"> for {g.recipient_name}</span> : null}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      g.status === "claimed" ? "text-[#5f7a52]" : "text-muted-foreground",
                    )}
                  >
                    {g.status === "claimed"
                      ? `Claimed${g.claimed_by_name ? ` by ${g.claimed_by_name}` : ""} on ${formatRewardDate(g.claimed_at)}`
                      : g.status === "open"
                        ? `Not claimed yet · claim by ${formatRewardDate(g.claim_by)}`
                        : g.status === "expired"
                          ? "Not claimed in time. Please contact the studio"
                          : "Refunded"}
                  </p>
                </div>
                {g.status === "open" ? (
                  <button
                    type="button"
                    onClick={() => void shareLink(g)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
