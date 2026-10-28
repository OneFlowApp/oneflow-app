import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Loader2, Mail, MessageSquare, Package, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  currentPlanLabel,
  currentPlanLabels,
  isActiveUserCredit,
  type UserCreditPlanRow,
} from "@/lib/currentPlan";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminTableWrap } from "@/components/admin/AdminTableWrap";
import { PageHeader } from "@/components/admin/PageHeader";
import { CustomerProfileSheet } from "@/components/admin/CustomerProfileSheet";
import {
  SendMemberEmailDialog,
  type SendMemberEmailTarget,
} from "@/components/admin/SendMemberEmailDialog";
import {
  AssignPackageDialog,
  type AssignPackageTarget,
  type AssignedCreditRow,
} from "@/components/admin/AssignPackageDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isBookableMember } from "@/lib/bookableMembers";
import { fetchAllMemberProfileIds, sendInAppMessagesToMembers } from "@/lib/studioMemberMessages";
import { getUser, supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth";
import { edgeFunctionErrorMessage, isValidEmail, supabaseErrorMessage } from "@/lib/supabaseErrors";
import { normalizeProductCategoryKey } from "@/lib/productCategories";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/customers")({
  validateSearch: (search: Record<string, unknown>) => ({
    profile: typeof search.profile === "string" ? search.profile : undefined,
  }),
  head: () => ({
    meta: [{ title: "Customers — One Flow Admin" }],
  }),
  component: CustomersPage,
});

const TZ = "Africa/Johannesburg";

function yearMonthKeyJhb(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

const ALL_ROLES = [
  "customer",
  "other",
  "guide",
  "front_desk",
  "management",
  "director",
  "boh",
  "marketing",
  "team",
] as const;

type AllRole = (typeof ALL_ROLES)[number];

function isAllRole(r: string): r is AllRole {
  return (ALL_ROLES as readonly string[]).includes(r);
}

/** Radix Select crashes when `value` is not a listed item — coerce unknown DB roles. */
function roleForSelect(role: string): AllRole {
  const r = role.trim().toLowerCase();
  return isAllRole(r) ? r : "customer";
}


function creditsDisplayFromActive(active: EmbeddedCreditRow[]): {
  display: string;
  hasActiveCredits: boolean;
} {
  if (active.length === 0) return { display: "—", hasActiveCredits: false };
  if (active.some((c) => c.is_unlimited)) {
    return { display: "Unlimited", hasActiveCredits: true };
  }
  const total = active.reduce(
    (sum, c) => sum + Math.max(0, Math.round(Number(c.credits_remaining) || 0)),
    0,
  );
  if (total <= 0) return { display: "—", hasActiveCredits: false };
  return { display: String(total), hasActiveCredits: true };
}

function mergeCreditsAfterAssign(
  member: Pick<MemberRow, "creditsDisplay" | "hasActiveCredits" | "currentPlans">,
  row: AssignedCreditRow,
): Pick<MemberRow, "creditsDisplay" | "hasActiveCredits" | "currentPlans"> {
  const creditsPart = (() => {
    if (row.is_unlimited || member.creditsDisplay === "Unlimited") {
      return { creditsDisplay: "Unlimited", hasActiveCredits: true };
    }
    const add = Math.max(0, Math.round(Number(row.credits_remaining) || 0));
    const prevTotal =
      member.hasActiveCredits && member.creditsDisplay !== "—"
        ? Math.round(Number(member.creditsDisplay) || 0)
        : 0;
    const total = prevTotal + add;
    if (total <= 0) return { creditsDisplay: "—", hasActiveCredits: false };
    return { creditsDisplay: String(total), hasActiveCredits: true };
  })();

  const name = row.product_name?.trim();
  const currentPlans =
    name && !member.currentPlans.some((p) => p.toLowerCase() === name.toLowerCase())
      ? [...member.currentPlans, name]
      : member.currentPlans;

  return { ...creditsPart, currentPlans };
}

type EmbeddedCreditRow = UserCreditPlanRow;

function isCreditActive(c: EmbeddedCreditRow, nowMs: number): boolean {
  return isActiveUserCredit(c, nowMs);
}

function activeCreditsForProfile(credits: EmbeddedCreditRow[], nowMs: number): EmbeddedCreditRow[] {
  return credits.filter((c) => isCreditActive(c, nowMs));
}

function planLabelFromActiveCredits(active: EmbeddedCreditRow[], nowMs: number): string {
  return currentPlanLabel(active, nowMs) ?? "No plan";
}

const ROLE_LABEL: Record<string, string> = {
  customer: "Customer",
  other: "Other",
  guide: "Guide",
  front_desk: "Front Desk",
  management: "Management",
  director: "Director",
  boh: "BOH",
  marketing: "Marketing",
  team: "Team",
};

type MemberRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  secondaryRoles: string[];
  plan: string;
  currentPlans: string[];
  creditsDisplay: string;
  hasActiveCredits: boolean;
  lastVisit: string;
  status: "active" | "paused" | "trial";
  waiverSigned: boolean;
  hasBooking: boolean;
  joinedAt: string | null;
  isReturningLegacy: boolean;
};

/** Responsive admin customers table — mobile: Name, Plan, Credits, Actions (+ checkbox). */
const CUSTOMERS_COL = {
  checkTh: "w-11 min-w-[2.75rem] px-2 py-3",
  checkTd: "w-11 min-w-[2.75rem] px-2 py-3 align-middle",
  nameTh:
    "min-w-[10rem] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:min-w-[10rem]",
  nameTd: "min-w-[10rem] max-w-[17.5rem] px-3 py-3 md:w-[22%]",
  emailTh:
    "hidden min-w-[11.25rem] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell",
  emailTd: "hidden min-w-[11.25rem] max-w-[14rem] truncate px-3 py-3 text-muted-foreground md:table-cell",
  phoneTh:
    "hidden min-w-[7.5rem] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell",
  phoneTd: "hidden min-w-[7.5rem] whitespace-nowrap px-3 py-3 text-muted-foreground md:table-cell",
  roleTh:
    "hidden min-w-[6.25rem] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell",
  roleTd: "hidden min-w-[6.25rem] px-3 py-3 md:table-cell",
  planTh:
    "w-[9rem] min-w-[9rem] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  planTd: "w-[9rem] min-w-[9rem] max-w-[9rem] truncate px-3 py-3",
  creditsTh:
    "w-[5.5rem] min-w-[5.5rem] whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  creditsTd: "w-[5.5rem] min-w-[5.5rem] whitespace-nowrap px-3 py-3 tabular-nums",
  lastVisitTh:
    "hidden w-[6.5rem] min-w-[6.5rem] whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell",
  lastVisitTd:
    "hidden w-[6.5rem] min-w-[6.5rem] whitespace-nowrap px-3 py-3 text-muted-foreground md:table-cell",
  statusTh:
    "hidden w-[5.5rem] min-w-[5.5rem] whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell",
  statusTd: "hidden w-[5.5rem] min-w-[5.5rem] px-3 py-3 md:table-cell",
  actionsTh:
    "w-[11.5rem] min-w-[11.5rem] whitespace-nowrap px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
  actionsTd: "w-[11.5rem] min-w-[11.5rem] px-3 py-3 text-right group-hover:bg-muted/20",
} as const;

const CUSTOMERS_TABLE_CLASS = "w-full min-w-[36rem] text-sm md:min-w-[74rem]";

function CustomersTableHead({
  allFilteredSelected,
  someFilteredSelected,
  onToggleSelectAll,
}: {
  allFilteredSelected: boolean;
  someFilteredSelected: boolean;
  onToggleSelectAll: () => void;
}) {
  return (
    <thead className="bg-muted/40">
      <tr className="text-left">
        <th className={CUSTOMERS_COL.checkTh}>
          <Checkbox
            checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
            onCheckedChange={onToggleSelectAll}
            aria-label="Select all members in this list"
          />
        </th>
        <th className={CUSTOMERS_COL.nameTh}>Name</th>
        <th className={CUSTOMERS_COL.emailTh}>Email</th>
        <th className={CUSTOMERS_COL.phoneTh}>Phone</th>
        <th className={CUSTOMERS_COL.roleTh}>Role</th>
        <th className={CUSTOMERS_COL.planTh}>Plan</th>
        <th className={CUSTOMERS_COL.creditsTh}>Credits</th>
        <th className={CUSTOMERS_COL.lastVisitTh}>Last visit</th>
        <th className={CUSTOMERS_COL.statusTh}>Status</th>
        <th className={CUSTOMERS_COL.actionsTh}>Actions</th>
      </tr>
    </thead>
  );
}

function CustomerRowActions({
  canManage,
  onProfile,
  onAssign,
  onSendEmail,
}: {
  canManage: boolean;
  onProfile: () => void;
  onAssign: () => void;
  onSendEmail: () => void;
}) {
  return (
    <div className="flex flex-nowrap items-center justify-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs"
        onClick={onProfile}
      >
        Profile
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs"
        disabled={!canManage}
        onClick={onSendEmail}
      >
        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Email
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs"
        disabled={!canManage}
        onClick={onAssign}
      >
        <Package className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Assign
      </Button>
    </div>
  );
}

function CustomersPage() {
  const { profile } = useAuth();
  const viewerRole = effectiveRole(profile);
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [q, setQ] = useState("");
  const [chipHasCredits, setChipHasCredits] = useState(false);
  const [chipNoCredits, setChipNoCredits] = useState(false);
  const [chipNeverBooked, setChipNeverBooked] = useState(false);
  const [chipWaiverUnsigned, setChipWaiverUnsigned] = useState(false);
  const [chipJoinedMonth, setChipJoinedMonth] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignPackageTarget | null>(null);
  const [bulkAssignTargets, setBulkAssignTargets] = useState<AssignPackageTarget[] | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageAllMembers, setMessageAllMembers] = useState(false);
  const [addFieldErrors, setAddFieldErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
  }>({});
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [role, setRole] = useState("customer");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetCustomerId, setSheetCustomerId] = useState<string | null>(null);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [sendEmailTarget, setSendEmailTarget] = useState<SendMemberEmailTarget | null>(null);
  const [legacyMigration, setLegacyMigration] = useState<{
    claimed: number;
    total: number;
  } | null>(null);

  const canManageCustomers =
    (viewerRole ?? "").toLowerCase() === "director" ||
    (viewerRole ?? "").toLowerCase() === "management";

  useEffect(() => {
    if (search.profile) {
      setSheetCustomerId(search.profile);
      setSheetOpen(true);
    }
  }, [search.profile]);

  const openProfileSheet = (id: string) => {
    setSheetCustomerId(id);
    setSheetOpen(true);
    void navigate({ to: "/admin/customers", search: { profile: id }, replace: true });
  };

  const closeProfileSheet = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setSheetCustomerId(null);
      void navigate({ to: "/admin/customers", search: { profile: undefined }, replace: true });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const nowMs = Date.now();
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, email, phone, role, secondary_roles, is_active, created_at, waiver_accepted_at",
      )
      .order("first_name", { ascending: true });

    if (pErr) {
      console.error(pErr);
      toast.error(supabaseErrorMessage(pErr, "Could not load customers"));
      setMembers([]);
      setLoading(false);
      return;
    }

    const ids = (profiles ?? []).map((p: { id: string }) => p.id);

    let legacyClaimedProfileIds = new Set<string>();
    if (canManageCustomers) {
      const [
        { count: legacyTotal, error: legacyTotalErr },
        { count: legacyClaimed, error: legacyClaimedErr },
      ] = await Promise.all([
        supabase.from("legacy_members").select("id", { count: "exact", head: true }),
        supabase
          .from("legacy_members")
          .select("id", { count: "exact", head: true })
          .not("claimed_at", "is", null),
      ]);

      if (legacyTotalErr || legacyClaimedErr) {
        console.error("customers: legacy_members load failed", legacyTotalErr ?? legacyClaimedErr);
      } else {
        const total = legacyTotal ?? 0;
        const claimed = legacyClaimed ?? 0;
        setLegacyMigration({ claimed, total });
      }

      const { data: legacyClaimRows, error: legacyClaimErr } = await supabase
        .from("legacy_members")
        .select("claimed_by")
        .not("claimed_at", "is", null);

      if (legacyClaimErr) {
        console.error("customers: legacy claimed_by load failed", legacyClaimErr);
      } else {
        legacyClaimedProfileIds = new Set(
          (legacyClaimRows ?? [])
            .map((r) => (r as { claimed_by: string | null }).claimed_by)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        );
      }
    } else {
      setLegacyMigration(null);
    }

    const creditsByProfile = new Map<string, EmbeddedCreditRow[]>();
    const bookedIds = new Set<string>();

    if (ids.length > 0) {
      const [{ data: bookingRows }, { data: creditRows, error: creditsErr }] = await Promise.all([
        supabase.from("bookings").select("profile_id").in("profile_id", ids),
        supabase
          .from("user_credits")
          .select(
            "profile_id, product_name, category, credits_remaining, is_unlimited, expires_at, purchased_at, created_at, product_id, products(name, is_addon)",
          )
          .in("profile_id", ids),
      ]);

      if (creditsErr) {
        console.error("customers: user_credits load failed", creditsErr);
        toast.error(supabaseErrorMessage(creditsErr, "Could not load member credits"));
      }

      for (const row of creditRows ?? []) {
        const pid = String((row as { profile_id: string }).profile_id);
        const credit: EmbeddedCreditRow = {
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

      for (const row of bookingRows ?? []) {
        const pid = row.profile_id as string | null;
        if (pid) bookedIds.add(pid);
      }
    }

    const rows: MemberRow[] = (profiles ?? []).map((p: Record<string, unknown>) => {
      const id = String(p.id);
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Member";
      const waiverAt = p.waiver_accepted_at as string | null | undefined;
      const embedded = creditsByProfile.get(id) ?? [];
      const active = activeCreditsForProfile(embedded, nowMs);
      const { display: creditsDisplay, hasActiveCredits } = creditsDisplayFromActive(active);
      return {
        id,
        name,
        email: String(p.email ?? "—"),
        phone: String(p.phone ?? "—"),
        role: String(p.role ?? "customer").toLowerCase(),
        secondaryRoles: Array.isArray(p.secondary_roles)
          ? (p.secondary_roles as string[]).map((r) => String(r).toLowerCase())
          : [],
        plan: planLabelFromActiveCredits(active, nowMs),
        currentPlans: currentPlanLabels(embedded, nowMs),
        creditsDisplay,
        hasActiveCredits,
        lastVisit: "—",
        status: "active" as const,
        waiverSigned: Boolean(waiverAt),
        hasBooking: bookedIds.has(id),
        joinedAt: (p.created_at as string | null | undefined) ?? null,
        isReturningLegacy: legacyClaimedProfileIds.has(id),
      };
    });

    setMembers(rows);
    setSelectedMemberIds([]);
    setLoading(false);
  }, [canManageCustomers]);

  useEffect(() => {
    void load();
  }, [load]);

  const chipFilterCount =
    Number(chipHasCredits) +
    Number(chipNoCredits) +
    Number(chipNeverBooked) +
    Number(chipWaiverUnsigned) +
    Number(chipJoinedMonth);

  const clearChipFilters = () => {
    setChipHasCredits(false);
    setChipNoCredits(false);
    setChipNeverBooked(false);
    setChipWaiverUnsigned(false);
    setChipJoinedMonth(false);
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return members.filter((m) => {
      if (ql) {
        const hay = `${m.name} ${m.email}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (roleFilter !== "all") {
        if (roleFilter === "customer") {
          if (!isBookableMember({ role: m.role, secondary_roles: m.secondaryRoles })) return false;
        } else if (m.role !== roleFilter) {
          return false;
        }
      }
      if (chipHasCredits && !m.hasActiveCredits) return false;
      if (chipNoCredits && m.hasActiveCredits) return false;
      if (chipNeverBooked && m.hasBooking) return false;
      if (chipWaiverUnsigned && m.waiverSigned) return false;
      if (
        chipJoinedMonth &&
        (!m.joinedAt || yearMonthKeyJhb(m.joinedAt) !== yearMonthKeyJhb(new Date().toISOString()))
      ) {
        return false;
      }
      return true;
    });
  }, [
    members,
    q,
    chipHasCredits,
    chipNoCredits,
    chipNeverBooked,
    chipWaiverUnsigned,
    chipJoinedMonth,
    roleFilter,
  ]);

  const selectedSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);

  const resetAddForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setDob("");
    setRole("customer");
    setAddFieldErrors({});
  };

  const toggleMemberSelected = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedSet.has(m.id));
  const someFilteredSelected = filtered.some((m) => selectedSet.has(m.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const drop = new Set(filtered.map((m) => m.id));
      setSelectedMemberIds((prev) => prev.filter((id) => !drop.has(id)));
    } else {
      setSelectedMemberIds((prev) => {
        const next = new Set(prev);
        for (const m of filtered) next.add(m.id);
        return Array.from(next);
      });
    }
  };

  const clearMemberSelection = () => setSelectedMemberIds([]);

  const selectedMemberRows = useMemo(
    () => members.filter((m) => selectedSet.has(m.id)),
    [members, selectedSet],
  );

  const openBulkAssignPackage = () => {
    const targets: AssignPackageTarget[] = selectedMemberRows.map((m) => {
      const em = m.email.trim() === "—" || !m.email.trim() ? null : m.email;
      return {
        profileId: m.id,
        displayName: m.name,
        email: em,
        firstName: m.name.split(/\s+/)[0] ?? null,
      };
    });
    if (targets.length === 0) return;
    setAssignTarget(null);
    setBulkAssignTargets(targets);
    setAssignOpen(true);
  };

  const exportSelectedMembersCsv = () => {
    const rows = selectedMemberRows;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ["Name", "Email", "Phone", "Role", "Credits"].join(",");
    const body = rows
      .map((m) =>
        [
          esc(m.name),
          esc(m.email),
          esc(m.phone),
          esc(m.role),
          esc(m.creditsDisplay),
        ].join(","),
      )
      .join("\n");
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `one-flow-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} member${rows.length === 1 ? "" : "s"} to CSV`);
  };

  const sendBulkStudioMessages = async () => {
    if (!messageSubject.trim() && !messageBody.trim()) {
      toast.error("Add a subject or message body.");
      return;
    }
    const user = await getUser();
    setMessageSending(true);
    try {
      const profileIds = messageAllMembers
        ? await fetchAllMemberProfileIds()
        : selectedMemberIds;
      if (profileIds.length === 0) {
        toast.error("No members selected");
        setMessageSending(false);
        return;
      }
      const { sent, failed } = await sendInAppMessagesToMembers({
        fromProfileId: user?.id ?? null,
        profileIds,
        subject: messageSubject.trim() || null,
        body: messageBody.trim(),
        messageType: "direct",
      });
      setMessageSending(false);
      setMessageOpen(false);
      setMessageAllMembers(false);
      setMessageSubject("");
      setMessageBody("");
      if (sent === 0) {
        toast.error("Could not send messages — check permissions and try again.");
        return;
      }
      if (failed > 0) {
        toast.error(`Sent to ${sent} members, ${failed} failed.`);
      } else {
        toast.success(`Message sent to ${sent} member${sent === 1 ? "" : "s"}`);
      }
      if (!messageAllMembers) {
        clearMemberSelection();
      }
    } catch (e) {
      console.error(e);
      setMessageSending(false);
      toast.error(e instanceof Error ? e.message : "Could not send messages");
    }
  };

  const openMessageAllMembers = () => {
    setMessageAllMembers(true);
    setMessageOpen(true);
  };

  const bumpMemberCreditsAfterAssign = (profileId: string, row: AssignedCreditRow) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === profileId ? { ...m, ...mergeCreditsAfterAssign(m, row) } : m,
      ),
    );
  };

  const submitAddMember = async () => {
    const err: typeof addFieldErrors = {};
    if (!firstName.trim()) err.firstName = "First name is required.";
    if (!lastName.trim()) err.lastName = "Last name is required.";
    if (!email.trim()) err.email = "Email is required.";
    else if (!isValidEmail(email)) err.email = "Enter a valid email address.";
    setAddFieldErrors(err);
    if (Object.keys(err).length > 0) return;

    setSaving(true);
    const { data, error } = await supabase.functions.invoke<{
      success?: boolean;
      full_name?: string;
      error?: string;
    }>("invite-guide", {
      body: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        date_of_birth: dob.trim() || undefined,
        role: role === "other" ? "other" : "customer",
      },
    });

    if (error) {
      toast.error(await edgeFunctionErrorMessage(error, data, "Could not create member"));
      setSaving(false);
      return;
    }

    if (data?.error) {
      toast.error(
        typeof data?.error === "string" && data.error.trim()
          ? data.error
          : "Could not create member — please try again",
      );
      setSaving(false);
      return;
    }

    const displayName = data?.full_name ?? `${firstName.trim()} ${lastName.trim()}`.trim();
    toast.success(`${displayName} invited — they will receive an email to set their password.`);
    setAddOpen(false);
    resetAddForm();
    await load();
    setSaving(false);
  };

  const saveListMemberRole = async (memberId: string, previous: AllRole, next: AllRole) => {
    const memberName = members.find((m) => m.id === memberId)?.name ?? "Member";
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: next } : m)));
    const { error } = await supabase.from("profiles").update({ role: next }).eq("id", memberId);
    if (error) {
      console.error("customer role update failed", error);
      toast.error(supabaseErrorMessage(error, "Could not update role"));
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: previous } : m)));
      return;
    }
    toast.success(`${ROLE_LABEL[next] ?? next} role saved for ${memberName}`);
  };

  const onListRoleChange = (memberId: string, currentRole: string, value: string) => {
    if (!isAllRole(value)) return;
    if (!canManageCustomers) return;
    if (value === currentRole) return;
    if (!isAllRole(currentRole)) return;
    void saveListMemberRole(memberId, currentRole, value);
  };

  return (
    <div className={cn(selectedMemberIds.length > 0 && "pb-28")}>
      <PageHeader
        title="Customers"
        description={loading ? "Loading…" : `${members.length} people`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canManageCustomers ? (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={openMessageAllMembers}
              >
                <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
                Message all members
              </Button>
            ) : null}
            <Button
              type="button"
              className="w-full gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d] sm:w-auto"
              onClick={() => {
                resetAddForm();
                setAddOpen(true);
              }}
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden /> Add member
            </Button>
          </div>
        }
      />

      {canManageCustomers && legacyMigration && legacyMigration.total > 0 ? (
        <p className="mb-4 rounded-xl border border-[#c5d4b8]/80 bg-[#e8efe3]/50 px-4 py-3 text-sm text-[#3d4f36]">
          <span className="font-semibold">Legacy migration:</span>{" "}
          {legacyMigration.claimed.toLocaleString()} of {legacyMigration.total.toLocaleString()}{" "}
          imported members have re-registered. Unclaimed rows are not listed below — email them from{" "}
          <Link to="/admin/email" className="font-semibold underline-offset-2 hover:underline">
            Email Marketing
          </Link>{" "}
          (All members or Imported members).
        </p>
      ) : null}

      <CustomerProfileSheet
        customerId={sheetCustomerId}
        open={sheetOpen}
        onOpenChange={closeProfileSheet}
        viewerRole={viewerRole}
        variant="customer"
        onProfileUpdated={() => void load()}
      />

      <SendMemberEmailDialog
        open={sendEmailOpen}
        onOpenChange={(o) => {
          setSendEmailOpen(o);
          if (!o) setSendEmailTarget(null);
        }}
        target={sendEmailTarget}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
              <div>
                <Label htmlFor="am-first">First name</Label>
                <Input
                  id="am-first"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    if (addFieldErrors.firstName)
                      setAddFieldErrors((e) => ({ ...e, firstName: undefined }));
                  }}
                  autoComplete="given-name"
                  aria-invalid={Boolean(addFieldErrors.firstName)}
                />
                {addFieldErrors.firstName ? (
                  <p className="mt-1 text-xs text-destructive">{addFieldErrors.firstName}</p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="am-last">Last name</Label>
                <Input
                  id="am-last"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    if (addFieldErrors.lastName)
                      setAddFieldErrors((e) => ({ ...e, lastName: undefined }));
                  }}
                  autoComplete="family-name"
                  aria-invalid={Boolean(addFieldErrors.lastName)}
                />
                {addFieldErrors.lastName ? (
                  <p className="mt-1 text-xs text-destructive">{addFieldErrors.lastName}</p>
                ) : null}
              </div>
            </div>
            <div>
              <Label htmlFor="am-email">Email</Label>
              <Input
                id="am-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (addFieldErrors.email) setAddFieldErrors((e) => ({ ...e, email: undefined }));
                }}
                autoComplete="email"
                aria-invalid={Boolean(addFieldErrors.email)}
              />
              {addFieldErrors.email ? (
                <p className="mt-1 text-xs text-destructive">{addFieldErrors.email}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="am-phone">Phone</Label>
              <Input
                id="am-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div>
              <Label htmlFor="am-dob">Date of birth</Label>
              <Input id="am-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              className="w-full bg-[#a3b693] text-white hover:bg-[#8fa67d] sm:w-auto"
              onClick={() => void submitAddMember()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create & invite"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assignOpen ? (
        <AssignPackageDialog
          open
          onOpenChange={(o) => {
            setAssignOpen(o);
            if (!o) {
              setBulkAssignTargets(null);
              setAssignTarget(null);
            }
          }}
          target={assignTarget}
          bulkTargets={bulkAssignTargets}
          canAssign={canManageCustomers}
          includeAddons
          onCreditInserted={(row, profileId) => bumpMemberCreditsAfterAssign(profileId, row)}
          onAssigned={() => void load()}
        />
      ) : null}

      <Dialog
        open={messageOpen}
        onOpenChange={(o) => {
          setMessageOpen(o);
          if (!o) setMessageAllMembers(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send message</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {messageAllMembers
              ? "Sending to all members with a customer account."
              : `Sending to ${selectedMemberIds.length} member${selectedMemberIds.length === 1 ? "" : "s"}.`}
          </p>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="bulk-msg-subject">Subject</Label>
              <Input
                id="bulk-msg-subject"
                value={messageSubject}
                onChange={(e) => setMessageSubject(e.target.value)}
                placeholder="Optional subject line"
              />
            </div>
            <div>
              <Label htmlFor="bulk-msg-body">Message</Label>
              <Textarea
                id="bulk-msg-body"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={5}
                placeholder="Write your message…"
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setMessageOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={messageSending}
              className="w-full bg-[#a3b693] text-white hover:bg-[#8fa67d] sm:w-auto"
              onClick={() => void sendBulkStudioMessages()}
            >
              {messageSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send to all"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4 flex flex-col gap-3 space-y-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:space-y-0">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="w-full sm:w-52">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground sm:w-auto sm:justify-start">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filters
            {chipFilterCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {chipFilterCount}
              </span>
            ) : null}
          </span>
          {chipFilterCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full gap-1 text-xs text-muted-foreground sm:w-auto"
              onClick={clearChipFilters}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap gap-2">
          {(
            [
              ["Has credits", chipHasCredits, () => setChipHasCredits((v) => !v)] as const,
              ["No credits", chipNoCredits, () => setChipNoCredits((v) => !v)] as const,
              ["Never booked", chipNeverBooked, () => setChipNeverBooked((v) => !v)] as const,
              [
                "Waiver not signed",
                chipWaiverUnsigned,
                () => setChipWaiverUnsigned((v) => !v),
              ] as const,
              ["Joined this month", chipJoinedMonth, () => setChipJoinedMonth((v) => !v)] as const,
            ] as const
          ).map(([label, on, toggle]) => (
            <button
              key={label}
              type="button"
              onClick={toggle}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
                (on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/60")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <AdminTableWrap className="mb-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
          {loading ? (
            <table className={CUSTOMERS_TABLE_CLASS}>
              <CustomersTableHead
                allFilteredSelected={false}
                someFilteredSelected={false}
                onToggleSelectAll={() => {}}
              />
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="group border-t border-border">
                    <td className={CUSTOMERS_COL.checkTd}>
                      <Skeleton className="h-4 w-4" />
                    </td>
                    <td className={CUSTOMERS_COL.nameTd}>
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className={CUSTOMERS_COL.emailTd}>
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className={CUSTOMERS_COL.phoneTd}>
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className={CUSTOMERS_COL.roleTd}>
                      <Skeleton className="h-8 w-[100px]" />
                    </td>
                    <td className={CUSTOMERS_COL.planTd}>
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className={CUSTOMERS_COL.creditsTd}>
                      <Skeleton className="h-4 w-8" />
                    </td>
                    <td className={CUSTOMERS_COL.lastVisitTd}>
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className={CUSTOMERS_COL.statusTd}>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </td>
                    <td className={CUSTOMERS_COL.actionsTd}>
                      <Skeleton className="ml-auto h-8 w-[10.5rem]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : members.length === 0 ? (
            <AdminEmptyState
              title="No people yet"
              actionLabel="Add member"
              onAction={() => {
                resetAddForm();
                setAddOpen(true);
              }}
            />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <p className="text-sm text-muted-foreground">No members match your filters.</p>
              <Button type="button" variant="outline" onClick={clearChipFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <table className={CUSTOMERS_TABLE_CLASS}>
              <CustomersTableHead
                allFilteredSelected={allFilteredSelected}
                someFilteredSelected={someFilteredSelected}
                onToggleSelectAll={toggleSelectAllFiltered}
              />
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="group border-t border-border hover:bg-muted/20">
                    <td className={CUSTOMERS_COL.checkTd}>
                      <Checkbox
                        checked={selectedSet.has(m.id)}
                        onCheckedChange={(v) => {
                          setSelectedMemberIds((prev) => {
                            if (v === true) return prev.includes(m.id) ? prev : [...prev, m.id];
                            return prev.filter((x) => x !== m.id);
                          });
                        }}
                        aria-label={`Select ${m.name}`}
                      />
                    </td>
                    <td className={CUSTOMERS_COL.nameTd}>
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold text-foreground">{m.name}</span>
                        {m.isReturningLegacy ? (
                          <span className="shrink-0 rounded-full bg-[#e8efe3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]">
                            Returning member
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={CUSTOMERS_COL.emailTd} title={m.email}>
                      {m.email}
                    </td>
                    <td className={CUSTOMERS_COL.phoneTd}>{m.phone}</td>
                    <td className={CUSTOMERS_COL.roleTd} onClick={(e) => e.stopPropagation()}>
                      <Select
                        key={`${m.id}-${m.role}`}
                        value={roleForSelect(m.role)}
                        onValueChange={(v) => onListRoleChange(m.id, m.role, v)}
                        disabled={!canManageCustomers}
                      >
                        <SelectTrigger className="h-8 w-full min-w-[5.5rem] max-w-[6.25rem] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={CUSTOMERS_COL.planTd}>
                      {m.currentPlans.length > 0 ? (
                        <div
                          className="flex max-w-full flex-col gap-0.5"
                          title={m.currentPlans.join(" · ")}
                        >
                          {m.currentPlans.map((plan) => (
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
                    <td className={CUSTOMERS_COL.creditsTd}>{m.creditsDisplay}</td>
                    <td className={CUSTOMERS_COL.lastVisitTd}>{m.lastVisit}</td>
                    <td className={CUSTOMERS_COL.statusTd}>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          m.status === "active"
                            ? "bg-success/20 text-success-foreground"
                            : m.status === "trial"
                              ? "bg-warning/30 text-warning-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className={CUSTOMERS_COL.actionsTd}>
                      <CustomerRowActions
                        canManage={canManageCustomers}
                        onProfile={() => openProfileSheet(m.id)}
                        onSendEmail={() => {
                          const em = m.email.trim() === "—" || !m.email.trim() ? null : m.email.trim();
                          if (!em) {
                            toast.error("This member has no email address.");
                            return;
                          }
                          setSendEmailTarget({ displayName: m.name, email: em });
                          setSendEmailOpen(true);
                        }}
                        onAssign={() => {
                          const em = m.email.trim() === "—" || !m.email.trim() ? null : m.email;
                          setBulkAssignTargets(null);
                          setAssignTarget({
                            profileId: m.id,
                            displayName: m.name,
                            email: em,
                            firstName: m.name.split(/\s+/)[0] ?? null,
                          });
                          setAssignOpen(true);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </AdminTableWrap>

      {selectedMemberIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-sm font-medium text-foreground sm:text-left">
              {selectedMemberIds.length} member{selectedMemberIds.length === 1 ? "" : "s"} selected
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!canManageCustomers}
                onClick={() => {
                  if (!canManageCustomers) return;
                  openBulkAssignPackage();
                }}
              >
                Assign package
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setMessageOpen(true)}
              >
                Send message
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={exportSelectedMembersCsv}
              >
                Export selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={clearMemberSelection}
              >
                Clear selection
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
