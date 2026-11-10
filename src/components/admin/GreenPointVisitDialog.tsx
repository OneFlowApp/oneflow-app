import { useEffect, useState } from "react";
import { Loader2, MapPin, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

type Person = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type Balance = {
  credit_id: string;
  pack: string;
  is_unlimited: boolean;
  credits_total: number | null;
  credits_remaining: number | null;
  expires_at: string | null;
  visits_used: number;
};

function nameOf(p: Person) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "Member";
}

/**
 * Front desk at Green Point (Mindbody): find a member with "Access to: Longkloof & Green Point"
 * and tick off one session. Takes one credit from that pack (unlimited packs just log the visit).
 */
export function GreenPointVisitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setPeople([]);
      setPerson(null);
      setBalances(null);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (person || term.length < 2) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const { data } = await supabase
        .from("member_directory")
        .select("id, first_name, last_name, avatar_url")
        .or(`first_name.ilike.${like},last_name.ilike.${like}`)
        .limit(12);
      if (cancelled) return;
      setPeople((data ?? []) as Person[]);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, person]);

  const loadBalances = async (p: Person) => {
    setBalances(null);
    const { data, error } = await supabase.rpc("green_point_balances", { p_profile_id: p.id });
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load this member's packs"));
      setBalances([]);
      return;
    }
    setBalances((data ?? []) as Balance[]);
  };

  const pick = (p: Person) => {
    setPerson(p);
    void loadBalances(p);
  };

  const tick = async (b: Balance) => {
    if (!person) return;
    setBusyId(b.credit_id);
    const { data, error } = await supabase.rpc("use_credit_at_green_point", { p_credit_id: b.credit_id });
    setBusyId(null);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not tick off this session"));
      return;
    }
    toast.success(
      b.is_unlimited
        ? `Green Point visit recorded for ${nameOf(person)}`
        : `Session ticked off. ${typeof data === "number" ? data : "?"} left on ${b.pack}.`,
    );
    await loadBalances(person);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-[#4a6b3c]" aria-hidden />
            Green Point visit
          </DialogTitle>
          <DialogDescription>
            For members with Access to: Longkloof &amp; Green Point. Check their card, then tick off
            the session from the right pack.
          </DialogDescription>
        </DialogHeader>

        {!person ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by first or last name"
                className="pl-9"
              />
            </div>
            {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <ul className="divide-y divide-border rounded-lg border border-border">
              {people.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {(p.first_name ?? "?").charAt(0)}
                      </span>
                    )}
                    {nameOf(p)}
                  </button>
                </li>
              ))}
              {q.trim().length >= 2 && !searching && people.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">No members found.</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{nameOf(person)}</p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPerson(null)}>
                Change
              </Button>
            </div>
            {balances === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : balances.length === 0 ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                No Longkloof &amp; Green Point packs. This member&apos;s packs are for Longkloof only.
              </p>
            ) : (
              <ul className="space-y-2">
                {balances.map((b) => (
                  <li key={b.credit_id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <Star className="h-3.5 w-3.5 shrink-0 fill-[#d4af37] text-[#d4af37]" aria-hidden />
                          {b.pack}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {b.is_unlimited ? "Unlimited" : `${b.credits_remaining ?? 0} of ${b.credits_total ?? 0} left`}
                          {b.visits_used > 0 ? ` · ${b.visits_used} used at Green Point` : ""}
                          {b.expires_at ? ` · until ${new Date(b.expires_at).toLocaleDateString("en-ZA")}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyId !== null}
                        className={cn("shrink-0 bg-[#a3b693] text-white hover:bg-[#8fa67d]")}
                        onClick={() => void tick(b)}
                      >
                        {busyId === b.credit_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tick off 1"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
