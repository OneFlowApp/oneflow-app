/** Placeholder values stored in user_credits.yoco_payment_id when no Yoco ID was captured. */
const YOCO_PLACEHOLDER_IDS = new Set([
  "yoco_checkout",
  "manual_assignment",
  "free_intro",
  "manual_component",
  "manual_green_point",
  "manual_studio",
]);

function normalizedYocoId(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

/** Yoco checkout ID (ch_…) — Yoco CSV "Online Reference". */
export function yocoCheckoutId(raw: string | null | undefined): string | null {
  const t = normalizedYocoId(raw);
  if (!t || YOCO_PLACEHOLDER_IDS.has(t)) return null;
  return t.startsWith("ch_") ? t : null;
}

/** Yoco payment reference — Yoco CSV "Reference" / receipt # (often paymentId, not ch_). */
export function yocoReferenceId(raw: string | null | undefined): string | null {
  const t = normalizedYocoId(raw);
  if (!t || YOCO_PLACEHOLDER_IDS.has(t)) return null;
  return t.startsWith("ch_") ? null : t;
}

/** Any stored Yoco id (checkout or reference) for search/export. */
export function yocoStoredPaymentId(raw: string | null | undefined): string | null {
  const t = normalizedYocoId(raw);
  if (!t || YOCO_PLACEHOLDER_IDS.has(t)) return null;
  return t;
}

export function isRecordedYocoPayment(raw: string | null | undefined): boolean {
  return yocoStoredPaymentId(raw) != null;
}

export function isYocoCheckoutPlaceholder(raw: string | null | undefined): boolean {
  return normalizedYocoId(raw) === "yoco_checkout";
}
