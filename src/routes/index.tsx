import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Coffee, MapPin, QrCode } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { movementChallengeTotalDays } from "@/lib/movementChallenge";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { HomeSpotlightCard, homeSpotlightCardVisible } from "@/components/HomeSpotlightCard";
import { HomeEventCard } from "@/components/HomeEventCard";
import { MemberPassesPanel } from "@/components/MemberPassesPanel";
import { homeEventCardVisible } from "@/lib/homeEventCard";
import {
  activeMatAccessLabels,
  activeTowelAccessLabels,
  hasActiveMatAccess,
  hasActiveTowelAccess,
} from "@/lib/matTowelAccess";
import { useTimezone } from "@/hooks/use-timezone";
import { useHomePage } from "@/lib/queries/homePage";
import { invalidateMemberBookingCaches } from "@/lib/queries/invalidate";
import { queryKeys } from "@/lib/queries/queryKeys";
import { supabase } from "@/lib/supabase";
import {
  civilAddDaysYmd,
  formatClassDateTime,
  formatShortDateInZone,
  STUDIO_TIMEZONE,
  todayDateKey,
  ymdInTimeZone,
} from "@/lib/timezone";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function upcomingDayLabel(iso: string, timeZone: string): string {
  const classYmd = ymdInTimeZone(iso, STUDIO_TIMEZONE);
  const todayYmd = todayDateKey(STUDIO_TIMEZONE);
  const tomorrowYmd = civilAddDaysYmd(todayYmd, 1);
  if (classYmd === tomorrowYmd) return "Tomorrow";
  return formatShortDateInZone(iso, timeZone);
}

function HomeSkeleton() {
  return (
    <main className="flex-1 space-y-5 px-5 pt-6">
      <Skeleton className="mx-auto h-[52px] w-64 max-w-full" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-52 w-full rounded-2xl" />
    </main>
  );
}

function HomePage() {
  const { user, authReady } = useAuth();
  const queryClient = useQueryClient();
  const { timeZone, studioTimeZone } = useTimezone();
  const { data: home, isLoading } = useHomePage(user?.id);

  const firstName = home?.firstName ?? null;
  const cafeCreditTotal = home?.cafeCreditTotal ?? 0;
  const cafeUnlimited = home?.cafeUnlimited ?? false;
  const matTowelRows = home?.matTowelRows ?? [];
  const challengeStamped = home?.challengeStamped ?? 0;
  const challengeConfig = home?.challengeConfig ?? null;
  const upcomingBookings = home?.upcomingBookings ?? [];
  const homeEventCard = home?.homeEventCard ?? null;
  const challengeTotalDays = challengeConfig
    ? movementChallengeTotalDays(challengeConfig)
    : 31;
  const SAGE = "#a3b693";
  const showCafeTile = cafeUnlimited || cafeCreditTotal > 0;
  const showMatTile = hasActiveMatAccess(matTowelRows);
  const showTowelTile = hasActiveTowelAccess(matTowelRows);
  const matAccessLabels = activeMatAccessLabels(matTowelRows);
  const towelAccessLabels = activeTowelAccessLabels(matTowelRows);

  const refreshHome = () => {
    if (!user?.id) return;
    invalidateMemberBookingCaches(user.id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.homePage(user.id) });
  };

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("home-bookings-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        refreshHome();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshHome();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id, queryClient]);

  const showSkeleton = !authReady || (isLoading && !home);

  if (showSkeleton) {
    return (
      <AppShell>
        <HomeSkeleton />
      </AppShell>
    );
  }

  const welcomeTitle = firstName ? `Welcome ${firstName}!` : "Welcome!";

  return (
    <AppShell>
      <main className="flex-1 space-y-5 px-5 pt-6">
        <h1 className="text-center font-display text-[44px] font-bold leading-tight tracking-tight">
          {welcomeTitle}
        </h1>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold">Your bookings</h2>
              <Link
                to="/bookings"
                className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
              >
                View all
              </Link>
          </div>
          {upcomingBookings.length > 0 ? (
            <ul className="space-y-3">
              {upcomingBookings.map((b) => {
                const dateStr = upcomingDayLabel(b.startsAt, timeZone);
                const { time: timeStr } = formatClassDateTime(
                  b.startsAt,
                  timeZone,
                  studioTimeZone,
                );
                const timeLabel = timeStr.toUpperCase();
                return (
                  <li key={b.id}>
                    <div className="rounded-xl border border-border bg-muted/20 px-3 py-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug">{b.name}</p>
                          {b.guideName ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              with {b.guideName}
                            </p>
                          ) : null}
                        </div>
                        <Link
                          to="/bookings"
                          search={{ booking: b.id }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold text-white"
                          style={{ backgroundColor: SAGE }}
                          aria-label={`Open check-in QR for ${b.name}`}
                        >
                          <QrCode className="h-3.5 w-3.5" aria-hidden />
                          QR
                        </Link>
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {dateStr} · {timeLabel}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {b.location}
                        </span>
                      </p>
                      <div className="mt-3">
                        <CancelBookingButton
                          bookingId={b.id}
                          variant="card"
                          onCancelled={refreshHome}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No upcoming classes booked.{" "}
              <Link to="/schedule" className="font-semibold text-primary underline-offset-2">
                Book a class
              </Link>
            </p>
          )}
        </section>

        <Link
          to="/schedule"
          className="block rounded-xl bg-primary px-6 py-4 text-center text-base font-medium text-primary-foreground shadow-sm transition-transform active:scale-[0.99]"
        >
          Book a Class
        </Link>

        {(showMatTile || showTowelTile || showCafeTile) ? (
          <section className="space-y-3">
            {showMatTile ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
                    style={{ backgroundColor: `${SAGE}22` }}
                    aria-hidden
                  >
                    🧘
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Mat storage</p>
                    <p className="text-xs text-muted-foreground">
                      {matAccessLabels.length === 1
                        ? matAccessLabels[0]
                        : `${matAccessLabels.length} active mat packages`}
                    </p>
                  </div>
                </div>
                <span
                  className="inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: SAGE }}
                >
                  Active
                </span>
              </div>
            ) : null}

            {showTowelTile ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
                    style={{ backgroundColor: `${SAGE}22` }}
                    aria-hidden
                  >
                    🪣
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Towel service</p>
                    <p className="text-xs text-muted-foreground">
                      {towelAccessLabels.length === 1
                        ? towelAccessLabels[0]
                        : `${towelAccessLabels.length} active towel packages`}
                    </p>
                  </div>
                </div>
                <span
                  className="inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: SAGE }}
                >
                  Active
                </span>
              </div>
            ) : null}

            {showCafeTile ? (
          <Link
            to="/cafe"
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 transition-colors active:bg-muted/40"
          >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${SAGE}22` }}
            >
              <Coffee className="h-5 w-5" style={{ color: SAGE }} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Café</p>
              <p className="text-xs text-muted-foreground">
                {cafeUnlimited
                  ? "Unlimited café credits"
                  : `${cafeCreditTotal} café credit${cafeCreditTotal === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: SAGE }}
          >
            <QrCode className="h-3.5 w-3.5" aria-hidden />
            QR
          </span>
          </Link>
            ) : null}
          </section>
        ) : null}

        <MemberPassesPanel />

        {(challengeConfig && homeSpotlightCardVisible(challengeConfig)) ||
        (homeEventCard && homeEventCardVisible(homeEventCard)) ? (
          <section className="space-y-4 border-t border-border pt-2">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              From the studio
            </p>
            {challengeConfig && homeSpotlightCardVisible(challengeConfig) ? (
              <HomeSpotlightCard
                config={challengeConfig}
                challengeStamped={challengeStamped}
                challengeTotalDays={challengeTotalDays}
              />
            ) : null}
            {homeEventCard && homeEventCardVisible(homeEventCard) ? (
              <HomeEventCard config={homeEventCard} />
            ) : null}
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
