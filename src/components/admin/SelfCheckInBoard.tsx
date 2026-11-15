import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { type RosterRow, patchBookingAttendance, rosterInitials } from "@/lib/checkInRoster";
import { upsertMayChallengeCheckIn } from "@/lib/mayChallengeCheckIn";
import { awardClassesAttendedBadges } from "@/lib/badges";
import { cn } from "@/lib/utils";

/** One Flow brand palette. */
const CHARCOAL = "#252b23";
const SAGE = "#a6baa1";
const BEIGE = "#e3ded5";

export type SelfCheckInSession = {
  key: string;
  label: string;
  time: string;
  total: number;
  attended: number;
  guideName?: string | null;
  checkInOpen?: boolean;
  checkInHint?: string;
};

/** "Jane Doe" → "Jane D." so full surnames aren't shown on a shared tablet. */
function displayName(row: RosterRow): string {
  const first = row.memberFirst?.trim() ?? "";
  const last = row.memberLast?.trim() ?? "";
  if (first && last) return `${first} ${last[0]!.toUpperCase()}.`;
  return first || last || row.member;
}

function Avatar({ row, size }: { row: RosterRow; size: "md" | "lg" }) {
  const box = size === "lg" ? "h-24 w-24 text-2xl" : "h-14 w-14 text-base";
  if (row.avatarUrl) {
    return (
      <img src={row.avatarUrl} alt="" className={cn(box, "shrink-0 rounded-full object-cover")} />
    );
  }
  return (
    <div
      className={cn(box, "flex shrink-0 items-center justify-center rounded-full font-semibold")}
      style={{ backgroundColor: BEIGE, color: CHARCOAL }}
    >
      {rosterInitials(row.memberFirst, row.memberLast)}
    </div>
  );
}

/**
 * Tablet self check-in: members pick their class, then tap their own name.
 * Undo and corrections are done by staff on the Bookings page.
 */
export function SelfCheckInBoard({
  sessions,
  rosterByClassId,
  selectedId,
  onSelect,
  onUpdated,
  openMinutesBefore,
}: {
  sessions: SelfCheckInSession[];
  rosterByClassId: Map<string, RosterRow[]>;
  selectedId: string | null;
  onSelect: (classId: string) => void;
  onUpdated: () => void | Promise<void>;
  openMinutesBefore: number;
}) {
  const [query, setQuery] = useState("");
  const [confirmRow, setConfirmRow] = useState<RosterRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);

  const session = sessions.find((s) => s.key === selectedId) ?? null;
  const roster = useMemo(() => {
    const list = (selectedId ? rosterByClassId.get(selectedId) : null) ?? [];
    return list
      .filter((r) => r.status !== "cancelled")
      .slice()
      .sort((a, b) =>
        displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" }),
      );
  }, [rosterByClassId, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) => r.member.toLowerCase().includes(q));
  }, [roster, query]);

  useEffect(() => setQuery(""), [selectedId]);

  useEffect(() => {
    if (!welcomeName) return;
    const t = setTimeout(() => setWelcomeName(null), 2600);
    return () => clearTimeout(t);
  }, [welcomeName]);

  const checkIn = async (row: RosterRow) => {
    setBusy(true);
    const { error } = await patchBookingAttendance(supabase, {
      bookingId: row.id,
      status: "attended",
      context: {
        profileId: row.profileId,
        classStartsAt: row.classStartsAt,
        classType: row.classType,
      },
      openMinutesBefore,
    });
    if (error) {
      setBusy(false);
      toast.error(error);
      return;
    }
    await upsertMayChallengeCheckIn({
      profileId: row.profileId,
      bookingId: row.id,
      classStartsAtIso: row.classStartsAt,
    });
    void awardClassesAttendedBadges(row.profileId);
    setBusy(false);
    setConfirmRow(null);
    setQuery("");
    setWelcomeName(row.memberFirst?.trim() || displayName(row));
    await onUpdated();
  };

  const closed = session?.checkInOpen === false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Today's classes */}
      <div className="-mx-1 flex shrink-0 gap-3 overflow-x-auto px-1 pb-1 scroll-touch">
        {sessions.length === 0 ? (
          <p className="py-6 text-base text-muted-foreground">No classes scheduled for today.</p>
        ) : (
          sessions.map((s) => {
            const active = s.key === selectedId;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onSelect(s.key)}
                className={cn(
                  "flex min-w-[190px] shrink-0 flex-col items-start rounded-2xl border px-5 py-4 text-left transition-colors",
                  active
                    ? "border-transparent text-white shadow-md"
                    : "border-border bg-card hover:bg-muted",
                  !active && s.checkInOpen === false && "opacity-60",
                )}
                style={active ? { backgroundColor: CHARCOAL } : undefined}
              >
                <span className="text-2xl font-semibold tabular-nums">{s.time}</span>
                <span className="mt-1 max-w-[220px] truncate text-sm font-medium">{s.label}</span>
                <span
                  className={cn("mt-1 text-xs", active ? "text-white/70" : "text-muted-foreground")}
                >
                  {s.attended}/{s.total} checked in
                </span>
              </button>
            );
          })
        )}
      </div>

      {session ? (
        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border bg-card p-5 sm:p-8">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Tap your name to check in
              </p>
              <h2
                className="mt-2 truncate font-display text-3xl font-semibold sm:text-4xl"
                style={{ color: CHARCOAL }}
              >
                {session.label}
              </h2>
              <p className="mt-1 text-base text-muted-foreground">
                {session.time}
                {session.guideName ? ` · with ${session.guideName}` : ""}
              </p>
            </div>
            {roster.length > 8 ? (
              <label className="relative w-full sm:w-80">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find your name"
                  className="h-14 w-full rounded-full border border-border bg-background pl-12 pr-5 text-lg outline-none focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: SAGE }}
                  aria-label="Find your name"
                />
              </label>
            ) : null}
          </div>

          {closed ? (
            <div
              className="mt-5 shrink-0 rounded-2xl px-5 py-4 text-base font-medium"
              style={{ backgroundColor: BEIGE, color: CHARCOAL }}
            >
              {session.checkInHint ?? "Check in isn't open for this class yet."}
            </div>
          ) : null}

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto scroll-touch">
            {roster.length === 0 ? (
              <p className="py-16 text-center text-lg text-muted-foreground">
                No one is booked for this class yet.
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-lg text-muted-foreground">
                No name matches. Please see the front desk.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {filtered.map((row) => {
                  const isIn = row.status === "attended";
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        disabled={isIn || closed}
                        onClick={() => setConfirmRow(row)}
                        className={cn(
                          "relative flex w-full flex-col items-center gap-3 rounded-2xl border px-4 py-6 text-center transition-all",
                          isIn
                            ? "border-transparent"
                            : "border-border bg-white hover:shadow-md active:scale-[0.98]",
                          closed && !isIn && "opacity-50",
                        )}
                        style={isIn ? { backgroundColor: `${SAGE}33` } : undefined}
                      >
                        {isIn ? (
                          <span
                            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: SAGE }}
                          >
                            <Check className="h-4 w-4" aria-hidden />
                          </span>
                        ) : null}
                        <Avatar row={row} size="md" />
                        <span
                          className="w-full truncate text-lg font-semibold"
                          style={{ color: CHARCOAL }}
                        >
                          {displayName(row)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {isIn ? "Checked in" : "Tap to check in"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Confirm it's them */}
      <Dialog open={confirmRow !== null} onOpenChange={(o) => !o && !busy && setConfirmRow(null)}>
        <DialogContent className="max-w-md rounded-3xl p-8 text-center">
          {confirmRow ? (
            <div className="flex flex-col items-center gap-4">
              <Avatar row={confirmRow} size="lg" />
              <DialogTitle
                className="font-display text-2xl font-semibold"
                style={{ color: CHARCOAL }}
              >
                Are you {displayName(confirmRow)}?
              </DialogTitle>
              <p className="text-base text-muted-foreground">{session?.label}</p>
              <div className="mt-2 flex w-full flex-col gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void checkIn(confirmRow)}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-full text-lg font-semibold text-white"
                  style={{ backgroundColor: CHARCOAL }}
                >
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-5 w-5" aria-hidden />
                  )}
                  Yes, check me in
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRow(null)}
                  className="h-14 w-full rounded-full border border-border text-lg font-medium"
                >
                  Not me
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Welcome */}
      {welcomeName ? (
        <button
          type="button"
          onClick={() => setWelcomeName(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 text-white"
          style={{ backgroundColor: `${CHARCOAL}f2` }}
          aria-label="Close"
        >
          <span
            className="flex h-24 w-24 items-center justify-center rounded-full"
            style={{ backgroundColor: SAGE }}
          >
            <Check className="h-12 w-12" aria-hidden />
          </span>
          <span className="font-display text-4xl font-semibold">Welcome, {welcomeName}</span>
          <span className="text-lg text-white/75">You're checked in. Enjoy your class.</span>
        </button>
      ) : null}
    </div>
  );
}
