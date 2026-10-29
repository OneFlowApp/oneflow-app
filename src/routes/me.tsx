import { createFileRoute, Link } from "@tanstack/react-router";
import { MembershipCard } from "@/components/MembershipCard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  User as UserIcon,
  CreditCard,
  History,
  Users,
  Settings,
  Camera,
  LogOut,
  Bell,
  Share2,
  ChevronRight,
  Shield,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Pencil,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { FriendsPanel } from "@/components/FriendsPanel";
import { MemberPassesPanel } from "@/components/MemberPassesPanel";
import { MessageStudioButton } from "@/components/MessageStudioSheet";
import { OutstandingFeesCard } from "@/components/OutstandingFeesCard";
import { formatRand } from "@/lib/format";
import { formatStudioDateShort } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getUser, supabase } from "@/lib/supabase";
import { compressImageIfNeeded } from "@/lib/imageCompress";

async function signOut() {
  await supabase.auth.signOut();
  window.location.assign("/auth");
}

const SAGE = "#a3b693";

type TabId = "profile" | "billing" | "history" | "friends" | "settings";

export const Route = createFileRoute("/me")({
  validateSearch: (search: Record<string, unknown>) => {
    const t = search.tab;
    const valid: TabId[] = ["profile", "billing", "history", "friends", "settings"];
    const tab =
      typeof t === "string" && (valid as string[]).includes(t) ? (t as TabId) : undefined;
    return { tab } as { tab?: TabId };
  },
  component: MePage,
});

const TABS: {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "billing", label: "Pass", icon: CreditCard },
  { id: "history", label: "Classes", icon: History },
  { id: "friends", label: "Friends", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

function useHorizontalTabSwipe(onPrev: () => void, onNext: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    origin.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!origin.current) return;
    const dx = e.changedTouches[0].clientX - origin.current.x;
    const dy = e.changedTouches[0].clientY - origin.current.y;
    origin.current = null;
    if (Math.abs(dx) < 56) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
    if (dx < 0) onNext();
    else onPrev();
  };
  return { onTouchStart, onTouchEnd, style: { touchAction: "pan-y" } as const };
}

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  weekly_goal: number | null;
  date_of_birth: string | null;
  avatar_url: string | null;
  is_searchable: boolean | null;
  notification_preferences: unknown | null;
  role: string | null;
};

function MePage() {
  const { tab: tabFromUrl } = Route.useSearch();
  const [tab, setTab] = useState<TabId>("profile");
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [historyRows, setHistoryRows] = useState<{ id: string; label: string; date: Date }[]>([]);

  const tabIdx = Math.max(
    0,
    TABS.findIndex((t) => t.id === tab),
  );
  const tabSwipe = useHorizontalTabSwipe(
    () => setTab(TABS[Math.max(0, tabIdx - 1)].id),
    () => setTab(TABS[Math.min(TABS.length - 1, tabIdx + 1)].id),
  );

  useEffect(() => {
    if (tabFromUrl && TABS.some((x) => x.id === tabFromUrl)) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getUser();
    if (!user) {
      setProfile(null);
      setUserId(null);
      setUnreadCount(0);
      setEmail("");
      setHistoryRows([]);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? "");
    setUserId(user.id);

    const [
      { data: prof, error: profErr },
      { count: unreadNotif, error: unreadErr },
      { data: hist },
    ] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "first_name, last_name, email, phone, date_of_birth, avatar_url, weekly_goal, is_searchable, notification_preferences, role",
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", user.id)
          .eq("is_read", false)
          .eq("type", "message"),
        supabase
          .from("bookings")
          .select("id, classes ( name, starts_at )")
          .eq("profile_id", user.id)
          .eq("status", "attended")
          .order("created_at", { ascending: false })
          .limit(12),
      ]);

    if (profErr) console.error(profErr);
    if (unreadErr) console.error(unreadErr);
    setProfile(profErr ? null : ((prof ?? null) as ProfileRow | null));
    setUnreadCount(typeof unreadNotif === "number" ? unreadNotif : 0);

    const rows =
      (hist ?? []).map((raw: Record<string, unknown>) => {
        const cls = raw.classes as
          | { name: string; starts_at: string }
          | { name: string; starts_at: string }[]
          | null;
        const c = Array.isArray(cls) ? cls[0] : cls;
        return {
          id: raw.id as string,
          label: c?.name ?? "Class",
          date: new Date(c?.starts_at ?? Date.now()),
        };
      }) ?? [];
    setHistoryRows(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const first = profile?.first_name?.trim() || "Member";
  const initials = (
    first.charAt(0) + (profile?.last_name?.charAt(0) || first.charAt(0))
  ).toUpperCase();

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-3">
        <h1 className="font-display text-lg font-semibold text-muted-foreground">Profile</h1>
        <Link
          to="/messages"
          aria-label="Messages"
          className="relative z-30 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>
      </div>

      <main className="flex flex-1 flex-col px-5 pt-3 pb-6">
        <OutstandingFeesCard />
        <MembershipCard />
        <nav className="flex shrink-0 items-stretch gap-0.5 rounded-t-xl border-b-2 border-border/60 bg-muted/50 px-0.5 pt-1">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-t-lg border-b-2 py-2 text-[10px] font-semibold transition-all duration-300 sm:text-[11px]",
                  active
                    ? "border-[#a3b693] text-[#a3b693]"
                    : "border-transparent text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={active ? 2.2 : 1.6} />
                <span className="leading-none">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="relative mt-4 min-h-[240px] flex-1" {...tabSwipe}>
          <div className="schedule-content-animate space-y-4">
            {loading ? (
              <MeTabSkeleton />
            ) : (
              <>
                {tab === "profile" && (
                  <ProfileTab
                    email={email}
                    profile={profile}
                    initials={initials.slice(0, 2)}
                    userId={userId}
                    onProfileSaved={() => void load()}
                  />
                )}
                {tab === "billing" && <BillingPanel />}
                {tab === "history" && <HistoryPanel rows={historyRows} />}
                {tab === "friends" && <FriendsPanel />}
                {tab === "settings" && (
                  <SettingsPanel
                    weeklyGoal={profile?.weekly_goal ?? 3}
                    isSearchable={profile?.is_searchable !== false}
                    userId={userId}
                    onWeeklyGoalSaved={() => void load()}
                    onSearchableSaved={() => void load()}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function MeTabSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-2xl font-bold">{title}</h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function ProfileTab({
  email: authEmail,
  profile,
  initials,
  userId,
  onProfileSaved,
}: {
  email: string;
  profile: ProfileRow | null;
  initials: string;
  userId: string | null;
  onProfileSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  const [first, setFirst] = useState(profile?.first_name ?? "");
  const [last, setLast] = useState(profile?.last_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const dobStr = profile?.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : "";
  const [dob, setDob] = useState(dobStr);

  useEffect(() => {
    setFirst(profile?.first_name ?? "");
    setLast(profile?.last_name ?? "");
    setPhone(profile?.phone ?? "");
    setDob(profile?.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : "");
    setLocalUrl(null);
  }, [profile]);

  const avatarSrc = localUrl ?? profile?.avatar_url?.trim() ?? null;
  const displayEmail = authEmail || profile?.email || "—";

  const saveProfile = async () => {
    const u = await getUser();
    if (!u) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: first.trim() || null,
        last_name: last.trim() || null,
        phone: phone.trim() || null,
        date_of_birth: dob.trim() || null,
      })
      .eq("id", u.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Profile saved");
    setEditing(false);
    onProfileSaved();
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) {
      toast.error("Could not upload");
      return;
    }
    setUploading(true);
    try {
      const blob = await compressImageIfNeeded(file);
      const ext = blob.type === "image/png" ? "png" : "jpeg";
      const path = `${userId}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, {
        upsert: true,
        contentType: blob.type || "image/jpeg",
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", userId);
      if (pErr) throw pErr;
      setLocalUrl(pub.publicUrl);
      toast.success("Photo updated");
      onProfileSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const readOnly = !editing;

  return (
    <Panel title="Your profile">
      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-muted text-2xl font-bold">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => void onPickPhoto(ev)}
          />
          <button
            type="button"
            aria-label="Change photo"
            disabled={uploading || !userId}
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#a3b693] text-white shadow-md disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-4 text-center font-display text-xl font-bold">
          {[first, last].filter(Boolean).join(" ").trim() || "Member"}
        </p>
        <p className="mt-1 text-center text-sm text-muted-foreground">{displayEmail}</p>
      </div>

      <div className="space-y-3 pt-2">
        <div>
          <label className="text-sm font-medium">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            readOnly={readOnly}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm outline-none focus:border-primary read-only:opacity-80"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Date of birth</label>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            readOnly={readOnly}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm outline-none focus:border-primary read-only:opacity-80"
          />
        </div>
        <div>
          <label className="text-sm font-medium">First name</label>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            readOnly={readOnly}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm outline-none focus:border-primary read-only:opacity-80"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Last name</label>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            readOnly={readOnly}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm outline-none focus:border-primary read-only:opacity-80"
          />
        </div>
      </div>

      {editing ? (
        <Button
          type="button"
          className="mt-4 w-full"
          disabled={saving}
          onClick={() => void saveProfile()}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full gap-2 border-[#a3b693]/50 text-[#a3b693]"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" /> Edit profile
        </Button>
      )}

      <MessageStudioButton className="mt-3 w-full gap-2 rounded-xl py-6 text-base shadow-sm" />
    </Panel>
  );
}

function formatZarFromWholeRand(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

function BillingPanel() {
  const [rows, setRows] = useState<
    { id: string; name: string; date: string; amountZar: number; source: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const user = await getUser();
      if (!user) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const purchasesRes = await supabase
        .from("user_credits")
        .select(
          "id, created_at, product_name, yoco_payment_id, amount_paid_zar, product:product_id ( name, price_zar )",
        )
        .eq("profile_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (cancelled) return;

      const data = purchasesRes.data;
      const error = purchasesRes.error;
      if (error) {
        console.error(error);
        setRows([]);
        setLoading(false);
        return;
      }

      const mapped = (data ?? []).map((raw: Record<string, unknown>) => {
        const prod = (Array.isArray(raw.product) ? raw.product[0] : raw.product) as
          | { name?: string; price_zar?: number }
          | null;
        const name =
          String(raw.product_name ?? "").trim() || prod?.name?.trim() || "Pass / credits";
        // What they actually paid (includes upgrades and member price); older rows fall back to the list price.
        const paid = Number(raw.amount_paid_zar);
        const amountZar = Number.isFinite(paid) && paid > 0 ? paid : Number(prod?.price_zar ?? 0) || 0;
        const dt = typeof raw.created_at === "string" ? raw.created_at : "";
        const dateLabel = dt ? formatStudioDateShort(dt, { year: true }) : "—";
        const yoco = raw.yoco_payment_id;
        const source = yoco ? "Card (Yoco)" : "Studio / staff";
        return {
          id: String(raw.id),
          name,
          date: dateLabel,
          amountZar,
          source,
        };
      });

      setRows(mapped);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel title="Billing history">
      <MemberPassesPanel compact />
      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Passes and credit grants linked to your account (checkout and in-studio).
        </p>
        <Link
          to="/pricing"
          className="shrink-0 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-primary hover:bg-muted/60"
        >
          View passes
        </Link>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No purchases yet.{" "}
          <Link to="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
            Buy a pass
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-2 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{inv.name}</p>
                <p className="text-xs text-muted-foreground">{inv.date}</p>
                <p className="text-[10px] text-muted-foreground">{inv.source}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatZarFromWholeRand(inv.amountZar)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HistoryPanel({ rows }: { rows: { id: string; label: string; date: Date }[] }) {
  return (
    <Panel title="Class history">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attended classes yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatStudioDateShort(p.date)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                Attended
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const settingsLinkClass =
  "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40";

function WeeklyGoalSetting({ initial, onSaved }: { initial: number; onSaved: () => void }) {
  const clampGoal = (n: number) => Math.min(14, Math.max(1, Math.round(n)));
  const [val, setVal] = useState(String(clampGoal(initial)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(String(clampGoal(initial)));
  }, [initial]);

  const parseVal = () => {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? clampGoal(n) : clampGoal(initial);
  };

  const save = async () => {
    const num = parseInt(val, 10);
    if (!Number.isFinite(num) || num < 1 || num > 14) {
      toast.error("Enter a weekly goal between 1 and 14 classes.");
      return;
    }
    setSaving(true);
    const user = await getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ weekly_goal: clampGoal(num) })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Weekly goal saved");
    onSaved();
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-sm font-semibold">Weekly goal</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Target classes per week (1–14). Progress shows on your home screen.
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Decrease goal"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold"
          onClick={() => setVal(String(clampGoal(parseVal() - 1)))}
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={14}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full max-w-[5rem] rounded-lg border border-border bg-card py-2 text-center text-sm font-semibold tabular-nums outline-none focus:border-primary"
        />
        <button
          type="button"
          aria-label="Increase goal"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold"
          onClick={() => setVal(String(clampGoal(parseVal() + 1)))}
        >
          +
        </button>
      </div>
      <Button type="button" className="mt-4 w-full" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save weekly goal"}
      </Button>
    </div>
  );
}

async function runInviteFriend(userId: string | null) {
  if (!userId) {
    toast.error("Sign in to invite friends.");
    return;
  }
  const link = `https://oneflow1.netlify.app?ref=${userId}`;
  const text = `Join me at One Flow! Use my link to sign up: ${link}`;
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: "One Flow", text });
      return;
    }
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Copied!", { description: "Invite link copied to clipboard." });
  } catch {
    toast.error("Could not share or copy the link.");
  }
}

function SearchableSetting({
  initial,
  userId,
  onSaved,
}: {
  initial: boolean;
  userId: string | null;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChecked(initial);
  }, [initial]);

  const onToggle = async (next: boolean) => {
    setChecked(next);
    if (!userId) {
      toast.error("Sign in to change settings.");
      setChecked(initial);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ is_searchable: next })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      setChecked(initial);
      return;
    }
    toast.success(next ? "You can be found in friend search" : "Hidden from friend search");
    onSaved();
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Allow friends to find me by name</p>
        <p className="text-xs text-muted-foreground">
          When off, you won&apos;t appear in anyone&apos;s search results.
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={saving || !userId}
        onCheckedChange={(v) => void onToggle(v)}
        aria-label="Allow friends to find me by name"
      />
    </div>
  );
}

function SettingsPanel({
  weeklyGoal,
  isSearchable,
  userId,
  onWeeklyGoalSaved,
  onSearchableSaved,
}: {
  weeklyGoal: number;
  isSearchable: boolean;
  userId: string | null;
  onWeeklyGoalSaved: () => void;
  onSearchableSaved: () => void;
}) {
  return (
    <Panel title="Account settings">
      <WeeklyGoalSetting initial={weeklyGoal} onSaved={onWeeklyGoalSaved} />

      <SearchableSetting initial={isSearchable} userId={userId} onSaved={onSearchableSaved} />

      <Link to="/notifications" className={settingsLinkClass}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
          <Bell className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">Notification preferences</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <button
        type="button"
        className={settingsLinkClass}
        onClick={() =>
          window.open("https://www.oneflow.co.za/policies", "_blank", "noopener,noreferrer")
        }
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
          <Shield className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">Privacy policy</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>

      <button
        type="button"
        className={settingsLinkClass}
        onClick={() => void runInviteFriend(userId)}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
          <Share2 className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">Share with a friend</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>

      <Link to="/faq" className={settingsLinkClass}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
          <HelpCircle className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">FAQ & help</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <Link
        to="/admin"
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
          <LayoutGrid className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">Admin Dashboard</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
      <Row
        icon={<LogOut className="h-4 w-4" />}
        label="Sign out"
        danger
        onClick={() => void signOut()}
      />
    </Panel>
  );
}

function Row({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left"
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          danger ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
        )}
      >
        {icon}
      </span>
      <span className={cn("flex-1 text-sm font-semibold", danger && "text-destructive")}>
        {label}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
