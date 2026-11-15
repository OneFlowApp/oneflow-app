import { createFileRoute } from "@tanstack/react-router";
import { addClassToCalendar } from "@/lib/addToCalendar";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Clock, MapPin, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { Skeleton } from "@/components/ui/skeleton";
import { TypeBadge } from "@/components/TypeBadge";
import { useAuth } from "@/contexts/auth";
import { useTimezone } from "@/hooks/use-timezone";
import { formatClassDateTime, formatShortDateInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { useMemberBookings } from "@/lib/queries/memberBookings";
import { useMemberWaitlist } from "@/lib/queries/memberWaitlist";
import { invalidateMemberBookingCaches } from "@/lib/queries/invalidate";
import { displayClassType, type ClassType } from "@/types/studio";
import { classTitle, classTypeSlugFor } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { leaveWaitlist } from "@/lib/waitlist";
import { PracticeShareComposerSheet } from "@/components/PracticeShareComposerSheet";
import type { ClassPracticeShareInput } from "@/lib/classPracticeShare";

function uuidOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return undefined;
  }
  return s;
}

export const Route = createFileRoute("/bookings")({
  validateSearch: (raw: Record<string, unknown>) => ({
    /** When set (e.g. from home “Upcoming”), scroll to this booking and show its check-in QR. */
    booking: uuidOrUndefined(raw.booking),
  }),
  component: BookingsPage,
});

type ClassJoin = {
  name: string;
  class_type: string;
  location: string;
  starts_at: string;
  guide_name?: string | null;
};

type RawBooking = {
  id: string;
  status: string;
  qr_token: string | null;
  classes: ClassJoin | ClassJoin[] | null;
};

type BookingListRow = {
  id: string;
  status: string;
  qrToken: string | null;
  className: string;
  classType: ClassType;
  location: string;
  startsAt: Date;
  endsAt: Date | null;
  guideFirst: string | null;
  guideName: string | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function guideNameFromClass(cls: ClassJoin | null): string | null {
  const gn = cls?.guide_name?.trim();
  return gn || null;
}

function guideFirstFromClass(cls: ClassJoin | null): string | null {
  const gn = guideNameFromClass(cls);
  if (!gn) return null;
  return gn.split(/\s+/)[0] ?? null;
}

function BookingsPage() {
  const { user } = useAuth();
  const { timeZone, studioTimeZone } = useTimezone();
  const search = Route.useSearch();
  const bookingHighlightId = search.booking;
  const highlightedRef = useRef<HTMLElement | null>(null);
  const didScrollToBookingRef = useRef(false);

  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [shareComposerOpen, setShareComposerOpen] = useState(false);
  const [shareComposerInput, setShareComposerInput] = useState<ClassPracticeShareInput | null>(null);

  const {
    data: memberBookings = [],
    isLoading: bookingsLoading,
    isFetching: bookingsFetching,
  } = useMemberBookings(user?.id);
  const {
    data: waitlist = [],
    isLoading: waitlistLoading,
    refetch: refetchWaitlist,
  } = useMemberWaitlist(user?.id);

  const loading = bookingsLoading || waitlistLoading;

  // Subscribe so a class-type rename repaints booking titles.
  const { catalog } = useClassCatalog();

  const rows = useMemo<BookingListRow[]>(() => {
    return memberBookings
      .map((raw) => {
        const cls = one(raw.classes);
        return {
          id: raw.id,
          status: raw.status,
          qrToken: raw.qr_token ?? null,
          className: (cls ? classTitle(cls) : "") || "Class",
          classType: displayClassType(
            (cls ? classTypeSlugFor(cls) : null) ?? cls?.class_type,
          ),
          location: cls?.location ?? "",
          startsAt: new Date(cls?.starts_at ?? Date.now()),
          endsAt: cls?.ends_at ? new Date(cls.ends_at) : null,
          guideFirst: guideFirstFromClass(cls),
          guideName: guideNameFromClass(cls),
        };
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    // `catalog` is not read here, but classTitle() resolves against module state that
    // hydration mutates, so the memo must invalidate when the catalog lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberBookings, catalog]);

  const upcoming = useMemo(
    () => rows.filter((r) => r.status === "confirmed" && r.startsAt.getTime() >= Date.now()),
    [rows],
  );
  const past = useMemo(() => rows.filter((r) => r.status === "attended"), [rows]);

  const refreshBookings = () => {
    if (user?.id) invalidateMemberBookingCaches(user.id);
  };

  useEffect(() => {
    didScrollToBookingRef.current = false;
  }, [bookingHighlightId]);

  useEffect(() => {
    if (!bookingHighlightId) {
      return;
    }
    setTab("upcoming");
  }, [bookingHighlightId]);

  useEffect(() => {
    if (!bookingHighlightId || loading || didScrollToBookingRef.current) return;
    const inUpcoming = upcoming.some((b) => b.id === bookingHighlightId);
    if (!inUpcoming) {
      didScrollToBookingRef.current = true;
      return;
    }
    const el = highlightedRef.current;
    if (!el) return;
    didScrollToBookingRef.current = true;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [bookingHighlightId, loading, rows, upcoming]);

  const leaveClassWaitlist = async (entryId: string) => {
    try {
      await leaveWaitlist(entryId);
      await refetchWaitlist();
      toast.success("Left the waitlist");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not leave waitlist");
    }
  };

  const openShareComposer = (booking: BookingListRow) => {
    setShareComposerInput({
      className: booking.className,
      guideName: booking.guideName ?? booking.guideFirst ?? "",
      startsAt: booking.startsAt,
      timeZone: timeZone ?? studioTimeZone,
    });
    setShareComposerOpen(true);
  };

  return (
    <AppShell>
      <header className="safe-top px-5 pt-3 pb-3">
        <h1 className="font-display text-2xl font-semibold">My bookings</h1>
      </header>

      <div className="px-5">
        <div className="inline-flex rounded-full border border-border bg-card p-1">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 space-y-3 px-5 pt-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            {tab === "upcoming" && waitlist.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  On the waitlist
                </h2>
                {waitlist.map((w) => (
                  <article
                    key={w.id}
                    className="rounded-2xl border border-dashed border-[#a3b693]/60 bg-[#f4f7f0]/70 p-4"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <TypeBadge type={displayClassType(w.classType)} />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4a6b3c]">
                        #{w.position} on waitlist
                      </span>
                    </div>
                    <h3 className="truncate font-display text-lg font-semibold">{w.className}</h3>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatShortDateInZone(new Date(w.startsAt), timeZone)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" aria-hidden />{" "}
                        {formatClassDateTime(w.startsAt, timeZone, studioTimeZone).time}
                      </span>
                      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden />{" "}
                        <span className="min-w-0 break-words">{w.location}</span>
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      We'll book you in automatically and email you if a spot opens.
                    </p>
                    <button
                      onClick={() => void leaveClassWaitlist(w.id)}
                      className="mt-3 inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
                    >
                      <X className="h-3 w-3 shrink-0" aria-hidden /> Leave waitlist
                    </button>
                  </article>
                ))}
              </section>
            )}
            {tab === "upcoming" && upcoming.length === 0 && waitlist.length === 0 && (
              <Empty text="No upcoming bookings yet — head to Schedule to book." />
            )}
            {tab === "upcoming" &&
              upcoming.map((b) => (
                <article
                  key={b.id}
                  ref={bookingHighlightId === b.id ? highlightedRef : undefined}
                  className={cn(
                    "rounded-2xl border bg-card p-4",
                    bookingHighlightId === b.id
                      ? "border-[#a3b693] shadow-md ring-2 ring-[#a3b693]/40"
                      : "border-border",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <TypeBadge type={b.classType} />
                  </div>
                  <h3 className="truncate font-display text-lg font-semibold">{b.className}</h3>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatShortDateInZone(b.startsAt, timeZone)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      <Clock className="h-3 w-3 shrink-0" aria-hidden />{" "}
                      {formatClassDateTime(b.startsAt.toISOString(), timeZone, studioTimeZone).time}
                    </span>
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />{" "}
                      <span className="min-w-0 break-words">{b.location}</span>
                    </span>
                    {b.guideFirst && <span>with {b.guideFirst}</span>}
                  </div>
                  <CancelBookingButton
                    bookingId={b.id}
                    variant="card"
                    className="mt-3"
                    onCancelled={refreshBookings}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addClassToCalendar({
                        id: b.id,
                        title: b.className,
                        startsAt: b.startsAt,
                        endsAt: b.endsAt,
                        location: b.location,
                        guide: b.guideName,
                      })
                    }
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#5f7a52] underline-offset-2 hover:underline"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                    Add to calendar
                  </button>
                </article>
              ))}

            {tab === "past" && past.length === 0 && (
              <Empty text="No past classes yet — your attended sessions will show here." />
            )}
            {tab === "past" &&
              past.map((b) => (
                <article
                  key={b.id}
                  className="rounded-2xl border border-border bg-card p-4 opacity-90"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <TypeBadge type={b.classType} />
                    <span className="text-[10px] uppercase tracking-wide text-success">
                      Attended
                    </span>
                  </div>
                  <h3 className="truncate font-display text-lg font-semibold">{b.className}</h3>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatShortDateInZone(b.startsAt, timeZone)}
                  </div>
                  {b.status === "attended" ? (
                    <button
                      type="button"
                      onClick={() => openShareComposer(b)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#a3b693] px-4 py-2 text-xs font-semibold text-white hover:bg-[#8fa67d]"
                    >
                      <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Share your practice
                    </button>
                  ) : null}
                </article>
              ))}
          </>
        )}
      </main>

      <PracticeShareComposerSheet
        open={shareComposerOpen}
        onOpenChange={(open) => {
          setShareComposerOpen(open);
          if (!open) setShareComposerInput(null);
        }}
        input={shareComposerInput}
      />

    </AppShell>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
