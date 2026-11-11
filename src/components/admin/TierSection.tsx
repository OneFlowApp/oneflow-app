import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type TierInfo = {
  tier: string;
  base_tier: string;
  classes_lifetime: number;
  classes_12m: number;
  dropped: boolean;
  restore_needed: number;
  last_class: string | null;
  keep_by: string | null;
  paused_until: string | null;
};

const NAME: Record<string, string> = {
  member: "Member",
  green: "Green",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

function fmt(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

/** Customer profile: card tier, with a pause on the 60 day rule for Director and Management. */
export function TierSection({ profileId, canPause }: { profileId: string; canPause: boolean }) {
  const [info, setInfo] = useState<TierInfo | null>(null);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("member_tier", { p_profile_id: profileId });
    if (error) {
      console.warn("member tier", error.message);
      return;
    }
    const row = ((Array.isArray(data) ? data[0] : data) ?? null) as TierInfo | null;
    setInfo(row);
    setUntil(row?.paused_until ?? "");
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!info) return null;

  const save = async (value: string | null) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_tier_pause", { p_profile_id: profileId, p_until: value });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not update the pause"));
      return;
    }
    toast.success(value ? `Tier on hold until ${fmt(value)}` : "Pause removed");
    await load();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-2 font-display text-lg font-semibold">Card tier</h4>
      <p className="text-sm">
        <span className="font-semibold">{NAME[info.tier] ?? info.tier}</span>
        {info.dropped ? ` (dropped from ${NAME[info.base_tier]}, ${info.restore_needed} more to restore)` : ""} ·{" "}
        {info.classes_lifetime} classes in total · {info.classes_12m} in the last 12 months
      </p>
      <p className="text-xs text-muted-foreground">
        {info.last_class ? `Last class ${fmt(info.last_class)}` : "No classes attended yet"}
        {info.paused_until
          ? ` · on hold until ${fmt(info.paused_until)}`
          : info.keep_by && info.tier !== "member"
            ? ` · needs a class by ${fmt(info.keep_by)}`
            : ""}
      </p>
      {canPause ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Hold tier until (injury, pregnancy, travel)
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 w-44" />
          </label>
          <Button type="button" size="sm" variant="outline" disabled={busy || !until} onClick={() => void save(until)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save hold
          </Button>
          {info.paused_until ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Remove hold
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
