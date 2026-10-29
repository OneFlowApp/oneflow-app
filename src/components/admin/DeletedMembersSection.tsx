import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type DeletedRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string | null;
  deleted_at: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/** "Deleted members" archive on the Customers page: closed by default. */
export function DeletedMembersSection({ refreshKey, onOpenMember }: { refreshKey: number; onOpenMember: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DeletedRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, created_at, deleted_at")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("deleted members", error);
        setRows([]);
        return;
      }
      setRows((data ?? []) as DeletedRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden />
        Deleted members
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-3">
          {rows === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deleted members.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMember(r.id)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="font-medium">
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || "Member"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Member since {formatDate(r.created_at)} · deleted {formatDate(r.deleted_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
