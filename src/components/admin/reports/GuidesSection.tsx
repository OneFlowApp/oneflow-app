import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  Download,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/admin/StatCard";
import { supabase } from "@/lib/supabase";
import { downloadReportCsv } from "@/lib/reportsCsv";
import type { PeriodBounds } from "@/lib/reportsPeriod";
import { cn } from "@/lib/utils";

const SAGE = "#a3b693";
const SAGE_BORDER = "border-[#c5d4b8]/80";

type ClassRow = {
  id: string;
  name: string;
  guide_name: string | null;
  capacity: number | null;
  starts_at: string;
};

type BookingRow = {
  class_id: string;
  status: string;
};

type GuideRow = {
  name: string;
  sessions: number;
  attended: number;
  booked: number;
  capacity: number;
  occupancyPct: number;
};

type SortKey = "name" | "sessions" | "attended" | "occupancy";
type SortDir = "asc" | "desc";

type SectionState = {
  loading: boolean;
  totalSessions: number;
  totalAttended: number;
  uniqueGuides: number;
  unattributed: number;
  rows: GuideRow[];
  errorMsg: string | null;
};

const EMPTY: SectionState = {
  loading: true,
  totalSessions: 0,
  totalAttended: 0,
  uniqueGuides: 0,
  unattributed: 0,
  rows: [],
  errorMsg: null,
};

async function fetchBookingsForClasses(classIds: string[]): Promise<BookingRow[]> {
  if (classIds.length === 0) return [];
  const chunk = 180;
  const all: BookingRow[] = [];
  for (let i = 0; i < classIds.length; i += chunk) {
    const slice = classIds.slice(i, i + chunk);
    const { data, error } = await supabase
      .from("bookings")
      .select("class_id, status")
      .in("class_id", slice)
      .in("status", ["confirmed", "attended"]);
    if (error) {
      console.error("guides bookings chunk", error);
      continue;
    }
    all.push(...((data ?? []) as BookingRow[]));
  }
  return all;
}

export function GuidesSection({ bounds }: { bounds: PeriodBounds }) {
  const [state, setState] = useState<SectionState>(EMPTY);
  const [sortKey, setSortKey] = useState<SortKey>("attended");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { startUtcIso, endUtcIso } = bounds;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, errorMsg: null }));

    void (async () => {
      const classesRes = await supabase
        .from("classes")
        .select("id, name, guide_name, capacity, starts_at")
        .gte("starts_at", startUtcIso)
        .lte("starts_at", endUtcIso)
        .eq("is_cancelled", false);

      if (cancelled) return;

      if (classesRes.error) {
        console.error("guides classes", classesRes.error);
        setState((s) => ({ ...s, loading: false, errorMsg: classesRes.error?.message ?? null }));
        return;
      }

      const allClasses = (classesRes.data ?? []) as ClassRow[];
      // Empty classes the guide left don't count as sessions taught.
      const { data: leftRows } = allClasses.length
        ? await supabase
            .from("empty_class_checkins")
            .select("class_id")
            .eq("outcome", "left")
            .in(
              "class_id",
              allClasses.map((c) => c.id),
            )
        : { data: [] };
      const leftIds = new Set(((leftRows ?? []) as { class_id: string }[]).map((r) => r.class_id));
      const classes = allClasses.filter((c) => !leftIds.has(c.id));
      const classIds = classes.map((c) => c.id);
      const bookings = await fetchBookingsForClasses(classIds);
      if (cancelled) return;

      const bookedPerClass = new Map<string, number>();
      const attendedPerClass = new Map<string, number>();
      for (const b of bookings) {
        bookedPerClass.set(b.class_id, (bookedPerClass.get(b.class_id) ?? 0) + 1);
        if (b.status === "attended") {
          attendedPerClass.set(b.class_id, (attendedPerClass.get(b.class_id) ?? 0) + 1);
        }
      }

      const perGuide = new Map<
        string,
        { sessions: number; attended: number; booked: number; capacity: number }
      >();
      let unattributed = 0;
      let totalAttended = 0;
      for (const c of classes) {
        const guide = (c.guide_name ?? "").trim();
        const attended = attendedPerClass.get(c.id) ?? 0;
        totalAttended += attended;
        if (!guide) {
          unattributed += 1;
          continue;
        }
        const entry = perGuide.get(guide) ?? {
          sessions: 0,
          attended: 0,
          booked: 0,
          capacity: 0,
        };
        entry.sessions += 1;
        entry.attended += attended;
        entry.booked += bookedPerClass.get(c.id) ?? 0;
        entry.capacity += Number(c.capacity ?? 0);
        perGuide.set(guide, entry);
      }

      const rows: GuideRow[] = [...perGuide.entries()].map(([name, agg]) => ({
        name,
        sessions: agg.sessions,
        attended: agg.attended,
        booked: agg.booked,
        capacity: agg.capacity,
        occupancyPct: agg.capacity > 0 ? Math.round((agg.booked / agg.capacity) * 100) : 0,
      }));

      setState({
        loading: false,
        totalSessions: classes.length,
        totalAttended,
        uniqueGuides: rows.length,
        unattributed,
        rows,
        errorMsg: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [startUtcIso, endUtcIso]);

  const sortedRows = useMemo(() => {
    const out = [...state.rows];
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "sessions") cmp = a.sessions - b.sessions;
      else if (sortKey === "attended") cmp = a.attended - b.attended;
      else cmp = a.occupancyPct - b.occupancyPct;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [state.rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (k !== sortKey) return null;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-0.5 inline h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="ml-0.5 inline h-3 w-3" aria-hidden />
    );
  };

  const exportCsv = () => {
    const header = ["Guide", "Sessions", "Attended", "Capacity (sum)", "Avg occupancy %"];
    const body = sortedRows.map((g) => [
      g.name,
      g.sessions,
      g.attended,
      g.capacity,
      g.occupancyPct,
    ]);
    downloadReportCsv(`guides-report-${new Date().toISOString().slice(0, 10)}.csv`, [
      header,
      ...body,
    ]);
  };

  return (
    <section>
      <h3
        className="mb-3 font-display text-sm font-bold uppercase tracking-wide"
        style={{ color: SAGE }}
      >
        Guides / Instructors
      </h3>

      {/* Disclaimer */}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Estimated from{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">classes.guide_name</code>. Will switch
          to <code className="rounded bg-amber-100 px-1 py-0.5">classes.guide_id</code> once every
          class is linked to a guides FK. Until then, two records with the same spelling roll up;
          typos split a guide across rows. TODO.
        </span>
      </div>

      {state.errorMsg ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.errorMsg}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {state.loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : (
          <>
            <StatCard
              label="Total sessions"
              value={state.totalSessions.toLocaleString()}
              icon={<CalendarCheck className="h-4 w-4" />}
            />
            <StatCard
              label="Total check-ins"
              value={state.totalAttended.toLocaleString()}
              icon={<UserCheck className="h-4 w-4" />}
            />
            <StatCard
              label="Guides"
              value={state.uniqueGuides.toLocaleString()}
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              label="Unattributed"
              value={state.unattributed.toLocaleString()}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      <div
        className={cn(
          "mt-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5",
          SAGE_BORDER,
          "bg-[#f4f7f0]/80",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Per-guide breakdown
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={exportCsv}
            disabled={state.loading || sortedRows.length === 0}
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
        {state.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No guide-attributed sessions in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="hover:text-foreground"
                    >
                      Guide <SortIcon k="name" />
                    </button>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("sessions")}
                      className="hover:text-foreground"
                    >
                      Sessions <SortIcon k="sessions" />
                    </button>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("attended")}
                      className="hover:text-foreground"
                    >
                      Attended <SortIcon k="attended" />
                    </button>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("occupancy")}
                      className="hover:text-foreground"
                    >
                      Avg occupancy <SortIcon k="occupancy" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((g) => (
                  <tr key={g.name} className="border-t border-[#c5d4b8]/40">
                    <td className="px-2 py-2 font-medium">{g.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.sessions}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.attended}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          g.occupancyPct >= 100
                            ? "bg-destructive/15 text-destructive"
                            : g.occupancyPct >= 80
                              ? "bg-amber-100 text-amber-900"
                              : "bg-[#e8efe3] text-[#3d4f36]",
                        )}
                      >
                        {g.occupancyPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
