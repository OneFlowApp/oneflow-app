import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export type GuideRateRule = Rule;

type Rule = {
  id: string | null;
  guide_profile_id: string;
  class_group: "all" | "mat" | "reformer" | "wellzone" | "sauna_journey" | "event";
  min_attendance: number;
  max_attendance: number | null;
  rate_zar: number;
  note: string | null;
  sort_order: number;
};

type Guide = { profileId: string; name: string };

const GROUPS: { value: Rule["class_group"]; label: string }[] = [
  { value: "all", label: "All classes" },
  { value: "mat", label: "On The Mat" },
  { value: "reformer", label: "Reformer" },
  { value: "wellzone", label: "Wellzone" },
  { value: "sauna_journey", label: "Sauna Journey" },
  { value: "event", label: "Events" },
];

const groupLabel = (g: Rule["class_group"]) => GROUPS.find((x) => x.value === g)?.label ?? g;

export function ruleSummary(r: Rule): string {
  const att =
    r.max_attendance == null
      ? `${r.min_attendance} or more people`
      : r.min_attendance === r.max_attendance
        ? `${r.min_attendance} ${r.min_attendance === 1 ? "person" : "people"}`
        : `${r.min_attendance} to ${r.max_attendance} people`;
  return `${groupLabel(r.class_group)} · ${att} · R${Number(r.rate_zar || 0).toLocaleString("en-ZA")}`;
}

/** Directors: each guide's pay rates and rules, e.g. "Reformer, 0 to 3 people: R250; 4 or more: R350". */
export function GuideRatesSection() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [saved, setSaved] = useState("");
  const [deleted, setDeleted] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [g, r] = await Promise.all([
      supabase
        .from("guides")
        .select(
          "profile_id, is_active, profile:profiles!guides_profile_id_fkey(first_name, last_name)",
        )
        .or("is_active.eq.true,is_active.is.null"),
      supabase.from("guide_rates").select("*").order("sort_order"),
    ]);
    setLoading(false);
    if (r.error) {
      toast.error(supabaseErrorMessage(r.error, "Could not load guide rates"));
      return;
    }
    const list: Guide[] = [];
    const seen = new Set<string>();
    for (const row of (g.data ?? []) as Record<string, unknown>[]) {
      const pid = String(row.profile_id ?? "");
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const p = (Array.isArray(row.profile) ? row.profile[0] : row.profile) as {
        first_name?: string;
        last_name?: string;
      } | null;
      list.push({
        profileId: pid,
        name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Guide",
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    setGuides(list);
    const rows = (r.data ?? []) as Rule[];
    setRules(rows);
    setSaved(JSON.stringify(rows));
    setDeleted([]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byGuide = useMemo(() => {
    const m = new Map<string, { rule: Rule; i: number }[]>();
    rules.forEach((rule, i) =>
      m.set(rule.guide_profile_id, [...(m.get(rule.guide_profile_id) ?? []), { rule, i }]),
    );
    return m;
  }, [rules]);

  const dirty = JSON.stringify(rules) !== saved || deleted.length > 0;
  const update = (i: number, patch: Partial<Rule>) =>
    setRules((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addRule = (guideId: string) =>
    setRules((list) => {
      const mine = list.filter((r) => r.guide_profile_id === guideId);
      const last = mine.at(-1);
      return [
        ...list,
        {
          id: null,
          guide_profile_id: guideId,
          class_group: last?.class_group ?? "all",
          min_attendance: last?.max_attendance != null ? last.max_attendance + 1 : 0,
          max_attendance: null,
          rate_zar: 0,
          note: null,
          sort_order: mine.length + 1,
        },
      ];
    });

  const removeRule = (i: number) =>
    setRules((list) => {
      const r = list[i];
      if (r?.id) setDeleted((d) => [...d, r.id as string]);
      return list.filter((_, j) => j !== i);
    });

  const save = async () => {
    for (const r of rules) {
      if (r.max_attendance != null && r.max_attendance < r.min_attendance) {
        toast.error(`Check ${ruleSummary(r)}: "to" is lower than "from".`);
        return;
      }
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const stamp = { updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null };
    const clean = (r: Rule) => ({
      guide_profile_id: r.guide_profile_id,
      class_group: r.class_group,
      min_attendance: Math.max(0, Math.round(Number(r.min_attendance) || 0)),
      max_attendance:
        r.max_attendance == null || String(r.max_attendance) === ""
          ? null
          : Math.round(Number(r.max_attendance)),
      rate_zar: Math.max(0, Number(r.rate_zar) || 0),
      note: r.note?.trim() || null,
      sort_order: r.sort_order,
      ...stamp,
    });
    const existing = rules.filter((r) => r.id).map((r) => ({ id: r.id, ...clean(r) }));
    const fresh = rules.filter((r) => !r.id).map(clean);
    const results = await Promise.all([
      existing.length
        ? supabase.from("guide_rates").upsert(existing)
        : Promise.resolve({ error: null }),
      fresh.length ? supabase.from("guide_rates").insert(fresh) : Promise.resolve({ error: null }),
      deleted.length
        ? supabase.from("guide_rates").delete().in("id", deleted)
        : Promise.resolve({ error: null }),
    ]);
    setSaving(false);
    const err = results.find((x) => x.error)?.error;
    if (err) {
      toast.error(supabaseErrorMessage(err, "Could not save"));
      return;
    }
    toast.success("Guide rates saved");
    void load();
  };

  const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="pb-6">
      <p className="mb-4 text-sm text-muted-foreground">
        Each guide&apos;s rates and rules. Only Directors can see this. Set a rate per class type
        and attendance band, for example Reformer, 0 to 3 people R250, 4 or more people R350. Leave
        &ldquo;to&rdquo; empty for &ldquo;or more&rdquo;.
      </p>
      <ul className="space-y-3">
        {guides.map((g) => {
          const mine = byGuide.get(g.profileId) ?? [];
          const isOpen = open === g.profileId;
          return (
            <li key={g.profileId} className="rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.profileId)}
                className="flex w-full items-start justify-between gap-3 p-4 text-left"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{g.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {mine.length === 0
                      ? "No rates set yet"
                      : mine.map(({ rule }) => ruleSummary(rule)).join("  ·  ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-primary">
                  {isOpen ? "Close" : "Edit"}
                </span>
              </button>
              {isOpen ? (
                <div className="space-y-2 border-t border-border p-4">
                  {mine.map(({ rule: r, i }) => (
                    <div
                      key={r.id ?? `new-${i}`}
                      className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[150px_auto_auto_120px_1fr_auto] sm:items-center"
                    >
                      <select
                        className={input}
                        value={r.class_group}
                        onChange={(e) =>
                          update(i, { class_group: e.target.value as Rule["class_group"] })
                        }
                      >
                        {GROUPS.map((x) => (
                          <option key={x.value} value={x.value}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        From
                        <input
                          type="number"
                          min={0}
                          className={cn(input, "w-16")}
                          value={r.min_attendance}
                          onChange={(e) => update(i, { min_attendance: Number(e.target.value) })}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        to
                        <input
                          type="number"
                          min={0}
                          placeholder="more"
                          className={cn(input, "w-16")}
                          value={r.max_attendance ?? ""}
                          onChange={(e) =>
                            update(i, {
                              max_attendance: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                        people
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        R
                        <input
                          type="number"
                          min={0}
                          className={cn(input, "w-24")}
                          value={r.rate_zar}
                          onChange={(e) => update(i, { rate_zar: Number(e.target.value) })}
                        />
                      </label>
                      <input
                        className={input}
                        placeholder="Note, e.g. includes travel"
                        value={r.note ?? ""}
                        onChange={(e) => update(i, { note: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeRule(i)}
                        className="justify-self-end rounded-full p-2 text-muted-foreground hover:text-destructive"
                        aria-label="Remove this rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addRule(g.profileId)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Add a rate
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-3 mt-4 flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="rounded-full bg-[#5f7a52] px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </div>
  );
}
