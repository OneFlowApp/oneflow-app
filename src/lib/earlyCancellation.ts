/** Staff don't need to see cancellations made 2 or more hours before class (no fee, no follow up). */
export const LATE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isEarlyCancellation(b: {
  status: string | null | undefined;
  cancelled_at?: string | null;
  late_cancel?: boolean | null;
  starts_at: string | null | undefined;
}): boolean {
  if (String(b.status) !== "cancelled") return false;
  if (b.late_cancel) return false;
  if (!b.cancelled_at || !b.starts_at) return true;
  return new Date(b.starts_at).getTime() - new Date(b.cancelled_at).getTime() >= LATE_CANCEL_WINDOW_MS;
}
