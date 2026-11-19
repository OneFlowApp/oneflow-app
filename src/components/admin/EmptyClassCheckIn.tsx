import { useCallback, useEffect, useState } from "react";
import { DoorOpen, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

type Outcome = "stayed" | "left";
type Record_ = {
  outcome: Outcome;
  note: string | null;
  recorded_at: string;
  recorded_by: string | null;
};

/**
 * Shown on a class with nobody booked, from 5 minutes after it starts:
 * staff record whether the guide stayed or left, with a note if needed.
 */
export function EmptyClassCheckIn({
  classId,
  startsAt,
  guideName,
  bookedCount,
}: {
  classId: string;
  startsAt: string;
  guideName: string | null;
  bookedCount: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [record, setRecord] = useState<(Record_ & { by?: string }) | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const due = bookedCount === 0 && now >= new Date(startsAt).getTime() + 5 * 60_000;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("empty_class_checkins")
      .select("outcome, note, recorded_at, recorded_by")
      .eq("class_id", classId)
      .maybeSingle();
    const r = data as Record_ | null;
    let by: string | undefined;
    if (r?.recorded_by) {
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", r.recorded_by)
        .maybeSingle();
      by = (p as { first_name?: string } | null)?.first_name ?? undefined;
    }
    setRecord(r ? { ...r, by } : null);
    setOutcome(r?.outcome ?? null);
    setNote(r?.note ?? "");
  }, [classId]);

  useEffect(() => {
    if (due) void load();
  }, [due, load]);

  if (!due || record === undefined) return null;

  const save = async () => {
    if (!outcome) {
      toast.error("Choose whether the guide stayed or left.");
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("empty_class_checkins").upsert(
      {
        class_id: classId,
        outcome,
        note: note.trim() || null,
        recorded_by: u.user?.id ?? null,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: "class_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save"));
      return;
    }
    toast.success("Saved");
    setEditing(false);
    void load();
  };

  const guide = guideName?.trim() || "The guide";

  if (record && !editing) {
    return (
      <section className="mb-4 rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Empty class check-in
        </p>
        <p className="mt-1 text-sm font-semibold">
          {record.outcome === "stayed" ? `${guide} stayed` : `${guide} left`}
        </p>
        {record.note ? <p className="mt-1 whitespace-pre-wrap text-sm">{record.note}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Recorded{record.by ? ` by ${record.by}` : ""}{" "}
          {new Date(record.recorded_at).toLocaleString("en-ZA", {
            timeZone: "Africa/Johannesburg",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" · "}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Change
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-xl border border-[#d4af37]/60 bg-[#d4af37]/10 p-4">
      <p className="text-sm font-semibold">Nobody is booked into this class. Check in the guide</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Record what {guide} did, for guide pay and follow-up.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(
          [
            { v: "stayed", label: "Teacher stayed", Icon: UserCheck },
            { v: "left", label: "Teacher left", Icon: DoorOpen },
          ] as const
        ).map(({ v, label, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => setOutcome(v)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold",
              outcome === v ? "border-[#5f7a52] bg-[#5f7a52] text-white" : "border-border bg-card",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Notes (optional), e.g. waited until 9:45, then left"
        className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="mt-2 flex justify-end gap-2">
        {record ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-full bg-[#5f7a52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
