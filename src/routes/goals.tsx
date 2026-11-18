import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Award, ChevronRight, Flame, Gift, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/auth";
import { getUser, supabase } from "@/lib/supabase";
import { useMemberBadges } from "@/lib/queries/memberBadges";
import {
  clampWeeklyGoal,
  DEFAULT_WEEKLY_GOAL,
  fetchWeeklyGoalProgress,
  weeklyGoalFromProfile,
} from "@/lib/weeklyGoal";

export const Route = createFileRoute("/goals")({
  component: GoalsPage,
});

function GoalsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: badges = [], isLoading: badgesLoading } = useMemberBadges(user?.id);
  const [weeklyGoal, setWeeklyGoal] = useState(DEFAULT_WEEKLY_GOAL);
  const [thisWeekCount, setThisWeekCount] = useState(0);
  const [streakWeeks, setStreakWeeks] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(DEFAULT_WEEKLY_GOAL));
  const [savingGoal, setSavingGoal] = useState(false);

  const load = useCallback(async () => {
    const currentUser = await getUser();
    if (!currentUser) {
      setWeeklyGoal(DEFAULT_WEEKLY_GOAL);
      setThisWeekCount(0);
      setStreakWeeks(0);
      setLongestStreak(0);
      return;
    }

    const [{ data: prof, error: profErr }, progress] = await Promise.all([
      supabase
        .from("profiles")
        .select("weekly_goal, current_streak, longest_streak")
        .eq("id", currentUser.id)
        .maybeSingle(),
      fetchWeeklyGoalProgress(supabase, currentUser.id),
    ]);

    if (profErr) {
      console.error(profErr);
      setWeeklyGoal(DEFAULT_WEEKLY_GOAL);
      setThisWeekCount(0);
      setStreakWeeks(0);
      setLongestStreak(0);
      return;
    }

    const wg = weeklyGoalFromProfile(
      (prof as { weekly_goal?: number | null } | null)?.weekly_goal,
    );
    const curStreak = Number(
      (prof as { current_streak?: number | null } | null)?.current_streak ?? 0,
    );
    const maxStreak = Number(
      (prof as { longest_streak?: number | null } | null)?.longest_streak ?? 0,
    );
    setWeeklyGoal(wg);
    setGoalInput(String(wg));
    setStreakWeeks(Number.isFinite(curStreak) ? Math.max(0, curStreak) : 0);
    setLongestStreak(Number.isFinite(maxStreak) ? Math.max(0, maxStreak) : 0);
    setThisWeekCount(progress.weeklyDone);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pct = Math.min(100, (thisWeekCount / weeklyGoal) * 100);

  const saveGoal = async () => {
    const currentUser = await getUser();
    if (!currentUser) return;
    const n = Number.parseInt(goalInput, 10);
    if (!Number.isFinite(n) || n < 1 || n > 14) {
      toast.error("Enter a weekly goal between 1 and 14.");
      return;
    }
    const next = clampWeeklyGoal(n);
    setSavingGoal(true);
    const { error } = await supabase
      .from("profiles")
      .update({ weekly_goal: next })
      .eq("id", currentUser.id);
    setSavingGoal(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Weekly goal saved");
    setWeeklyGoal(next);
    setGoalInput(String(next));
    setEditingGoal(false);
  };

  return (
    <AppShell>
      <header className="safe-top px-5 pt-3 pb-3">
        <h1 className="font-display text-2xl font-semibold">Goals & Streaks</h1>
      </header>
      <main className="flex-1 space-y-4 px-5 pb-6">
        <section className="rounded-3xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">This week</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="font-display text-3xl font-semibold">
              {thisWeekCount} / {weeklyGoal}
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
              onClick={() => setEditingGoal((v) => !v)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {editingGoal ? "Close" : "Edit"}
            </button>
          </div>
          {editingGoal ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={14}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="h-10 w-24 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void saveGoal()}
                disabled={savingGoal}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {savingGoal ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </section>
        <section className="rounded-3xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Streak</p>
          {streakWeeks > 0 ? (
            <>
              <p className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-semibold">
                <Flame className="h-7 w-7 text-orange-500" /> {streakWeeks} weeks
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Longest streak: {longestStreak} weeks
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Start your streak this week!</p>
          )}
        </section>

        <Link
          to="/gameboard"
          className="flex items-center gap-3 rounded-3xl border border-[#d4af37]/50 bg-[#d4af37]/10 p-5"
        >
          <Gift className="h-7 w-7 shrink-0 text-[#8a6d12]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base font-semibold">Weekly Gameboard</span>
            <span className="block text-xs text-muted-foreground">
              {weeklyGoal >= 3 && thisWeekCount >= weeklyGoal
                ? "Goal reached! Pick a tile and win a reward."
                : "Hit a weekly goal of 3 or more classes to play and win rewards."}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 font-display text-base font-semibold">
              <Award className="h-4 w-4 text-primary" aria-hidden />
              Your badges
            </h2>
            <Link
              to="/rewards"
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              All rewards
            </Link>
          </div>
          {badgesLoading ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-2xl border border-border bg-muted/60"
                />
              ))}
            </div>
          ) : badges.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              Badges awarded by the studio will appear here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-primary bg-primary-soft p-3 text-center"
                  title={b.name}
                >
                  <div className="text-2xl" aria-hidden>
                    {b.icon}
                  </div>
                  <p className="line-clamp-2 text-[11px] font-medium leading-tight">{b.name}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={() => navigate({ to: "/schedule" })}
          className="block w-full rounded-2xl bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Book a class
        </button>
      </main>
    </AppShell>
  );
}
