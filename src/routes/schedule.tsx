import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BookingSheet } from "@/components/BookingSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { supabase } from "@/lib/supabase";
import { useTimezone } from "@/hooks/use-timezone";
import {
  confirmedBookingIntervalsFromRows,
  useMemberBookings,
} from "@/lib/queries/memberBookings";
import { useMemberWaitlist } from "@/lib/queries/memberWaitlist";
import { invalidateMemberBookingCaches } from "@/lib/queries/invalidate";
import { useScheduleDayClasses } from "@/lib/queries/scheduleDay";
import {
  civilAddDaysYmd,
  dayOfMonthFromDateKey,
  formatClassDateTime,
  formatLongDayFromDateKey,
  formatMonthYearFromDateKey,
  todayDateKey,
  weekDateKeysFromSunday,
  weekSundayDateKey,
  weekdayIndexSundayZero,
  ymdInTimeZone,
} from "@/lib/timezone";
import {
  type BookedClassInterval,
  customerClassCapacityLabel,
  findOverlappingBooking,
  isFreeBeginnerClass,
  isPastScheduleClass,
  isPastScheduleDay,
} from "@/lib/scheduleBooking";
import { cn } from "@/lib/utils";
import { TypeBadge } from "@/components/TypeBadge";
import { WeekDayStrip, weekdayStripLetter } from "@/components/WeekDayStrip";
import { CurrentTimeLine, currentTimeLineInsertIndex } from "@/components/CurrentTimeLine";
import { classTypeTheme } from "@/lib/classTypeTheme";
import { classTitle, classTypeSlugFor } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { displayClassType } from "@/types/studio";
import { useNowMs } from "@/hooks/use-now-ms";
import { pickFocusClassId } from "@/lib/liveClassList";
import { friendsGoingLabel, useFriendsGoing, type FriendGoing } from "@/lib/friendsGoing";

function uuidOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return undefined;
  }
  return s;
}

export const Route = createFileRoute("/schedule")({
  validateSearch: (raw: Record<string, unknown>) => ({
    class: uuidOrUndefined(raw.class),
  }),
  component: SchedulePage,
});

const SAGE = "#a3b693";

type ClassRow = {
  id: string;
  name: string;
  class_type: string;
  location: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  is_cancelled: boolean;
  guide_name: string | null;
  description?: string;
  product_id?: string | null;
};

/** Denormalized `classes.guide_name` from PostgREST (text); never guess a label when missing. */
function guideNameFromRow(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function ScheduleRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </>
  );
}

const SWIPE_MIN_PX = 56;
/** Prefer vertical scroll; only treat as day-change when clearly sideways. */
const SWIPE_AXIS_RATIO = 1.35;

function useHorizontalDaySwipe(onPrev: () => void, onNext: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onPrevRef = useRef(onPrev);
  const onNextRef = useRef(onNext);
  onPrevRef.current = onPrev;
  onNextRef.current = onNext;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const origin = { x: 0, y: 0 };
    let locked: "h" | "v" | null = null;

    const reset = () => {
      locked = null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      origin.x = e.touches[0].clientX;
      origin.y = e.touches[0].clientY;
      locked = null;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || locked === "v") return;
      const dx = e.touches[0].clientX - origin.x;
      const dy = e.touches[0].clientY - origin.y;
      if (!locked) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        // Diagonal / mostly-vertical gestures stay vertical so the page doesn't
        // "scroll" sideways while the user is trying to move down the list.
        locked =
          Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO ? "h" : "v";
      }
      if (locked === "h") e.preventDefault();
    };

    const onEnd = (e: TouchEvent) => {
      if (locked !== "h") {
        reset();
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) {
        reset();
        return;
      }
      const dx = touch.clientX - origin.x;
      reset();
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      if (dx < 0) onNextRef.current();
      else onPrevRef.current();
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd, { passive: true });
    node.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return containerRef;
}

export default function SchedulePage() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { timeZone, studioTimeZone } = useTimezone();
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKey(studioTimeZone));
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [bookingFor, setBookingFor] = useState<ClassRow | null>(null);
  /** Confirmed booking `class_id`s for this user (any day — not filtered by booking `created_at`). */
  const [bookedClassIds, setBookedClassIds] = useState<Set<string>>(() => new Set());
  const [bookedIntervals, setBookedIntervals] = useState<BookedClassInterval[]>([]);
  const [waitlistedClassIds, setWaitlistedClassIds] = useState<Set<string>>(() => new Set());
  const [pendingOpenClassId, setPendingOpenClassId] = useState<string | null>(null);
  const [daySlide, setDaySlide] = useState<"from-left" | "from-right" | null>(null);
  const lastStudioTodayRef = useRef(todayDateKey(studioTimeZone));
  const selectedDateKeyRef = useRef(selectedDateKey);
  selectedDateKeyRef.current = selectedDateKey;

  const dayClassesQuery = useScheduleDayClasses(selectedDateKey, studioTimeZone);
  const memberBookingsQuery = useMemberBookings(user?.id);
  const waitlistQuery = useMemberWaitlist(user?.id);

  const goPrevDay = useCallback(() => {
    setDaySlide("from-left");
    setSelectedDateKey((k) => civilAddDaysYmd(k, -1));
  }, []);

  const goNextDay = useCallback(() => {
    setDaySlide("from-right");
    setSelectedDateKey((k) => civilAddDaysYmd(k, 1));
  }, []);

  const goNextWeek = useCallback(() => {
    setDaySlide("from-right");
    setSelectedDateKey((k) => civilAddDaysYmd(k, 7));
  }, []);

  /** Back one week, but never before the studio's today. */
  const goPrevWeek = useCallback(() => {
    const studioToday = todayDateKey(studioTimeZone);
    setDaySlide("from-left");
    setSelectedDateKey((k) => {
      const back = civilAddDaysYmd(k, -7);
      return back < studioToday ? studioToday : back;
    });
  }, [studioTimeZone]);

  const swipeContainerRef = useHorizontalDaySwipe(goPrevDay, goNextDay);

  useEffect(() => {
    if (!daySlide) return;
    const t = window.setTimeout(() => setDaySlide(null), 220);
    return () => window.clearTimeout(t);
  }, [daySlide, selectedDateKey]);

  useEffect(() => {
    const syncStudioDay = () => {
      const studioToday = todayDateKey(studioTimeZone);
      const prevToday = lastStudioTodayRef.current;
      if (studioToday === prevToday) return;
      lastStudioTodayRef.current = studioToday;
      if (selectedDateKeyRef.current === prevToday) {
        setSelectedDateKey(studioToday);
        setDaySlide(null);
      }
    };
    syncStudioDay();
    const intervalId = window.setInterval(syncStudioDay, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") syncStudioDay();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [studioTimeZone]);

  const nowMs = useNowMs();
  const classListRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const didScrollToNowRef = useRef<string | null>(null);

  useEffect(() => {
    const rows = dayClassesQuery.data;
    if (!rows) return;
    const mapped = rows
      .map((c) => ({
        ...c,
        guide_name: guideNameFromRow(c.guide_name),
      }))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    // Show the full day — past classes stay visible (dimmed in the row).
    setClasses(mapped);
    setLoading(dayClassesQuery.isLoading && !dayClassesQuery.data);
    setRevalidating(dayClassesQuery.isFetching && !dayClassesQuery.isLoading);
  }, [
    dayClassesQuery.data,
    dayClassesQuery.isLoading,
    dayClassesQuery.isFetching,
  ]);

  useEffect(() => {
    const intervals = confirmedBookingIntervalsFromRows(memberBookingsQuery.data ?? []);
    setBookedClassIds(new Set(intervals.map((b) => b.class_id)));
    setBookedIntervals(intervals);
  }, [memberBookingsQuery.data]);

  useEffect(() => {
    setWaitlistedClassIds(new Set((waitlistQuery.data ?? []).map((w) => w.classId)));
  }, [waitlistQuery.data]);

  useEffect(() => {
    const classId = search.class;
    if (!authReady || !user?.id || !classId) {
      if (!classId) setPendingOpenClassId(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, starts_at, is_cancelled")
        .eq("id", classId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        toast.error("Class not found.");
        void navigate({ to: "/schedule", search: { class: undefined }, replace: true });
        return;
      }

      if (data.is_cancelled) {
        toast.error("This class has been cancelled.");
        void navigate({ to: "/schedule", search: { class: undefined }, replace: true });
        return;
      }

      const ts = String(data.starts_at);
      setSelectedDateKey(ymdInTimeZone(ts, studioTimeZone));
      setPendingOpenClassId(classId);
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user?.id, search.class, navigate, studioTimeZone]);

  useEffect(() => {
    if (!pendingOpenClassId || loading || revalidating || !user?.id) return;

    const row = classes.find((c) => c.id === pendingOpenClassId);
    if (row) {
      if (isPastScheduleClass(row.starts_at)) {
        toast.error("This class has already passed — you can’t book it.");
      } else {
        setBookingFor(row);
      }
      setPendingOpenClassId(null);
      void navigate({ to: "/schedule", search: { class: undefined }, replace: true });
      return;
    }

    setPendingOpenClassId(null);
    void navigate({ to: "/schedule", search: { class: undefined }, replace: true });
    toast.info(
      "That class isn’t on this day’s list — find it on the day it runs or pick another.",
      {
        duration: 6000,
      },
    );
  }, [pendingOpenClassId, loading, revalidating, classes, navigate, user?.id]);

  const weekSundayKey = useMemo(
    () => weekSundayDateKey(selectedDateKey, studioTimeZone),
    [selectedDateKey, studioTimeZone],
  );

  const daysInWeek = useMemo(() => weekDateKeysFromSunday(weekSundayKey), [weekSundayKey]);

  const monthLabel = formatMonthYearFromDateKey(selectedDateKey, studioTimeZone);
  const longDayLabel = formatLongDayFromDateKey(selectedDateKey, studioTimeZone);

  const uid = user?.id;
  const classIdsForFriends = useMemo(() => classes.map((c) => c.id), [classes]);
  const friendsGoing = useFriendsGoing(classIdsForFriends, uid);
  const todayKey = todayDateKey(studioTimeZone);
  const isCurrentWeek = weekSundayKey <= weekSundayDateKey(todayKey, studioTimeZone);
  const selectedDayIsPast = isPastScheduleDay(selectedDateKey, studioTimeZone);
  const isToday = selectedDateKey === todayKey;
  const timeLineIndex = isToday ? currentTimeLineInsertIndex(classes, nowMs) : -1;
  const focusClassId = isToday ? pickFocusClassId(classes, nowMs) : null;

  useEffect(() => {
    if (!isToday || loading || classes.length === 0) return;
    const key = `${selectedDateKey}:${focusClassId ?? "none"}`;
    if (didScrollToNowRef.current === key) return;
    didScrollToNowRef.current = key;

    // Align under the sticky day chrome — block:"center" tucked cards (and type badges)
    // under the translucent sticky header.
    const run = () => {
      const target =
        (focusClassId &&
          classListRef.current?.querySelector(
            `[data-schedule-class-id="${CSS.escape(focusClassId)}"]`,
          )) ||
        classListRef.current?.querySelector("[data-schedule-now-line]");
      if (!(target instanceof HTMLElement)) return;

      const scroller = document.querySelector("[data-customer-scroll]");
      if (!(scroller instanceof HTMLElement)) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }

      const sticky = stickyHeaderRef.current;
      const stickyH = sticky?.getBoundingClientRect().height ?? 0;
      const gap = 10;
      const delta =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        stickyH -
        gap;
      scroller.scrollBy({ top: delta, behavior: "smooth" });
    };

    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [isToday, loading, classes, focusClassId, selectedDateKey]);
  if (!authReady || !uid) {
    return (
      <AppShell>
        <header className="px-4 pt-3 pb-1.5 text-center">
          <h1 className="font-display text-lg font-semibold tracking-tight">Schedule</h1>
          <p className="text-xs text-muted-foreground">Book a class</p>
        </header>
        <div className="px-4 pt-3">
          <Skeleton className="mx-auto mb-2 h-3 w-28" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <main className="flex-1 space-y-3 px-4 pt-3">
          <Skeleton className="mx-auto h-4 w-40" />
          <ScheduleRowsSkeleton />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="px-4 pt-3 pb-1.5 text-center">
        <h1 className="font-display text-lg font-semibold tracking-tight">Schedule</h1>
        <p className="text-xs text-muted-foreground">Book a class</p>
      </header>

      <div ref={swipeContainerRef} className="min-w-0 overflow-x-hidden touch-pan-y">
        <div
          ref={stickyHeaderRef}
          className="sticky top-0 z-20 border-b border-border bg-background"
        >
          <div className="space-y-2 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous week"
                onClick={goPrevWeek}
                disabled={isCurrentWeek}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground",
                  isCurrentWeek && "invisible",
                )}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-center text-xs text-muted-foreground">{monthLabel}</p>
              <button
                type="button"
                aria-label="Next week"
                onClick={goNextWeek}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <WeekDayStrip
              days={daysInWeek.map((dayKey) => {
                const selected = dayKey === selectedDateKey;
                const dayIsPast = isPastScheduleDay(dayKey, studioTimeZone);
                return {
                  key: dayKey,
                  weekdayLetter: weekdayStripLetter(
                    weekdayIndexSundayZero(dayKey, studioTimeZone),
                  ),
                  dayOfMonth: dayOfMonthFromDateKey(dayKey),
                  selected,
                  isToday: dayKey === todayKey,
                  selectedMuted: selected && dayIsPast,
                  dimmed: !selected && dayIsPast,
                };
              })}
              onSelect={setSelectedDateKey}
            />
            <div className="text-center">
              <p
                className={cn(
                  "font-display text-sm font-semibold leading-tight",
                  selectedDayIsPast && "text-muted-foreground",
                )}
              >
                {longDayLabel}
              </p>
              {selectedDateKey === todayKey ? (
                <p className="mt-0.5 text-[11px] font-medium text-[#4a6b3c]">Today</p>
              ) : selectedDateKey > todayKey ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Upcoming</p>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Past</p>
              )}
            </div>
          </div>
        </div>

      <main
        className={cn(
          "flex-1 space-y-3 px-4 pt-3 pb-4 transition-opacity",
          revalidating && "opacity-80",
        )}
      >
        <div
          key={selectedDateKey}
          className={cn(
            "min-w-0 space-y-3 overflow-x-hidden",
            !loading &&
              (daySlide === "from-left"
                ? "schedule-slide-from-left"
                : daySlide === "from-right"
                  ? "schedule-slide-from-right"
                  : "schedule-content-animate"),
          )}
        >
          {loading ? (
            <ScheduleRowsSkeleton />
          ) : classes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              <p>No classes scheduled for this day.</p>
            </div>
          ) : (
            <div ref={classListRef} className="space-y-3">
              {classes.map((c, idx) => {
                const classIsPast =
                  selectedDayIsPast || isPastScheduleClass(c.starts_at, nowMs);
                const overlapBooking = findOverlappingBooking(c, bookedIntervals, c.id);
                return (
                  <div key={c.id}>
                    {timeLineIndex === idx ? (
                      <div data-schedule-now-line className="mb-3">
                        <CurrentTimeLine />
                      </div>
                    ) : null}
                    <div data-schedule-class-id={c.id}>
                      <ScheduleRow
                        session={c}
                        displayTimeZone={timeZone}
                        studioTimeZone={studioTimeZone}
                        alreadyBooked={bookedClassIds.has(c.id)}
                        onWaitlist={waitlistedClassIds.has(c.id)}
                        friendsGoing={friendsGoing.get(c.id) ?? []}
                        overlapBooking={overlapBooking}
                        isPast={classIsPast}
                        onReserve={() => {
                          if (classIsPast || overlapBooking) return;
                          setBookingFor(c);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {timeLineIndex === classes.length ? (
                <div data-schedule-now-line>
                  <CurrentTimeLine />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
      </div>

      <BookingSheet
        session={bookingFor}
        open={bookingFor !== null}
        onBookingConfirmed={(classId) => {
          if (uid) invalidateMemberBookingCaches(uid);
          setBookedClassIds((prev) => new Set(prev).add(classId));
          if (bookingFor && bookingFor.id === classId) {
            setBookedIntervals((prev) => [
              ...prev.filter((b) => b.class_id !== classId),
              {
                class_id: classId,
                name: bookingFor.name,
                starts_at: bookingFor.starts_at,
                ends_at: bookingFor.ends_at,
              },
            ]);
          }
        }}
        onOpenChange={(o) => {
          if (!o) {
            setBookingFor(null);
            if (uid) invalidateMemberBookingCaches(uid);
          }
        }}
      />
    </AppShell>
  );
}

function ScheduleRow({
  session,
  displayTimeZone,
  studioTimeZone,
  alreadyBooked,
  onWaitlist,
  friendsGoing,
  overlapBooking,
  isPast,
  onReserve,
}: {
  session: ClassRow;
  displayTimeZone: string;
  studioTimeZone: string;
  alreadyBooked: boolean;
  onWaitlist: boolean;
  friendsGoing: FriendGoing[];
  overlapBooking: BookedClassInterval | null;
  isPast?: boolean;
  onReserve: () => void;
}) {
  const [descExpanded, setDescExpanded] = useState(false);
  const desc = session.description?.trim() ?? "";
  // Subscribe so a class-type rename repaints the row title and badge.
  useClassCatalog();

  const guideName = guideNameFromRow(session.guide_name);
  const badgeType = displayClassType(classTypeSlugFor(session) ?? session.class_type);
  const typeTheme = classTypeTheme(badgeType);
  const { time, zoneLabel } = formatClassDateTime(
    session.starts_at,
    displayTimeZone,
    studioTimeZone,
  );
  const timeLabel = time.toUpperCase();
  const durationMin = Math.round(
    (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000,
  );
  const capacityInfo = customerClassCapacityLabel(session.booked_count, session.capacity);
  const full = capacityInfo.full;
  const almostFull = capacityInfo.almostFull;
  const hasOverlap = Boolean(overlapBooking);
  const canReserve = !isPast && !alreadyBooked && !full && !hasOverlap;
  // When full + not booked + no overlap, the button opens the sheet to
  // join the waitlist (or manage an existing entry).
  const canWaitlist = !isPast && !alreadyBooked && full && !hasOverlap;
  const isFreeClass = isFreeBeginnerClass(session.class_type);

  return (
    <div
      className={cn(
        "rounded-xl border border-border border-l-4 bg-card px-3.5 py-3",
        typeTheme.tint,
        isPast && "opacity-55 saturate-50",
      )}
      style={{ borderLeftColor: typeTheme.accent }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isFreeClass && (
              <span className="inline-flex rounded-full bg-[#a3b693]/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]">
                FREE
              </span>
            )}
            {almostFull && !full && !isPast && (
              <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                Almost full
              </span>
            )}
          </div>
          <h3 className="font-display text-sm font-semibold leading-snug tracking-tight break-words text-foreground">
            {classTitle(session)}
          </h3>
          {guideName ? (
            <p className="mt-0.5 text-xs font-medium leading-snug" style={{ color: SAGE }}>
              {guideName}
            </p>
          ) : null}
        </div>
        <TypeBadge type={badgeType} size="sm" className="shrink-0" />
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
        <span className="inline-flex flex-wrap items-center gap-1 font-medium tabular-nums">
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          {timeLabel}
          {zoneLabel ? (
            <span className="font-normal text-muted-foreground/80">({zoneLabel})</span>
          ) : null}
        </span>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span className="break-words">{session.location}</span>
        </span>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="tabular-nums">{durationMin} mins</span>
      </p>

      {friendsGoing.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex -space-x-2">
            {friendsGoing.slice(0, 3).map((f) =>
              f.avatar_url?.trim() ? (
                <img
                  key={f.friend_id}
                  src={f.avatar_url}
                  alt=""
                  className="h-5 w-5 rounded-full border-2 border-card object-cover"
                />
              ) : (
                <span
                  key={f.friend_id}
                  className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-[#a3b693] text-[9px] font-bold text-white"
                  aria-hidden
                >
                  {(f.first_name?.trim() || "F").charAt(0).toUpperCase()}
                </span>
              ),
            )}
          </div>
          <p className="text-[11px] font-medium" style={{ color: SAGE }}>
            {friendsGoingLabel(friendsGoing)}
          </p>
        </div>
      ) : null}

      {desc ? (
        <div className="mt-2 min-w-0">
          <p
            className={cn(
              "text-[11px] leading-snug text-muted-foreground",
              !descExpanded && "line-clamp-2",
            )}
          >
            {desc}
          </p>
          {(desc.length > 72 || descExpanded) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDescExpanded((v) => !v);
              }}
              className="mt-0.5 text-[11px] font-semibold"
              style={{ color: SAGE }}
            >
              {descExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onReserve}
        disabled={!canReserve && !canWaitlist}
        className={cn(
          "mt-2.5 w-full rounded-lg py-2 text-xs font-semibold transition-opacity",
          isPast || alreadyBooked || hasOverlap
            ? "cursor-not-allowed bg-muted text-muted-foreground"
            : canWaitlist
              ? onWaitlist
                ? "border border-[#a3b693]/60 bg-[#e8efe3] text-[#3d4f36] active:opacity-90"
                : "border border-[#a3b693]/60 bg-card text-[#3d4f36] active:opacity-90"
              : isFreeClass
                ? "bg-[#a3b693] text-white active:opacity-90"
                : "bg-primary text-primary-foreground active:opacity-90",
        )}
      >
        {isPast
          ? "Past"
          : alreadyBooked
            ? "Booked"
            : hasOverlap
              ? "Time conflict"
              : full
                ? onWaitlist
                  ? "On waitlist"
                  : "Join Waitlist"
                : isFreeClass
                  ? "Book Free"
                  : "Reserve"}
      </button>
    </div>
  );
}
