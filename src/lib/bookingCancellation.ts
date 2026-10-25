import { supabase, getUser } from "@/lib/supabase";
import { formatStudioEmailDate, formatStudioTime12Upper } from "@/lib/timezone";
import { promoteNextWaitlistEntry, sendWaitlistPromotionEmail } from "@/lib/waitlist";

type CancelBookingParams = {
  bookingId: string;
  cancellationReason: "customer_cancelled" | "admin_cancelled";
  waiveLateFee?: boolean;
};

type CancellationResult = {
  lateCancel: boolean;
  waived: boolean;
  className: string;
  startsAt: string;
};

type BookingCancelRow = {
  id: string;
  status: string;
  profile_id: string;
  class_id: string;
  mat_addon: boolean | null;
  towel_addon: boolean | null;
  classes:
    | {
        name: string;
        starts_at: string;
        location: string | null;
        guide_name: string | null;
      }
    | {
        name: string;
        starts_at: string;
        location: string | null;
        guide_name: string | null;
      }[]
    | null;
  profiles:
    | {
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }
    | {
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function cancelBookingWithPolicy({
  bookingId,
  cancellationReason,
  waiveLateFee = false,
}: CancelBookingParams): Promise<CancellationResult> {
  const user =
    cancellationReason === "customer_cancelled" ? await getUser() : null;
  if (cancellationReason === "customer_cancelled" && !user) {
    throw new Error("Sign in to cancel this booking");
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `
      id,
      status,
      profile_id,
      class_id,
      mat_addon,
      towel_addon,
      classes ( name, starts_at, location, guide_name ),
      profiles ( email, first_name, last_name )
    `,
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Booking not found");

  const booking = data as unknown as BookingCancelRow;
  if (booking.status === "cancelled") {
    throw new Error("Booking already cancelled");
  }
  if (cancellationReason === "customer_cancelled" && booking.profile_id !== user?.id) {
    throw new Error("You can only cancel your own bookings");
  }

  const cls = one(booking.classes);
  if (!cls?.starts_at) throw new Error("Booking class details missing");

  // The database cancels the booking, refunds any credit or Flow Points and
  // flags a late-cancel fee (unless waived) in one transaction.
  const { data: cancelData, error: cancelError } = await supabase.rpc("cancel_my_booking", {
    p_booking_id: booking.id,
    p_reason: cancellationReason,
    p_waive_late_fee: waiveLateFee,
  });
  if (cancelError) throw new Error(cancelError.message);

  const cancelResult = one(
    cancelData as
      | { late_cancel?: boolean | null; late_fee_applied?: boolean | null }
      | { late_cancel?: boolean | null; late_fee_applied?: boolean | null }[]
      | null,
  );
  const lateCancel = Boolean(cancelResult?.late_cancel);

  const profile = one(booking.profiles);
  const toEmail = profile?.email?.trim() || "";
  if (toEmail) {
    const date = formatStudioEmailDate(cls.starts_at);
    const time = formatStudioTime12Upper(cls.starts_at);

    await supabase.functions.invoke("send-email", {
      body: {
        to: toEmail,
        template: lateCancel && !waiveLateFee ? "late_cancellation" : "booking_cancellation",
        data: {
          class_name: cls.name,
          date,
          time,
          starts_at: cls.starts_at,
          guide_name: cls.guide_name ?? "Guide",
          location: cls.location ?? "One Flow",
          mat_addon: Boolean(booking.mat_addon),
          towel_addon: Boolean(booking.towel_addon),
        },
      },
    });
  }

  // Best-effort waitlist promotion: a spot just opened. If someone qualifies,
  // they're auto-booked server-side; we then notify them. Any failure here is
  // logged but doesn't fail the cancel.
  try {
    const promoted = await promoteNextWaitlistEntry(booking.class_id);
    if (promoted) {
      await sendWaitlistPromotionEmail(promoted.bookingId);
    }
  } catch (e) {
    console.error("waitlist promotion after cancel", e);
  }

  return {
    lateCancel,
    waived: lateCancel && waiveLateFee,
    className: cls.name,
    startsAt: cls.starts_at,
  };
}
