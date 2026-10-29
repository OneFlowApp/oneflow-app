import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type FeeRow = {
  id: string;
  kind: "late_cancel" | "no_show";
  amount_zar: number;
  status: "unpaid" | "paid" | "waived" | "expired";
  credit_held: boolean;
  blocks_booking: boolean;
  due_by: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<FeeRow["status"], string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  waived: "Waived",
  expired: "Not paid in time, credit used",
};

/** Late cancel and no-show fees for one member, with Waive for staff who may waive. */
export function MemberFeesSection({ profileId, canWaive }: { profileId: string; canWaive: boolean }) {
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [waivingId, setWaivingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("member_fees")
      .select("id, kind, amount_zar, status, credit_held, blocks_booking, due_by, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    setLoading(false);
    if (error) {
      console.warn("member fees", error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as FeeRow[]);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const waive = async (id: string) => {
    setWaivingId(id);
    const { error } = await supabase.rpc("waive_member_fee", { p_fee_id: id });
    setWaivingId(null);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not waive this fee"));
      return;
    }
    toast.success("Fee waived");
    await load();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-3 font-display text-lg font-semibold">Fees</h4>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading fees" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No late cancel or no-show fees.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {f.kind === "no_show" ? "No-show" : "Late cancellation"} · R{Math.round(Number(f.amount_zar))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(f.created_at).toLocaleDateString("en-ZA")} · {STATUS_LABEL[f.status]}
                  {f.status === "unpaid" && f.blocks_booking ? " · booking blocked" : ""}
                  {f.status === "unpaid" && f.credit_held ? " · credit held" : ""}
                </p>
              </div>
              {canWaive && f.status === "unpaid" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={waivingId === f.id}
                  onClick={() => void waive(f.id)}
                >
                  {waivingId === f.id ? "Waiving…" : "Waive"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
