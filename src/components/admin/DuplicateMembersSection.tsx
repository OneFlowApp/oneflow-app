import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  created_at: string | null;
};

type Pair = { a: Person; b: Person; reason: string };

function nameOf(p: Person): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "Member";
}

function joined(p: Person): string {
  return p.created_at
    ? new Date(p.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

/** "Possible duplicates" on the Customers page: pairs of accounts that look like the same person, with Merge. */
export function DuplicateMembersSection({
  refreshKey,
  onMerged,
}: {
  refreshKey: number;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [mergePair, setMergePair] = useState<Pair | null>(null);
  const [keepId, setKeepId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("find_possible_duplicates");
    if (error) {
      console.error("duplicates", error);
      setPairs([]);
      return;
    }
    const rows = (data ?? []) as { keep_id: string; other_id: string; reason: string }[];
    const ids = [...new Set(rows.flatMap((r) => [r.keep_id, r.other_id]))];
    if (ids.length === 0) {
      setPairs([]);
      return;
    }
    const { data: people } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone, role, created_at")
      .in("id", ids);
    const byId = new Map(((people ?? []) as Person[]).map((p) => [p.id, p]));
    setPairs(
      rows
        .map((r) => ({ a: byId.get(r.keep_id), b: byId.get(r.other_id), reason: r.reason }))
        .filter((x): x is Pair => Boolean(x.a && x.b)),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const startMerge = (pair: Pair) => {
    setMergePair(pair);
    // Default: keep the staff account if there is one, otherwise the older account.
    const staffA = (pair.a.role ?? "customer") !== "customer";
    const staffB = (pair.b.role ?? "customer") !== "customer";
    setKeepId(staffB && !staffA ? pair.b.id : pair.a.id);
  };

  const confirmMerge = async () => {
    if (!mergePair || !keepId) return;
    const removeId = keepId === mergePair.a.id ? mergePair.b.id : mergePair.a.id;
    setBusy(true);
    const { error } = await supabase.rpc("merge_members", { p_keep: keepId, p_remove: removeId });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not merge these accounts"));
      return;
    }
    toast.success("Accounts merged. Packs, bookings and Flow Points are now on one account.");
    setMergePair(null);
    await load();
    onMerged();
  };

  const count = pairs?.length ?? 0;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden />
        Possible duplicates
        {count > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-3">
          {pairs === null ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : pairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No possible duplicates found.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pairs.map((p) => (
                <li key={`${p.a.id}-${p.b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {nameOf(p.a)} · {nameOf(p.b)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.a.email} · {p.b.email} · {p.reason}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => startMerge(p)}>
                    Merge
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <Dialog open={mergePair !== null} onOpenChange={(o) => !busy && !o && setMergePair(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge these accounts?</DialogTitle>
            <DialogDescription>
              Choose the account to keep. Packs, bookings, fees, badges and Flow Points move onto it.
              The other account is deleted and listed under Deleted members.
            </DialogDescription>
          </DialogHeader>
          {mergePair ? (
            <div className="space-y-2">
              {[mergePair.a, mergePair.b].map((p) => (
                <label
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                    keepId === p.id ? "border-[#a3b693] bg-[#e8efe3]/50" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="keep"
                    className="mt-1"
                    checked={keepId === p.id}
                    onChange={() => setKeepId(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">
                      Keep {nameOf(p)}
                      {(p.role ?? "customer") !== "customer" ? ` (${p.role})` : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.email || "No email"} · {p.phone || "No phone"} · joined {joined(p)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMergePair(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !keepId}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              onClick={() => void confirmMerge()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Merge accounts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
