import { createFileRoute, Link } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Undo2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAuth } from "@/contexts/auth";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { formatStudioTime12Upper } from "@/lib/timezone";
import { WalkInSheet } from "@/components/admin/WalkInSheet";
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
import { cancelBookingWithPolicy } from "@/lib/bookingCancellation";
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
};

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

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [roster, setRoster] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BookingRow | null>(null);
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
        "id, status, profile_id, class_id, payment_method, mat_addon, towel_addon, profiles ( first_name, last_name, role ), classes ( id, name, starts_at, ends_at )",
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
      profile_id: string | null;
      class_id: string;
      payment_method: string | null;
      mat_addon: boolean | null;
      towel_addon: boolean | null;
      profiles:
        | { first_name: string; last_name: string; role?: string | null }
        | { first_name: string; last_name: string; role?: string | null }[]
        | null;
      classes:
        | { id: string; name: string; starts_at: string; ends_at: string }
        | { id: string; name: string; starts_at: string; ends_at: string }[]
        | null;
    }>;

    const addonAccess = await fetchRosterMemberAddonAccess(supabase);

    const rows: BookingRow[] = [];
    for (const r of raw) {
      const prof = one(r.profiles);
      const fn = prof?.first_name?.trim() ?? "";
      const ln = prof?.last_name?.trim() ?? "";
      const clsOne = one(r.classes);
      if (!clsOne?.starts_at) continue;
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
        creditLabel: r.payment_method?.replace(/_/g, " ") ?? "—",
        matAddon: Boolean(pid && addonAccess.matProfileIds.has(pid)),
        towelAddon: Boolean(pid && addonAccess.towelProfileIds.has(pid)),
        hasSageCredit: Boolean(pid && addonAccess.cafeProfileIds.has(pid)),
        memberRole: prof?.role ?? null,
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
      const res = await cancelBookingWithPolicy({
        bookingId: removeTarget.id,
        cancellationReason: "admin_cancelled",
        waiveLateFee,
      });
      toast.success(
        res.lateCancel && !res.waived
          ? "Booking removed. Late cancellation fee pending."
          : "Booking removed and credit returned.",
      );
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
              {cls.booked_count}/{cls.capacity} booked
            </span>
          </div>

          {roster.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No bookings yet.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {roster.map((b) => {
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
                        <span className="min-w-0 truncate">{b.memberShort}</span>
                        <RosterAddonPills
                          mat={b.matAddon}
                          towel={b.towelAddon}
                          cafe={b.hasSageCredit}
                        />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{b.creditLabel}</p>
                    </div>
                    <span className={rosterStatusClass(b.status)}>{rosterStatusLabel(b.status)}</span>
                    <div className="flex w-full justify-end gap-2 sm:w-auto sm:flex-none">
                      {isIn ? (
                        <button
                          type="button"
                          onClick={() => void updateBookingStatus(b.id, "confirmed")}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted sm:flex-none"
                        >
                          <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Undo
                        </button>
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

      <WalkInSheet open={walkInOpen} onOpenChange={setWalkInOpen} onDone={() => void load()} />

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
