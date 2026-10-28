import { useQuery } from "@tanstack/react-query";
import {
  classSkipsPayment,
  fetchBookableProductCatalog,
  isComplimentaryClassTicket,
} from "@/lib/scheduleBooking";
import { pickPerClassHireAddons } from "@/lib/bookingAddons";
import { fetchMyWaitlistEntryForClass } from "@/lib/waitlist";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "./queryKeys";

export type BookingSheetSession = {
  id: string;
  class_type: string;
  product_id?: string | null;
};

export type BookingSheetData = {
  userId: string;
  userEmail: string | null;
  userRole: string | null;
  flowPoints: number;
  credits: {
    id: string;
    product_id?: string | null;
    product_name: string;
    credits_remaining: number | null;
    is_unlimited: boolean;
    expires_at: string | null;
    allowed_class_types: string[] | null;
    category: string | null;
    mat_access?: boolean | null;
    towel_access?: boolean | null;
  }[];
  acceptedFriends: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  }[];
  hireAddons: ReturnType<typeof pickPerClassHireAddons>;
  waitlistEntry: Awaited<ReturnType<typeof fetchMyWaitlistEntryForClass>>;
  isFreeClass: boolean;
  isComplimentaryClass: boolean;
  classTicketProduct: { id: string; name: string; price_zar: number } | null;
};

async function fetchBookableCatalogCached() {
  return queryClient.fetchQuery({
    queryKey: queryKeys.bookableCatalog(),
    queryFn: () => fetchBookableProductCatalog(supabase),
    staleTime: 5 * 60_000,
  });
}

export async function fetchBookingSheetData(
  userId: string,
  userEmail: string | null | undefined,
  session: BookingSheetSession,
): Promise<BookingSheetData> {
  const catalog = await fetchBookableCatalogCached();

  const ticketPromise = session.product_id
    ? supabase
        .from("products")
        .select("id, name, price_zar, category, is_class_ticket")
        .eq("id", session.product_id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const addonPromise = supabase
    .from("products")
    .select("id, name, price_zar")
    .eq("is_active", true)
    .eq("is_addon", true)
    .ilike("name", "%hire%")
    .not("name", "ilike", "%monthly%")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const ticketRes = await ticketPromise;
  const ticketRow = ticketRes.data as {
    id: string;
    name: string;
    price_zar: number;
    category?: string | null;
    is_class_ticket?: boolean | null;
  } | null;
  const ticket = ticketRow && typeof ticketRow.price_zar === "number" ? ticketRow : null;
  const complimentaryTicket = isComplimentaryClassTicket(ticket);
  const skipPayment = classSkipsPayment(session.class_type, catalog);

  const creditsPromise = complimentaryTicket
    ? Promise.resolve({ data: null, error: null })
    : supabase
        .from("user_credits")
        .select(
          "id, product_id, product_name, credits_remaining, is_unlimited, expires_at, allowed_class_types, category, mat_access, towel_access",
        )
        .eq("profile_id", userId);

  const pointsPromise = complimentaryTicket
    ? Promise.resolve({ data: null, error: null })
    : supabase.from("profiles").select("flow_points, role").eq("id", userId).maybeSingle();

  const [
    { data: creditsData },
    { data: pointsData },
    { data: ships },
    { data: addonData },
    waitlistMine,
  ] = await Promise.all([
    creditsPromise,
    pointsPromise,
    supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq("status", "accepted"),
    addonPromise,
    fetchMyWaitlistEntryForClass(session.id, userId).catch((err) => {
      console.error("[BookingSheet] waitlist lookup failed", err);
      return null;
    }),
  ]);

  const addons = (addonData ?? []) as { id: string; name: string; price_zar: number }[];
  const hires = pickPerClassHireAddons(addons);

  let credits: BookingSheetData["credits"] = [];
  let flowPoints = 0;
  let userRole: string | null = null;

  if (!complimentaryTicket) {
    const prof = pointsData as { flow_points?: number | null; role?: string | null } | null;
    const fp = prof?.flow_points;
    flowPoints = typeof fp === "number" && Number.isFinite(fp) ? Math.max(0, fp) : 0;
    userRole = prof?.role ?? null;
    credits = (creditsData ?? []) as BookingSheetData["credits"];
  }

  const shipRows = (ships ?? []) as { requester_id: string; addressee_id: string }[];
  const otherIds = shipRows.map((s) =>
    s.requester_id === userId ? s.addressee_id : s.requester_id,
  );

  let acceptedFriends: BookingSheetData["acceptedFriends"] = [];
  if (otherIds.length > 0) {
    const { data: profs } = await supabase
      .from("member_directory")
      .select("id, first_name, last_name, avatar_url")
      .in("id", otherIds);
    acceptedFriends = (profs ?? []) as BookingSheetData["acceptedFriends"];
  }

  return {
    userId,
    userEmail: userEmail ?? null,
    userRole,
    flowPoints,
    credits,
    acceptedFriends,
    hireAddons: hires,
    waitlistEntry: waitlistMine,
    isFreeClass: skipPayment,
    isComplimentaryClass: complimentaryTicket,
    classTicketProduct: ticket,
  };
}

export function useBookingSheetData(
  userId: string | undefined,
  userEmail: string | null | undefined,
  session: BookingSheetSession | null,
  open: boolean,
) {
  return useQuery({
    queryKey: queryKeys.bookingSheet(userId ?? "", session?.id ?? ""),
    queryFn: () => fetchBookingSheetData(userId!, userEmail, session!),
    enabled: open && !!userId && !!session,
    staleTime: 30_000,
  });
}
