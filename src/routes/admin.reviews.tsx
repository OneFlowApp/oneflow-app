import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { CustomerProfileSheet } from "@/components/admin/CustomerProfileSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { effectiveRole } from "@/lib/roleAccess";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Reviews — One Flow Admin" }] }),
  component: ReviewsPage,
});

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  profile_id: string;
  className: string;
  classStarts: string | null;
  guide: string;
  member: string;
};

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
] as const;

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(size, n <= Math.round(value) ? "fill-[#a3b693] text-[#a3b693]" : "text-muted-foreground/30")}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Director and Management: every class review, with averages per guide and per class. */
function ReviewsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("90");
  const [guide, setGuide] = useState("all");
  const [rating, setRating] = useState("all");
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("class_reviews")
      .select(
        "id, rating, comment, created_at, profile_id, class:class_id(name, starts_at, guide_name), member:profile_id(first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(2000);
    if (period !== "all") {
      q = q.gte("created_at", new Date(Date.now() - Number(period) * 86_400_000).toISOString());
    }
    const { data, error: err } = await q;
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
    setRows(
      (data ?? []).map((raw) => {
        const r = raw as unknown as {
          id: string;
          rating: number;
          comment: string | null;
          created_at: string;
          profile_id: string;
          class: { name: string | null; starts_at: string | null; guide_name: string | null } | null;
          member: { first_name: string | null; last_name: string | null } | null;
        };
        const c = one(r.class);
        const m = one(r.member);
        return {
          id: r.id,
          rating: r.rating,
          comment: r.comment?.trim() || null,
          created_at: r.created_at,
          profile_id: r.profile_id,
          className: c?.name?.trim() || "Class",
          classStarts: c?.starts_at ?? null,
          guide: c?.guide_name?.trim() || "No guide",
          member: [m?.first_name, m?.last_name].filter(Boolean).join(" ") || "Member",
        };
      }),
    );
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const guides = useMemo(() => [...new Set(rows.map((r) => r.guide))].sort(), [rows]);
  const shown = useMemo(
    () =>
      rows.filter(
        (r) => (guide === "all" || r.guide === guide) && (rating === "all" || r.rating === Number(rating)),
      ),
    [rows, guide, rating],
  );

  const avg = (list: ReviewRow[]) => (list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : 0);

  const byGuide = useMemo(() => {
    const m = new Map<string, ReviewRow[]>();
    for (const r of rows) m.set(r.guide, [...(m.get(r.guide) ?? []), r]);
    return [...m.entries()]
      .map(([name, list]) => ({ name, count: list.length, avg: avg(list), low: list.filter((r) => r.rating <= 2).length }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  }, [rows]);

  const byClass = useMemo(() => {
    const m = new Map<string, ReviewRow[]>();
    for (const r of rows) m.set(r.className, [...(m.get(r.className) ?? []), r]);
    return [...m.entries()]
      .map(([name, list]) => ({ name, count: list.length, avg: avg(list) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [rows]);

  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="What members said after class. Only Director and Management can see this page."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <select className={select} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select className={select} value={guide} onChange={(e) => setGuide(e.target.value)}>
          <option value="all">All guides</option>
          {guides.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select className={select} value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="all">All ratings</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No reviews in this period yet.
        </p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Average rating</p>
              <p className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
                {avg(rows).toFixed(1)} <Stars value={avg(rows)} />
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Reviews</p>
              <p className="mt-1 font-display text-2xl font-semibold">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">1 or 2 stars</p>
              <p className="mt-1 font-display text-2xl font-semibold">
                {rows.filter((r) => r.rating <= 2).length}
              </p>
            </div>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 font-display text-lg font-semibold">By guide</h3>
              <ul className="divide-y divide-border text-sm">
                {byGuide.map((g) => (
                  <li key={g.name}>
                    <button
                      type="button"
                      onClick={() => setGuide(guide === g.name ? "all" : g.name)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 py-2 text-left",
                        guide === g.name && "font-semibold",
                      )}
                    >
                      <span className="truncate">{g.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                        <Stars value={g.avg} size="h-3.5 w-3.5" />
                        {g.avg.toFixed(1)} · {g.count}
                        {g.low > 0 ? <span className="text-destructive">· {g.low} low</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 font-display text-lg font-semibold">By class</h3>
              <ul className="divide-y divide-border text-sm">
                {byClass.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <Stars value={c.avg} size="h-3.5 w-3.5" />
                      {c.avg.toFixed(1)} · {c.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <h3 className="mb-3 font-display text-lg font-semibold">
            {shown.length} review{shown.length === 1 ? "" : "s"}
          </h3>
          <ul className="space-y-3">
            {shown.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars value={r.rating} />
                  <span className="text-xs text-muted-foreground">Reviewed {when(r.created_at)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold">
                  {r.className} · {r.guide}
                  <span className="font-normal text-muted-foreground"> · {when(r.classStarts)}</span>
                </p>
                {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p> : null}
                <button
                  type="button"
                  onClick={() => setProfileId(r.profile_id)}
                  className="mt-2 text-xs text-[#5f7a52] underline-offset-2 hover:underline"
                >
                  {r.member}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <CustomerProfileSheet
        customerId={profileId}
        open={profileId !== null}
        onOpenChange={(o) => {
          if (!o) setProfileId(null);
        }}
        viewerRole={effectiveRole(profile)}
        variant="customer"
      />
    </div>
  );
}
