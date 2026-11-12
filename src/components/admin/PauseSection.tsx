import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type PauseRow = {
  id: string;
  product_name: string | null;
  starts_on: string;
  ends_on: string;
  weeks: number;
  fee_zar: number;
  status: string;
  paid_at: string | null;
};

function fmt(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/** Customer profile: the member's pass pauses, with Undo for Director and Management. */
export function PauseSection({ profileId, canUndo }: { profileId: string; canUndo: boolean }) {
  const [rows, setRows] = useState<PauseRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("credit_pauses")
      .select("id, product_name, starts_on, ends_on, weeks, fee_zar, status, paid_at")
      .eq("profile_id", profileId)
      .neq("status", "pending_payment")
      .order("starts_on", { ascending: false });
    setRows((data ?? []) as PauseRow[]);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows.length === 0) return null;

  const undo = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("cancel_credit_pause", { p_pause_id: id });
    setBusy(null);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not undo the pause"));
      return;
    }
    toast.success("Pause undone. The pass end date has moved back.");
    await load();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-2 font-display text-lg font-semibold">Pauses</h4>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span>
              <span className="font-semibold">{r.product_name ?? "Pass"}</span> · {fmt(r.starts_on)} to {fmt(r.ends_on)} (
              {r.weeks} wk{r.weeks === 1 ? "" : "s"}, R{Number(r.fee_zar).toFixed(0)})
              {r.status === "cancelled" ? <span className="text-muted-foreground"> · undone</span> : null}
            </span>
            {canUndo && r.status === "active" ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void undo(r.id)}>
                Undo pause
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Undoing a pause doesn't refund the fee. Refund in Yoco if needed.</p>
    </section>
  );
}
