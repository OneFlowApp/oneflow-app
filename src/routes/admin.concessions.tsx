import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { CustomerProfileSheet } from "@/components/admin/CustomerProfileSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { effectiveRole } from "@/lib/roleAccess";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/concessions")({
  head: () => ({ meta: [{ title: "Student & senior — One Flow Admin" }] }),
  component: ConcessionsPage,
});

type Row = {
  id: string;
  profile_id: string;
  kind: string;
  result: string;
  reason: string | null;
  document_summary: string | null;
  valid_until: string | null;
  checked_at: string;
  revoked_at: string | null;
  member: string;
};

const FILTERS = [
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "All checks" },
] as const;

function when(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Director and Management: every automatic student / senior check, with Revoke. */
function ConcessionsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("approved");
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("concession_checks")
      .select("id, profile_id, kind, result, reason, document_summary, valid_until, checked_at, revoked_at, member:profile_id(first_name, last_name)")
      .order("checked_at", { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load checks"));
      return;
    }
    setRows(
      (data ?? []).map((raw) => {
        const r = raw as unknown as Omit<Row, "member"> & {
          member: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
        };
        const m = Array.isArray(r.member) ? r.member[0] : r.member;
        return { ...r, member: [m?.first_name, m?.last_name].filter(Boolean).join(" ") || "Member" };
      }),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === "all" ? true : filter === "approved" ? r.result === "approved" : r.result === "declined",
      ),
    [rows, filter],
  );

  const revoke = async (id: string) => {
    const { error } = await supabase.rpc("revoke_concession", { p_check_id: id });
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not revoke"));
      return;
    }
    toast.success("Discount revoked");
    await load();
  };

  const status = (r: Row) => {
    if (r.result !== "approved") return r.result === "declined" ? "Declined" : "Unreadable photo";
    if (r.revoked_at) return "Revoked";
    if (r.valid_until && r.valid_until < today) return "Expired";
    return `Active until ${r.valid_until}`;
  };

  return (
    <div>
      <PageHeader
        title="Student & senior"
        description="Every automatic discount check. Photos are never saved; only the result is. Revoke any approval that looks wrong."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === f.value ? "border-[#a3b693] bg-[#a3b693]/15 font-semibold" : "border-border",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0 text-sm">
                <button
                  type="button"
                  onClick={() => setProfileId(r.profile_id)}
                  className="font-semibold text-[#5f7a52] underline-offset-2 hover:underline"
                >
                  {r.member}
                </button>
                <span className="capitalize"> · {r.kind}</span>
                <p className="text-xs text-muted-foreground">
                  {status(r)} · checked {when(r.checked_at)}
                </p>
                {r.reason ? <p className="mt-1 text-xs">{r.reason}</p> : null}
                {r.document_summary ? (
                  <p className="text-xs text-muted-foreground">Document: {r.document_summary}</p>
                ) : null}
              </div>
              {r.result === "approved" && !r.revoked_at && r.valid_until && r.valid_until >= today ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void revoke(r.id)}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
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
