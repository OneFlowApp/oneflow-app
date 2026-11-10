import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HomeSpotlightCard } from "@/components/HomeSpotlightCard";
import { HomeEventCard } from "@/components/HomeEventCard";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { uploadChallengeImage } from "@/lib/uploadChallengeImage";
import { cn } from "@/lib/utils";
import {
  eventConfigFor,
  promoConfigFor,
  SPOTLIGHT_COLUMNS,
  SPOTLIGHT_KIND_LABEL,
  type HomeSpotlight,
  type SpotlightKind,
  type SpotlightPlacement,
} from "@/lib/homeSpotlights";
import type { MovementChallengeConfig } from "@/lib/movementChallenge";

type Draft = Omit<HomeSpotlight, "id" | "is_live" | "sort_order" | "closed_at" | "created_at">;

const EMPTY: Draft = {
  kind: "promo",
  badge: "Special offer",
  title: "",
  subtitle: "",
  body: "",
  event_date: "",
  price_label: "",
  image_url: "",
  link_url: "/schedule",
  link_label: "Tap to view →",
  placement: "bottom",
};

const PLACEMENT_LABEL: Record<SpotlightPlacement, string> = {
  top: "Top of Home",
  bottom: "Bottom of Home",
};

/** Admin → Home spotlight: a library of spotlights, live at the top or bottom of Home, or closed. */
export function HomeSpotlightsManager({ challengeConfig }: { challengeConfig: MovementChallengeConfig }) {
  const [rows, setRows] = useState<HomeSpotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("home_spotlights")
      .select(SPOTLIGHT_COLUMNS)
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load spotlights"));
      return;
    }
    setRows((data ?? []) as HomeSpotlight[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useMemo(
    () => ({
      top: rows.filter((r) => r.is_live && r.placement === "top"),
      bottom: rows.filter((r) => r.is_live && r.placement === "bottom"),
    }),
    [rows],
  );
  const closed = rows.filter((r) => !r.is_live);

  const nextOrder = () => (rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 10 : 10);

  const openNew = () => {
    setEditingId(null);
    setDraft({ ...EMPTY });
  };
  const openEdit = (r: HomeSpotlight) => {
    setEditingId(r.id);
    setDraft({
      kind: r.kind,
      badge: r.badge ?? "",
      title: r.title,
      subtitle: r.subtitle ?? "",
      body: r.body ?? "",
      event_date: r.event_date ?? "",
      price_label: r.price_label ?? "",
      image_url: r.image_url ?? "",
      link_url: r.link_url ?? "",
      link_label: r.link_label ?? "",
      placement: r.placement,
    });
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    if (draft.kind !== "challenge" && !draft.title.trim()) {
      toast.error("Give the spotlight a title");
      return;
    }
    const link = (draft.link_url ?? "").trim();
    if (link.startsWith("http") && !link.startsWith("https://")) {
      toast.error("Website links must start with https://");
      return;
    }
    const clean = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]),
    ) as Record<string, unknown>;
    clean.title = draft.kind === "challenge" ? challengeConfig.title || "Challenge" : draft.title.trim();
    setSaving(true);
    const res = editingId
      ? await supabase
          .from("home_spotlights")
          .update({ ...clean, updated_at: new Date().toISOString() })
          .eq("id", editingId)
      : await supabase.from("home_spotlights").insert({ ...clean, is_live: true, sort_order: nextOrder() });
    setSaving(false);
    if (res.error) {
      toast.error(supabaseErrorMessage(res.error, "Could not save the spotlight"));
      return;
    }
    toast.success(editingId ? "Spotlight saved" : "Spotlight added");
    setDraft(null);
    await load();
  };

  const patch = async (id: string, values: Record<string, unknown>, ok: string) => {
    const { error } = await supabase
      .from("home_spotlights")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not update"));
      return;
    }
    toast.success(ok);
    await load();
  };

  const move = async (list: HomeSpotlight[], i: number, dir: -1 | 1) => {
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    const ao = a.sort_order === b.sort_order ? b.sort_order + dir : b.sort_order;
    await supabase.from("home_spotlights").update({ sort_order: ao }).eq("id", a.id);
    await supabase.from("home_spotlights").update({ sort_order: a.sort_order }).eq("id", b.id);
    await load();
  };

  const reuse = async (r: HomeSpotlight) => {
    const { id: _id, created_at: _c, closed_at: _cl, ...rest } = r;
    const { error } = await supabase
      .from("home_spotlights")
      .insert({ ...rest, is_live: true, sort_order: nextOrder(), title: r.title });
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not copy the spotlight"));
      return;
    }
    toast.success("Copy added to Home. Edit it to change the details.");
    await load();
  };

  const remove = async (r: HomeSpotlight) => {
    if (!window.confirm(`Delete "${r.title}" for good? This can't be undone.`)) return;
    const { error } = await supabase.from("home_spotlights").delete().eq("id", r.id);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not delete"));
      return;
    }
    toast.success("Spotlight deleted");
    await load();
  };

  const onImage = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      set("image_url", await uploadChallengeImage(file));
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const titleOf = (r: HomeSpotlight) => (r.kind === "challenge" ? challengeConfig.title || r.title : r.title);

  const liveList = (placement: SpotlightPlacement) => {
    const list = live[placement];
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {PLACEMENT_LABEL[placement]}
        </p>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            Nothing showing here.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{titleOf(r) || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">{SPOTLIGHT_KIND_LABEL[r.kind]}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => void move(list, i, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === list.length - 1} onClick={() => void move(list, i, 1)} aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => void patch(r.id, { is_live: false, closed_at: new Date().toISOString() }, "Spotlight closed. Find it under Closed spotlights.")}
                  aria-label="Close spotlight"
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const previewRow: HomeSpotlight | null = draft
    ? { ...draft, id: "preview", is_live: true, sort_order: 0, closed_at: null, created_at: "" }
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold">Home spotlights</h3>
          <p className="text-sm text-muted-foreground">
            Show as many as you like at the top or bottom of the member Home page. Close one with ×; it's
            kept below so you can reopen or reuse it.
          </p>
        </div>
        <Button type="button" onClick={openNew} className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]">
          <Plus className="h-4 w-4" /> Add spotlight
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-5">
          {liveList("top")}
          {liveList("bottom")}

          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowClosed((o) => !o)}
              aria-expanded={showClosed}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold"
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", showClosed && "rotate-90")} aria-hidden />
              Closed spotlights
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{closed.length}</span>
            </button>
            {showClosed ? (
              closed.length === 0 ? (
                <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {closed.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{titleOf(r) || "Untitled"}</p>
                        <p className="text-xs text-muted-foreground">
                          {SPOTLIGHT_KIND_LABEL[r.kind]}
                          {r.closed_at ? ` · closed ${new Date(r.closed_at).toLocaleDateString("en-ZA")}` : ""}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void patch(r.id, { is_live: true, closed_at: null }, "Spotlight reopened")}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void reuse(r)}>
                        <Copy className="h-3.5 w-3.5" /> Use again
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(r)} aria-label="Delete for good">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && !saving && setDraft(null)}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit spotlight" : "New spotlight"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Type</Label>
                  <Select value={draft.kind} onValueChange={(v) => set("kind", v as SpotlightKind)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SPOTLIGHT_KIND_LABEL) as SpotlightKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {SPOTLIGHT_KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Where</Label>
                  <Select value={draft.placement} onValueChange={(v) => set("placement", v as SpotlightPlacement)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">{PLACEMENT_LABEL.top}</SelectItem>
                      <SelectItem value="bottom">{PLACEMENT_LABEL.bottom}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {draft.kind === "challenge" ? (
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Shows the Movement challenge card with each member's stamps. Edit its title, dates and
                  image in the Movement challenge section on this page.
                </p>
              ) : (
                <>
                  {draft.kind === "promo" ? (
                    <div className="grid gap-1.5">
                      <Label>Badge</Label>
                      <Input value={draft.badge ?? ""} onChange={(e) => set("badge", e.target.value)} placeholder="Special offer" />
                    </div>
                  ) : null}
                  <div className="grid gap-1.5">
                    <Label>Title</Label>
                    <Input value={draft.title} onChange={(e) => set("title", e.target.value)} />
                  </div>
                  {draft.kind === "promo" ? (
                    <div className="grid gap-1.5">
                      <Label>Subtitle</Label>
                      <Input value={draft.subtitle ?? ""} onChange={(e) => set("subtitle", e.target.value)} />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label>Date</Label>
                          <Input value={draft.event_date ?? ""} onChange={(e) => set("event_date", e.target.value)} placeholder="Saturday 6 December" />
                        </div>
                        <div className="grid gap-1.5">
                          <Label>Price</Label>
                          <Input value={draft.price_label ?? ""} onChange={(e) => set("price_label", e.target.value)} placeholder="R450 or Free" />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Description</Label>
                        <Textarea rows={3} value={draft.body ?? ""} onChange={(e) => set("body", e.target.value)} />
                      </div>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label>Link</Label>
                      <Input value={draft.link_url ?? ""} onChange={(e) => set("link_url", e.target.value)} placeholder="/schedule or https://…" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Button text</Label>
                      <Input value={draft.link_label ?? ""} onChange={(e) => set("link_label", e.target.value)} placeholder="Tap to view →" />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Image</Label>
                    <div className="flex gap-2">
                      <Input value={draft.image_url ?? ""} onChange={(e) => set("image_url", e.target.value)} placeholder="Upload or paste an image link" />
                      <Button type="button" variant="outline" className="shrink-0 gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                        Upload
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void onImage(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {previewRow ? (
                <div className="pointer-events-none">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
                  {previewRow.kind === "event" ? (
                    <HomeEventCard config={eventConfigFor(previewRow)} />
                  ) : previewRow.kind === "challenge" ? (
                    <HomeSpotlightCard config={{ ...challengeConfig, home_card_mode: "challenge" }} />
                  ) : (
                    <HomeSpotlightCard config={promoConfigFor(previewRow)} />
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()} className="bg-[#a3b693] text-white hover:bg-[#8fa67d]">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save" : "Add to Home"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
