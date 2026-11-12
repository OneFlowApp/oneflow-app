import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, PauseCircle, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { formatStudioDateShort } from "@/lib/timezone";

type CreditRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  credits_remaining: number | null;
  is_unlimited: boolean | null;
  expires_at: string | null;
  purchased_at: string | null;
  refunded_at?: string | null;
  access_scope?: string | null;
  mat_access?: boolean | null;
  towel_access?: boolean | null;
  product:
    | ProductJoin
    | ProductJoin[]
    | null;
};

type ProductJoin = {
  name: string | null;
  is_staff_only?: boolean | null;
  can_pause?: boolean | null;
  is_continuous?: boolean | null;
};

type PauseRow = {
  id: string;
  credit_id: string;
  starts_on: string;
  ends_on: string;
  status: string;
};

type PauseRules = { fee: number; minWeeks: number; maxWeeks: number };

type PassPart = { id: string; label: string; unlimited: boolean; remaining: number };

type Pass = {
  key: string;
  name: string;
  expiresAt: string | null;
  openAccess: boolean;
  matAndTowel: boolean;
  canPause: boolean;
  pause: PauseRow | null;
  parts: PassPart[];
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** "The Seeker - Wellzone" → "Wellzone"; a single-part pack keeps no extra label. */
function partLabel(rowName: string, packName: string): string {
  const n = rowName.trim();
  const p = packName.trim();
  if (p && n.toLowerCase().startsWith(`${p.toLowerCase()} - `)) return n.slice(p.length + 3).trim();
  if (n && n !== p) return n;
  return "";
}

function remainingLabel(part: PassPart): string {
  if (part.unlimited) return "Unlimited";
  return part.remaining === 1 ? "1 left" : `${part.remaining} left`;
}

/** Groups a member's credits into the packs they bought, by real pack name. */
function groupPasses(rows: CreditRow[], nowMs: number): Pass[] {
  const byKey = new Map<string, Pass>();
  for (const r of rows) {
    if (r.refunded_at) continue;
    if (r.expires_at && new Date(r.expires_at).getTime() <= nowMs) continue;
    const prod = one(r.product);
    const packName = (prod?.name ?? r.product_name ?? "Pass").trim();
    const key = `${r.product_id ?? packName}|${r.purchased_at ?? ""}`;
    let pass = byKey.get(key);
    if (!pass) {
      pass = {
        key,
        name: packName,
        expiresAt: r.expires_at,
        openAccess: r.access_scope === "open_access",
        matAndTowel: false,
        canPause: Boolean(prod?.can_pause) && !prod?.is_continuous,
        pause: null,
        parts: [],
      };
      byKey.set(key, pass);
    }
    if (r.mat_access || r.towel_access) pass.matAndTowel = true;
    if (r.access_scope === "open_access") pass.openAccess = true;
    pass.parts.push({
      id: r.id,
      label: partLabel(r.product_name ?? "", packName),
      unlimited: Boolean(r.is_unlimited),
      remaining: Math.max(0, Number(r.credits_remaining ?? 0) || 0),
    });
  }
  // Keep packs that still have something to use.
  return [...byKey.values()]
    .filter((p) => p.parts.some((x) => x.unlimited || x.remaining > 0))
    .sort((a, b) => (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"));
}

/** "Your passes": each active pack by its real name, with what is left on each part. */
function ymd(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function niceDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

export function MemberPassesPanel({ compact = false }: { compact?: boolean }) {
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [rules, setRules] = useState<PauseRules>({ fee: 300, minWeeks: 1, maxWeeks: 4 });
  const [pausing, setPausing] = useState<Pass | null>(null);

  const load = useCallback(async () => {
    const user = await getUser();
    if (!user) {
      setPasses([]);
      return;
    }
    const [{ data, error }, { data: pz }, { data: st }] = await Promise.all([
      supabase
        .from("user_credits")
        .select(
          "id, product_id, product_name, credits_remaining, is_unlimited, expires_at, purchased_at, refunded_at, access_scope, mat_access, towel_access, product:product_id ( name, is_staff_only, can_pause, is_continuous )",
        )
        .eq("profile_id", user.id),
      supabase
        .from("credit_pauses")
        .select("id, credit_id, starts_on, ends_on, status")
        .eq("profile_id", user.id)
        .eq("status", "active"),
      supabase.from("studio_settings").select("key, value").like("key", "pause_%"),
    ]);
    if (error) {
      console.error("passes", error);
      setPasses([]);
      return;
    }
    const grouped = groupPasses((data ?? []) as CreditRow[], Date.now());
    const pauses = (pz ?? []) as PauseRow[];
    for (const p of grouped) {
      p.pause = pauses.find((x) => p.parts.some((part) => part.id === x.credit_id)) ?? null;
    }
    setPasses(grouped);
    const v = Object.fromEntries(((st ?? []) as { key: string; value: string }[]).map((r) => [r.key, Number(r.value)]));
    setRules({
      fee: Number.isFinite(v.pause_fee_zar) ? v.pause_fee_zar : 300,
      minWeeks: v.pause_min_weeks > 0 ? v.pause_min_weeks : 1,
      maxWeeks: v.pause_max_weeks > 0 ? v.pause_max_weeks : 4,
    });
  }, []);

  useEffect(() => {
    void load();
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("pause_paid") === "1") {
        toast.success("Payment received. Your pass is paused.");
        url.searchParams.delete("pause_paid");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      /* ignore */
    }
  }, [load]);

  return (
    <div className={compact ? "space-y-2" : "rounded-2xl border border-border bg-card px-5 py-5"}>
      {!compact ? (
        <div className="mb-3 flex items-center gap-2">
          <Ticket className="h-4 w-4 text-[#a3b693]" />
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your passes
          </span>
        </div>
      ) : null}

      {passes === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : passes.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-3">
          <span className="text-sm text-muted-foreground">No active passes</span>
          <Link
            to="/pricing"
            className="rounded-full border border-[#a3b693] px-3 py-1 text-xs font-semibold text-[#a3b693] transition-opacity active:opacity-70"
          >
            Buy a pass
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {passes.map((p) => (
            <li key={p.key} className="rounded-xl border border-border bg-muted/20 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm font-semibold">{p.name}</span>
                {p.expiresAt ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    until {formatStudioDateShort(p.expiresAt, { year: false })}
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 space-y-0.5">
                {p.parts.map((part) => (
                  <li key={part.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{part.label || "Sessions"}</span>
                    <span className="font-medium text-[#4a6b3c]">{remainingLabel(part)}</span>
                  </li>
                ))}
              </ul>
              {p.pause ? (
                <p className="mt-1.5 text-xs font-medium text-[#4a6b3c]">
                  Paused {niceDate(p.pause.starts_on)} to {niceDate(p.pause.ends_on)}
                </p>
              ) : null}
              {p.openAccess || p.matAndTowel ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.openAccess ? (
                    <span className="rounded-full bg-[#e8efe3] px-2 py-0.5 text-[11px] font-semibold text-[#3d4f36]">
                      Access to: Longkloof &amp; Green Point
                    </span>
                  ) : null}
                  {p.matAndTowel ? (
                    <span className="rounded-full bg-[#e8efe3] px-2 py-0.5 text-[11px] font-semibold text-[#3d4f36]">
                      Mat & towel included
                    </span>
                  ) : null}
                </div>
              ) : null}
              {p.canPause && !p.pause && p.expiresAt ? (
                <button
                  type="button"
                  onClick={() => setPausing(p)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-opacity active:opacity-70"
                >
                  <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                  Pause this pass
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <PauseDialog pass={pausing} rules={rules} onClose={() => setPausing(null)} />
    </div>
  );
}

function PauseDialog({ pass, rules, onClose }: { pass: Pass | null; rules: PauseRules; onClose: () => void }) {
  const today = ymd(new Date());
  const [start, setStart] = useState(today);
  const [weeks, setWeeks] = useState(rules.minWeeks);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pass) {
      setStart(addDaysIso(today, 1));
      setWeeks(rules.minWeeks);
    }
  }, [pass, today, rules.minWeeks]);

  if (!pass) return null;
  const end = addDaysIso(start, weeks * 7 - 1);
  const newExpiry = pass.expiresAt ? new Date(new Date(pass.expiresAt).getTime() + weeks * 7 * 86_400_000) : null;
  const options = Array.from({ length: rules.maxWeeks - rules.minWeeks + 1 }, (_, i) => rules.minWeeks + i);
  const lastStart = pass.expiresAt ? ymd(new Date(pass.expiresAt)) : undefined;

  const confirm = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("request_credit_pause", {
      p_credit_id: pass.parts[0].id,
      p_starts_on: start,
      p_weeks: weeks,
    });
    if (error) {
      setBusy(false);
      toast.error(supabaseErrorMessage(error, "Could not pause this pass"));
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { pause_id: string; fee_zar: number } | null;
    if (!row) {
      setBusy(false);
      toast.error("Could not pause this pass");
      return;
    }
    if (!(Number(row.fee_zar) > 0)) {
      setBusy(false);
      toast.success("Your pass is paused");
      onClose();
      window.location.reload();
      return;
    }
    const origin = window.location.origin;
    const { data: checkout, error: payErr } = await supabase.functions.invoke("yoco-checkout", {
      body: {
        type: "pause",
        pause_id: row.pause_id,
        success_url: `${origin}/me?pause_paid=1`,
        cancel_url: `${origin}/me`,
      },
    });
    const redirect =
      (checkout as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (checkout as { redirect_url?: string } | null)?.redirect_url;
    if (payErr || !redirect) {
      setBusy(false);
      toast.error(payErr?.message ?? "Could not start payment");
      return;
    }
    window.location.href = redirect;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pause {pass.name}</DialogTitle>
          <DialogDescription>
            Pause for {rules.minWeeks} to {rules.maxWeeks} weeks, once per pass. Your end date moves out by the weeks
            you pause.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            Start date
            <input
              type="date"
              value={start}
              min={today}
              max={lastStart}
              onChange={(e) => setStart(e.target.value || today)}
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <div>
            <p className="text-sm font-medium">How long</p>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {options.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeeks(w)}
                  className={
                    w === weeks
                      ? "rounded-md border-2 border-[#a3b693] bg-[#a3b693]/15 py-2 text-sm font-semibold"
                      : "rounded-md border border-border py-2 text-sm"
                  }
                >
                  {w} wk{w === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p>
              Paused <span className="font-semibold">{niceDate(start)}</span> to{" "}
              <span className="font-semibold">{niceDate(end)}</span>
            </p>
            {newExpiry ? (
              <p className="text-muted-foreground">
                Your pass then ends {formatStudioDateShort(newExpiry.toISOString(), { year: true })}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              Classes booked with this pass in those dates need to be cancelled first.
            </p>
          </div>
          <Button type="button" className="w-full" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {rules.fee > 0 ? `Pay R${rules.fee} and pause` : "Pause my pass"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
