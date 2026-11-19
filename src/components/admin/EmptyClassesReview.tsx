import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string | null;
  starts_at: string;
  guide_name: string | null;
  outcome: "stayed" | "left" | null;
  note: string | null;
};

const TZ = "Africa/Johannesburg";

function ymd(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * Classes nobody was booked into, so staff can record (or correct) whether the guide stayed or left.
 * Classes where the guide left are left off guides' month-end lists.
 */
export function EmptyClassesReview() {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const fromIso = new Date(`${from}T00:00:00+02:00`).toISOString();
    const toIso = new Date(
      Math.min(new Date(`${to}T23:59:59+02:00`).getTime(), Date.now() - 5 * 60_000),
    ).toISOString();
    const { data, error } = await supabase
      .from("classes")
      .select("id, name, title_override, starts_at, guide_name, booked_count")
      .gte("starts_at", fromIso)
      .lte("starts_at", toIso)
      .eq("is_cancelled", false)
      .not("guide_name", "is", null)
      .lte("booked_count", 0)
      .order("starts_at", { ascending: false })
      .limit(300);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load classes"));
      setRows([]);
      return;
    }
    const classes = (data ?? []) as {
      id: string;
      name: string | null;
      title_override?: string | null;
      starts_at: string;
      guide_name: string | null;
    }[];
    const ids = classes.map((c) => c.id);
    const { data: recs } = ids.length
      ? await supabase
          .from("empty_class_checkins")
          .select("class_id, outcome, note")
          .in("class_id", ids)
      : { data: [] };
    const byId = new Map(
      ((recs ?? []) as { class_id: string; outcome: Row["outcome"]; note: string | null }[]).map(
        (r) => [r.class_id, r],
      ),
    );
    const list = classes.map((c) => ({
      id: c.id,
      name: c.title_override?.trim() || c.name,
      starts_at: c.starts_at,
      guide_name: c.guide_name,
      outcome: byId.get(c.id)?.outcome ?? null,
      note: byId.get(c.id)?.note ?? null,
    }));
    setRows(list);
    setNotes(Object.fromEntries(list.map((r) => [r.id, r.note ?? ""])));
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (r: Row, outcome: "stayed" | "left") => {
    setBusy(r.id);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("empty_class_checkins").upsert(
      {
        class_id: r.id,
        outcome,
        note: (notes[r.id] ?? "").trim() || null,
        recorded_by: u.user?.id ?? null,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: "class_id" },
    );
    setBusy(null);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save"));
      return;
    }
    setRows((list) =>
      (list ?? []).map((x) => (x.id === r.id ? { ...x, outcome, note: notes[r.id] ?? null } : x)),
    );
  };

  const todo = (rows ?? []).filter((r) => !r.outcome).length;
  const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Classes with nobody booked. Record whether the guide stayed or left. Classes where the guide{" "}
        <span className="font-medium text-foreground">left</span> don&apos;t appear on their
        month-end list.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="date"
          className={input}
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-muted-foreground">to</span>
        <input
          type="date"
          className={input}
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        {rows ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.length} empty class{rows.length === 1 ? "" : "es"} · {todo} to check
          </span>
        ) : null}
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No empty classes in these dates.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                "grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center",
                r.outcome ? "border-border" : "border-[#d4af37]/60",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {new Date(r.starts_at).toLocaleString("en-ZA", {
                    timeZone: TZ,
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {r.name} · {r.guide_name}
                </p>
                <input
                  className={cn(input, "mt-1.5 w-full")}
                  placeholder="Note (optional)"
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  onBlur={() => {
                    if (r.outcome && (notes[r.id] ?? "") !== (r.note ?? ""))
                      void save(r, r.outcome);
                  }}
                />
              </div>
              <div className="flex gap-2">
                {(["stayed", "left"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void save(r, o)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      r.outcome === o
                        ? o === "left"
                          ? "border-destructive bg-destructive text-white"
                          : "border-[#5f7a52] bg-[#5f7a52] text-white"
                        : "border-border bg-card",
                    )}
                  >
                    {o === "stayed" ? "Teacher stayed" : "Teacher left"}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
