import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, MapPin, Users, Sparkles, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth";
import { useBookingSheetData } from "@/lib/queries/bookingSheet";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";
import {
  customerClassCapacityLabel,
  fetchConfirmedBookingIntervals,
  findOverlappingBooking,
  classTicketRestrictsCreditsToProduct,
  isPastScheduleClass,
  isPurchasableClassTicketPrice,
  overlapBookingMessage,
} from "@/lib/scheduleBooking";
import {
  bookingConfirmationEmailData,
  bookingConfirmationTemplateForClassType,
} from "@/lib/bookingConfirmationEmail";
import { bookingCreditInsertErrorMessage, isBookableClassCredit } from "@/lib/bookingCredits";
import { profileEarnsFlowPoints } from "@/lib/flowPoints";
import { userCreditCoversClassType } from "@/lib/allowedClassTypes";
import { classTitle } from "@/lib/classTitle";
import { useClassCatalog } from "@/contexts/classCatalog";
import { classDateFromStartsAtIso } from "@/lib/mayChallengeCheckIn";
import { formatTicketPriceLabel } from "@/lib/classTicketProduct";
import {
  DEFAULT_MOVEMENT_CHALLENGE,
  fetchMovementChallengeConfig,
  isClassDateInChallenge,
  type MovementChallengeConfig,
} from "@/lib/movementChallenge";
import {
  joinWaitlist,
  leaveWaitlist,
  type WaitlistEntry,
} from "@/lib/waitlist";
import {
  formatHireAddonPrice,
  type BookingHireAddon,
} from "@/lib/bookingAddons";
import {
  formatStudioDateLong,
  formatStudioDateOnly,
  formatStudioTime12Upper,
} from "@/lib/timezone";

interface ClassRow {
  id: string;
  name: string;
  title_override?: string | null;
  class_type: string;
  class_type_id?: string | null;
  location: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  guide_name?: string | null;
  description?: string | null;
  product_id?: string | null;
}

interface Credit {
  id: string;
  product_id?: string | null;
  product_name: string;
  credits_remaining: number | null;
  is_unlimited: boolean;
  expires_at: string | null;
  allowed_class_types: string[] | null;
  mat_access?: boolean | null;
  towel_access?: boolean | null;
}

interface Props {
  session: ClassRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a booking is confirmed so the schedule can mark the class as booked without waiting for refetch. */
  onBookingConfirmed?: (classId: string) => void;
}

type FriendOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

function friendLabel(f: FriendOption): string {
  return [f.first_name, f.last_name].filter(Boolean).join(" ").trim() || "Friend";
}

function friendInitials(f: FriendOption): string {
  const a = (f.first_name?.trim() || "F").charAt(0);
  const b = (f.last_name?.trim() || a).charAt(0);
  return (a + b).toUpperCase();
}

export function BookingSheet({ session, open, onOpenChange, onBookingConfirmed }: Props) {
  const { user } = useAuth();
  const { data: sheetData } = useBookingSheetData(user?.id, user?.email, session, open);
  // Subscribe so a class-type rename repaints the sheet title.
  useClassCatalog();
  const [credits, setCredits] = useState<Credit[]>([]);
  const [selectedCredit, setSelectedCredit] = useState<string | null>(null);
  const [flowPoints, setFlowPoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [matAddon, setMatAddon] = useState(false);
  const [towelAddon, setTowelAddon] = useState(false);
  const [hireAddons, setHireAddons] = useState<{
    mat: BookingHireAddon | null;
    towel: BookingHireAddon | null;
  }>({ mat: null, towel: null });
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [acceptedFriends, setAcceptedFriends] = useState<FriendOption[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMode, setInviteMode] = useState<"friend" | "email">("friend");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailName, setInviteEmailName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [payCheckoutSlow, setPayCheckoutSlow] = useState(false);
  const [waitlistEntry, setWaitlistEntry] = useState<WaitlistEntry | null>(null);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [isFreeClass, setIsFreeClass] = useState(false);
  const [isComplimentaryClass, setIsComplimentaryClass] = useState(false);
  const [challengeConfig, setChallengeConfig] =
    useState<MovementChallengeConfig>(DEFAULT_MOVEMENT_CHALLENGE);
  const [classTicketProduct, setClassTicketProduct] = useState<{
    id: string;
    name: string;
    price_zar: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchMovementChallengeConfig().then(setChallengeConfig);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setInviteOpen(false);
      setSelectedFriendId(null);
      setInviteEmail("");
      setInviteEmailName("");
      setMatAddon(false);
      setTowelAddon(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !session || !sheetData) return;

    setUserId(sheetData.userId);
    setUserEmail(sheetData.userEmail);
    setWaitlistEntry(sheetData.waitlistEntry);
    setHireAddons(sheetData.hireAddons);
    setIsFreeClass(sheetData.isFreeClass);
    setIsComplimentaryClass(sheetData.isComplimentaryClass);
    setClassTicketProduct(sheetData.classTicketProduct);
    setAcceptedFriends(sheetData.acceptedFriends);

    const ticket = sheetData.classTicketProduct;
    if (sheetData.isComplimentaryClass) {
      setCredits([]);
      setSelectedCredit(null);
      setUsePoints(false);
      setFlowPoints(0);
      setUserRole(sheetData.userRole);
      return;
    }

    const nowMs = Date.now();
    const pool = sheetData.credits.filter((c) => {
      if (!isBookableClassCredit(c)) return false;
      if (c.is_unlimited) {
        if (c.expires_at && new Date(c.expires_at).getTime() < nowMs) return false;
        return true;
      }
      const rem = Number(c.credits_remaining);
      if (!Number.isFinite(rem) || rem <= 0) return false;
      if (c.expires_at && new Date(c.expires_at).getTime() < nowMs) return false;
      return true;
    });

    const eligible =
      ticket && classTicketRestrictsCreditsToProduct(ticket.price_zar)
        ? pool.filter(
            (c) => String((c as { product_id?: string | null }).product_id ?? "") === ticket.id,
          )
        : pool.filter((c) =>
            userCreditCoversClassType({
              category: c.category,
              allowed_class_types: c.allowed_class_types,
              classType: session.class_type,
            }),
          );

    setCredits(eligible as Credit[]);
    setSelectedCredit(eligible[0]?.id ?? null);
    setFlowPoints(sheetData.flowPoints);
    setUserRole(sheetData.userRole);
  }, [open, session, sheetData]);

  if (!session) return null;

  const classIsPast = isPastScheduleClass(session.starts_at);
  const capacityInfo = customerClassCapacityLabel(session.booked_count, session.capacity);
  const spots = Math.max(0, session.capacity - session.booked_count);
  const dateLine = formatStudioDateLong(session.starts_at);
  const timeLine = formatStudioTime12Upper(session.starts_at);
  const durationMin = Math.round(
    (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000,
  );
  const countsTowardChallenge =
    challengeConfig.enabled &&
    ["yoga", "sauna_journey"].includes(session.class_type) &&
    isClassDateInChallenge(classDateFromStartsAtIso(session.starts_at), challengeConfig);
  const isPaidClassTicket = Boolean(
    classTicketProduct && isPurchasableClassTicketPrice(classTicketProduct.price_zar),
  );
  const showHireAddons =
    !isFreeClass &&
    !isPaidClassTicket &&
    !["sauna_journey", "wellzone"].includes(session.class_type.trim().toLowerCase());
  const needsTicketPurchase = isPaidClassTicket && !selectedCredit;
  const pointsValue = Math.floor(flowPoints / 100) * 10;

  const afterBookingConfirmed = async (bookingId: string) => {
    if (!userEmail) {
      console.warn("[BookingSheet] booking confirmation email skipped — no user email", {
        bookingId,
        classId: session.id,
      });
      return;
    }

    const template = bookingConfirmationTemplateForClassType(session.class_type);
    const emailPayload = bookingConfirmationEmailData({
      className: classTitle(session),
      startsAtIso: session.starts_at,
      guideName: session.guide_name,
      location: session.location,
      matAddon: isFreeClass ? false : matAddon,
      towelAddon: isFreeClass ? false : towelAddon,
    });

    console.info("[BookingSheet] invoking send-email for booking confirmation", {
      bookingId,
      to: userEmail,
      template,
      classId: session.id,
    });

    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        to: userEmail,
        template,
        data: emailPayload,
      },
    });

    if (error) {
      console.error("[BookingSheet] send-email invoke failed", {
        bookingId,
        to: userEmail,
        template,
        error,
      });
      return;
    }

    const payload = data as { success?: boolean; error?: unknown; id?: string | null } | null;
    if (payload?.error) {
      console.error("[BookingSheet] send-email returned error", {
        bookingId,
        to: userEmail,
        template,
        error: payload.error,
      });
      return;
    }

    console.info("[BookingSheet] booking confirmation email accepted by send-email", {
      bookingId,
      to: userEmail,
      resendId: payload?.id ?? null,
    });
  };

  const confirm = async () => {
    if (!userId || !session) return;
    if (isComplimentaryClass) {
      toast.error("This class is complimentary and can only be assigned by the studio team.");
      return;
    }
    if (needsTicketPurchase) {
      await buyClassTicketAndBook();
      return;
    }
    if (classIsPast) {
      toast.error("This class has already passed — you can’t book it.");
      return;
    }

    const existingBookings = await fetchConfirmedBookingIntervals(supabase, userId);
    const overlap = findOverlappingBooking(session, existingBookings, session.id);
    if (overlap) {
      toast.error(overlapBookingMessage(overlap));
      return;
    }

    console.info("[BookingSheet] confirm payment check", {
      classId: session.id,
      classType: session.class_type,
      isFreeClass,
      selectedCredit,
      usePoints,
    });

    if (isFreeClass && !selectedCredit && !usePoints) {
      console.info("[BookingSheet] free class path — no credit or points selected");
      setLoading(true);
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          profile_id: userId,
          class_id: session.id,
          status: "confirmed",
          payment_method: "free",
          credit_id: null,
          flow_points_used: 0,
          mat_addon: false,
          towel_addon: false,
          qr_token: globalThis.crypto.randomUUID(),
        })
        .select()
        .maybeSingle();

      if (error || !booking) {
        console.error("[BookingSheet] free booking insert failed", error);
        toast.error(
          error?.code === "23505"
            ? "You already have an active booking for this class."
            : supabaseErrorMessage(error, "Could not complete booking"),
        );
        setLoading(false);
        return;
      }

      await afterBookingConfirmed(booking.id as string);
      console.info("[BookingSheet] free class booking complete", { bookingId: booking.id });
      toast.success("You're booked! See you on the mat 🌿");
      setLoading(false);
      onBookingConfirmed?.(session.id);
      onOpenChange(false);
      return;
    }

    if (!selectedCredit && !usePoints) {
      toast.error("Please select a payment method");
      return;
    }
    setLoading(true);

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        profile_id: userId,
        class_id: session.id,
        status: "confirmed",
        payment_method: selectedCredit ? "credit" : "flow_points",
        credit_id: selectedCredit ?? null,
        flow_points_used: usePoints ? Math.min(flowPoints, 100) : 0,
        mat_addon: matAddon,
        towel_addon: towelAddon,
        qr_token: globalThis.crypto.randomUUID(),
      })
      .select()
      .maybeSingle();

    if (error || !booking) {
      console.error("[BookingSheet] booking insert failed", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        userId,
        classId: session.id,
        creditId: selectedCredit,
        paymentMethod: selectedCredit ? "credit" : "flow_points",
      });
      toast.error(
        error
          ? error.code === "23505"
            ? "You already have an active booking for this class."
            : !selectedCredit && error.message?.trim()
              ? // Flow Points are deducted by the database on insert; surface its message as-is
                error.message.trim()
              : bookingCreditInsertErrorMessage(
                  error,
                  supabaseErrorMessage(error, "Could not complete booking"),
                )
          : "Booking failed — no row returned. This is often RLS or a missing database field.",
      );
      setLoading(false);
      return;
    }

    await afterBookingConfirmed(booking.id as string);

    toast.success("Booking confirmed!", {
      description: `${classTitle(session)} · ${dateLine} at ${timeLine}`,
    });
    setLoading(false);
    onBookingConfirmed?.(session.id);
    onOpenChange(false);
  };

  const buyClassTicketAndBook = async () => {
    if (!userId || !session || !classTicketProduct) return;
    if (!isPurchasableClassTicketPrice(classTicketProduct.price_zar)) {
      toast.error("This class is complimentary and cannot be purchased online.");
      return;
    }
    if (classIsPast) {
      toast.error("This class has already passed — you can’t book it.");
      return;
    }
    setLoading(true);
    setPayCheckoutSlow(false);
    const slow = window.setTimeout(() => setPayCheckoutSlow(true), 5000);
    const origin = window.location.origin;
    const successQs = new URLSearchParams({
      pack_id: classTicketProduct.id,
      profile_id: userId,
      class_id: session.id,
      auto_book: "1",
    });
    const { data: checkout, error: yocoErr } = await supabase.functions.invoke("yoco-checkout", {
      body: {
        pack_id: classTicketProduct.id,
        profile_id: userId,
        class_id: session.id,
        success_url: `${origin}/payment/success?${successQs.toString()}`,
        cancel_url: `${origin}/schedule?class=${session.id}`,
      },
    });
    window.clearTimeout(slow);
    setPayCheckoutSlow(false);
    setLoading(false);
    if (yocoErr) {
      toast.error(yocoErr.message ?? "Checkout failed");
      return;
    }
    const redirect =
      (checkout as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (checkout as { redirect_url?: string } | null)?.redirect_url ??
      null;
    if (redirect) {
      window.location.href = redirect;
    } else {
      toast.error("Yoco didn't return a redirect URL");
    }
  };

  const joinClassWaitlist = async () => {
    if (!userId || !session) return;
    if (isComplimentaryClass) {
      toast.error("This class is complimentary and can only be assigned by the studio team.");
      return;
    }
    if (classIsPast) {
      toast.error("This class has already passed.");
      return;
    }
    let paymentMethod: "free" | "credit" | "flow_points";
    let creditId: string | null = null;
    let flowPointsPledged = 0;

    if (isFreeClass && !selectedCredit && !usePoints) {
      paymentMethod = "free";
    } else if (selectedCredit) {
      paymentMethod = "credit";
      creditId = selectedCredit;
    } else if (usePoints) {
      paymentMethod = "flow_points";
      flowPointsPledged = Math.min(flowPoints, 100);
    } else {
      toast.error("Select a payment method to join the waitlist.");
      return;
    }

    setWaitlistBusy(true);
    try {
      const entry = await joinWaitlist({
        classId: session.id,
        profileId: userId,
        paymentMethod,
        creditId,
        flowPointsPledged,
      });
      setWaitlistEntry(entry);
      toast.success("You're on the waitlist", {
        description: "We'll book you in and email if a spot opens up.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join waitlist");
    } finally {
      setWaitlistBusy(false);
    }
  };

  const leaveClassWaitlist = async () => {
    if (!waitlistEntry) return;
    setWaitlistBusy(true);
    try {
      await leaveWaitlist(waitlistEntry.id);
      setWaitlistEntry(null);
      toast.success("Left the waitlist");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not leave waitlist");
    } finally {
      setWaitlistBusy(false);
    }
  };

  const validateInviteEmail = (): string | null => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return null;
    }
    return email;
  };

  const runInviteByEmail = async () => {
    if (!userId || !session) return;
    const email = validateInviteEmail();
    if (!email) return;
    console.info("[BookingSheet] email invite submit", {
      email,
      classId: session.id,
      inviteeName: inviteEmailName.trim() || null,
    });
    setInviteBusy(true);
    const { data: row, error } = await supabase
      .from("class_invites")
      .insert({
        inviter_id: userId,
        invitee_id: null,
        invitee_email: email,
        invitee_name: inviteEmailName.trim() || null,
        class_id: session.id,
        paid_by_inviter: false,
        status: "pending",
        invited_via_email: true,
      })
      .select("id")
      .maybeSingle();
    console.info("[BookingSheet] class_invites insert result", {
      inviteId: (row as { id?: string } | null)?.id ?? null,
      error: error?.message ?? null,
    });
    if (error || !row) {
      toast.error(error?.message ?? "Could not create invite");
      setInviteBusy(false);
      return;
    }
    const inviteId = (row as { id: string }).id;
    const { data: finData, error: finErr } = await supabase.functions.invoke("finalize-class-invite", {
      body: { class_invite_id: inviteId, after_payment: false },
    });
    console.info("[BookingSheet] finalize-class-invite result", {
      inviteId,
      error: finErr?.message ?? null,
      data: finData,
    });
    if (finErr) {
      toast.error(finErr.message ?? "Invite created but email failed.");
    } else {
      toast.success("Invite sent", {
        description: `Emailed ${email}.`,
      });
    }
    setInviteBusy(false);
    setInviteOpen(false);
    setInviteEmail("");
    setInviteEmailName("");
  };

  const runPayForFriendByEmail = async () => {
    if (!userId || !session) return;
    const email = validateInviteEmail();
    if (!email) return;
    setInviteBusy(true);
    setPayCheckoutSlow(false);
    const slow = window.setTimeout(() => setPayCheckoutSlow(true), 5000);
    const { data: row, error } = await supabase
      .from("class_invites")
      .insert({
        inviter_id: userId,
        invitee_id: null,
        invitee_email: email,
        invitee_name: inviteEmailName.trim() || null,
        class_id: session.id,
        paid_by_inviter: true,
        status: "pending_payment",
        invited_via_email: true,
      })
      .select("id")
      .maybeSingle();
    if (error || !row) {
      window.clearTimeout(slow);
      setPayCheckoutSlow(false);
      toast.error(error?.message ?? "Could not start payment");
      setInviteBusy(false);
      return;
    }
    const inviteId = (row as { id: string }).id;
    const origin = window.location.origin;
    const { data: checkout, error: yocoErr } = await supabase.functions.invoke("yoco-checkout", {
      body: {
        type: "class_invite",
        class_invite_id: inviteId,
        inviter_profile_id: userId,
        success_url: `${origin}/payment/success?class_invite_id=${inviteId}&profile_id=${userId}`,
        cancel_url: `${origin}/schedule`,
      },
    });
    window.clearTimeout(slow);
    setPayCheckoutSlow(false);
    setInviteBusy(false);
    if (yocoErr) {
      toast.error(yocoErr.message ?? "Checkout failed");
      return;
    }
    const redirect =
      (checkout as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (checkout as { redirect_url?: string } | null)?.redirect_url ??
      null;
    if (redirect) {
      window.location.href = redirect;
    } else {
      toast.error("Yoco didn't return a redirect URL");
    }
  };

  const runInviteOnly = async () => {
    if (!userId || !session || !selectedFriendId) {
      toast.error("Select a friend to invite.");
      return;
    }
    setInviteBusy(true);
    const { data: row, error } = await supabase
      .from("class_invites")
      .insert({
        inviter_id: userId,
        invitee_id: selectedFriendId,
        class_id: session.id,
        paid_by_inviter: false,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !row) {
      toast.error(error?.message ?? "Could not create invite");
      setInviteBusy(false);
      return;
    }
    const inviteId = (row as { id: string }).id;
    const { error: finErr } = await supabase.functions.invoke("finalize-class-invite", {
      body: { class_invite_id: inviteId, after_payment: false },
    });
    if (finErr) {
      toast.error(finErr.message ?? "Invite created but notification failed.");
    } else {
      toast.success("Invite sent", {
        description: "Your friend was notified by email and in the app.",
      });
    }
    setInviteBusy(false);
    setInviteOpen(false);
    setSelectedFriendId(null);
  };

  const runPayForFriend = async () => {
    if (!userId || !session || !selectedFriendId) {
      toast.error("Select a friend to invite.");
      return;
    }
    setInviteBusy(true);
    setPayCheckoutSlow(false);
    const slow = window.setTimeout(() => setPayCheckoutSlow(true), 5000);
    const { data: row, error } = await supabase
      .from("class_invites")
      .insert({
        inviter_id: userId,
        invitee_id: selectedFriendId,
        class_id: session.id,
        paid_by_inviter: true,
        status: "pending_payment",
      })
      .select("id")
      .single();
    if (error || !row) {
      window.clearTimeout(slow);
      setPayCheckoutSlow(false);
      toast.error(error?.message ?? "Could not start payment");
      setInviteBusy(false);
      return;
    }
    const inviteId = (row as { id: string }).id;
    const origin = window.location.origin;
    const { data: checkout, error: yocoErr } = await supabase.functions.invoke("yoco-checkout", {
      body: {
        type: "class_invite",
        class_invite_id: inviteId,
        inviter_profile_id: userId,
        success_url: `${origin}/payment/success?class_invite_id=${inviteId}&profile_id=${userId}`,
        cancel_url: `${origin}/schedule`,
      },
    });
    window.clearTimeout(slow);
    setPayCheckoutSlow(false);
    setInviteBusy(false);
    if (yocoErr) {
      toast.error(yocoErr.message ?? "Checkout failed");
      return;
    }
    const redirect =
      (checkout as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (checkout as { redirect_url?: string })?.redirect_url;
    if (!redirect || typeof redirect !== "string") {
      toast.error("No payment link returned");
      return;
    }
    window.location.href = redirect;
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-0 bg-background p-0"
        >
          <div className="px-6 pb-8 pt-6">
            <SheetHeader className="text-center">
              <SheetTitle className="font-display text-2xl font-bold">{classTitle(session)}</SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {dateLine} at {timeLine}
              </SheetDescription>
              {session.description?.trim() ? (
                <p className="mt-3 text-left text-sm leading-relaxed text-foreground/90">
                  {session.description.trim()}
                </p>
              ) : null}
            </SheetHeader>

            <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <Clock className="h-4 w-4" /> {durationMin} minutes
              </li>
              <li className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4" /> {session.location}
              </li>
              {capacityInfo.message ? (
                <li className="flex items-center gap-2.5">
                  <Users className="h-4 w-4" /> {capacityInfo.message}
                </li>
              ) : null}
            </ul>

            {countsTowardChallenge && (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {challengeConfig.booking_banner_text}
              </div>
            )}

            {classTicketProduct && isPaidClassTicket ? (
              <div className="mt-4 rounded-xl border border-[#c5d4b8]/70 bg-[#f4f7f0]/90 px-3 py-2.5 text-xs">
                <p className="font-semibold text-[#3d4f36]">
                  Event ticket · {formatTicketPriceLabel(classTicketProduct.price_zar)}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {isComplimentaryClass
                    ? "Complimentary — contact the studio to be added to this class."
                    : classTicketProduct.price_zar > 0
                      ? "Purchase this ticket to book — one credit per person."
                      : "Free ticket — tap Book to reserve your spot."}
                </p>
              </div>
            ) : null}

            {isComplimentaryClass ? (
              <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
                This is a complimentary class. It cannot be booked online — please contact the
                studio team.
              </div>
            ) : null}

            {!isComplimentaryClass && credits.length === 0 && !isPaidClassTicket && !isFreeClass ? (
              <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
                No eligible credits for this class.{" "}
                <Link to="/pricing" className="text-primary underline">
                  Buy a pass
                </Link>
              </div>
            ) : null}

            {!isComplimentaryClass && credits.length > 0 ? (
              <>
                <p className="mt-6 text-sm font-semibold">Select credit to use:</p>
                <div className="mt-2 space-y-2">
                  {credits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCredit(c.id);
                        setUsePoints(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors",
                        selectedCredit === c.id && !usePoints ? "border-primary" : "border-border",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                          selectedCredit === c.id && !usePoints
                            ? "border-primary"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {selectedCredit === c.id && !usePoints && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{c.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.is_unlimited ? "Unlimited" : `${c.credits_remaining} remaining`}
                          {c.expires_at &&
                            ` · Expires ${formatStudioDateOnly(c.expires_at)}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {!isFreeClass && !isPaidClassTicket && flowPoints >= 100 && (
              <button
                type="button"
                onClick={() => {
                  setUsePoints(true);
                  setSelectedCredit(null);
                }}
                className={cn(
                  "mt-2 flex w-full items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors",
                  usePoints ? "border-primary" : "border-border",
                )}
              >
                <span
                  className={cn(
                    "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                    usePoints ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {usePoints && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <div>
                  <p className="text-sm font-semibold">Flow Points</p>
                  <p className="text-xs text-muted-foreground">
                    {flowPoints} pts · Worth R{pointsValue}
                  </p>
                </div>
              </button>
            )}

            {!isComplimentaryClass && !isFreeClass && !isPaidClassTicket && showHireAddons && (hireAddons.mat || hireAddons.towel) && (
              <>
                <p className="mt-6 text-sm font-semibold">Add-ons for this class:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {hireAddons.mat ? (
                    <button
                      key={hireAddons.mat.id}
                      type="button"
                      onClick={() => setMatAddon((v) => !v)}
                      className={cn(
                        "min-w-[7rem] flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                        matAddon ? "border-primary bg-primary/10" : "border-border bg-card",
                      )}
                    >
                      🧘 {hireAddons.mat.name}
                      {formatHireAddonPrice(hireAddons.mat.price_zar) ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {formatHireAddonPrice(hireAddons.mat.price_zar)}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                  {hireAddons.towel ? (
                    <button
                      key={hireAddons.towel.id}
                      type="button"
                      onClick={() => setTowelAddon((v) => !v)}
                      className={cn(
                        "min-w-[7rem] flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                        towelAddon ? "border-primary bg-primary/10" : "border-border bg-card",
                      )}
                    >
                      🏷️ {hireAddons.towel.name}
                      {formatHireAddonPrice(hireAddons.towel.price_zar) ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {formatHireAddonPrice(hireAddons.towel.price_zar)}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                if (acceptedFriends.length > 0) {
                  setInviteMode("friend");
                  setSelectedFriendId(acceptedFriends[0]?.id ?? null);
                } else {
                  setInviteMode("email");
                  setSelectedFriendId(null);
                }
                setInviteOpen(true);
              }}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-[#a3b693]/50 bg-card py-3.5 text-sm font-semibold text-[#4a6b3c] transition-colors hover:bg-muted/50"
            >
              <UserPlus className="h-4 w-4" />
              Invite a friend
            </button>

            {waitlistEntry ? (
              <>
                <div className="mt-6 rounded-2xl border border-[#a3b693]/50 bg-[#e8efe3]/80 px-4 py-4 text-center dark:bg-[#a3b693]/10">
                  <p className="text-sm font-semibold text-[#3d4f36] dark:text-foreground">
                    You're on the waitlist
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    We'll book you in automatically and email you if a spot opens.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void leaveClassWaitlist()}
                  disabled={waitlistBusy}
                  className="mt-6 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold disabled:opacity-50"
                >
                  {waitlistBusy ? "Leaving…" : "Leave waitlist"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-2 w-full rounded-xl py-3 text-sm font-medium text-muted-foreground"
                >
                  Close
                </button>
              </>
            ) : isComplimentaryClass ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-6 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold"
                >
                  Close
                </button>
              </>
            ) : spots === 0 && !classIsPast ? (
              <>
                <button
                  type="button"
                  onClick={() => void joinClassWaitlist()}
                  disabled={
                    waitlistBusy ||
                    (needsTicketPurchase
                      ? false
                      : !isFreeClass && !selectedCredit && !usePoints)
                  }
                  className="mt-6 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-90 disabled:opacity-50"
                >
                  {waitlistBusy ? "Joining…" : "Join Waitlist"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-2 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={loading || classIsPast}
                  className={cn(
                    "mt-6 w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity active:opacity-90 disabled:opacity-50",
                    isFreeClass && !selectedCredit && !usePoints && !classIsPast
                      ? "bg-[#a3b693] text-white"
                      : "bg-primary text-primary-foreground",
                  )}
                >
                  {classIsPast
                    ? "Class has passed"
                    : loading
                      ? payCheckoutSlow
                        ? "Redirecting to payment…"
                        : "Confirming…"
                      : needsTicketPurchase
                        ? `Pay ${formatTicketPriceLabel(classTicketProduct!.price_zar)} & book`
                        : isFreeClass && !selectedCredit && !usePoints
                          ? "Book Free"
                          : "Confirm Booking"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-2 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-0 bg-background p-0"
        >
          <div className="px-6 pb-8 pt-6">
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-xl font-bold">
                Invite to this class
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {inviteMode === "friend"
                  ? "Pick a friend in the app — they'll get an in-app notification and email."
                  : "Send the invite to an email address — works for anyone, even if they're not on One Flow yet."}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 inline-flex w-full rounded-full border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setInviteMode("friend")}
                disabled={acceptedFriends.length === 0}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  inviteMode === "friend"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                  acceptedFriends.length === 0 && "opacity-40",
                )}
              >
                Friend in app
              </button>
              <button
                type="button"
                onClick={() => setInviteMode("email")}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  inviteMode === "email"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                Email
              </button>
            </div>

            {inviteMode === "friend" ? (
              <>
                {acceptedFriends.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
                    You don&apos;t have friends in the app yet. Use the Email tab to invite anyone.
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {acceptedFriends.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFriendId(f.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                          selectedFriendId === f.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card",
                        )}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-semibold">
                          {f.avatar_url?.trim() ? (
                            <img src={f.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            friendInitials(f)
                          )}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {friendLabel(f)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!selectedFriendId || inviteBusy}
                  onClick={() => void runInviteOnly()}
                  className="mt-6 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold transition-opacity disabled:opacity-50"
                >
                  {inviteBusy ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Working…
                    </span>
                  ) : (
                    "Invite only (they pay)"
                  )}
                </button>

                <button
                  type="button"
                  disabled={!selectedFriendId || inviteBusy}
                  onClick={() => void runPayForFriend()}
                  className="mt-2 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
                >
                  {inviteBusy ? (
                    payCheckoutSlow ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Still opening Yoco…
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Payment…
                      </span>
                    )
                  ) : (
                    "Pay for them (Yoco)"
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  <div>
                    <label
                      htmlFor="invite-email-name"
                      className="mb-1 block text-xs font-medium text-muted-foreground"
                    >
                      Their name (optional)
                    </label>
                    <input
                      id="invite-email-name"
                      type="text"
                      value={inviteEmailName}
                      onChange={(e) => setInviteEmailName(e.target.value)}
                      placeholder="e.g. Sarah"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="invite-email"
                      className="mb-1 block text-xs font-medium text-muted-foreground"
                    >
                      Email address
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      autoComplete="off"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="sarah@example.com"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={inviteBusy || !inviteEmail.trim()}
                  onClick={() => void runInviteByEmail()}
                  className="mt-6 w-full rounded-xl border border-border bg-card py-3.5 text-sm font-semibold transition-opacity disabled:opacity-50"
                >
                  {inviteBusy ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </span>
                  ) : (
                    "Invite only (they pay)"
                  )}
                </button>

                <button
                  type="button"
                  disabled={inviteBusy || !inviteEmail.trim()}
                  onClick={() => void runPayForFriendByEmail()}
                  className="mt-2 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
                >
                  {inviteBusy ? (
                    payCheckoutSlow ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Still opening Yoco…
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Payment…
                      </span>
                    )
                  ) : (
                    "Pay for them (Yoco)"
                  )}
                </button>

                <p className="mt-3 text-center text-[11px] leading-snug text-muted-foreground">
                  They&apos;ll get the email straight away. If you paid, the class is booked the
                  moment they sign up with that email.
                </p>
              </>
            )}

            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="mt-2 w-full rounded-xl py-3 text-sm font-medium text-muted-foreground"
            >
              Close
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
