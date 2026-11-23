import { useEffect, useState } from "react";
import { Loader2, Star, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";

type GuideCard = {
  name: string | null;
  bio: string | null;
  photo_url: string | null;
  disciplines: string[] | null;
  avg_rating: number | null;
  review_count: number;
  reviews: { rating: number; comment: string; at: string; class_name: string | null }[];
};

/** Tap a guide's name on the schedule: their photo, bio, rating and recent reviews. */
export function GuideCardSheet({
  classId,
  fallbackName,
  open,
  onOpenChange,
}: {
  classId: string | null;
  fallbackName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [card, setCard] = useState<GuideCard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !classId) return;
    let cancelled = false;
    setLoading(true);
    setCard(null);
    void supabase.rpc("guide_card", { p_class_id: classId }).then(({ data }) => {
      if (cancelled) return;
      setCard((data as GuideCard | null) ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, classId]);

  const name = card?.name || fallbackName || "Your guide";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-0 bg-background p-0 pb-[env(safe-area-inset-bottom)] [&>button:first-of-type]:hidden"
      >
        <div className="sticky top-0 z-10 flex justify-end bg-background/95 px-4 pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 pb-8">
          <div className="flex items-center gap-4">
            {card?.photo_url ? (
              <img
                src={card.photo_url}
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#a3b693] text-xl font-bold text-white">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <SheetTitle className="font-display text-xl font-bold">{name}</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {card?.avg_rating != null && card.review_count > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-[#d4af37] text-[#d4af37]" aria-hidden />
                    {card.avg_rating} from {card.review_count} review
                    {card.review_count === 1 ? "" : "s"}
                  </span>
                ) : (
                  "Guide at One Flow"
                )}
              </SheetDescription>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {card?.bio?.trim() ? (
                <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {card.bio.trim()}
                </p>
              ) : null}

              {card?.reviews?.length ? (
                <div className="mt-6">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent reviews
                  </h4>
                  <ul className="mt-2 space-y-3">
                    {card.reviews.map((r, i) => (
                      <li key={i} className="rounded-xl border border-border bg-card px-3 py-2.5">
                        <div className="flex items-center gap-0.5" aria-label={`${r.rating} stars`}>
                          {Array.from({ length: 5 }).map((_, s) => (
                            <Star
                              key={s}
                              className={
                                s < r.rating
                                  ? "h-3 w-3 fill-[#d4af37] text-[#d4af37]"
                                  : "h-3 w-3 text-muted-foreground/30"
                              }
                              aria-hidden
                            />
                          ))}
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {r.class_name ? `${r.class_name} · ` : ""}
                            {new Date(r.at).toLocaleDateString("en-ZA", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-snug">{r.comment}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!card?.bio?.trim() && !card?.reviews?.length ? (
                <p className="mt-5 text-sm text-muted-foreground">More about {name} coming soon.</p>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
