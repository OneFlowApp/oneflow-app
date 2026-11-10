import { supabase } from "@/lib/supabase";
import { DEFAULT_MOVEMENT_CHALLENGE, type MovementChallengeConfig } from "@/lib/movementChallenge";
import type { HomeEventCardConfig } from "@/lib/homeEventCard";

export type SpotlightKind = "promo" | "event" | "challenge";
export type SpotlightPlacement = "top" | "bottom";

export type HomeSpotlight = {
  id: string;
  kind: SpotlightKind;
  badge: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  event_date: string | null;
  price_label: string | null;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  placement: SpotlightPlacement;
  is_live: boolean;
  sort_order: number;
  closed_at: string | null;
  created_at: string;
};

export const SPOTLIGHT_COLUMNS =
  "id, kind, badge, title, subtitle, body, event_date, price_label, image_url, link_url, link_label, placement, is_live, sort_order, closed_at, created_at";

export const SPOTLIGHT_KIND_LABEL: Record<SpotlightKind, string> = {
  promo: "Offer or announcement",
  event: "Event",
  challenge: "Movement challenge",
};

export async function fetchLiveSpotlights(): Promise<HomeSpotlight[]> {
  const { data, error } = await supabase
    .from("home_spotlights")
    .select(SPOTLIGHT_COLUMNS)
    .eq("is_live", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("home spotlights", error.message);
    return [];
  }
  return (data ?? []) as HomeSpotlight[];
}

/** An offer row drawn with the existing spotlight card (image, badge, title, subtitle, link). */
export function promoConfigFor(s: HomeSpotlight): MovementChallengeConfig {
  return {
    ...DEFAULT_MOVEMENT_CHALLENGE,
    home_card_mode: "offer",
    promo_badge_label: s.badge ?? "",
    promo_title: s.title,
    promo_subtitle: s.subtitle ?? "",
    promo_image_url: s.image_url ?? "",
    promo_link: s.link_url ?? "/schedule",
    promo_link_label: s.link_label ?? "",
  };
}

/** An event row drawn with the existing event card. */
export function eventConfigFor(s: HomeSpotlight): HomeEventCardConfig {
  return {
    enabled: true,
    image_url: s.image_url ?? "",
    event_date: s.event_date ?? "",
    price_label: s.price_label ?? "",
    title: s.title,
    body_text: s.body ?? "",
    link_url: s.link_url ?? "/schedule",
    link_label: s.link_label ?? "Learn more",
  };
}
