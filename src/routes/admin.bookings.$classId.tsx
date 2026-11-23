import { createFileRoute, Link } from "@tanstack/react-router";
import { canSeeMemberPrivateDetails, effectiveRole } from "@/lib/roleAccess";
import { CustomerProfileSheet } from "@/components/admin/CustomerProfileSheet";
import { isEarlyCancellation } from "@/lib/earlyCancellation";
import { bookingPaymentLabel, fetchBookingCredits } from "@/lib/bookingPaymentLabel";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Footprints,
  Smartphone,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAuth } from "@/contexts/auth";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { formatStudioTime12Upper } from "@/lib/timezone";
import { WalkInSheet } from "@/components/admin/WalkInSheet";
import { EmptyClassCheckIn } from "@/components/admin/EmptyClassCheckIn";
import {
  AssignPackageDialog,
  type AssignPackageTarget,
} from "@/components/admin/AssignPackageDialog";
import { TypeBadge } from "@/components/TypeBadge";
import { classTypeTheme } from "@/lib/classTypeTheme";
import { classTitle, classTypeSlugFor } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { displayClassType } from "@/types/studio";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { cancelBookingWithPolicy, cancellationOutcomeMessage } from "@/lib/bookingCancellation";
import { deleteMayChallengeCheckInForBooking } from "@/lib/mayChallengeCheckIn";
import { manualCheckInToastMessage } from "@/lib/flowPoints";
import {
  fetchRosterMemberAddonAccess,
  RosterAddonPills,
} from "@/components/admin/RosterAddonPills";

export const Route = createFileRoute("/admin/bookings/$classId")({
  head: () => ({
    meta: [{ title: "Class roster — One Flow Admin" }],
  }),
  component: BookingClassDetailPage,
});

const SAGE = "#a3b693";

type BookingStatus = "confirmed" | "attended" | "cancelled" | "no-show";

type ClassRow = {
  id: string;
  name: string;
  title_override: string | null;
  class_type: string;
  class_type_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  location: string | null;
  guide_name: string | null;
};

type BookingRow = {
  id: string;
  profile_id: string | null;
  memberFull: string;
  memberShort: string;
  status: BookingStatus;
  classStartsAtIso: string;
  creditLabel: string;
  matAddon: boolean;
  towelAddon: boolean;
  hasSageCredit: boolean;
  memberRole: string | null;
  firstName: string;
  lastName: string;
  bookedAt: string;
  unpaid: boolean;
  /** How they were booked: by the team (walk-in) or themselves in the app. Null for bookings before 19 Nov. */
  source: "walk_in" | "app" | null;
};

type RosterSort = "just_booked" | "first_name" | "last_name";

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function shortMemberName(first: string, last: string) {
  const f = first.trim();
  const L = last.trim().charAt(0).toUpperCase();
  if (!f) return L ? `${L}.` : "Member";
  return L ? `${f} ${L}.` : f;
}

function rosterStatusLabel(status: BookingStatus): string {
  if (status === "confirmed") return "Booked";
  if (status === "attended") return "Attended";
  if (status === "cancelled") return "Cancelled";
  return "No-show";
}

function rosterStatusClass(status: BookingStatus) {
  return cn(
    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
    status === "attended" &&
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-50",
    status === "confirmed" &&
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
    status === "cancelled" && "bg-destructive/15 text-destructive",
    status === "no-show" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  );
}

function BookingClassDetailPage() {
  // Subscribe so a class-type rename repaints class titles and badges.
  useClassCatalog();
  const { classId } = Route.useParams();
  const { profile } = useAuth();
  const isGuide = effectiveRole(profile) === "guide";
  /** Full member profile (contact details, history) only for roles allowed to see them. */
  const canOpenProfile = canSeeMemberPrivateDetails(profile);
  const [rosterSort, setRosterSort] = useState<RosterSort>("just_booked");
  const [profileId, setProfileId] = useState<string | null>(null);

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [roster, setRoster] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BookingRow | null>(null);
  const [payTarget, setPayTarget] = useState<BookingRow | null>(null);
  const [payWhere, setPayWhere] = useState("Paid at Longkloof desk");
  const [payAmount, setPayAmount] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  /** Load the pack they bought straight from the Unpaid tag; the class then comes off it automatically. */
  const [assignFor, setAssignFor] = useState<AssignPackageTarget | null>(null);

  const markPaid = async () => {
    if (!payTarget) return;
    const amount = payAmount.trim() === "" ? null : Number(payAmount.replace(",", "."));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast.error("Enter the amount in rand, or leave it empty.");
      return;
    }
    setPaySaving(true);
    const { error: payErr } = await supabase.rpc("mark_booking_paid", {
      p_booking_id: payTarget.id,
      p_paid_where: payWhere,
      p_amount: amount,
    });
    setPaySaving(false);
    if (payErr) {
      toast.error(supabaseErrorMessage(payErr, "Could not mark as paid"));
      return;
    }
    toast.success(`${payTarget.memberFull} marked as paid`);
    setPayTarget(null);
    setPayAmount("");
    void load();
  };
  const [waiveLateFee, setWaiveLateFee] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: classData, error: classErr } = await supabase
        .from("classes")
        .select(
          "id, name, title_override, class_type, class_type_id, starts_at, ends_at, capacity, booked_count, location, guide_name",
        )
        .eq("id", classId)
        .maybeSingle();

      if (classErr) {
        const message = supabaseErrorMessage(classErr, "Could not load class");
        toast.error(message);
        setCls(null);
        setRoster([]);
        setLoadError(message);
        setLoading(false);
        return;
      }
      if (!classData) {
        setCls(null);
        setRoster([]);
        setLoadError("Class not found.");
        setLoading(false);
        return;
      }

      setCls(classData as ClassRow);

      const { data: bookingData, error: bookingErr } = await supabase
        .from("bookings")
        .select(
          "id, status, cancelled_at, late_cancel, profile_id, class_id, payment_method, credit_id, unpaid, paid_where, booked_by, class_invite_id, mat_addon, towel_addon, created_at, profiles ( first_name, last_name, role ), classes ( id, name, starts_at, ends_at )",
        )
        .eq("class_id", classId)
        .order("created_at", { ascending: true });

      if (bookingErr) {
        const message = supabaseErrorMessage(bookingErr, "Could not load roster");
        toast.error(message);
        setRoster([]);
        setLoadError(message);
        setLoading(false);
        return;
      }

      const raw = (bookingData ?? []) as Array<{
        id: string;
        status: string;
        cancelled_at?: string | null;
        late_cancel?: boolean | null;
        profile_id: string | null;
        class_id: string;
        payment_method: string | null;
        credit_id?: string | null;
        unpaid?: boolean | null;
        mat_addon: boolean | null;
        towel_addon: boolean | null;
        created_at: string | null;
        profiles:
          | { first_name: string; last_name: string; role?: string | null }
          | { first_name: string; last_name: string; role?: string | null }[]
          | null;
        classes:
          | { id: string; name: string; starts_at: string; ends_at: string }
          | { id: string; name: string; starts_at: string; ends_at: string }[]
          | null;
      }>;

      const staffIds = [
        ...new Set(
          raw
            .map((r) => (r as { booked_by?: string | null }).booked_by)
            .filter((x, i): x is string => Boolean(x) && x !== raw[i]?.profile_id),
        ),
      ];
      // Places a friend paid for (class invites): show who paid instead of "Free class".
      const inviteIds = [
        ...new Set(
          raw
            .map((r) => (r as { class_invite_id?: string | null }).class_invite_id)
            .filter((x): x is string => Boolean(x)),
        ),
      ];
      const inviterByInvite = new Map<string, string>();
      if (inviteIds.length) {
        const { data: invs } = await supabase
          .from("class_invites")
          .select("id, inviter:inviter_id(first_name, last_name)")
          .in("id", inviteIds);
        for (const iv of (invs ?? []) as {
          id: string;
          inviter:
            | { first_name: string | null; last_name: string | null }
            | { first_name: string | null; last_name: string | null }[]
            | null;
        }[]) {
          const p = one(iv.inviter);
          inviterByInvite.set(iv.id, [p?.first_name, p?.last_name].filter(Boolean).join(" "));
        }
      }
      const [addonAccess, creditInfo, staffRes] = await Promise.all([
        fetchRosterMemberAddonAccess(supabase),
        fetchBookingCredits(
          supabase,
          raw.map((r) => r.credit_id),
        ),
        staffIds.length
          ? supabase
              .from("profiles")
              .select("id, first_name, role, secondary_roles")
              .in("id", staffIds)
          : Promise.resolve({ data: [] as { id: string; first_name: string | null }[] }),
      ]);
      // Only someone on the team counts as a walk-in loader (a waitlist move-up can carry another member's id).
      const teamIds = new Set(
        (
          (staffRes.data ?? []) as {
            id: string;
            role?: string | null;
            secondary_roles?: string[] | null;
          }[]
        )
          .filter((p) =>
            [p.role ?? "", ...(p.secondary_roles ?? [])].some(
              (x) => x && x.toLowerCase() !== "customer",
            ),
          )
          .map((p) => p.id),
      );
      const staffName = new Map(
        ((staffRes.data ?? []) as { id: string; first_name: string | null }[]).map((p) => [
          p.id,
          p.first_name ?? "staff",
        ]),
      );

      const rows: BookingRow[] = [];
      for (const r of raw) {
        const prof = one(r.profiles);
        const fn = prof?.first_name?.trim() ?? "";
        const ln = prof?.last_name?.trim() ?? "";
        const clsOne = one(r.classes);
        if (!clsOne?.starts_at) continue;
        if (isEarlyCancellation({ ...r, starts_at: clsOne.starts_at })) continue;
        const st = String(r.status);
        const status = (
          ["confirmed", "attended", "cancelled", "no-show"].includes(st) ? st : "confirmed"
        ) as BookingStatus;
        const pid = r.profile_id;
        rows.push({
          id: r.id,
          profile_id: r.profile_id,
          memberFull: fn || ln ? `${fn} ${ln}`.trim() : "Unknown member",
          memberShort: shortMemberName(fn, ln || ""),
          status,
          classStartsAtIso: clsOne.starts_at,
          creditLabel:
            bookingPaymentLabel(
              r.payment_method,
              r.credit_id ? creditInfo.get(r.credit_id) : null,
              {
                paidWhere: (r as { paid_where?: string | null }).paid_where,
                paidByFriend: (() => {
                  const iv = (r as { class_invite_id?: string | null }).class_invite_id;
                  return iv ? (inviterByInvite.get(iv) ?? "") : null;
                })(),
              },
            ) +
            (() => {
              const by = (r as { booked_by?: string | null }).booked_by;
              return by && by !== r.profile_id && teamIds.has(by)
                ? ` · added by ${staffName.get(by) ?? "staff"}`
                : "";
            })(),
          matAddon: Boolean(pid && addonAccess.matProfileIds.has(pid)),
          towelAddon: Boolean(pid && addonAccess.towelProfileIds.has(pid)),
          hasSageCredit: Boolean(pid && addonAccess.cafeProfileIds.has(pid)),
          memberRole: prof?.role ?? null,
          firstName: fn,
          lastName: ln,
          bookedAt: r.created_at ?? "",
          unpaid: Boolean(r.unpaid),
          source: (() => {
            const by = (r as { booked_by?: string | null }).booked_by;
            if (!by) return null;
            return by !== r.profile_id && teamIds.has(by) ? "walk_in" : "app";
          })(),
        });
      }

      rows.sort((a, b) => a.memberFull.localeCompare(b.memberFull));
      setRoster(rows);
    } catch (e: unknown) {
      const message = supabaseErrorMessage(e, "Could not load class roster");
      toast.error(message);
      setCls(null);
      setRoster([]);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBookingStatus = async (id: string, status: "attended" | "confirmed") => {
    const patch =
      status === "attended"
        ? {
            status: "attended" as const,
            checked_in: true,
            checked_in_at: new Date().toISOString(),
          }
        : {
            status: "confirmed" as const,
            checked_in: false,
            checked_in_at: null as string | null,
          };
    const { error } = await supabase.from("bookings").update(patch).eq("id", id);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not update booking"));
      return;
    }
    if (status === "attended") {
      const row = roster.find((r) => r.id === id);
      if (row?.profile_id && row.classStartsAtIso) {
        await supabase.from("challenge_checkins").insert({
          profile_id: row.profile_id,
          class_date: new Date(row.classStartsAtIso).toISOString().split("T")[0],
          booking_id: id,
        });
      }
      toast.success(manualCheckInToastMessage(row?.memberRole));
    } else {
      await deleteMayChallengeCheckInForBooking(id);
      toast.success("Undone");
    }
    await load();
  };

  const confirmRemoveBooking = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      // Checked in: undo the check-in first, so removing gives the session back like any booking.
      if (removeTarget.status === "attended") {
        const { error: undoErr } = await supabase
          .from("bookings")
          .update({ status: "confirmed", checked_in: false, checked_in_at: null })
          .eq("id", removeTarget.id);
        if (undoErr) throw undoErr;
      }
      const res = await cancelBookingWithPolicy({
        bookingId: removeTarget.id,
        cancellationReason: "admin_cancelled",
        waiveLateFee,
      });
      toast.success(cancellationOutcomeMessage(res, "member"));
      setRemoveTarget(null);
      setWaiveLateFee(false);
      await load();
    } catch (error) {
      toast.error(supabaseErrorMessage(error, "Could not remove booking"));
    } finally {
      setRemoving(false);
    }
  };

  const badgeType = displayClassType((cls ? classTypeSlugFor(cls) : null) ?? cls?.class_type);
  const typeTheme = classTypeTheme(badgeType);

  const sortedRoster = useMemo(() => {
    const list = roster.slice();
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    if (rosterSort === "first_name") {
      list.sort((a, b) => byText(a.firstName, b.firstName) || byText(a.lastName, b.lastName));
    } else if (rosterSort === "last_name") {
      list.sort((a, b) => byText(a.lastName, b.lastName) || byText(a.firstName, b.firstName));
    } else {
      list.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
    }
    return list;
  }, [roster, rosterSort]);

  /** Counted from the list itself so it always matches the names shown. */
  const activeCount = roster.filter((b) => b.status !== "cancelled").length;

  return (
    <div className="pb-10">
      <div className="mb-4">
        <Link
          to="/admin/bookings"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to day list
        </Link>
      </div>

      <PageHeader
        title={(cls ? classTitle(cls) : "") || "Class roster"}
        description={
          cls
            ? `${formatStudioTime12Upper(cls.starts_at)} – ${formatStudioTime12Upper(cls.ends_at)}${
                cls.guide_name?.trim() ? ` · ${cls.guide_name.trim()}` : ""
              }${cls.location?.trim() ? ` · ${cls.location.trim()}` : ""}`
            : "Loading…"
        }
        actions={
          <button
            type="button"
            onClick={() => setWalkInOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: SAGE }}
          >
            <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
            Walk-in
          </button>
        }
      />

      {!loading && cls && ["director", "management"].includes(effectiveRole(profile) ?? "") ? (
        <EmptyClassCheckIn
          classId={cls.id}
          startsAt={cls.starts_at}
          guideName={cls.guide_name ?? null}
          bookedCount={activeCount}
        />
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading roster…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        </div>
      ) : !cls ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Class not found.
        </div>
      ) : (
        <>
          <div
            className={cn(
              "mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border border-l-4 px-3.5 py-2.5",
              typeTheme.tint,
            )}
            style={{ borderLeftColor: typeTheme.accent }}
          >
            <TypeBadge type={badgeType} size="sm" />
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {activeCount}/{cls.capacity} booked
            </span>
            {roster.length > 1 ? (
              <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                Sort
                <select
                  value={rosterSort}
                  onChange={(e) => setRosterSort(e.target.value as RosterSort)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="just_booked">Just booked</option>
                  <option value="first_name">First name</option>
                  <option value="last_name">Last name</option>
                </select>
              </label>
            ) : null}
          </div>

          {roster.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No bookings yet.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {sortedRoster.map((b) => {
                const isIn = b.status === "attended";
                const isCancelled = b.status === "cancelled";
                const isNoShow = b.status === "no-show";
                return (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-foreground">
                        {canOpenProfile && b.profile_id ? (
                          <button
                            type="button"
                            onClick={() => setProfileId(b.profile_id)}
                            className="min-w-0 truncate text-left underline-offset-2 hover:underline"
                          >
                            {b.memberFull}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate">{b.memberFull}</span>
                        )}
                        {b.source === "walk_in" ? (
                          <span
                            title="Walk-in: added by the team"
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                          >
                            <Footprints className="h-3 w-3" aria-hidden />
                            Walk-in
                          </span>
                        ) : b.source === "app" ? (
                          <span
                            title="Booked in the app"
                            className="inline-flex items-center gap-1 rounded-full bg-[#5f7a52]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]"
                          >
                            <Smartphone className="h-3 w-3" aria-hidden />
                            App
                          </span>
                        ) : null}
                        <RosterAddonPills
                          mat={b.matAddon}
                          towel={b.towelAddon}
                          cafe={b.hasSageCredit}
                        />
                        {b.unpaid ? (
                          <button
                            type="button"
                            onClick={() => setPayTarget(b)}
                            title="Not paid yet. Tap to mark as paid."
                            className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-red-700"
                          >
                            <CircleAlert className="h-3 w-3" aria-hidden />
                            Unpaid
                          </button>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.creditLabel}
                        {b.bookedAt
                          ? ` · booked ${new Date(b.bookedAt).toLocaleString("en-ZA", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                              timeZone: "Africa/Johannesburg",
                            })}`
                          : ""}
                      </p>
                    </div>
                    <span className={rosterStatusClass(b.status)}>
                      {rosterStatusLabel(b.status)}
                    </span>
                    <div className="flex w-full justify-end gap-2 sm:w-auto sm:flex-none">
                      {isIn ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRemoveTarget(b);
                              setWaiveLateFee(true);
                            }}
                            hidden={isGuide}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 sm:flex-none"
                          >
                            <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateBookingStatus(b.id, "confirmed")}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted sm:flex-none"
                          >
                            <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Undo
                          </button>
                        </>
                      ) : isCancelled ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRemoveTarget(b);
                              setWaiveLateFee(false);
                            }}
                            hidden={isGuide}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/20 sm:flex-none"
                          >
                            <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateBookingStatus(b.id, "attended")}
                            className={cn(
                              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 sm:flex-none",
                              isNoShow && "opacity-90",
                            )}
                            style={{ backgroundColor: SAGE }}
                          >
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Check in
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <WalkInSheet
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        onDone={() => void load()}
        currentClassId={classId}
      />
      {canOpenProfile ? (
        <CustomerProfileSheet
          customerId={profileId}
          open={profileId !== null}
          onOpenChange={(o) => {
            if (!o) setProfileId(null);
          }}
          viewerRole={effectiveRole(profile)}
          variant="customer"
          onProfileUpdated={() => void load()}
        />
      ) : null}

      <Sheet
        open={payTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPayTarget(null);
            setPayAmount("");
          }
        }}
      >
        <SheetContent side="right" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>Mark as paid</SheetTitle>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              {payTarget?.memberFull} was checked in before paying. Record where they paid and the
              red Unpaid tag goes away.
            </p>
            <div className="grid gap-2">
              {["Paid at Longkloof desk", "Paid at De Waterkant", "Paid online / EFT"].map((w) => (
                <label
                  key={w}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="pay-where"
                    checked={payWhere === w}
                    onChange={() => setPayWhere(w)}
                  />
                  {w}
                </label>
              ))}
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Amount paid (R)</span>
              <input
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Optional"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </div>
          {payTarget?.profile_id && !isGuide ? (
            <div className="mt-5 rounded-xl border border-[#d4af37]/50 bg-[#d4af37]/10 p-3">
              <p className="text-sm font-semibold">Did they buy a pack?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Load it here. If it covers this class, the class comes off the pack and the Unpaid
                tag goes.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (!payTarget?.profile_id) return;
                  setAssignFor({
                    profileId: payTarget.profile_id,
                    displayName: payTarget.memberFull,
                    email: null,
                  });
                  setPayTarget(null);
                }}
                className="mt-2 rounded-full bg-[#5f7a52] px-4 py-2 text-xs font-semibold text-white"
              >
                Load their pack
              </button>
            </div>
          ) : null}
          <SheetFooter className="mt-6 gap-2">
            <SheetClose asChild>
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
            </SheetClose>
            <button
              type="button"
              disabled={paySaving}
              onClick={() => void markPaid()}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: SAGE }}
            >
              {paySaving ? "Saving…" : "Mark as paid"}
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {assignFor ? (
        <AssignPackageDialog
          open
          onOpenChange={(o) => {
            if (!o) setAssignFor(null);
          }}
          target={assignFor}
          canAssign={!isGuide}
          includeAddons
          onAssigned={() => {
            setAssignFor(null);
            void load();
          }}
        />
      ) : null}

      <Sheet
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setWaiveLateFee(false);
          }
        }}
      >
        <SheetContent side="right" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>Remove booking</SheetTitle>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              This applies the booking cancellation policy and refunds credits. For late
              cancellations (within 2 hours), fee pending is set unless waived.
            </p>
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <input
                type="checkbox"
                checked={waiveLateFee}
                onChange={(e) => setWaiveLateFee(e.target.checked)}
              />
              <span className="text-sm font-medium">Waive fee</span>
            </label>
          </div>
          <SheetFooter className="mt-8">
            <SheetClose asChild>
              <button
                type="button"
                className="rounded-md border border-border px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
            </SheetClose>
            <button
              type="button"
              onClick={() => void confirmRemoveBooking()}
              disabled={removing}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {removing ? "Removing..." : "Remove booking"}
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
