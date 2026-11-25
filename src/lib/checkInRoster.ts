import type { SupabaseClient } from "@supabase/supabase-js";
import { awardClassesAttendedBadges } from "@/lib/badges";
import {
  checkInWindowAt,
  DEFAULT_CHECKIN_OPEN_MINUTES_BEFORE,
} from "@/lib/checkInWindow";
import { deleteMayChallengeCheckInForBooking } from "@/lib/mayChallengeCheckIn";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { bookingPaymentLabel, type BookingCreditInfo } from "@/lib/bookingPaymentLabel";
import { formatStudioEmailDate, formatStudioTime12Upper } from "@/lib/timezone";

export type BookingStatus = "attended" | "confirmed" | "cancelled" | "no-show";

export type ProfileJoinRow = {
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
  role?: string | null;
};

export type BookingRow = {
  id: string;
  status: string;
  profile_id: string;
  class_id: string;
  qr_token: string | null;
  qr_used?: boolean | null;
  checked_in?: boolean | null;
  payment_method: string | null;
  credit_id?: string | null;
  unpaid?: boolean | null;
  paid_where?: string | null;
  mat_addon?: boolean | null;
  towel_addon?: boolean | null;
  profiles: ProfileJoinRow | ProfileJoinRow[] | null;
  classes:
    | {
        id: string;
        name: string;
        starts_at: string;
        guide_name: string | null;
        class_type?: string | null;
      }
    | {
        id: string;
        name: string;
        starts_at: string;
        guide_name: string | null;
        class_type?: string | null;
      }[]
    | null;
};

export type RosterRow = {
  id: string;
  status: BookingStatus;
  member: string;
  memberFirst: string | null;
  memberLast: string | null;
  profileId: string;
  class_id: string;
  className: string;
  classStartsAt: string;
  classType: string | null;
  startsAtLabel: string;
  creditLabel: string;
  matAddon: boolean;
  towelAddon: boolean;
  hasSageCredit: boolean;
  avatarUrl: string | null;
  memberRole: string | null;
};

export function oneProfile(p: BookingRow["profiles"]): ProfileJoinRow | null {
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

export function oneClass(c: BookingRow["classes"]) {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

/** Check-in roster display: first initial + full surname (e.g. J Dumas). */
export function formatCheckInMemberName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "Unknown member";
  if (!l) return f;
  if (!f) return l;
  return `${f.charAt(0).toUpperCase()} ${l}`;
}

export function rosterInitials(
  first: string | null | undefined,
  last: string | null | undefined,
) {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const parts = [f.charAt(0), l.charAt(0)].filter(Boolean);
  return parts.join("").toUpperCase() || "?";
}

/** Normalize mat/towel flags from PostgREST (boolean, 0/1, or legacy string). */
export function rosterAddonTruthy(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "t" || s === "1" || s === "yes";
  }
  return false;
}

export function formatClassTime(iso: string) {
  return formatStudioTime12Upper(iso);
}

export type RosterAddonAccessSets = {
  matProfileIds: Set<string>;
  towelProfileIds: Set<string>;
  cafeProfileIds: Set<string>;
};

export function normalizeBooking(
  raw: BookingRow,
  addonAccess: RosterAddonAccessSets,
  credits?: Map<string, BookingCreditInfo>,
): RosterRow | null {
  const prof = oneProfile(raw.profiles);
  const member = prof
    ? formatCheckInMemberName(prof.first_name, prof.last_name)
    : "Unknown member";
  const cls = oneClass(raw.classes);
  if (!cls) return null;
  const status = raw.status as BookingStatus;
  if (!["attended", "confirmed", "cancelled", "no-show"].includes(status)) return null;
  const matAddon = addonAccess.matProfileIds.has(raw.profile_id);
  const towelAddon = addonAccess.towelProfileIds.has(raw.profile_id);
  const avatarRaw = prof?.avatar_url;
  const avatarUrl = typeof avatarRaw === "string" && avatarRaw.trim() ? avatarRaw.trim() : null;
  return {
    id: raw.id,
    status,
    member,
    memberFirst: prof?.first_name ?? null,
    memberLast: prof?.last_name ?? null,
    profileId: raw.profile_id,
    class_id: raw.class_id,
    className: cls.name,
    classStartsAt: cls.starts_at,
    classType: cls.class_type ?? null,
    startsAtLabel: `Today · ${formatClassTime(cls.starts_at)}`,
    // Same wording as the class bookings page: "Package · …", "Comp (no pack)", "Not paid yet".
    creditLabel: bookingPaymentLabel(
      raw.payment_method,
      raw.credit_id ? credits?.get(raw.credit_id) : null,
      { unpaid: raw.unpaid, paidWhere: raw.paid_where },
    ),
    matAddon,
    towelAddon,
    hasSageCredit: addonAccess.cafeProfileIds.has(raw.profile_id),
    avatarUrl,
    memberRole: prof?.role ?? null,
  };
}

export async function patchBookingAttendance(
  client: SupabaseClient,
  args: {
    bookingId: string;
    status: "attended" | "confirmed";
    context: {
      profileId: string;
      classStartsAt: string;
      classType?: string | null;
    } | null;
    openMinutesBefore?: number;
  },
): Promise<{ error: string | null }> {
  const { bookingId, status, context, openMinutesBefore = DEFAULT_CHECKIN_OPEN_MINUTES_BEFORE } =
    args;

  if (status === "attended" && context?.classStartsAt) {
    const window = checkInWindowAt(
      context.classStartsAt,
      context.classType,
      openMinutesBefore,
    );
    if (!window.allowed) {
      return { error: window.reason ?? "Check-in is not available for this class right now." };
    }
  }

  const patch =
    status === "attended"
      ? {
          status,
          checked_in: true,
          checked_in_at: new Date().toISOString(),
        }
      : {
          status,
          checked_in: false,
          checked_in_at: null as string | null,
          qr_used: false,
        };
  const { error } = await client.from("bookings").update(patch).eq("id", bookingId);
  if (error) {
    console.error("check-in: booking status update failed", error);
    return { error: supabaseErrorMessage(error, "Could not update booking") };
  }
  if (status === "attended" && context) {
    await client.from("challenge_checkins").insert({
      profile_id: context.profileId,
      class_date: new Date(context.classStartsAt).toISOString().split("T")[0],
      booking_id: bookingId,
    });
    void awardClassesAttendedBadges(context.profileId);
  } else if (status === "confirmed") {
    await deleteMayChallengeCheckInForBooking(bookingId);
  }
  return { error: null };
}
