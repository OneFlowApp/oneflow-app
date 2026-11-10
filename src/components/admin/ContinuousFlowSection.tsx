import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type Status = {
  product_name: string | null;
  active_until: string | null;
  eligible: boolean;
  blocked_until: string | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

/** Customer profile: Continuous Flow status, with Restore for Director and Management. */
export function ContinuousFlowSection({ profileId, canRestore }: { profileId: string; canRestore: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("continuous_flow_status", { p_profile_id: profileId });
    if (error) {
      console.warn("continuous flow status", error.message);
      return;
    }
    setStatus(((Array.isArray(data) ? data[0] : data) ?? null) as Status | null);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status || (!status.active_until && status.eligible)) return null;

  const restore = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("restore_continuous_flow", { p_profile_id: profileId });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not restore Continuous Flow"));
      return;
    }
    toast.success("Continuous Flow restored. They can buy it again now.");
    await load();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-2 font-display text-lg font-semibold">Continuous Flow</h4>
      {status.eligible ? (
        <p className="text-sm text-muted-foreground">
          {status.product_name ?? "Continuous Flow"}
          {status.active_until
            ? new Date(status.active_until).getTime() > Date.now()
              ? ` · runs until ${fmt(status.active_until)}`
              : ` · ended ${fmt(status.active_until)}, renew within a day to keep it`
            : ""}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-semibold">Paused</span> after a break of more than a day
            {status.active_until ? ` (ended ${fmt(status.active_until)})` : ""}.
            {status.blocked_until ? ` Available again from ${fmt(status.blocked_until)}.` : ""}
          </p>
          {canRestore ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void restore()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Restore Continuous Flow
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
