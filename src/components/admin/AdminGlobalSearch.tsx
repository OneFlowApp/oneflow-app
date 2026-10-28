import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Search, User, Calendar, BookOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatStudioDateTime } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth";
import { canSeeMemberPrivateDetails } from "@/lib/roleAccess";

const DEBOUNCE_MS = 300;
const MIN_LEN = 2;

type CustomerHit = {
  kind: "customer";
  id: string;
  label: string;
  sub: string;
};
type ClassHit = {
  kind: "class";
  id: string;
  label: string;
  sub: string;
};
type BookingHit = {
  kind: "booking";
  id: string;
  label: string;
  sub: string;
  profileId: string;
};

type Hit = CustomerHit | ClassHit | BookingHit;

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AdminGlobalSearch({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q.trim(), DEBOUNCE_MS);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const { profile: viewer } = useAuth();
  const showPrivate = canSeeMemberPrivateDetails(viewer);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runSearch = useCallback(async (term: string) => {
    if (term.length < MIN_LEN) {
      setHits([]);
      return;
    }
    setLoading(true);
    const pat = `%${term}%`;
    const ql = term.toLowerCase();

    try {
      const [fnRes, lnRes, emRes, classRes, bookRes] = await Promise.all([
        supabase.from("profiles").select("id, first_name, last_name, email").ilike("first_name", pat).limit(6),
        supabase.from("profiles").select("id, first_name, last_name, email").ilike("last_name", pat).limit(6),
        supabase.from("profiles").select("id, first_name, last_name, email").ilike("email", pat).limit(6),
        supabase
          .from("classes")
          .select("id, name, starts_at")
          .ilike("name", pat)
          .limit(8)
          .order("starts_at", { ascending: false }),
        supabase
          .from("bookings")
          .select(
            "id, profile_id, classes(id,name,starts_at), profiles(first_name,last_name,email)",
          )
          .order("created_at", { ascending: false })
          .limit(120),
      ]);

      const profById = new Map<string, Record<string, unknown>>();
      for (const row of [...(fnRes.data ?? []), ...(lnRes.data ?? []), ...(emRes.data ?? [])]) {
        const r = row as Record<string, unknown>;
        profById.set(String(r.id), r);
      }

      const customers: CustomerHit[] = [...profById.values()].map((r) => {
        const fn = String(r.first_name ?? "").trim();
        const ln = String(r.last_name ?? "").trim();
        const em = String(r.email ?? "").trim();
        return {
          kind: "customer" as const,
          id: String(r.id),
          label: `${fn} ${ln}`.trim() || (showPrivate ? em : "") || "Member",
          sub: showPrivate ? em || "—" : "",
        };
      });

      const classes: ClassHit[] = (classRes.data ?? []).map((r: Record<string, unknown>) => ({
        kind: "class" as const,
        id: String(r.id),
        label: String(r.name ?? "Class"),
        sub: r.starts_at
          ? formatStudioDateTime(String(r.starts_at), { dateStyle: "medium", timeStyle: "short" })
          : "—",
      }));

      const rawBooks = (bookRes.data ?? []) as Record<string, unknown>[];
      const bookingHits: BookingHit[] = [];
      for (const row of rawBooks) {
        const prof = row.profiles as
          | { first_name?: string; last_name?: string; email?: string }
          | null;
        const p = Array.isArray(prof) ? prof[0] : prof;
        const fn = (p?.first_name ?? "").trim();
        const ln = (p?.last_name ?? "").trim();
        const em = (p?.email ?? "").trim();
        const name = `${fn} ${ln}`.trim().toLowerCase();
        if (!name.includes(ql) && !em.toLowerCase().includes(ql)) continue;
        const cls = row.classes as
          | { name?: string; starts_at?: string }
          | { name?: string; starts_at?: string }[]
          | null;
        const c = Array.isArray(cls) ? cls[0] : cls;
        bookingHits.push({
          kind: "booking",
          id: String(row.id),
          profileId: String(row.profile_id ?? ""),
          label: `${fn} ${ln}`.trim() || (showPrivate ? em : "") || "Booking",
          sub: c?.name ? `${c.name}` : "Class",
        });
        if (bookingHits.length >= 8) break;
      }

      setHits([...customers, ...classes, ...bookingHits]);
    } finally {
      setLoading(false);
    }
  }, [showPrivate]);

  useEffect(() => {
    void runSearch(debounced);
  }, [debounced, runSearch]);

  const grouped = useMemo(() => {
    const customers = hits.filter((h): h is CustomerHit => h.kind === "customer");
    const classes = hits.filter((h): h is ClassHit => h.kind === "class");
    const bookings = hits.filter((h): h is BookingHit => h.kind === "booking");
    return { customers, classes, bookings };
  }, [hits]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    if (h.kind === "customer") {
      void navigate({ to: "/admin/customers", search: { profile: h.id } });
    } else if (h.kind === "class") {
      void navigate({ to: "/admin/schedule", search: { highlight: h.id } });
    } else {
      void navigate({ to: "/admin/customers", search: { profile: h.profileId } });
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "relative h-9 w-full max-w-full justify-start gap-2 border-sidebar-border bg-sidebar-accent/20 text-sidebar-foreground/90 hover:bg-sidebar-accent/40 md:max-w-[220px]",
            className,
          )}
        >
          <Search className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
          <span className="truncate text-xs font-medium">Search…</span>
          <kbd className="pointer-events-none ml-auto hidden rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline">
            ⌘K
          </kbd>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        className="flex h-[min(100dvh,520px)] flex-col gap-0 overflow-hidden p-0 sm:left-auto sm:right-4 sm:top-4 sm:max-w-lg sm:rounded-xl"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="font-display text-lg">Search admin</SheetTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Members, classes, and recent bookings (by member name). Type at least {MIN_LEN}{" "}
            characters.
          </p>
        </SheetHeader>
        <div className="border-b border-border px-3 py-2">
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-10"
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-label="Searching" />
            </div>
          ) : debounced.length < MIN_LEN ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              Type {MIN_LEN}+ characters to search.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">No results.</p>
          ) : (
            <div className="space-y-6">
              {grouped.customers.length > 0 ? (
                <section>
                  <p className="mb-2 flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <User className="h-3.5 w-3.5" aria-hidden /> Members
                  </p>
                  <ul className="space-y-1">
                    {grouped.customers.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => go(h)}
                          className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted"
                        >
                          <span className="font-medium">{h.label}</span>
                          <span className="text-xs text-muted-foreground">{h.sub}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {grouped.classes.length > 0 ? (
                <section>
                  <p className="mb-2 flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" aria-hidden /> Master
                  </p>
                  <ul className="space-y-1">
                    {grouped.classes.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => go(h)}
                          className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted"
                        >
                          <span className="font-medium">{h.label}</span>
                          <span className="text-xs text-muted-foreground">{h.sub}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {grouped.bookings.length > 0 ? (
                <section>
                  <p className="mb-2 flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden /> Bookings
                  </p>
                  <ul className="space-y-1">
                    {grouped.bookings.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => go(h)}
                          className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted"
                        >
                          <span className="font-medium">{h.label}</span>
                          <span className="text-xs text-muted-foreground">{h.sub}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          <Link
            to="/admin/customers"
            className="underline underline-offset-2"
            onClick={() => setOpen(false)}
          >
            Open customers
          </Link>
          {" · "}
          <Link
            to="/admin/schedule"
            className="underline underline-offset-2"
            onClick={() => setOpen(false)}
          >
            Open Master
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
