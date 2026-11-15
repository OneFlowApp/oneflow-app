import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { CheckInClassAccordion } from "@/components/admin/CheckInClassAccordion";
import { WalkInSheet } from "@/components/admin/WalkInSheet";
import { GreenPointVisitDialog } from "@/components/admin/GreenPointVisitDialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { classTitle } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { cn } from "@/lib/utils";
import { fetchRosterMemberAddonAccess } from "@/components/admin/RosterAddonPills";
import { jhbDayBounds } from "@/lib/jhbTime";
import {
  type BookingRow,
  type RosterRow,
  formatClassTime,
  normalizeBooking,
} from "@/lib/checkInRoster";
import { pickNextUpcomingClassId } from "@/lib/checkInUpcoming";
import { orderClassesForLiveDay } from "@/lib/liveClassList";
import {
  DEFAULT_CHECKIN_OPEN_MINUTES_BEFORE,
  checkInWindowAt,
  parseCheckinOpenMinutesBefore,
} from "@/lib/checkInWindow";
import { useNowMs } from "@/hooks/use-now-ms";
import { useScrollToLiveClass } from "@/hooks/use-scroll-to-live-class";
export const Route = createFileRoute("/admin/check-in")({
  validateSearch: (raw: Record<string, unknown>) => ({
    class: typeof raw.class === "string" ? raw.class : undefined,
  }),
  component: CheckInPage,
});

type TodayClass = {
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
  guide_id: string | null;
};

function CheckInPage() {
  // Subscribe so a class-type rename repaints the roster headings.
  useClassCatalog();
  const search = Route.useSearch();
  const [todayClasses, setTodayClasses] = useState<TodayClass[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [expandedClassIds, setExpandedClassIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [greenPointOpen, setGreenPointOpen] = useState(false);
  const [checkinOpenMinutes, setCheckinOpenMinutes] = useState(DEFAULT_CHECKIN_OPEN_MINUTES_BEFORE);
  const classListRef = useRef<HTMLDivElement>(null);
  const nowMs = useNowMs();

  const orderedClasses = useMemo(
    () => orderClassesForLiveDay(todayClasses, nowMs),
    [todayClasses, nowMs],
  );

  const nextUpcomingClassId = useMemo(
    () => pickNextUpcomingClassId(todayClasses, nowMs),
    [todayClasses, nowMs],
  );

  useScrollToLiveClass(
    nextUpcomingClassId,
    !loading && orderedClasses.length > 0,
    classListRef,
  );

  useEffect(() => {
    if (!search.class) return;
    setExpandedClassIds((prev) => new Set(prev).add(search.class!));
  }, [search.class]);

  useEffect(() => {
    if (loading || !nextUpcomingClassId) return;
    setExpandedClassIds((prev) => {
      if (prev.size > 0) return prev;
      return new Set([nextUpcomingClassId]);
    });
  }, [loading, nextUpcomingClassId]);

  const rosterByClassId = useMemo(() => {
    const map = new Map<string, RosterRow[]>();
    for (const row of roster) {
      if (row.status === "cancelled") continue;
      const list = map.get(row.class_id) ?? [];
      list.push(row);
      map.set(row.class_id, list);
    }
    return map;
  }, [roster]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { startUtcIso, endUtcIso } = jhbDayBounds();

    const [{ data: classesData, error: classesError }, settingsRes] = await Promise.all([
      supabase
        .from("classes")
        .select(
          "id, name, title_override, class_type, class_type_id, starts_at, ends_at, capacity, booked_count, location, guide_name, guide_id",
        )
        .gte("starts_at", startUtcIso)
        .lte("starts_at", endUtcIso)
        .eq("is_cancelled", false)
        .order("starts_at"),
      supabase
        .from("studio_settings")
        .select("value")
        .eq("key", "checkin_open_minutes_before")
        .maybeSingle(),
    ]);

    const openMinutes = parseCheckinOpenMinutesBefore(
      (settingsRes.data as { value?: string } | null)?.value,
    );
    setCheckinOpenMinutes(openMinutes);

    if (classesError) {
      console.error("check-in: classes load failed", classesError);
      toast.error(supabaseErrorMessage(classesError, "Could not load today’s classes"));
      setTodayClasses([]);
      setRoster([]);
      setLoading(false);
      return;
    }

    const rawClasses = (classesData ?? []) as unknown as Record<string, unknown>[];
    // Show the full JHB day — not only classes whose check-in window is open right now
    // (that filter made mid-day look like “no classes today”).
    const classes: TodayClass[] = rawClasses.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      title_override: (row.title_override as string | null) ?? null,
      class_type_id: (row.class_type_id as string | null) ?? null,
      class_type: String(row.class_type ?? ""),
      starts_at: String(row.starts_at ?? ""),
      ends_at: String(row.ends_at ?? ""),
      capacity: Number(row.capacity ?? 0),
      booked_count: Number(row.booked_count ?? 0),
      location: (row.location as string | null) ?? null,
      guide_name: (row.guide_name as string | null) ?? null,
      guide_id: (row.guide_id as string | null) ?? null,
    }));
    setTodayClasses(classes);

    const classIds = classes.map((c) => c.id);

    if (classIds.length === 0) {
      setRoster([]);
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
        profile_id,
        class_id,
        qr_token,
        payment_method,
        mat_addon,
        towel_addon,
        profiles ( first_name, last_name, avatar_url, role ),
        classes ( id, name, starts_at, guide_name, class_type )
      `,
        )
        .in("class_id", classIds),
      fetchRosterMemberAddonAccess(supabase),
    ]);

    if (bookingsError) {
      console.error("check-in: bookings load failed", bookingsError);
      toast.error(supabaseErrorMessage(bookingsError, "Could not load bookings"));
      setRoster([]);
      setLoading(false);
      return;
    }

    const rows = (bookingsData ?? []) as unknown as BookingRow[];
    const normalized = rows
      .map((row) => normalizeBooking(row, addonAccess))
      .filter((r): r is RosterRow => r !== null);
    setRoster(normalized);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-checkin-bookings-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        void loadData();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const sessions = useMemo(() => {
    return orderedClasses.map((c) => {
      const forClass = rosterByClassId.get(c.id) ?? [];
      const attended = forClass.filter((b) => b.status === "attended").length;
      const window = checkInWindowAt(
        c.starts_at,
        c.class_type,
        checkinOpenMinutes,
        nowMs,
      );
      return {
        key: c.id,
        label: classTitle(c),
        time: formatClassTime(c.starts_at),
        total: forClass.length,
        attended,
        guideName: c.guide_name,
        checkInOpen: window.allowed,
        checkInHint: window.allowed
          ? "Check-in open"
          : (window.reason ?? "Check-in closed"),
      };
    });
  }, [orderedClasses, rosterByClassId, checkinOpenMinutes, nowMs]);

  const toggleClassExpanded = (classId: string, open: boolean) => {
    setExpandedClassIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(classId);
      else next.delete(classId);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-[599px]:overflow-y-auto max-[599px]:scroll-touch">
      <PageHeader
        title="Check-In"
        actions={
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setGreenPointOpen(true)}>
              Green Point visit
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              onClick={() => setWalkInOpen(true)}
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
              Walk-in
            </Button>
          </div>
        }
      />
      <GreenPointVisitDialog open={greenPointOpen} onOpenChange={setGreenPointOpen} />

      <WalkInSheet
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        onDone={() => void loadData()}
      />

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading check-in…</div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-4",
            "min-[600px]:overflow-hidden",
          )}
        >
          <div
            className={cn(
              "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card p-3",
              "min-[600px]:min-h-0",
            )}
          >
            <p className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Today&apos;s classes
            </p>
            <div
              ref={classListRef}
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5"
            >
              {sessions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No classes scheduled for today.
                </p>
              ) : (
                sessions.map((s) => (
                  <div key={s.key} data-live-class-id={s.key}>
                    <CheckInClassAccordion
                    key={s.key}
                    session={s}
                    roster={rosterByClassId.get(s.key) ?? []}
                    expanded={expandedClassIds.has(s.key)}
                    onExpandedChange={(open) => toggleClassExpanded(s.key, open)}
                    loading={loading}
                    onUpdated={loadData}
                    openMinutesBefore={checkinOpenMinutes}
                  />
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
