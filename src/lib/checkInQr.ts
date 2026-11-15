import type { SupabaseClient } from "@supabase/supabase-js";

export type QrCheckInRpcResult = {
  ok: boolean;
  code?: string;
  message?: string;
  booking_id?: string;
  profile_id?: string;
  member_name?: string;
  member_role?: string | null;
  class_starts_at?: string | null;
};

/** Staff QR check-in via DB RPC (bypasses bookings RLS). Falls back to null if RPC is unavailable. */
export async function checkInBookingByQrRpc(
  client: SupabaseClient,
  token: string,
): Promise<{ result: QrCheckInRpcResult | null; rpcError: string | null }> {
  const { data, error } = await client.rpc("check_in_booking_by_qr", { p_token: token });

  if (error) {
    const msg = error.message ?? "";
    if (
      error.code === "PGRST202" ||
      msg.includes("check_in_booking_by_qr") ||
      msg.includes("Could not find the function")
    ) {
      return { result: null, rpcError: null };
    }
    return { result: null, rpcError: msg };
  }

  if (!data || typeof data !== "object") {
    return { result: null, rpcError: "Unexpected check-in response" };
  }

  return { result: data as QrCheckInRpcResult, rpcError: null };
}

/**
 * A member who cancelled and rebooked the same class may still show the old QR code.
 * Given the scanned (cancelled) booking's token, return the qr_token of that member's
 * current confirmed booking for the same class, if there is one.
 */
export async function findRebookedQrToken(
  client: SupabaseClient,
  cancelledToken: string,
): Promise<string | null> {
  const { data: old, error } = await client
    .from("bookings")
    .select("profile_id, class_id, status")
    .eq("qr_token", cancelledToken)
    .maybeSingle();
  if (error || !old || old.status !== "cancelled" || !old.profile_id || !old.class_id) return null;

  const { data: current, error: currentError } = await client
    .from("bookings")
    .select("qr_token")
    .eq("profile_id", old.profile_id)
    .eq("class_id", old.class_id)
    .eq("status", "confirmed")
    .not("qr_token", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError || !current?.qr_token) return null;
  const next = String(current.qr_token);
  return next === cancelledToken ? null : next;
}
