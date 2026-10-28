import { createFileRoute } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useMemo, useState } from "react";
import { CalendarDays, Percent, UserCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { ClassRosterSheet, type ClassRosterSession } from "@/components/admin/ClassRosterSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { useAdminDashboard } from "@/lib/queries/adminDashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const TZ = "Africa/Johannesburg";

type TodayClassRow = {
  id: string;
  name: string;
  starts_at: string;
  booked_count: number;
  capacity: number;
  guide_name: string | null;
};

function AdminDashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { profile } = useAuth();
  const { data, isLoading, isError, error } = useAdminDashboard();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterSession, setRosterSession] = useState<ClassRosterSession | null>(null);

  const viewerRole = effectiveRole(profile);
  const canOpenClassRoster = useMemo(() => {
    const r = (viewerRole ?? "").toLowerCase();
    return r === "director" || r === "management";
  }, [viewerRole]);

  const classes = (data?.classes ?? []) as TodayClassRow[];
  const memberCount = data?.memberCount ?? 0;
  const signInsToday = data?.signInsToday ?? 0;

  const classCount = classes.length;
  const occPcts = classes
    .filter((c) => c.capacity > 0)
    .map((c) => (c.booked_count / c.capacity) * 100);
  const avgOcc =
    occPcts.length > 0 ? Math.round(occPcts.reduce((a, b) => a + b, 0) / occPcts.length) : 0;

  const todayLabel = new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: TZ,
  });

  const openClassRoster = (c: TodayClassRow) => {
    if (!canOpenClassRoster) return;
    setRosterSession({
      id: c.id,
      name: c.name,
      starts_at: c.starts_at,
      capacity: c.capacity,
      booked_count: c.booked_count,
    });
    setRosterOpen(true);
  };

  const errorMsg = isError
    ? error instanceof Error
      ? error.message
      : "Could not load dashboard data."
    : null;

  return (
    <div>
      <PageHeader title="Dashboard" description={todayLabel} />

      <ClassRosterSheet
        open={rosterOpen}
        onOpenChange={(o) => {
          setRosterOpen(o);
          if (!o) setRosterSession(null);
        }}
        session={rosterSession}
      />

      {isLoading ? (
        <AdminDashboardSkeleton />
      ) : (
        <>
          {errorMsg ? (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Could not load all dashboard data: {errorMsg}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Sign-ins Today"
              value={signInsToday.toLocaleString()}
              icon={<UserCheck className="h-4 w-4" />}
            />
            <StatCard
              label="Classes Today"
              value={classCount.toLocaleString()}
              icon={<CalendarDays className="h-4 w-4" />}
            />
            <StatCard
              label="Avg Occupancy"
              value={`${avgOcc}%`}
              icon={<Percent className="h-4 w-4" />}
            />
            <StatCard
              label="Total Members"
              value={memberCount.toLocaleString()}
              icon={<Users className="h-4 w-4" />}
            />
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h3 className="font-display text-lg font-semibold">{"Today's classes"}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Time</th>
                    <th className="px-5 py-3 font-medium">Class name</th>
                    <th className="px-5 py-3 font-medium">Guide</th>
                    <th className="px-5 py-3 font-medium">Booked / Capacity</th>
                    <th className="px-5 py-3 font-medium min-w-[140px]">Occupancy</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                        No classes scheduled for today.
                      </td>
                    </tr>
                  ) : (
                    classes.map((c) => {
                      const pct =
                        c.capacity > 0
                          ? Math.min(100, Math.round((c.booked_count / c.capacity) * 100))
                          : 0;
                      const time = new Date(c.starts_at)
                        .toLocaleTimeString("en-ZA", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                          timeZone: TZ,
                        })
                        .toUpperCase();
                      const guide = c.guide_name?.trim() || "—";
                      return (
                        <tr
                          key={c.id}
                          className={cn(
                            "border-t border-border",
                            canOpenClassRoster && "cursor-pointer hover:bg-muted/40",
                          )}
                          onClick={() => openClassRoster(c)}
                          onKeyDown={(e) => {
                            if (!canOpenClassRoster) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openClassRoster(c);
                            }
                          }}
                          tabIndex={canOpenClassRoster ? 0 : undefined}
                          role={canOpenClassRoster ? "button" : undefined}
                          aria-label={canOpenClassRoster ? `View roster for ${c.name}` : undefined}
                        >
                          <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums">
                            {time}
                          </td>
                          <td className="px-5 py-3 font-medium">{c.name}</td>
                          <td className="px-5 py-3 text-muted-foreground">{guide}</td>
                          <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                            {c.booked_count} / {c.capacity}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    pct >= 100
                                      ? "bg-destructive"
                                      : pct >= 80
                                        ? "bg-warning"
                                        : "bg-primary",
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                                {pct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
