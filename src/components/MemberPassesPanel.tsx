import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Ticket } from "lucide-react";
import { getUser, supabase } from "@/lib/supabase";
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
    | { name: string | null; is_staff_only?: boolean | null }
    | { name: string | null; is_staff_only?: boolean | null }[]
    | null;
};

type PassPart = { id: string; label: string; unlimited: boolean; remaining: number };

type Pass = {
  key: string;
  name: string;
  expiresAt: string | null;
  openAccess: boolean;
  matAndTowel: boolean;
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
export function MemberPassesPanel({ compact = false }: { compact?: boolean }) {
  const [passes, setPasses] = useState<Pass[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (!user) {
        if (!cancelled) setPasses([]);
        return;
      }
      const { data, error } = await supabase
        .from("user_credits")
        .select(
          "id, product_id, product_name, credits_remaining, is_unlimited, expires_at, purchased_at, refunded_at, access_scope, mat_access, towel_access, product:product_id ( name, is_staff_only )",
        )
        .eq("profile_id", user.id);
      if (cancelled) return;
      if (error) {
        console.error("passes", error);
        setPasses([]);
        return;
      }
      setPasses(groupPasses((data ?? []) as CreditRow[], Date.now()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
              {p.openAccess || p.matAndTowel ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.openAccess ? (
                    <span className="rounded-full bg-[#e8efe3] px-2 py-0.5 text-[11px] font-semibold text-[#3d4f36]">
                      Longkloof + Green Point
                    </span>
                  ) : null}
                  {p.matAndTowel ? (
                    <span className="rounded-full bg-[#e8efe3] px-2 py-0.5 text-[11px] font-semibold text-[#3d4f36]">
                      Mat & towel included
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
