import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { HomeSpotlightCard } from "@/components/HomeSpotlightCard";
import { HomeSpotlightsManager } from "@/components/admin/HomeSpotlightsManager";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_MOVEMENT_CHALLENGE,
  fetchMovementChallengeConfig,
  homeSpotlightImageUrl,
  movementChallengeTotalDays,
  saveMovementChallengeConfig,
  type HomeSpotlightCardMode,
  type MovementChallengeConfig,
} from "@/lib/movementChallenge";
import { getUser } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  DEFAULT_HOME_EVENT_CARD,
  fetchHomeEventCardConfig,
  saveHomeEventCardConfig,
  type HomeEventCardConfig,
} from "@/lib/homeEventCard";
import { HomeEventCard } from "@/components/HomeEventCard";
import { uploadChallengeImage } from "@/lib/uploadChallengeImage";

export const Route = createFileRoute("/admin/challenge")({
  head: () => ({ meta: [{ title: "Home Spotlight — One Flow Admin" }] }),
  component: AdminChallengePage,
});

type ImageTarget = "challenge" | "promo" | "event";

function AdminChallengePage() {
  const [config, setConfig] = useState<MovementChallengeConfig>(DEFAULT_MOVEMENT_CHALLENGE);
  const [eventCard, setEventCard] = useState<HomeEventCardConfig>(DEFAULT_HOME_EVENT_CARD);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageTarget, setImageTarget] = useState<ImageTarget>("challenge");
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await fetchMovementChallengeConfig({ bypassCache: true }));
      setEventCard(await fetchHomeEventCardConfig({ bypassCache: true }));
    } catch (e) {
      console.error(e);
      toast.error("Could not load spotlight settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof MovementChallengeConfig>(
    key: K,
    value: MovementChallengeConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateEventCard = <K extends keyof HomeEventCardConfig>(
    key: K,
    value: HomeEventCardConfig[K],
  ) => {
    setEventCard((prev) => ({ ...prev, [key]: value }));
  };

  // Offers and events now live in the spotlight library; this page only saves the challenge.
  const isPromoMode = false;

  const save = async () => {
    if (isPromoMode && !config.promo_title.trim()) {
      toast.error("Promo title is required for events and offers");
      return;
    }
    if (config.home_card_mode === "challenge" && !config.title.trim()) {
      toast.error("Challenge title is required");
      return;
    }
    if (config.enabled) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(config.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(config.end_date)) {
        toast.error("Use YYYY-MM-DD for challenge start and end dates");
        return;
      }
      if (config.end_date < config.start_date) {
        toast.error("Challenge end date must be on or after start date");
        return;
      }
    }
    const promoLink = config.promo_link.trim();
    if (isPromoMode && promoLink.startsWith("http") && !promoLink.startsWith("https://")) {
      toast.error("External promo links must use https://");
      return;
    }

    setSaving(true);
    try {
      const user = await getUser();
      await saveMovementChallengeConfig(
        {
          ...config,
          badge_label: config.badge_label.trim(),
          title: config.title.trim(),
          subtitle: config.subtitle.trim(),
          stamp_help_text: config.stamp_help_text.trim(),
          booking_banner_text: config.booking_banner_text.trim(),
          promo_badge_label: config.promo_badge_label.trim(),
          promo_title: config.promo_title.trim(),
          promo_subtitle: config.promo_subtitle.trim(),
          promo_link: promoLink,
          promo_link_label: config.promo_link_label.trim(),
        },
        user?.id ?? null,
      );
      await saveHomeEventCardConfig({
        ...eventCard,
        image_url: eventCard.image_url.trim(),
        event_date: eventCard.event_date.trim(),
        price_label: eventCard.price_label.trim(),
        title: eventCard.title.trim(),
        body_text: eventCard.body_text.trim(),
        link_url: eventCard.link_url.trim() || "/schedule",
        link_label: eventCard.link_label.trim() || "Learn more",
      });
      toast.success("Saved");
    } catch (e) {
      console.error(e);
      toast.error(supabaseErrorMessage(e, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const onImagePick = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadChallengeImage(file);
      if (imageTarget === "event") {
        updateEventCard("image_url", url);
      } else if (imageTarget === "promo") {
        update("promo_image_url", url);
      } else {
        update("image_url", url);
      }
      toast.success("Image uploaded");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const totalDays = movementChallengeTotalDays(config);
  const previewConfig =
    config.home_card_mode === "hidden"
      ? { ...config, home_card_mode: "challenge" as const }
      : config;

  return (
    <div>
      <PageHeader
        title="Home spotlight"
        description="Spotlights at the top or bottom of the member Home page, and the Movement challenge."
        actions={
          <Button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save challenge
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <HomeSpotlightsManager challengeConfig={config} />

          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">Movement challenge</h3>
            <label className="mb-4 flex cursor-pointer items-center gap-3">
              <Checkbox
                checked={config.enabled}
                onCheckedChange={(v) => update("enabled", v === true)}
                disabled={loading}
              />
              <span className="text-sm">
                Enable stamp tracking, /challenge page, and booking banners
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="ch-badge">Badge label</Label>
                <Input
                  id="ch-badge"
                  value={config.badge_label}
                  onChange={(e) => update("badge_label", e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="ch-title">Title</Label>
                <Input
                  id="ch-title"
                  value={config.title}
                  onChange={(e) => update("title", e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="ch-subtitle">Subtitle (/challenge page)</Label>
                <Input
                  id="ch-subtitle"
                  value={config.subtitle}
                  onChange={(e) => update("subtitle", e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="ch-booking">Booking sheet banner</Label>
                <Input
                  id="ch-booking"
                  value={config.booking_banner_text}
                  onChange={(e) => update("booking_banner_text", e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="ch-stamp-help">Stamp card footnote</Label>
                <Textarea
                  id="ch-stamp-help"
                  rows={3}
                  value={config.stamp_help_text}
                  onChange={(e) => update("stamp_help_text", e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <h4 className="mb-3 text-sm font-semibold">Challenge dates</h4>
              <p className="mb-4 text-sm text-muted-foreground">
                Check-ins during this range earn stamps ({totalDays} day
                {totalDays === 1 ? "" : "s"}).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="ch-start">Start date</Label>
                  <Input
                    id="ch-start"
                    type="date"
                    value={config.start_date}
                    onChange={(e) => update("start_date", e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ch-end">End date</Label>
                  <Input
                    id="ch-end"
                    type="date"
                    value={config.end_date}
                    onChange={(e) => update("end_date", e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <h4 className="mb-3 text-sm font-semibold">Challenge hero image</h4>
              <div className="grid gap-1.5">
                <Label htmlFor="ch-image-url">Image URL</Label>
                <Input
                  id="ch-image-url"
                  value={config.image_url}
                  onChange={(e) => update("image_url", e.target.value)}
                  disabled={loading}
                  placeholder="Leave blank for default studio photo"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-3 gap-2"
                disabled={loading || uploading}
                onClick={() => {
                  setImageTarget("challenge");
                  imageInputRef.current?.click();
                }}
              >
                {uploading && imageTarget === "challenge" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                Upload challenge image
              </Button>
            </div>
          </section>

        </div>

        <aside className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Challenge card preview
          </p>
          <div className="pointer-events-none">
            <HomeSpotlightCard
              config={{ ...config, home_card_mode: "challenge" }}
              challengeStamped={0}
              challengeTotalDays={totalDays}
            />
          </div>
        </aside>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onImagePick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
