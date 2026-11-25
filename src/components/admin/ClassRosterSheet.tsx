import { useCallback, useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchBookingCredits } from "@/lib/bookingPaymentLabel";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { type BookingRow, type RosterRow, normalizeBooking } from "@/lib/checkInRoster";
import { fetchRosterMemberAddonAccess } from "@/components/admin/RosterAddonPills";
import { CheckInRosterList } from "@/components/admin/CheckInRosterList";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  fetchClassWaitlistRoster,
  leaveWaitlist,
  type WaitlistRosterRow,
} from "@/lib/waitlist";
const TZ = "Africa/Johannesburg";

export type ClassRosterSession = {
  id: string;
  name: string;
  starts_at: string;
  capacity: number;
  booked_count: number;
};

export function ClassRosterSheet({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ClassRosterSession | null;
}) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistRosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const loadRoster = useCallback(async () => {
    if (!session?.id) {
      setRoster([]);
      setWaitlist([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: bookingsData, error: bookingsError }, addonAccess, waitlistRows] =
        await Promise.all([
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
        credit_id,
        unpaid,
        paid_where,
        mat_addon,
        towel_addon,
        profiles ( first_name, last_name, avatar_url, role ),
        classes ( id, name, starts_at, guide_name )
      `,
            )
            .eq("class_id", session.id),
          fetchRosterMemberAddonAccess(supabase),
          fetchClassWaitlistRoster(session.id).catch((err) => {
            console.error("dashboard roster: waitlist load failed", err);
            return [] as WaitlistRosterRow[];
          }),
        ]);

      if (bookingsError) {
        console.error("dashboard roster: bookings load failed", bookingsError);
        toast.error(supabaseErrorMessage(bookingsError, "Could not load bookings"));
        setRoster([]);
        setWaitlist(waitlistRows);
        return;
      }

      const rows = (bookingsData ?? []) as unknown as BookingRow[];
      const credits = await fetchBookingCredits(
        supabase,
        rows.map((r) => r.credit_id),
      );
      const normalized = rows
        .map((row) => normalizeBooking(row, addonAccess, credits))
        .filter((r): r is RosterRow => r !== null);
      setRoster(normalized);
      setWaitlist(waitlistRows);
    } finally {
      setLoading(false);
    }
  }, [session?.id]);

  const removeFromWaitlist = async (entry: WaitlistRosterRow) => {
    const name = [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim() || "this member";
    if (!window.confirm(`Remove ${name} from the waitlist?`)) return;
    try {
      await leaveWaitlist(entry.id);
      setWaitlist((prev) =>
        prev
          .filter((w) => w.id !== entry.id)
          .map((w, i) => ({ ...w, position: i + 1 })),
      );
      toast.success("Removed from waitlist");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };

  useEffect(() => {
    if (!open || !session) return;
    void loadRoster();
  }, [open, session, loadRoster]);

  const bookedNonCancelled = roster.filter((r) => r.status !== "cancelled").length;
  const capacity = session?.capacity ?? 0;

  const timeLabel =
    session?.starts_at &&
    new Date(session.starts_at).toLocaleTimeString("en-ZA", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TZ,
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-8 text-left">{session?.name ?? "Class roster"}</SheetTitle>
          {session ? (
            <p className="text-left text-sm text-muted-foreground">
              {timeLabel} · {bookedNonCancelled} / {capacity} booked
            </p>
          ) : null}
        </SheetHeader>

        <div className="mt-4 flex-1">
          <CheckInRosterList
            roster={roster.filter((r) => r.status !== "cancelled")}
            loading={loading}
            onUpdated={loadRoster}
          />

          {waitlist.length > 0 ? (
            <section className="mt-6 border-t border-border pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Waitlist
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {waitlist.length} waiting
                </span>
              </div>
              <ul className="space-y-2">
                {waitlist.map((w) => {
                  const name =
                    [w.firstName, w.lastName].filter(Boolean).join(" ").trim() || "Member";
                  const initials = `${(w.firstName?.[0] ?? "").toUpperCase()}${(w.lastName?.[0] ?? "").toUpperCase()}` || "M";
                  const intent =
                    w.paymentMethod === "credit"
                      ? w.creditProductName ?? "Credit"
                      : w.paymentMethod === "flow_points"
                        ? `${w.flowPointsPledged ?? 100} Flow Points`
                        : w.paymentMethod === "free"
                          ? "Free class"
                          : "—";
                  return (
                    <li
                      key={w.id}
                      className="flex items-center gap-3 rounded-xl border border-dashed border-[#a3b693]/60 bg-[#f4f7f0]/70 px-3 py-2"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#a3b693]/25 text-xs font-semibold tabular-nums text-[#3d4f36]">
                        #{w.position}
                      </span>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-xs font-semibold">
                        {w.avatarUrl?.trim() ? (
                          <img src={w.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          initials
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        <p className="truncate text-xs text-muted-foreground">{intent}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeFromWaitlist(w)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40"
                        aria-label={`Remove ${name} from waitlist`}
                      >
                        <X className="h-3 w-3" aria-hidden /> Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <SheetFooter className="mt-auto flex-col gap-2 border-t border-border pt-4 sm:flex-col">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={!session}
            onClick={() => {
              if (!session) return;
              onOpenChange(false);
              void navigate({ to: "/admin/check-in", search: { class: session.id } });
            }}
          >
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            View full check-in
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
