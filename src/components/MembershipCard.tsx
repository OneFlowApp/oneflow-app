import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, ChevronDown, Copy, ExternalLink, Star, X } from "lucide-react";
import { toast } from "sonner";
import { getUser, supabase } from "@/lib/supabase";
import logo from "@/assets/oneflow-logo.webp";
import { cn } from "@/lib/utils";
import { fetchMemberBadges, type MemberBadgePreview } from "@/lib/queries/memberBadges";

type Tier = "member" | "green" | "bronze" | "silver" | "gold";

type Membership = {
  is_member: boolean;
  valid_until: string | null;
  pack_names: string[] | null;
  is_staff?: boolean | null;
  staff_label?: string | null;
  tier?: Tier | null;
  classes_lifetime?: number | null;
  classes_12m?: number | null;
  keep_target?: number | null;
  next_tier?: Tier | null;
  classes_to_next?: number | null;
  dropped?: boolean | null;
  restore_needed?: number | null;
  keep_by?: string | null;
  paused_until?: string | null;
};

/** Card finishes by reward tier, plus fancier cards for the team and the Director. */
export type CardLook = { card: string; chip: string; text: string; lightLogo: boolean; pattern?: string; shimmer?: boolean };
export const CARD_STYLE: Record<Tier | "staff" | "director", CardLook> = {
  member: {
    card: "bg-gradient-to-br from-[#f6f2ea] via-[#e6dece] to-[#c9bfa8]",
    chip: "bg-black/10",
    text: "text-[#2f3a2a]",
    lightLogo: false,
  },
  green: {
    card: "bg-gradient-to-br from-[#a3b693] via-[#7f9a6e] to-[#5f7a52]",
    chip: "bg-white/20",
    text: "text-white",
    lightLogo: true,
  },
  bronze: {
    card: "bg-gradient-to-br from-[#f0c9a0] via-[#b87333] to-[#6e4219]",
    chip: "bg-white/20",
    text: "text-white",
    lightLogo: true,
  },
  silver: {
    card: "bg-gradient-to-br from-[#f4f6f7] via-[#bfc6cc] to-[#7c858d]",
    chip: "bg-black/10",
    text: "text-[#1f2428]",
    lightLogo: false,
  },
  gold: {
    card: "bg-gradient-to-br from-[#f7e7a1] via-[#d4af37] to-[#9c7a1c]",
    chip: "bg-black/10",
    text: "text-[#2b2205]",
    lightLogo: false,
    shimmer: true,
  },
  staff: {
    card: "bg-gradient-to-br from-[#26331f] via-[#34452c] to-[#11170f] ring-1 ring-[#d4af37]/70",
    chip: "bg-[#d4af37]/25 text-[#f3dc8a]",
    text: "text-[#f5f1e6]",
    lightLogo: true,
    pattern:
      "repeating-linear-gradient(135deg, rgba(212,175,55,0.10) 0 1px, transparent 1px 14px)",
    shimmer: true,
  },
  director: {
    card: "bg-gradient-to-br from-[#1c1c1c] via-[#0a0a0a] to-[#2b2412] ring-2 ring-[#d4af37]",
    chip: "bg-gradient-to-r from-[#f7e7a1] to-[#d4af37] text-[#1a1406]",
    text: "text-[#f3dc8a]",
    lightLogo: true,
    pattern:
      "radial-gradient(circle at 20% 15%, rgba(212,175,55,0.25), transparent 45%), repeating-linear-gradient(45deg, rgba(212,175,55,0.08) 0 1px, transparent 1px 10px), repeating-linear-gradient(-45deg, rgba(212,175,55,0.08) 0 1px, transparent 1px 10px)",
    shimmer: true,
  },
};

const TIER_NAME: Record<Tier, string> = {
  member: "Member",
  green: "Green",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

export const SHIMMER_CSS = `@keyframes ofCardShimmer{0%{transform:translateX(-120%) rotate(20deg)}60%,100%{transform:translateX(220%) rotate(20deg)}}
@media (prefers-reduced-motion: reduce){.of-card-shimmer{display:none}}`;

/** Badges sit on the card like stickers: slightly tilted, with a white die-cut edge. */
const STICKER_TILT = ["-rotate-6", "rotate-3", "-rotate-2", "rotate-6", "-rotate-3", "rotate-2"];
export function Sticker({ badge, i }: { badge: MemberBadgePreview; i: number }) {
  return (
    <span
      title={badge.name}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-md ring-2 ring-white",
        STICKER_TILT[i % STICKER_TILT.length],
      )}
    >
      {badge.icon}
    </span>
  );
}

type Perk = {
  id: string;
  title: string;
  description: string | null;
  link_url: string | null;
  discount_code: string | null;
};
type Person = { first_name: string | null; last_name: string | null; avatar_url: string | null };

/** One active balance shown under the card, so a front desk can see what's left. */
type Balance = {
  id: string;
  product_name: string | null;
  is_unlimited: boolean | null;
  credits_total: number | null;
  credits_remaining: number | null;
  expires_at: string | null;
  access_scope: string | null;
  category: string | null;
};
type GreenPointVisit = { id: string; credit_id: string; used_at: string };

/** Up to 20 credits show as dots (used ones crossed off); bigger packs show a count. */
function Tally({ total, left }: { total: number; left: number }) {
  if (total <= 0) return null;
  if (total > 20) return <span className="text-xs text-white/80">{left} of {total} left</span>;
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`${left} of ${total} left`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-3 w-3 rounded-full border",
            i < left ? "border-[#d4e3c8] bg-[#a3b693]" : "border-white/40 bg-transparent",
          )}
        />
      ))}
      <span className="ml-1 text-xs text-white/80">
        {left}/{total}
      </span>
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * "Your membership" on the Me page, shown only to members with a valid paid package.
 * Opens a full-screen digital membership card with a live clock (so a screenshot is easy to spot)
 * and the membership perks set in Admin → Settings.
 */
type TierRules = Record<string, number>;
const TIER_DEFAULTS: TierRules = {
  tier_green_classes: 40,
  tier_bronze_classes: 100,
  tier_silver_classes: 250,
  tier_gold_classes: 500,
  tier_green_keep: 20,
  tier_bronze_keep: 40,
  tier_silver_keep: 75,
  tier_gold_keep: 100,
  tier_inactive_days: 60,
  tier_restore_classes: 4,
};

/** "How card colours work": the tier rules, read live from Admin → Settings. */
export function TierGuide({ rules, current }: { rules: TierRules; current: Tier | null }) {
  const [open, setOpen] = useState(false);
  const r = (k: string) => rules[k] ?? TIER_DEFAULTS[k];
  const rows: Tier[] = ["green", "bronze", "silver", "gold"];
  return (
    <div className="mx-auto mt-4 w-full max-w-sm rounded-xl bg-white/10 px-4 py-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between font-semibold"
        aria-expanded={open}
      >
        How card colours work
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="mt-3 space-y-3 text-xs text-white/85">
          <p>Your card changes colour as you practise with us. Every class you attend counts.</p>
          <ul className="space-y-2">
            <li className="flex items-center gap-3">
              <span className={cn("h-6 w-9 shrink-0 rounded-md", CARD_STYLE.member.card)} aria-hidden />
              <span>
                <span className="font-semibold text-white">Member</span> · your card from day one
              </span>
            </li>
            {rows.map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-6 w-9 shrink-0 rounded-md",
                    CARD_STYLE[t].card,
                    current === t && "ring-2 ring-white",
                  )}
                  aria-hidden
                />
                <span>
                  <span className="font-semibold text-white">{TIER_NAME[t]}</span> · from {r(`tier_${t}_classes`)}{" "}
                  classes, kept with {r(`tier_${t}_keep`)} classes a year
                </span>
              </li>
            ))}
          </ul>
          <p>
            <span className="font-semibold text-white">Keep it active.</span> If you go{" "}
            {r("tier_inactive_days")} days without a class, your card drops one colour. Come back and attend{" "}
            {r("tier_restore_classes")} classes to get it back.
          </p>
          <p>
            <span className="font-semibold text-white">Taking a break?</span> Injured, pregnant or travelling? Let the
            studio know and we can hold your colour for you.
          </p>
          <p>
            <span className="font-semibold text-white">Stickers.</span> Earn badges for milestones and streaks, and they
            land on your card as stickers.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function MembershipCard() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [perks, setPerks] = useState<Perk[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [balances, setBalances] = useState<Balance[]>([]);
  const [gpVisits, setGpVisits] = useState<GreenPointVisit[]>([]);
  const [stickers, setStickers] = useState<MemberBadgePreview[]>([]);
  const [tierRules, setTierRules] = useState<TierRules>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await getUser();
      if (!user) return;
      const nowIso = new Date().toISOString();
      const [mRes, pRes, meRes, bRes, vRes, badges, tRes] = await Promise.all([
        supabase.rpc("my_membership"),
        supabase
          .from("membership_perks")
          .select("id, title, description, link_url, discount_code")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase
          .from("profiles")
          .select("first_name, last_name, avatar_url")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("user_credits")
          .select(
            "id, product_name, is_unlimited, credits_total, credits_remaining, expires_at, access_scope, category",
          )
          .eq("profile_id", user.id)
          .is("refunded_at", null)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order("expires_at", { ascending: true }),
        supabase
          .from("green_point_visits")
          .select("id, credit_id, used_at")
          .eq("profile_id", user.id)
          .order("used_at", { ascending: false })
          .limit(5),
        fetchMemberBadges(user.id, 60),
        supabase.from("studio_settings").select("key, value").like("key", "tier_%"),
      ]);
      if (cancelled) return;
      if (mRes.error) {
        console.warn("membership", mRes.error.message);
        return;
      }
      const m = (Array.isArray(mRes.data) ? mRes.data[0] : mRes.data) as Membership | null;
      setMembership(m ?? null);
      setPerks((pRes.data ?? []) as Perk[]);
      setPerson((meRes.data ?? null) as Person | null);
      setBalances(
        ((bRes.data ?? []) as Balance[]).filter(
          (b) =>
            b.category !== "cafe" &&
            (b.is_unlimited || (b.credits_remaining ?? 0) > 0 || (b.credits_total ?? 0) === 0),
        ),
      );
      setGpVisits((vRes.data ?? []) as GreenPointVisit[]);
      setStickers(badges);
      const rules: TierRules = {};
      for (const row of (tRes.data ?? []) as { key: string; value: string | null }[]) {
        const n = Number(row.value);
        if (Number.isFinite(n) && n > 0) rules[row.key] = n;
      }
      setTierRules(rules);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  if (!membership?.is_member) return null;

  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Member";
  const tier: Tier = membership.tier ?? "member";
  const isStaff = membership.is_staff === true;
  const isDirector = isStaff && membership.staff_label === "Director";
  const style = CARD_STYLE[isDirector ? "director" : isStaff ? "staff" : tier];
  const badge = isStaff
    ? (membership.staff_label ?? "Team")
    : tier === "member"
      ? "Member"
      : `${TIER_NAME[tier]} member`;
  const creditBalances = balances.filter((b) => b.category !== "mat_towel");
  const bothStudios = creditBalances.some((b) => b.access_scope === "open_access");
  const initials = name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-[#c5d4b8] bg-gradient-to-r from-[#e8efe3] to-card px-4 py-3 text-left shadow-sm"
      >
        <span className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-[#4a6b3c]" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-[#3d4f36]">Your membership</span>
            <span className="block text-xs text-muted-foreground">
              {badge}
              {perks.length > 0 ? ` · ${perks.length} perk${perks.length === 1 ? "" : "s"}` : ""} · Tap
              to show your card
            </span>
          </span>
        </span>
        <span className="rounded-full bg-[#a3b693] px-3 py-1 text-xs font-semibold text-white">
          Show card
        </span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Membership card"
              className="fixed inset-0 z-[200] flex flex-col overflow-y-auto bg-[#2f3a2a] px-5 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white"
            >
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div
                className={cn(
                  "relative mx-auto mt-2 w-full max-w-sm overflow-hidden rounded-3xl p-6 shadow-2xl",
                  style.card,
                  style.text,
                )}
              >
                <style>{SHIMMER_CSS}</style>
                {style.pattern ? (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundImage: style.pattern }}
                    aria-hidden
                  />
                ) : null}
                {style.shimmer ? (
                  <div
                    className="of-card-shimmer pointer-events-none absolute -inset-y-10 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                    style={{ animation: "ofCardShimmer 5s ease-in-out infinite" }}
                    aria-hidden
                  />
                ) : null}
                <div
                  className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/20 blur-2xl"
                  aria-hidden
                />
                <div className="relative flex items-center justify-between">
                  <img
                    src={logo}
                    alt="One Flow"
                    className={cn("h-10 w-auto brightness-0", style.lightLogo && "invert")}
                  />
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                      style.chip,
                    )}
                  >
                    {badge}
                  </span>
                </div>
                {bothStudios ? (
                  <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#2b2205] shadow">
                    <Star className="h-3.5 w-3.5 fill-[#2b2205]" aria-hidden />
                    Longkloof &amp; Green Point
                  </p>
                ) : null}
                <div className="relative mt-6 flex items-center gap-4">
                  {person?.avatar_url ? (
                    <img
                      src={person.avatar_url}
                      alt=""
                      className="h-20 w-20 rounded-full border-2 border-white/70 object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/70 bg-white/15 text-2xl font-bold">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-display text-xl font-bold">{name}</p>
                    {membership.valid_until ? (
                      <p className="text-sm opacity-85">
                        Valid until {formatDate(membership.valid_until)}
                      </p>
                    ) : null}
                  </div>
                </div>
                {membership.pack_names && membership.pack_names.length > 0 ? (
                  <p className="relative mt-4 text-xs opacity-90">
                    <span className="font-semibold">Access: </span>
                    {membership.pack_names.join(" · ")}
                  </p>
                ) : null}
                <p
                  className="mt-5 text-center font-mono text-2xl tabular-nums tracking-wider"
                  aria-live="off"
                >
                  {now.toLocaleTimeString("en-ZA", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
                <p className="text-center text-[11px] opacity-75">
                  Live card · {now.toLocaleDateString("en-ZA")}
                </p>
                {stickers.length > 0 ? (
                  <div className="relative mt-4 flex flex-wrap justify-center gap-2" aria-label="Badges">
                    {stickers.slice(0, 6).map((b, i) => (
                      <Sticker key={b.id} badge={b} i={i} />
                    ))}
                  </div>
                ) : null}
              </div>

              {creditBalances.length > 0 ? (
                <div className="mx-auto mt-4 w-full max-w-sm rounded-xl bg-white/10 px-4 py-3">
                  <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/80">
                    Your credits
                  </p>
                  <ul className="space-y-3">
                    {creditBalances.map((b) => (
                      <li key={b.id}>
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          {b.access_scope === "open_access" ? (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-[#d4af37] text-[#d4af37]" aria-hidden />
                          ) : null}
                          {b.product_name ?? "Pack"}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                          {b.is_unlimited ? (
                            <span className="text-xs text-white/80">Unlimited</span>
                          ) : (
                            <Tally total={b.credits_total ?? 0} left={b.credits_remaining ?? 0} />
                          )}
                          <span className="text-[11px] text-white/70">
                            {b.access_scope === "open_access" ? "Longkloof & Green Point" : "Longkloof"}
                            {b.expires_at ? ` · until ${new Date(b.expires_at).toLocaleDateString("en-ZA")}` : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {gpVisits.length > 0 ? (
                    <p className="mt-3 border-t border-white/15 pt-2 text-[11px] text-white/75">
                      Green Point visits:{" "}
                      {gpVisits
                        .map((v) =>
                          new Date(v.used_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }),
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!isStaff ? (
                <div className="mx-auto mt-4 w-full max-w-sm rounded-xl bg-white/10 px-4 py-3 text-sm">
                  <p className="font-semibold">
                    {tier === "member" ? "Member" : `${TIER_NAME[tier]} tier`} ·{" "}
                    {membership.classes_lifetime ?? 0} classes with us
                  </p>
                  <p className="text-xs text-white/75">
                    {membership.classes_12m ?? 0} in the last 12 months
                    {membership.keep_target ? ` (${membership.keep_target} a year keeps your tier)` : ""}.
                  </p>
                  {membership.dropped ? (
                    <p className="mt-2 text-xs text-[#f3dc8a]">
                      Welcome back! {membership.restore_needed ?? 0} more class
                      {(membership.restore_needed ?? 0) === 1 ? "" : "es"} to restore your tier.
                    </p>
                  ) : membership.paused_until ? (
                    <p className="mt-2 text-xs text-white/75">
                      Your tier is on hold until {formatDate(membership.paused_until)}.
                    </p>
                  ) : membership.keep_by && tier !== "member" ? (
                    <p className="mt-2 text-xs text-white/75">
                      Book a class by {formatDate(membership.keep_by)} to keep your tier.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-white/75">
                    {membership.next_tier
                      ? `${membership.classes_to_next ?? 0} more to reach ${TIER_NAME[membership.next_tier]}.`
                      : "You've reached our top tier. Thank you!"}
                  </p>
                </div>
              ) : null}

              {!isStaff ? <TierGuide rules={tierRules} current={tier} /> : null}

              {stickers.length > 0 ? (
                <div className="mx-auto mt-4 w-full max-w-sm rounded-xl bg-white/10 px-4 py-3">
                  <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/80">
                    Your stickers · {stickers.length}
                  </p>
                  <ul className="grid grid-cols-4 gap-3">
                    {stickers.map((b, i) => (
                      <li key={b.id} className="flex flex-col items-center gap-1 text-center">
                        <Sticker badge={b} i={i} />
                        <span className="text-[10px] leading-tight text-white/80">{b.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {perks.length > 0 ? (
                <div className="mx-auto mt-6 w-full max-w-sm">
                  <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/80">
                    Membership perks
                  </p>
                  <ul className="space-y-2">
                    {perks.map((p) => (
                      <li key={p.id} className="rounded-xl bg-white/10 px-4 py-3">
                        {p.link_url ? (
                          <a
                            href={p.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 font-semibold underline-offset-2 hover:underline"
                          >
                            {p.title}
                            <ExternalLink className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                          </a>
                        ) : (
                          <p className="font-semibold">{p.title}</p>
                        )}
                        {p.description ? (
                          <p className="text-sm text-white/80">{p.description}</p>
                        ) : null}
                        {p.discount_code ? (
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(p.discount_code ?? "")
                                .then(() => toast.success("Discount code copied"))
                                .catch(() => undefined);
                            }}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-white/50 px-3 py-1.5 text-sm"
                            aria-label={`Copy discount code ${p.discount_code}`}
                          >
                            <span className="text-white/75">Online code</span>
                            <span className="font-mono font-semibold tracking-wider">
                              {p.discount_code}
                            </span>
                            <Copy className="h-3.5 w-3.5 opacity-80" aria-hidden />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
