import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { canEdit } from "@/lib/roleAccess";
import { REWARD_KIND_LABEL, type GameboardReward } from "@/lib/gameboard";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/gameboard")({
  head: () => ({ meta: [{ title: "Gameboard — One Flow Admin" }] }),
  component: GameboardAdminPage,
});

type Tile = {
  id: string | null;
  sort_order: number;
  label: string;
  kind: GameboardReward["kind"];
  gift_product_id: string | null;
  weight: number;
  is_active: boolean;
};

type GiftProduct = { id: string; name: string };

/** Director and Management: the rewards on the weekly gameboard and how often each turns up. */
function GameboardAdminPage() {
  const { profile } = useAuth();
  const editable = canEdit(profile, "gameboard");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [saved, setSaved] = useState<string>("");
  const [gifts, setGifts] = useState<GiftProduct[]>([]);
  const [boardSize, setBoardSize] = useState("9");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, p, s] = await Promise.all([
      supabase
        .from("gameboard_tiles")
        .select("id, sort_order, label, kind, gift_product_id, weight, is_active")
        .order("sort_order"),
      supabase.from("products").select("id, name").ilike("name", "Gift:%").order("name"),
      supabase.from("studio_settings").select("value").eq("key", "gameboard_board_size").maybeSingle(),
    ]);
    setLoading(false);
    if (t.error) {
      toast.error(supabaseErrorMessage(t.error, "Could not load the gameboard"));
      return;
    }
    const rows = (t.data ?? []) as Tile[];
    setTiles(rows);
    setSaved(JSON.stringify(rows));
    setGifts((p.data ?? []) as GiftProduct[]);
    setBoardSize(String((s.data as { value?: string } | null)?.value ?? "9"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(
    () => tiles.filter((t) => t.is_active).reduce((n, t) => n + Math.max(0, t.weight || 0), 0),
    [tiles],
  );
  const pct = (t: Tile) => (t.is_active && total > 0 ? (100 * Math.max(0, t.weight || 0)) / total : 0);
  const byKind = (k: Tile["kind"]) => tiles.filter((t) => t.kind === k).reduce((n, t) => n + pct(t), 0);
  const dirty = JSON.stringify(tiles) !== saved;

  const update = (i: number, patch: Partial<Tile>) =>
    setTiles((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const addTile = () =>
    setTiles((list) => [
      ...list,
      {
        id: null,
        sort_order: (list.at(-1)?.sort_order ?? 0) + 1,
        label: "",
        kind: "message",
        gift_product_id: null,
        weight: 1,
        is_active: true,
      },
    ]);

  const save = async () => {
    for (const t of tiles) {
      if (!t.label.trim()) {
        toast.error("Every reward needs a name.");
        return;
      }
      if (t.kind === "gift" && !t.gift_product_id) {
        toast.error(`Choose which class "${t.label}" gifts.`);
        return;
      }
    }
    if (total <= 0) {
      toast.error("At least one reward needs a chance above 0.");
      return;
    }
    const size = Math.round(Number(boardSize));
    if (!Number.isFinite(size) || size < 3 || size > 25) {
      toast.error("The board needs between 3 and 25 tiles.");
      return;
    }
    setSaving(true);
    const rows = tiles.map((t, i) => ({
      ...(t.id ? { id: t.id } : {}),
      sort_order: i + 1,
      label: t.label.trim(),
      kind: t.kind,
      gift_product_id: t.kind === "gift" ? t.gift_product_id : null,
      weight: Math.max(0, Math.round(t.weight || 0)),
      is_active: t.is_active,
    }));
    const existing = rows.filter((r) => "id" in r);
    const fresh = rows.filter((r) => !("id" in r));
    const results = await Promise.all([
      existing.length ? supabase.from("gameboard_tiles").upsert(existing) : Promise.resolve({ error: null }),
      fresh.length ? supabase.from("gameboard_tiles").insert(fresh) : Promise.resolve({ error: null }),
      supabase
        .from("studio_settings")
        .upsert({ key: "gameboard_board_size", value: String(size) }, { onConflict: "key" }),
    ]);
    setSaving(false);
    const err = results.find((r) => r.error)?.error;
    if (err) {
      toast.error(supabaseErrorMessage(err, "Could not save"));
      return;
    }
    toast.success("Gameboard saved. New plays use these rewards and odds.");
    void load();
  };

  const input = "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";
  const boardN = Math.max(3, Math.min(25, Math.round(Number(boardSize)) || 9));

  return (
    <div className="pb-10">
      <PageHeader
        title="Gameboard"
        description="The rewards members can win when they hit their weekly goal, and how often each one turns up."
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {(["gift", "sachet", "message"] as const).map((k) => (
              <div key={k} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{REWARD_KIND_LABEL[k]}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{Math.round(byKind(k))}%</p>
                <p className="text-xs text-muted-foreground">chance per play</p>
              </div>
            ))}
          </div>

          <p className="mb-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Chance</span> is a weight: a reward with 2 turns up twice as
            often as one with 1, and 0 means it never turns up. Each play's tile is drawn with these odds, so the % is
            the chance of winning that reward on one play.
          </p>

          <ul className="space-y-2">
            {tiles.map((t, i) => (
              <li
                key={t.id ?? `new-${i}`}
                className={cn(
                  "grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_200px_200px_90px_70px_auto] sm:items-center",
                  !t.is_active && "opacity-60",
                )}
              >
                <input
                  className={input}
                  value={t.label}
                  placeholder="Reward name, e.g. A free coffee"
                  disabled={!editable}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
                <select
                  className={input}
                  value={t.kind}
                  disabled={!editable}
                  onChange={(e) => update(i, { kind: e.target.value as Tile["kind"] })}
                >
                  {(["gift", "sachet", "message"] as const).map((k) => (
                    <option key={k} value={k}>
                      {REWARD_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                {t.kind === "gift" ? (
                  <select
                    className={input}
                    value={t.gift_product_id ?? ""}
                    disabled={!editable}
                    onChange={(e) => update(i, { gift_product_id: e.target.value || null })}
                  >
                    <option value="">Which class?</option>
                    {gifts.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name.replace(/^Gift:\s*/i, "")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t.kind === "message" ? "A random message from the list" : "Staff mark it collected"}
                  </span>
                )}
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Chance
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    className={cn(input, "w-16")}
                    value={t.weight}
                    disabled={!editable}
                    onChange={(e) => update(i, { weight: Number(e.target.value) })}
                  />
                </label>
                <span className="text-sm font-semibold tabular-nums">{pct(t).toFixed(1)}%</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={t.is_active}
                    disabled={!editable}
                    onChange={(e) => update(i, { is_active: e.target.checked })}
                  />
                  On
                </label>
              </li>
            ))}
          </ul>

          {editable ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={addTile}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden /> Add a reward
              </button>
              <label className="flex items-center gap-2 text-sm">
                Tiles on the board
                <input
                  type="number"
                  min={3}
                  max={25}
                  className={cn(input, "w-16")}
                  value={boardSize}
                  onChange={(e) => setBoardSize(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">({boardN} tiles; repeats are fine)</span>
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="ml-auto rounded-full bg-[#5f7a52] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : dirty ? "Save changes" : "Save"}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">View only. Director and Management can change rewards.</p>
          )}

          <p className="mt-6 text-xs text-muted-foreground">
            To stop a reward, untick On rather than deleting it, so past winners still see what they won. Gift classes
            come from hidden products named "Gift: …" in Products. Plays already on someone's screen keep the board they
            were dealt.
          </p>
        </>
      )}
    </div>
  );
}
