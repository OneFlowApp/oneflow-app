import { useQuery } from "@tanstack/react-query";
import { HomeSpotlightCard } from "@/components/HomeSpotlightCard";
import { HomeEventCard } from "@/components/HomeEventCard";
import {
  eventConfigFor,
  fetchLiveSpotlights,
  promoConfigFor,
  type SpotlightPlacement,
} from "@/lib/homeSpotlights";
import type { MovementChallengeConfig } from "@/lib/movementChallenge";

/** Live spotlights for one place on the member Home page (top or bottom). */
export function HomeSpotlightSlot({
  placement,
  challengeConfig,
  challengeStamped,
  challengeTotalDays,
}: {
  placement: SpotlightPlacement;
  challengeConfig: MovementChallengeConfig | null | undefined;
  challengeStamped: number;
  challengeTotalDays: number;
}) {
  const { data } = useQuery({
    queryKey: ["home-spotlights"],
    queryFn: fetchLiveSpotlights,
    staleTime: 60_000,
  });
  const items = (data ?? []).filter((s) => s.placement === placement);
  if (items.length === 0) return null;

  const cards = items.map((s) => {
    if (s.kind === "event") return <HomeEventCard key={s.id} config={eventConfigFor(s)} />;
    if (s.kind === "challenge") {
      if (!challengeConfig) return null;
      return (
        <HomeSpotlightCard
          key={s.id}
          config={{ ...challengeConfig, home_card_mode: "challenge" }}
          challengeStamped={challengeStamped}
          challengeTotalDays={challengeTotalDays}
        />
      );
    }
    return <HomeSpotlightCard key={s.id} config={promoConfigFor(s)} />;
  });

  if (placement === "top") return <section className="space-y-4">{cards}</section>;
  return (
    <section className="space-y-4 border-t border-border pt-2">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        From the studio
      </p>
      {cards}
    </section>
  );
}
