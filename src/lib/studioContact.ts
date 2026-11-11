import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Fallback studio WhatsApp / phone, used until a number is saved in Admin → Settings. */
export const STUDIO_PHONE_E164 = "27825533033";
export const STUDIO_PHONE_DISPLAY = "+27 82 553 3033";
export const STUDIO_WHATSAPP_URL = `https://wa.me/${STUDIO_PHONE_E164}`;
export const STUDIO_PHONE_TEL = `tel:+${STUDIO_PHONE_E164}`;

/** Turns "082 553 3033", "+27 82 553 3033" or "27825533033" into "27825533033". */
export function whatsappDigits(raw: string | null | undefined): string | null {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** The studio WhatsApp link, from Admin → Settings (works before sign in too). */
export function useStudioWhatsAppUrl(): string {
  const { data } = useQuery({
    queryKey: ["studio-whatsapp-number"],
    queryFn: async () => {
      const { data: value, error } = await supabase.rpc("studio_whatsapp_number");
      if (error) throw error;
      return typeof value === "string" ? value : null;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const digits = whatsappDigits(data);
  return digits ? `https://wa.me/${digits}` : STUDIO_WHATSAPP_URL;
}
