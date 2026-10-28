import { createFileRoute } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Package,
  Phone,
  Plus,
  Search,
  User,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AssignPackageDialog,
  type AssignPackageTarget,
} from "@/components/admin/AssignPackageDialog";
import { CustomerProfileSheet } from "@/components/admin/CustomerProfileSheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getUser, supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth";
import { currentPlanLabels, type UserCreditPlanRow } from "@/lib/currentPlan";
import { edgeFunctionErrorMessage, isValidEmail, supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({ meta: [{ title: "Staff — One Flow Admin" }] }),
  component: StaffPage,
});

const TZ = "Africa/Johannesburg";
const PAGE_SIZE = 20;

type StaffRole = "director" | "management" | "guide" | "front_desk" | "boh" | "marketing" | "team";

const STAFF_ROLES: StaffRole[] = [
  "director",
  "management",
  "guide",
  "front_desk",
  "boh",
  "marketing",
  "team",
];

const ROLE_LABEL: Record<StaffRole, string> = {
  director: "Director",
  management: "Management",
  guide: "Guide",
  front_desk: "Front Desk",
  boh: "BOH",
  marketing: "Marketing",
  team: "Team",
};

const ROLE_BADGE: Record<StaffRole, string> = {
  director: "bg-[#a3b693] text-white",
  management: "bg-blue-100 text-blue-800",
  guide: "bg-purple-100 text-purple-800",
  front_desk: "bg-cyan-100 text-cyan-800",
  boh: "bg-orange-100 text-orange-800",
  marketing: "bg-pink-100 text-pink-800",
  team: "bg-gray-200 text-gray-800",
};

type StaffRow = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: StaffRole;
  avatarUrl: string | null;
  createdAt: string;
  currentPlans: string[];
};

type SortKey = "name_asc" | "name_desc" | "joined_desc" | "joined_asc" | "role";

function isStaffRole(r: string | null | undefined): r is StaffRole {
  return STAFF_ROLES.includes((r ?? "") as StaffRole);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(first: string, last: string, email: string): string {
  const f = first.trim();
  const l = last.trim();
  if (f || l) return `${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase();
  return (email[0] ?? "S").toUpperCase();
}

function StaffPage() {
  const { profile } = useAuth();
  const viewerRole = effectiveRole(profile);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  // List controls
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("name_asc");
  const [page, setPage] = useState(1);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eFirst, setEFirst] = useState("");
  const [eLast, setELast] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eRole, setERole] = useState<StaffRole>("guide");
  const [saving, setSaving] = useState(false);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [iFirst, setIFirst] = useState("");
  const [iLast, setILast] = useState("");
  const [iEmail, setIEmail] = useState("");
  const [iPhone, setIPhone] = useState("");
  const [iRole, setIRole] = useState<StaffRole>("guide");
  const [inviting, setInviting] = useState(false);

  // Deactivate confirmation
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null);

  const [profileSheetRow, setProfileSheetRow] = useState<StaffRow | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignPackageTarget | null>(null);

  const isDirector = (viewerRole ?? "").toLowerCase() === "director";
  const canManage = isDirector || (viewerRole ?? "").toLowerCase() === "management";

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone, role, avatar_url, created_at")
      .in("role", STAFF_ROLES)
      .order("first_name", { ascending: true });

    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load staff"));
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped: StaffRow[] = (data ?? [])
      .map((p: Record<string, unknown>) => {
        const role = String(p.role ?? "").toLowerCase();
        if (!isStaffRole(role)) return null;
        const first = String(p.first_name ?? "").trim();
        const last = String(p.last_name ?? "").trim();
        return {
          id: String(p.id),
          firstName: first,
          lastName: last,
          fullName: `${first} ${last}`.trim() || String(p.email ?? "Staff"),
          email: String(p.email ?? ""),
          phone: String(p.phone ?? ""),
          role,
          avatarUrl: (p.avatar_url as string | null) ?? null,
          createdAt: String(p.created_at ?? ""),
          currentPlans: [] as string[],
        };
      })
      .filter((x): x is StaffRow => x !== null);

    const ids = mapped.map((r) => r.id);
    if (ids.length > 0) {
      const nowMs = Date.now();
      const { data: creditRows, error: creditsErr } = await supabase
        .from("user_credits")
        .select(
          "profile_id, product_name, category, credits_remaining, is_unlimited, expires_at, purchased_at, created_at, product_id, products(name, is_addon)",
        )
        .in("profile_id", ids);

      if (creditsErr) {
        console.error("staff: user_credits load failed", creditsErr);
        toast.error(supabaseErrorMessage(creditsErr, "Could not load staff credits"));
      }

      const creditsByProfile = new Map<string, UserCreditPlanRow[]>();
      for (const row of creditRows ?? []) {
        const pid = String((row as { profile_id: string }).profile_id);
        const credit: UserCreditPlanRow = {
          product_name: (row as { product_name: string | null }).product_name,
          category: (row as { category: string | null }).category,
          credits_remaining: (row as { credits_remaining: number | null }).credits_remaining,
          is_unlimited: (row as { is_unlimited: boolean | null }).is_unlimited,
          expires_at: (row as { expires_at: string | null }).expires_at,
          purchased_at: (row as { purchased_at?: string | null }).purchased_at ?? null,
          created_at: (row as { created_at?: string | null }).created_at ?? null,
          products: (row as { products?: UserCreditPlanRow["products"] }).products ?? null,
        };
        const list = creditsByProfile.get(pid) ?? [];
        list.push(credit);
        creditsByProfile.set(pid, list);
      }

      for (const row of mapped) {
        const embedded = creditsByProfile.get(row.id) ?? [];
        row.currentPlans = currentPlanLabels(embedded, nowMs);
      }
    }

    setRows(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSorted = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (ql) {
        const hay = `${r.fullName} ${r.email} ${r.phone}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "name_desc":
          return b.fullName.localeCompare(a.fullName);
        case "joined_desc":
          return b.createdAt.localeCompare(a.createdAt);
        case "joined_asc":
          return a.createdAt.localeCompare(b.createdAt);
        case "role":
          return a.role.localeCompare(b.role) || a.fullName.localeCompare(b.fullName);
        case "name_asc":
        default:
          return a.fullName.localeCompare(b.fullName);
      }
    });
    return out;
  }, [rows, q, roleFilter, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, roleFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = useMemo(() => {
    const tally: Record<StaffRole, number> = {
      director: 0,
      management: 0,
      guide: 0,
      front_desk: 0,
      boh: 0,
      marketing: 0,
      team: 0,
    };
    for (const r of rows) tally[r.role] += 1;
    return tally;
  }, [rows]);

  const openEdit = (r: StaffRow) => {
    setEditingId(r.id);
    setEFirst(r.firstName);
    setELast(r.lastName);
    setEEmail(r.email);
    setEPhone(r.phone);
    setERole(r.role);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!eFirst.trim() || !eLast.trim()) {
      toast.error("First and last name are required");
      return;
    }
    setSaving(true);
    try {
      const id = editingId;
      const nextRole = eRole;

      const { error: fieldsError } = await supabase
        .from("profiles")
        .update({
          first_name: eFirst.trim(),
          last_name: eLast.trim(),
          email: eEmail.trim().toLowerCase(),
          phone: ePhone.trim() || null,
        })
        .eq("id", id);

      if (fieldsError) {
        throw fieldsError;
      }

      const { data: roleRow, error: roleError } = await supabase
        .from("profiles")
        .update({ role: nextRole })
        .eq("id", id)
        .select("id, role")
        .single();

      if (roleError) {
        throw roleError;
      }
      if (!roleRow) {
        toast.error("Role update did not apply (no row returned).");
        await load();
        return;
      }

      const returnedRole = String(roleRow.role ?? "").toLowerCase();
      if (returnedRole !== nextRole || !isStaffRole(returnedRole)) {
        toast.error("Role did not persist as expected.");
        await load();
        return;
      }

      const first = eFirst.trim();
      const last = eLast.trim();
      const email = eEmail.trim().toLowerCase();
      const phone = ePhone.trim();

      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                firstName: first,
                lastName: last,
                fullName: `${first} ${last}`.trim() || email || "Staff",
                email,
                phone,
                role: returnedRole as StaffRole,
              }
            : r,
        ),
      );

      toast.success("Staff member updated");
      setEditOpen(false);
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      console.error("staff save failed", e);
      toast.error(`Failed to update staff: ${supabaseErrorMessage(e, "Unknown error")}`);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitInvite = async () => {
    if (!iFirst.trim() || !iLast.trim() || !iEmail.trim()) {
      toast.error("First name, last name, and email are required");
      return;
    }
    if (!isValidEmail(iEmail)) {
      toast.error("Enter a valid email address (e.g. name@example.com)");
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        existing_user?: boolean;
        error?: string;
      }>("invite-guide", {
        body: {
          first_name: iFirst.trim(),
          last_name: iLast.trim(),
          email: iEmail.trim().toLowerCase(),
          phone: iPhone.trim() || undefined,
          role: iRole,
        },
      });

      if (error) {
        throw new Error(await edgeFunctionErrorMessage(error, data, "Could not send invite"));
      }
      if (data?.error) {
        throw new Error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : "Invite rejected by server",
        );
      }

      toast.success(
        data?.existing_user
          ? `${iFirst} ${iLast} added as ${ROLE_LABEL[iRole]} (already has an account — no invite email sent).`
          : `${iFirst} ${iLast} invited as ${ROLE_LABEL[iRole]}`,
      );
      setInviteOpen(false);
      setIFirst("");
      setILast("");
      setIEmail("");
      setIPhone("");
      setIRole("guide");
      await load();
    } catch (e: unknown) {
      console.error("staff invite failed", e);
      toast.error(`Failed to invite staff: ${supabaseErrorMessage(e, "Could not send invite")}`);
    } finally {
      setInviting(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: "customer" })
        .eq("id", deactivateTarget.id);
      if (error) throw error;

      if (deactivateTarget.role === "guide") {
        const { error: guideErr } = await supabase
          .from("guides")
          .update({ is_active: false })
          .eq("profile_id", deactivateTarget.id);
        if (guideErr) throw guideErr;
      }

      toast.success(`${deactivateTarget.fullName} deactivated`);
      setDeactivateTarget(null);
      await load();
    } catch (e: unknown) {
      console.error("staff deactivate failed", e);
      toast.error(
        `Failed to deactivate staff: ${supabaseErrorMessage(e, "Could not deactivate staff")}`,
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff"
        description={loading ? "Loading…" : `${rows.length} active staff`}
        actions={
          <Button
            type="button"
            onClick={() => setInviteOpen(true)}
            disabled={!canManage}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            <Plus className="h-4 w-4" /> Invite staff
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {STAFF_ROLES.map((r) => (
          <span
            key={r}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
              ROLE_BADGE[r],
            )}
          >
            {ROLE_LABEL[r]}
            <span className="rounded-full bg-white/30 px-1.5 text-[10px] tabular-nums">
              {counts[r]}
            </span>
          </span>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {STAFF_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name A–Z</SelectItem>
            <SelectItem value="name_desc">Name Z–A</SelectItem>
            <SelectItem value="joined_desc">Newest first</SelectItem>
            <SelectItem value="joined_asc">Oldest first</SelectItem>
            <SelectItem value="role">By role</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <UserCog className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">No staff match your filters.</p>
          </div>
        ) : (
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Staff member</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Current plan</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 font-medium">Active</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openEdit(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEdit(r);
                    }
                  }}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {r.avatarUrl ? (
                        <img
                          src={r.avatarUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="grid h-9 w-9 shrink-0 place-content-center rounded-full bg-[#a3b693] text-xs font-bold text-white"
                          aria-hidden
                        >
                          {initials(r.firstName, r.lastName, r.email)}
                        </div>
                      )}
                      <span className="truncate font-semibold">{r.fullName}</span>
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate px-5 py-3">
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{r.email}</span>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {r.phone ? (
                      <a
                        href={`tel:${r.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {r.phone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        ROLE_BADGE[r.role],
                      )}
                    >
                      {ROLE_LABEL[r.role]}
                    </span>
                  </td>
                  <td className="max-w-[10rem] px-5 py-3">
                    {r.currentPlans.length > 0 ? (
                      <div
                        className="flex max-w-full flex-col gap-0.5"
                        title={r.currentPlans.join(" · ")}
                      >
                        {r.currentPlans.map((plan) => (
                          <span
                            key={plan}
                            className="inline-flex max-w-full truncate rounded-full bg-[#e8efe3] px-2 py-0.5 text-[10px] font-semibold text-[#3d4f36]"
                          >
                            {plan}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    {r.createdAt ? formatDate(r.createdAt) : "—"}
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={true}
                      disabled={!canManage}
                      onCheckedChange={(next) => {
                        if (!next) setDeactivateTarget(r);
                      }}
                      aria-label={`Deactivate ${r.fullName}`}
                      className="data-[state=checked]:bg-[#a3b693]"
                    />
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs"
                        disabled={!canManage}
                        onClick={() => {
                          setAssignTarget({
                            profileId: r.id,
                            displayName: r.fullName,
                            email: r.email?.trim() || null,
                            firstName: r.firstName,
                          });
                          setAssignOpen(true);
                        }}
                      >
                        <Package className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Assign
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs"
                        onClick={() => setProfileSheetRow(r)}
                      >
                        <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Profile
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filteredSorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Page {page} of {pageCount} · {filteredSorted.length} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {assignOpen ? (
        <AssignPackageDialog
          open
          onOpenChange={setAssignOpen}
          target={assignTarget}
          canAssign={canManage}
          includeAddons
          onAssigned={() => void load()}
        />
      ) : null}

      <CustomerProfileSheet
        customerId={profileSheetRow?.id ?? null}
        open={profileSheetRow !== null}
        onOpenChange={(o) => {
          if (!o) setProfileSheetRow(null);
        }}
        viewerRole={viewerRole}
        variant="staff"
        onProfileUpdated={() => void load()}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          className="max-w-md"
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-radix-select-content]") || t.closest('[role="listbox"]')) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-radix-select-content]") || t.closest('[role="listbox"]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit staff member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="es-first">First name</Label>
                <Input
                  id="es-first"
                  value={eFirst}
                  onChange={(e) => setEFirst(e.target.value)}
                  disabled={!canManage}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="es-last">Last name</Label>
                <Input
                  id="es-last"
                  value={eLast}
                  onChange={(e) => setELast(e.target.value)}
                  disabled={!canManage}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="es-email">Email</Label>
              <Input
                id="es-email"
                type="email"
                value={eEmail}
                onChange={(e) => setEEmail(e.target.value)}
                disabled={!canManage}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="es-phone">Phone</Label>
              <Input
                id="es-phone"
                type="tel"
                value={ePhone}
                onChange={(e) => setEPhone(e.target.value)}
                disabled={!canManage}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select
                value={eRole}
                onValueChange={(v) => setERole(v as StaffRole)}
                disabled={!canManage}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving || !canManage}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite staff member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="is-first">First name</Label>
                <Input
                  id="is-first"
                  value={iFirst}
                  onChange={(e) => setIFirst(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="is-last">Last name</Label>
                <Input id="is-last" value={iLast} onChange={(e) => setILast(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="is-email">Email</Label>
              <Input
                id="is-email"
                type="email"
                value={iEmail}
                onChange={(e) => setIEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="is-phone">Phone (optional)</Label>
              <Input
                id="is-phone"
                type="tel"
                value={iPhone}
                onChange={(e) => setIPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={iRole} onValueChange={(v) => setIRole(v as StaffRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              An email invite will be sent. Only directors can invite staff.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitInvite()}
              disabled={inviting}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget
                ? `${deactivateTarget.fullName} will lose admin access. Their role will revert to customer and they will disappear from the staff list.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDeactivate();
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
