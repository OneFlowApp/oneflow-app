import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Eye, Gift, Leaf, Loader2, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  fetchGameboard,
  formatRewardDate,
  peekGameboardTile,
  pickGameboardTile,
  shareGift,
  startGameboardPlay,
  TIER_NAME,
  type GameboardPick,
  type GameboardReward,
  type GameboardState,
} from "@/lib/gameboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/gameboard")({
  head: () => ({ meta: [{ title: "Weekly Gameboard — One Flow" }] }),
  component: GameboardPage,
});

function kindOfLabel(label: string): GameboardReward["kind"] {
  if (/gift/i.test(label)) return "gift";
  if (/sachet/i.test(label)) return "sachet";
  return "message";
}

function RewardIcon({ kind, className }: { kind: GameboardReward["kind"]; className?: string }) {
  if (kind === "gift") return <Gift className={className} aria-hidden />;
  if (kind === "sachet") return <Leaf className={className} aria-hidden />;
  return <Sparkles className={className} aria-hidden />;
}

/** Tile colour runs from sage to deep green across the board. */
function tileBg(i: number) {
  const shades = ["#a3b693", "#93a983", "#839c74", "#748f66", "#668259", "#5f7a52", "#53704a", "#4a6542", "#3d4f36"];
  return shades[i % shades.length];
}

function GameboardPage() {
  const [state, setState] = useState<GameboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [playId, setPlayId] = useState<string | null>(null);
  const [peekMode, setPeekMode] = useState(false);
  const [peek, setPeek] = useState<{ index: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(GameboardPick & { picked: number }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchGameboard();
      setState(s);
      setPlayId(s.open_play_id);
    } catch (e) {
      toast.error(supabaseErrorMessage(e, "Could not load the gameboard"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tiles = Math.max(1, state?.tiles ?? 9);
  const canPlay = Boolean(state?.ok && (state.play_week || state.open_play_id));
  const peekUsed = peek !== null || state?.open_play_peeked != null;

  const ensurePlay = async () => {
    if (playId) return playId;
    const id = await startGameboardPlay();
    setPlayId(id);
    return id;
  };

  const onTile = async (index: number) => {
    if (busy || result || !canPlay) return;
    setBusy(true);
    try {
      const id = await ensurePlay();
      if (peekMode) {
        const label = await peekGameboardTile(id, index);
        setPeek({ index, label });
        setPeekMode(false);
      } else {
        const r = await pickGameboardTile(id, index);
        setResult({ ...r, picked: index });
        setPlayId(null);
        setPeek(null);
        void fetchGameboard().then(setState).catch(() => undefined);
      }
    } catch (e) {
      toast.error(supabaseErrorMessage(e, "Something went wrong. Please try again"));
    } finally {
      setBusy(false);
    }
  };

  const thisWeek = state?.weeks?.[state.weeks.length - 1];
  const playsLeft = (state?.weeks ?? []).reduce((n, w) => n + w.plays_left, 0);
  const rewards = state?.rewards ?? [];
  const active = rewards.filter((r) => r.status === "won" && r.kind !== "message");
  const past = rewards.filter((r) => !(r.status === "won" && r.kind !== "message"));

  const onShare = async (r: GameboardReward) => {
    if (!r.gift_token) return;
    try {
      const how = await shareGift(r.gift_token, r.label);
      if (how === "copied") toast.success("Gift link copied. Send it to your friend!");
    } catch {
      toast.error("Could not share the link");
    }
  };

  return (
    <AppShell>
      <header className="safe-top flex items-center gap-2 px-5 pt-3 pb-3">
        <Link to="/goals" className="-ml-2 rounded-full p-2 text-muted-foreground" aria-label="Back to goals">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-semibold">Weekly Gameboard</h1>
      </header>

      <main className="flex-1 space-y-4 px-5 pb-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !state?.ok ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {state?.reason === "staff"
              ? "The gameboard is a member reward, so it isn't available on team accounts."
              : "Sign in to play the weekly gameboard."}
          </p>
        ) : (
          <>
            <section className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">This week</p>
                <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {TIER_NAME[state.tier]} card
                </span>
              </div>
              <p className="mt-1 font-display text-3xl font-semibold">
                {thisWeek?.attended ?? 0} / {state.goal}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {state.goal < state.min_goal
                  ? `Set a weekly goal of ${state.min_goal} or more on your Goals page to unlock the gameboard.`
                  : canPlay
                    ? `Goal reached! You have ${Math.max(playsLeft, 1)} play${Math.max(playsLeft, 1) === 1 ? "" : "s"}. Pick a tile.`
                    : `Reach your goal of ${state.goal} classes this week to unlock a play.`}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {state.tier === "gold"
                  ? "Gold: 2 plays a week and a sneak peek."
                  : state.can_peek
                    ? "Silver: you get a sneak peek before you choose. Gold cards get 2 plays a week."
                    : "Silver and Gold cards get a sneak peek, and Gold gets 2 plays a week."}
              </p>
            </section>

            <section className="rounded-3xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">
                  {result ? "Your reward" : "Pick a tile"}
                </h2>
                {state.can_peek && canPlay && !result ? (
                  <button
                    type="button"
                    disabled={peekUsed || busy}
                    onClick={() => setPeekMode((v) => !v)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold",
                      peekMode ? "border-[#d4af37] bg-[#d4af37]/15 text-[#8a6d12]" : "border-border",
                      peekUsed && "opacity-50",
                    )}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {peekUsed ? "Peek used" : peekMode ? "Tap a tile to peek" : "Sneak peek"}
                  </button>
                ) : null}
              </div>

              {peek && !result ? (
                <p className="mb-3 rounded-xl bg-[#d4af37]/10 px-3 py-2 text-sm">
                  Tile {peek.index} hides: <span className="font-semibold">{peek.label}</span>. Pick it, or try
                  another tile.
                </p>
              ) : null}

              <div className={cn("grid grid-cols-3 gap-2.5", !canPlay && !result && "opacity-50")}>
                {Array.from({ length: tiles }, (_, i) => {
                  const index = i + 1;
                  const revealed = result?.board?.[i];
                  const isPicked = result?.picked === index;
                  const isPeek = peek?.index === index && !result;
                  const label = revealed ?? (isPeek ? peek?.label : null);
                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={!canPlay || busy || Boolean(result)}
                      onClick={() => void onTile(index)}
                      className={cn(
                        "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-2xl p-2 text-center text-white shadow-sm transition",
                        canPlay && !result && "active:scale-95",
                        isPicked && "ring-4 ring-[#d4af37]",
                        result && !isPicked && "opacity-60",
                      )}
                      style={{ backgroundColor: label ? "#f4f1ec" : tileBg(i) }}
                      aria-label={label ?? `Tile ${index}`}
                    >
                      {label ? (
                        <>
                          <RewardIcon kind={kindOfLabel(label)} className="h-6 w-6 text-[#5f7a52]" />
                          <span className="mt-1 text-[10px] font-semibold leading-tight text-[#3d4f36]">
                            {label}
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            className="pointer-events-none absolute inset-0 opacity-15"
                            style={{
                              backgroundImage:
                                "radial-gradient(circle at 30% 30%, #fff 0 2px, transparent 3px), radial-gradient(circle at 70% 70%, #fff 0 2px, transparent 3px)",
                              backgroundSize: "18px 18px",
                            }}
                          />
                          <span className="font-display text-2xl font-semibold opacity-90">{index}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>

              {result ? (
                <div className="mt-4 rounded-2xl border border-[#d4af37]/50 bg-[#d4af37]/10 p-4 text-center">
                  <RewardIcon kind={result.kind} className="mx-auto h-7 w-7 text-[#8a6d12]" />
                  <p className="mt-2 font-display text-lg font-semibold">{result.label}</p>
                  {result.message ? <p className="mt-2 text-sm italic">“{result.message}”</p> : null}
                  {result.kind === "gift" && result.gift_token ? (
                    <>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Send this to a friend before {formatRewardDate(result.expires_at)}.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void shareGift(result.gift_token!, result.label).then((how) => {
                            if (how === "copied") toast.success("Gift link copied. Send it to your friend!");
                          })
                        }
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                      >
                        <Share2 className="h-4 w-4" aria-hidden /> Share gift
                      </button>
                    </>
                  ) : null}
                  {result.kind === "sachet" ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Collect it at the front desk before {formatRewardDate(result.expires_at)}. Show them this page.
                    </p>
                  ) : null}
                  {playsLeft > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setResult(null);
                        void load();
                      }}
                      className="mt-3 block w-full text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Play again ({playsLeft} left)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>

            {active.length > 0 ? (
              <section>
                <h2 className="mb-2 font-display text-base font-semibold">Your rewards</h2>
                <ul className="space-y-2">
                  {active.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                      <RewardIcon kind={r.kind} className="h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{r.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.kind === "sachet" ? "Collect at the front desk · " : ""}
                          Expires {formatRewardDate(r.expires_at)}
                        </p>
                      </div>
                      {r.kind === "gift" && r.gift_token ? (
                        <button
                          type="button"
                          onClick={() => void onShare(r)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {past.length > 0 ? (
              <section>
                <h2 className="mb-2 font-display text-base font-semibold">Past rewards</h2>
                <ul className="space-y-2">
                  {past.slice(0, 12).map((r) => (
                    <li key={r.id} className="rounded-2xl border border-border bg-card/60 p-3 text-sm">
                      <p className="flex items-center gap-2 font-medium">
                        <RewardIcon kind={r.kind} className="h-4 w-4 text-muted-foreground" />
                        {r.label}
                        <span className="ml-auto text-xs font-normal text-muted-foreground">
                          {r.status === "expired"
                            ? "Expired"
                            : r.kind === "gift"
                              ? r.gift_claimed
                                ? "Claimed by your friend"
                                : "Used"
                              : r.kind === "sachet"
                                ? "Collected"
                                : formatRewardDate(r.won_at)}
                        </span>
                      </p>
                      {r.message ? <p className="mt-1 text-xs italic text-muted-foreground">“{r.message}”</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
    </AppShell>
  );
}
