import { useCallback, useEffect, useState } from "react";
import { Gift, Leaf } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { formatRewardDate } from "@/lib/gameboard";

type Row = { id: string; kind: string; label: string; expires_at: string | null; gift_claimed_by: string | null };

/** Staff: a member's open Gameboard rewards. Sachets are marked collected at the desk. */
export function GameboardRewardsSection({ profileId }: { profileId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("gameboard_plays")
      .select("id, kind, label, expires_at, gift_claimed_by")
      .eq("profile_id", profileId)
      .eq("status", "won")
      .gt("expires_at", new Date().toISOString())
      .order("expires_at");
    setRows((data ?? []) as Row[]);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows.length === 0) return null;

  const collect = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("use_gameboard_reward", { p_play_id: r.id });
    setBusy(null);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not mark as collected"));
      return;
    }
    toast.success(`${r.label} marked as collected`);
    void load();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-1 font-display text-lg font-semibold">Gameboard rewards</h4>
      <p className="mb-3 text-sm text-muted-foreground">
        Won on the weekly gameboard. Gifts are shared by the member; sachets are collected here at the desk.
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            {r.kind === "gift" ? (
              <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <Leaf className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.label}</span>
              <span className="block text-xs text-muted-foreground">Expires {formatRewardDate(r.expires_at)}</span>
            </span>
            {r.kind === "sachet" ? (
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void collect(r)}
                className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy === r.id ? "Saving…" : "Mark collected"}
              </button>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">Not claimed yet</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
