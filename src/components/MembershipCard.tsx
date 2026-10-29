import { useEffect, useState } from "react";
import { BadgeCheck, Copy, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { getUser, supabase } from "@/lib/supabase";
import logo from "@/assets/oneflow-logo.webp";

type Membership = { is_member: boolean; valid_until: string | null; pack_names: string[] | null };
type Perk = {
  id: string;
  title: string;
  description: string | null;
  link_url: string | null;
  discount_code: string | null;
};
type Person = { first_name: string | null; last_name: string | null; avatar_url: string | null };

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * "Your membership" on the Me page, shown only to members with a valid paid package.
 * Opens a full-screen digital membership card with a live clock (so a screenshot is easy to spot)
 * and the membership perks set in Admin → Settings.
 */
export function MembershipCard() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [perks, setPerks] = useState<Perk[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await getUser();
      if (!user) return;
      const [mRes, pRes, meRes] = await Promise.all([
        supabase.rpc("my_membership"),
        supabase
          .from("membership_perks")
          .select("id, title, description, link_url, discount_code")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase.from("profiles").select("first_name, last_name, avatar_url").eq("id", user.id).maybeSingle(),
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
              {perks.length > 0 ? `${perks.length} member perk${perks.length === 1 ? "" : "s"} · ` : ""}
              Tap to show your card
            </span>
          </span>
        </span>
        <span className="rounded-full bg-[#a3b693] px-3 py-1 text-xs font-semibold text-white">Show card</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Membership card"
          className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-[#2f3a2a] px-5 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white"
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

          <div className="mx-auto mt-2 w-full max-w-sm rounded-3xl bg-gradient-to-br from-[#a3b693] to-[#5f7a52] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <img src={logo} alt="One Flow" className="h-10 w-auto brightness-0 invert" />
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Member
              </span>
            </div>
            <div className="mt-6 flex items-center gap-4">
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
                  <p className="text-sm text-white/85">Valid until {formatDate(membership.valid_until)}</p>
                ) : null}
              </div>
            </div>
            {membership.pack_names && membership.pack_names.length > 0 ? (
              <p className="mt-4 text-xs text-white/85">{membership.pack_names.join(" · ")}</p>
            ) : null}
            <p className="mt-5 text-center font-mono text-2xl tabular-nums tracking-wider" aria-live="off">
              {now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
            <p className="text-center text-[11px] text-white/75">Live card · {now.toLocaleDateString("en-ZA")}</p>
          </div>

          {perks.length > 0 ? (
            <div className="mx-auto mt-6 w-full max-w-sm">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/80">Membership perks</p>
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
                    {p.description ? <p className="text-sm text-white/80">{p.description}</p> : null}
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
                        <span className="font-mono font-semibold tracking-wider">{p.discount_code}</span>
                        <Copy className="h-3.5 w-3.5 opacity-80" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
