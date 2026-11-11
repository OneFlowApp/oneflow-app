import { createFileRoute, Link } from "@tanstack/react-router";
import { isEarlyCancellation } from "@/lib/earlyCancellation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STUDIO_ROOMS } from "@/lib/studioRooms";
import {
  ChevronRight,
  Download,
  Filter,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { addDays, isSameDay, startOfDay } from "@/lib/format";
import {
  civilAddDaysYmd,
  dayBoundsForDateKey,
  formatStudioTime12Upper,
  STUDIO_TIMEZONE,
  ymdInTimeZone,
} from "@/lib/timezone";
import { WalkInSheet } from "@/components/admin/WalkInSheet";
import { CurrentTimeLine, currentTimeLineInsertIndex } from "@/components/CurrentTimeLine";
import { TypeBadge } from "@/components/TypeBadge";
import { WeekDayStrip, weekdayStripLetter } from "@/components/WeekDayStrip";
import { classTypeTheme } from "@/lib/classTypeTheme";
import { classTitle, classTypeSlugFor } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { displayClassType } from "@/types/studio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ALLOWED_CLASS_TYPE_SLUGS,
  CLASS_TYPE_SLUG_LABEL,
  isAllowedClassTypeSlug,
} from "@/lib/allowedClassTypes";
import {
  fetchRosterMemberAddonAccess,
  type RosterMemberAddonAccess,
} from "@/components/admin/RosterAddonPills";
import { useNowMs } from "@/hooks/use-now-ms";
import { useScrollToLiveClass } from "@/hooks/use-scroll-to-live-class";
import { isClassEnded, pickFocusClassId } from "@/lib/liveClassList";

export const Route = createFileRoute("/admin/bookings/")({
  component: BookingsPage,
});

type BookingsSortKey = "class_time" | "member_name" | "status";

const SAGE = "#a3b693";

type BookingStatus = "confirmed" | "attended" | "cancelled" | "no-show";

type WeekClassRow = {
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

type BookingRowRaw = {
  id: string;
  status: string;
  cancelled_at?: string | null;
  late_cancel?: boolean | null;
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
};

type AdminBookingRow = {
  id: string;
  profile_id: string | null;
  class_id: string;
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

function startOfCalendarWeekSunday(d: Date) {
  const x = startOfDay(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - dow);
  return x;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function formatClassTime(iso: string) {
  return formatStudioTime12Upper(iso);
}

function shortMemberName(first: string, last: string) {
  const f = first.trim();
  const L = last.trim().charAt(0).toUpperCase();
  if (!f) return L ? `${L}.` : "Member";
  return L ? `${f} ${L}.` : f;
}

function normalizeBooking(
  raw: BookingRowRaw,
  addonAccess: RosterMemberAddonAccess,
): AdminBookingRow | null {
  const prof = one(raw.profiles);
  const fn = prof?.first_name?.trim() ?? "";
  const ln = prof?.last_name?.trim() ?? "";
  const memberFull = fn || ln ? `${fn} ${ln}`.trim() : "Unknown member";
  const cls = one(raw.classes);
  if (!cls?.starts_at) return null;
  if (isEarlyCancellation({ ...raw, starts_at: cls.starts_at })) return null;
  const st = String(raw.status);
  const status = (
    ["confirmed", "attended", "cancelled", "no-show"].includes(st) ? st : "confirmed"
  ) as BookingStatus;
  const pid = raw.profile_id;
  return {
    id: raw.id,
    profile_id: raw.profile_id,
    class_id: raw.class_id,
    memberFull,
    memberShort: shortMemberName(fn, ln || ""),
    status,
    classStartsAtIso: cls.starts_at,
    creditLabel: raw.payment_method?.replace(/_/g, " ") ?? "—",
    matAddon: Boolean(pid && addonAccess.matProfileIds.has(pid)),
    towelAddon: Boolean(pid && addonAccess.towelProfileIds.has(pid)),
    hasSageCredit: Boolean(pid && addonAccess.cafeProfileIds.has(pid)),
    memberRole: prof?.role ?? null,
  };
}

function rosterStatusLabel(status: BookingStatus): string {
  if (status === "confirmed") return "Booked";
  if (status === "attended") return "Attended";
  if (status === "cancelled") return "Cancelled";
  return "No-show";
}

function rosterStatusSortRank(status: BookingStatus): number {
  if (status === "confirmed") return 0;
  if (status === "attended") return 1;
  if (status === "no-show") return 2;
  return 3;
}

const SESSION_LOCATIONS = STUDIO_ROOMS;

function sessionMatchesClassTypeFilter(classType: string, filter: string): boolean {
  if (filter === "all") return true;
  const c = classType.trim().toLowerCase();
  if (filter === "sauna") return c.includes("sauna") || c === "sauna_journey";
  if (filter === "pilates") return c === "pilates";
  if (isAllowedClassTypeSlug(filter)) return c === filter;
  return c === filter.toLowerCase();
}

const SAVED_VIEW_KEY = "of-admin-bookings-view";

type SavedView = {
  day: Date | null;
  query?: string;
  sort?: string;
  type?: string;
  guide?: string;
  location?: string;
};

/** The day and filters last used on the bookings list in the past hour. */
function readSavedView(): SavedView | null {
  try {
    const raw = sessionStorage.getItem(SAVED_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Omit<SavedView, "day"> & { day?: string; savedAt?: number };
    // Only restore a recent view, so opening the app the next morning starts on today.
    if (!v.savedAt || Date.now() - v.savedAt > 60 * 60 * 1000) return null;
    const day = v.day ? new Date(v.day) : null;
    return { ...v, day: day && !Number.isNaN(day.getTime()) ? day : null };
  } catch {
    return null;
  }
}

function BookingsPage() {
  // Subscribe so a class-type rename repaints class titles and badges.
  useClassCatalog();
  const saved = useMemo(readSavedView, []);
  const [viewWeekStart, setViewWeekStart] = useState(() =>
    saved?.day ? startOfCalendarWeekSunday(saved.day) : startOfCalendarWeekSunday(new Date()),
  );
  const [selectedDay, setSelectedDay] = useState(() => (saved?.day ? startOfDay(saved.day) : startOfDay(new Date())));
  const [weekClasses, setWeekClasses] = useState<WeekClassRow[]>([]);
  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(saved?.query ?? "");
  const [bookingsSort, setBookingsSort] = useState<BookingsSortKey>(
    (saved?.sort as BookingsSortKey | undefined) ?? "class_time",
  );
  const [sessionTypeFilter, setSessionTypeFilter] = useState<string>(saved?.type ?? "all");
  const [sessionGuideFilter, setSessionGuideFilter] = useState<string>(saved?.guide ?? "all");
  const [sessionLocationFilter, setSessionLocationFilter] = useState<string>(saved?.location ?? "all");

  // Remember the day and filters, so "Back to day list" returns to the same view.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        SAVED_VIEW_KEY,
        JSON.stringify({
          day: selectedDay.toISOString(),
          savedAt: Date.now(),
          query,
          sort: bookingsSort,
          type: sessionTypeFilter,
          guide: sessionGuideFilter,
          location: sessionLocationFilter,
        }),
      );
    } catch {
      /* private mode: nothing to remember */
    }
  }, [selectedDay, query, bookingsSort, sessionTypeFilter, sessionGuideFilter, sessionLocationFilter]);
  const [walkInOpen, setWalkInOpen] = useState(false);

  const nowMs = useNowMs();
  const todayKey = ymdInTimeZone(new Date(), STUDIO_TIMEZONE);
  const selectedDayKey = ymdInTimeZone(selectedDay, STUDIO_TIMEZONE);
  const isLiveDay = selectedDayKey === todayKey;

  const stripDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart],
  );

  const loadWeek = useCallback(async () => {
    setLoading(true);
    const weekStartKey = ymdInTimeZone(viewWeekStart, STUDIO_TIMEZONE);
    const weekEndKey = civilAddDaysYmd(weekStartKey, 7);
    const startIso = dayBoundsForDateKey(weekStartKey, STUDIO_TIMEZONE).startUtcIso;
    const endIso = dayBoundsForDateKey(weekEndKey, STUDIO_TIMEZONE).startUtcIso;

    const { data: classesData, error: classesError } = await supabase
      .from("classes")
      .select(
        "id, name, title_override, class_type, class_type_id, starts_at, ends_at, capacity, booked_count, location, guide_name, is_cancelled",
      )
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
      .eq("is_cancelled", false)
      .order("starts_at");

    if (classesError) {
      console.error("bookings week: classes load failed", classesError);
      toast.error(supabaseErrorMessage(classesError, "Could not load classes"));
      setWeekClasses([]);
      setBookings([]);
      setLoading(false);
      return;
    }

    const classes = (classesData ?? []) as WeekClassRow[];
    setWeekClasses(classes);
    const classIds = classes.map((c) => c.id);

    if (classIds.length === 0) {
      setBookings([]);
      setLoading(false);
      return;
    }

    const [{ data: bookingsData, error: bookingsError }, addonAccess] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          `
        id,
        status,
        cancelled_at,
        late_cancel,
        profile_id,
        class_id,
        payment_method,
        mat_addon,
        towel_addon,
        profiles ( first_name, last_name, role ),
        classes ( id, name, starts_at, ends_at )
      `,
        )
        .in("class_id", classIds),
      fetchRosterMemberAddonAccess(supabase),
    ]);

    if (bookingsError) {
      console.error("bookings week: bookings load failed", bookingsError);
      toast.error(supabaseErrorMessage(bookingsError, "Could not load bookings"));
      setBookings([]);
      setLoading(false);
      return;
    }

    const rawRows = (bookingsData ?? []) as unknown as BookingRowRaw[];
    const mapped = rawRows
      .map((row) => normalizeBooking(row, addonAccess))
      .filter((r): r is AdminBookingRow => r !== null);
    setBookings(mapped);
    setLoading(false);
  }, [viewWeekStart]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const daySessions = useMemo(() => {
    const out = weekClasses.filter((c) => isSameDay(new Date(c.starts_at), selectedDay));
    out.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return out;
  }, [weekClasses, selectedDay]);

  const guideNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of weekClasses) {
      const g = c.guide_name?.trim();
      if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [weekClasses]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>(SESSION_LOCATIONS);
    for (const c of weekClasses) {
      const loc = c.location?.trim();
      if (loc) set.add(loc);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [weekClasses]);

  const daySessionsFiltered = useMemo(() => {
    return daySessions.filter((s) => {
      if (!sessionMatchesClassTypeFilter(s.class_type, sessionTypeFilter)) return false;
      if (sessionGuideFilter !== "all") {
        if ((s.guide_name ?? "").trim() !== sessionGuideFilter) return false;
      }
      if (sessionLocationFilter !== "all") {
        if ((s.location ?? "").trim() !== sessionLocationFilter) return false;
      }
      return true;
    });
  }, [daySessions, sessionTypeFilter, sessionGuideFilter, sessionLocationFilter]);

  const sessionFilterCount =
    Number(sessionTypeFilter !== "all") +
    Number(sessionGuideFilter !== "all") +
    Number(sessionLocationFilter !== "all");

  const clearSessionFilters = () => {
    setSessionTypeFilter("all");
    setSessionGuideFilter("all");
    setSessionLocationFilter("all");
    setQuery("");
  };

  const bookingsByClass = useMemo(() => {
    const m = new Map<string, AdminBookingRow[]>();
    for (const b of bookings) {
      if (!isSameDay(new Date(b.classStartsAtIso), selectedDay)) continue;
      const list = m.get(b.class_id) ?? [];
      list.push(b);
      m.set(b.class_id, list);
    }
    for (const list of m.values()) {
      list.sort((a, x) => {
        if (bookingsSort === "status") {
          const dr = rosterStatusSortRank(a.status) - rosterStatusSortRank(x.status);
          if (dr !== 0) return dr;
        }
        return a.memberFull.localeCompare(x.memberFull);
      });
    }
    return m;
  }, [bookings, selectedDay, bookingsSort]);

  const qNorm = query.trim().toLowerCase();
  const visibleSessions = useMemo(() => {
    const filtered = daySessionsFiltered.filter((session) => {
      const roster = bookingsByClass.get(session.id) ?? [];
      if (!qNorm) return true;
      return roster.some((b) => b.memberFull.toLowerCase().includes(qNorm));
    });
    let sessions = filtered;
    if (bookingsSort === "member_name") {
      sessions = [...filtered].sort((s1, s2) => {
        const r1 = bookingsByClass.get(s1.id) ?? [];
        const r2 = bookingsByClass.get(s2.id) ?? [];
        const minName = (rows: AdminBookingRow[]): string =>
          rows.length === 0
            ? "\uffff"
            : rows.reduce((best, b) => {
                const n = b.memberFull.toLowerCase();
                return n < best ? n : best;
              }, rows[0]!.memberFull.toLowerCase());
        return minName(r1).localeCompare(minName(r2));
      });
    } else {
      // Chronological day view (past above, upcoming below) — Mindbody-style.
      sessions = [...sessions].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    }
    return sessions;
  }, [daySessionsFiltered, bookingsByClass, qNorm, bookingsSort]);

  const timeLineIndex = useMemo(
    () => (isLiveDay ? currentTimeLineInsertIndex(visibleSessions, nowMs) : -1),
    [isLiveDay, visibleSessions, nowMs],
  );

  const focusClassId = useMemo(
    () => (isLiveDay ? pickFocusClassId(visibleSessions, nowMs) : null),
    [isLiveDay, visibleSessions, nowMs],
  );

  useScrollToLiveClass(focusClassId, isLiveDay && !loading);

  const bookingsFilterBadgeCount = sessionFilterCount + (qNorm ? 1 : 0);

  const exportCsv = () => {
    const header = ["Class", "Time", "Member", "Short name", "Status", "Credit"];
    const rows: string[] = [];
    for (const session of daySessionsFiltered) {
      const roster = bookingsByClass.get(session.id) ?? [];
      const filtered = qNorm
        ? roster.filter((b) => b.memberFull.toLowerCase().includes(qNorm))
        : roster;
      for (const b of filtered) {
        rows.push(
          [
            classTitle(session),
            `${formatClassTime(session.starts_at)} – ${formatClassTime(session.ends_at)}`,
            b.memberFull,
            b.memberShort,
            rosterStatusLabel(b.status),
            b.creditLabel,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      }
    }
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings-${selectedDay.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const today = startOfDay(new Date());

  return (
    <div className="pb-10">
      <PageHeader
        title="Bookings"
        description="Daily rosters by class"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setWalkInOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:px-4"
              style={{ backgroundColor: SAGE }}
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
              Walk-in
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border-2 bg-card px-3.5 py-2 text-sm font-semibold transition hover:bg-muted/60 sm:px-4"
              style={{ borderColor: SAGE, color: SAGE }}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden /> Export CSV
            </button>
          </div>
        }
      />

      <WeekDayStrip
        className="mb-3"
        days={stripDays.map((d) => ({
          key: String(d.getTime()),
          weekdayLetter: weekdayStripLetter(d.getDay()),
          dayOfMonth: d.getDate(),
          selected: isSameDay(d, selectedDay),
          isToday: isSameDay(d, today),
        }))}
        onSelect={(key) => {
          const d = stripDays.find((x) => String(x.getTime()) === key);
          if (d) setSelectedDay(startOfDay(d));
        }}
        onPrevWeek={() => {
          setViewWeekStart(addDays(viewWeekStart, -7));
          setSelectedDay((d) => addDays(d, -7));
        }}
        onNextWeek={() => {
          setViewWeekStart(addDays(viewWeekStart, 7));
          setSelectedDay((d) => addDays(d, 7));
        }}
      />

      <div className="relative mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members for this day…"
            className="w-full rounded-xl border-2 border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[#a3b693]"
          />
        </div>
        <Select value={bookingsSort} onValueChange={(v) => setBookingsSort(v as BookingsSortKey)}>
          <SelectTrigger className="w-full sm:w-56 shrink-0">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="class_time">Class time</SelectItem>
            <SelectItem value="member_name">Member name A–Z</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filters
            {bookingsFilterBadgeCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {bookingsFilterBadgeCount}
              </span>
            ) : null}
          </span>
          {bookingsFilterBadgeCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs text-muted-foreground"
              onClick={clearSessionFilters}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="w-full min-w-0 sm:w-44">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Class type
            </label>
            <Select value={sessionTypeFilter} onValueChange={setSessionTypeFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ALLOWED_CLASS_TYPE_SLUGS.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {CLASS_TYPE_SLUG_LABEL[slug]}
                  </SelectItem>
                ))}
                <SelectItem value="sauna">Sauna</SelectItem>
                <SelectItem value="pilates">Pilates (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full min-w-0 sm:w-52">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Guide
            </label>
            <Select value={sessionGuideFilter} onValueChange={setSessionGuideFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All guides" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All guides</SelectItem>
                {guideNameOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full min-w-0 sm:w-44">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Location
            </label>
            <Select value={sessionLocationFilter} onValueChange={setSessionLocationFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locationOptions.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading bookings…
        </div>
      ) : daySessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No classes scheduled for this day.
        </div>
      ) : daySessionsFiltered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No classes match your filters for this day.
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No members match &ldquo;{query.trim()}&rdquo; for the filtered classes on this day.
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {visibleSessions.map((session, idx) => {
            const badgeType = displayClassType(classTypeSlugFor(session) ?? session.class_type);
            const typeTheme = classTypeTheme(badgeType);

            return (
              <li key={session.id}>
                {timeLineIndex === idx ? (
                  <div className="border-b border-border px-2 py-1.5">
                    <CurrentTimeLine />
                  </div>
                ) : null}
                <Link
                  to="/admin/bookings/$classId"
                  params={{ classId: session.id }}
                  data-live-class-id={session.id}
                  className={cn(
                    "flex items-center gap-2 border-b border-border border-l-4 px-3 py-2 transition last:border-b-0 hover:bg-muted/40",
                    typeTheme.tint,
                    isLiveDay && isClassEnded(session, nowMs) && "opacity-55",
                  )}
                  style={{ borderLeftColor: typeTheme.accent }}
                >
                  <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground sm:w-24 sm:text-sm">
                    {formatClassTime(session.starts_at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <p className="truncate font-display text-sm font-semibold text-foreground">
                        {classTitle(session)}
                      </p>
                      <TypeBadge type={badgeType} size="sm" className="shrink-0" />
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {session.guide_name?.trim() || "No guide"}
                      {session.location?.trim() ? ` · ${session.location.trim()}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-xs font-semibold text-muted-foreground">
                    {session.booked_count}/{session.capacity}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <WalkInSheet
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        onDone={() => void loadWeek()}
      />
    </div>
  );
}
