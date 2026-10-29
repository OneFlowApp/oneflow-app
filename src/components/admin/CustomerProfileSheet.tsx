import { useCallback, useEffect, useMemo, useState } from "react";
import { DeleteMemberSection } from "@/components/admin/DeleteMemberSection";
import { MemberFeesSection } from "@/components/admin/MemberFeesSection";
import {
  Calendar,
  Loader2,
  Mail,
  Package,
  Phone,
  Plus,
  Shield,
  Trash2,
  User,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import {
  AssignPackageDialog,
  type AssignPackageTarget,
  type AssignedCreditRow,
} from "@/components/admin/AssignPackageDialog";
import { SendMemberEmailDialog } from "@/components/admin/SendMemberEmailDialog";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  formatStudioDateNumeric,
  formatStudioDateOnly,
  formatStudioDateTime,
  formatStudioTime12Upper,
} from "@/lib/timezone";
import {
  BUNDLE_COMPONENT_OPTIONS,
  buildBundleComponentCreditRow,
  type BundleComponentKind,
} from "@/lib/multiCreditProducts";
import {
  UNLIMITED_CREDIT_DISPLAY,
  USER_CREDIT_ADMIN_SELECT,
  creditExpiresToDateInput,
  dateInputToCreditExpires,
  partitionCreditsForDisplay,
  type AdminCreditRow,
} from "@/lib/userCreditAdmin";
import { cn } from "@/lib/utils";

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

function roleForSelect(role: string): AllRole {
  const r = role.trim().toLowerCase();
  return isAllRole(r) ? r : "customer";
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

type ProfileRow = {
  deleted_at?: string | null;
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  role: string | null;
  secondary_roles: string[] | null;
  avatar_url: string | null;
  waiver_accepted_at: string | null;
  created_at: string | null;
  notes: string | null;
  is_active: boolean | null;
};

type CreditRow = AdminCreditRow;

type CreditTransactionRow = {
  id: string;
  product_name: string | null;
  credits_total: number | null;
  created_at: string | null;
  yoco_payment_id: string | null;
};

type BookingRow = {
  id: string;
  status: string;
  payment_method: string | null;
  created_at: string;
  classes: { name: string; starts_at: string } | { name: string; starts_at: string }[] | null;
};

function oneClass(c: BookingRow["classes"]): { name: string; starts_at: string } | null {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

function isCreditActive(row: CreditRow, now: number): boolean {
  if (row.is_unlimited) return true;
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
  const rem = row.credits_remaining ?? 0;
  return rem > 0;
}

type Props = {
  customerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerRole: string | null;
  /** "staff" shows Staff profile title; behaviour and data are the same. */
  variant?: "customer" | "staff";
  onProfileUpdated?: () => void;
};

export function CustomerProfileSheet({
  customerId,
  open,
  onOpenChange,
  viewerRole,
  variant = "customer",
  onProfileUpdated,
}: Props) {
  const canManage =
    (viewerRole ?? "").toLowerCase() === "director" ||
    (viewerRole ?? "").toLowerCase() === "management";

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>("all");

  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [roleDraft, setRoleDraft] = useState<string>("customer");
  const [savingRole, setSavingRole] = useState(false);
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<AllRole | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignPackageTarget | null>(null);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);

  const [removeCreditId, setRemoveCreditId] = useState<string | null>(null);
  const [removingCredit, setRemovingCredit] = useState(false);

  const [editCredit, setEditCredit] = useState<CreditRow | null>(null);
  const [editRemaining, setEditRemaining] = useState("");
  const [editTotal, setEditTotal] = useState("");
  const [editExpires, setEditExpires] = useState("");
  const [editUnlimited, setEditUnlimited] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [topUpCredit, setTopUpCredit] = useState<CreditRow | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("1");
  const [toppingUp, setToppingUp] = useState(false);

  const [addComponentGroup, setAddComponentGroup] = useState<{
    productId: string;
    title: string;
  } | null>(null);
  const [addComponentKind, setAddComponentKind] = useState<BundleComponentKind>("wellzone");
  const [addComponentCredits, setAddComponentCredits] = useState("10");
  const [addComponentUnlimited, setAddComponentUnlimited] = useState(false);
  const [addComponentExpires, setAddComponentExpires] = useState("");
  const [addingComponent, setAddingComponent] = useState(false);

  const [creditTransactions, setCreditTransactions] = useState<CreditTransactionRow[]>([]);
  const [secondaryPopoverOpen, setSecondaryPopoverOpen] = useState(false);
  const [secondaryDraft, setSecondaryDraft] = useState<string[]>([]);
  const [savingSecondary, setSavingSecondary] = useState(false);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendBusy, setResendBusy] = useState(false);

  const title = variant === "staff" ? "Staff profile" : "Customer profile";

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const { data: p, error: pErr } = await supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, email, phone, date_of_birth, role, secondary_roles, avatar_url, waiver_accepted_at, created_at, notes, is_active, deleted_at",
      )
      .eq("id", customerId)
      .maybeSingle();

    if (pErr || !p) {
      console.error("customer profile load failed", pErr);
      toast.error(
        pErr
          ? supabaseErrorMessage(pErr, "Could not load profile")
          : "Profile not found.",
      );
      setProfile(null);
      setCredits([]);
      setCreditTransactions([]);
      setBookings([]);
      setLoading(false);
      return;
    }

    const pr = p as ProfileRow;
    setProfile(pr);
    setNotesDraft(pr.notes ?? "");
    setRoleDraft(roleForSelect(String(pr.role ?? "customer")));

    const [{ data: cr }, { data: bk }] = await Promise.all([
      supabase
        .from("user_credits")
        .select(USER_CREDIT_ADMIN_SELECT)
        .eq("profile_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select(
          `
          id,
          status,
          payment_method,
          created_at,
          classes ( name, starts_at )
        `,
        )
        .eq("profile_id", customerId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const now = Date.now();
    const crRows = (cr ?? []) as CreditRow[];
    setCredits(crRows.filter((row) => isCreditActive(row, now)));
    const txRows: CreditTransactionRow[] = crRows.map((row) => ({
      id: row.id,
      product_name: row.product_name,
      credits_total: row.credits_total,
      created_at: row.created_at ?? null,
      yoco_payment_id: row.yoco_payment_id ?? null,
    }));
    txRows.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });
    setCreditTransactions(txRows);
    setBookings((bk ?? []) as BookingRow[]);
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    if (!open || !customerId) return;
    void load();
  }, [open, customerId, load]);

  useEffect(() => {
    if (!open || !customerId || !canManage) {
      setEmailVerified(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<{
        verified?: boolean;
        unknown?: boolean;
      }>("resend-verification-email", {
        body: { profile_id: customerId, action: "status" },
      });
      if (cancelled) return;
      if (error) {
        setEmailVerified(null);
        return;
      }
      if (data?.unknown) setEmailVerified(null);
      else setEmailVerified(data?.verified ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, canManage]);

  useEffect(() => {
    if (!secondaryPopoverOpen || !profile) return;
    const raw = profile.secondary_roles ?? [];
    setSecondaryDraft([...raw].filter((r) => ALL_ROLES.includes(r as AllRole)).sort());
  }, [secondaryPopoverOpen, profile]);

  const fullName = useMemo(() => {
    if (!profile) return "";
    return [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Member";
  }, [profile]);

  const filteredBookings = useMemo(() => {
    if (bookingStatusFilter === "all") return bookings;
    return bookings.filter((b) => b.status === bookingStatusFilter);
  }, [bookings, bookingStatusFilter]);

  const saveSecondaryRoles = async () => {
    if (!profile || !canManage) return;
    const primary = (profile.role ?? "customer").toLowerCase();
    const next = [...new Set(secondaryDraft.map((r) => r.toLowerCase()))].filter(
      (r) => isAllRole(r) && r !== primary,
    );
    setSavingSecondary(true);
    const { error } = await supabase
      .from("profiles")
      .update({ secondary_roles: next })
      .eq("id", profile.id);
    setSavingSecondary(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save secondary roles"));
      return;
    }
    setProfile((prev) => (prev ? { ...prev, secondary_roles: next } : null));
    setSecondaryPopoverOpen(false);
    toast.success(`Secondary roles updated for ${fullName}`);
    onProfileUpdated?.();
  };

  const resendVerificationEmail = async () => {
    if (!profile?.id || !canManage) return;
    setResendBusy(true);
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; skipped?: boolean }>(
      "resend-verification-email",
      { body: { profile_id: profile.id } },
    );
    setResendBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not send verification email"));
      return;
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      toast.error(String(data.error));
      return;
    }
    if (data && typeof data === "object" && "skipped" in data && data.skipped) {
      toast.success("Email is already verified.");
      setEmailVerified(true);
    } else {
      toast.success(`Verification email sent to ${profile.email ?? "member"}`);
    }
  };

  const openAssignPackage = () => {
    if (!profile) return;
    setAssignTarget({
      profileId: profile.id,
      displayName: fullName,
      email: profile.email?.trim() || null,
      firstName: profile.first_name,
    });
    setAssignOpen(true);
  };

  const saveNotes = async () => {
    if (!profile || !canManage) return;
    setSavingNotes(true);
    const { error } = await supabase
      .from("profiles")
      .update({ notes: notesDraft.trim() || null })
      .eq("id", profile.id);
    setSavingNotes(false);
    if (error) {
      console.error("customer notes save failed", error);
      toast.error(supabaseErrorMessage(error, "Could not save notes"));
      return;
    }
    toast.success(`Notes saved for ${fullName}`);
    setProfile((prev) => (prev ? { ...prev, notes: notesDraft.trim() || null } : null));
    onProfileUpdated?.();
  };

  const setActive = async (next: boolean) => {
    if (!profile || !canManage) return;
    setTogglingActive(true);
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", profile.id);
    setTogglingActive(false);
    if (error) {
      console.error("customer active toggle failed", error);
      toast.error(supabaseErrorMessage(error, "Could not update member status"));
      return;
    }
    toast.success(next ? "Member marked active" : "Member marked inactive");
    setProfile((prev) => (prev ? { ...prev, is_active: next } : null));
    onProfileUpdated?.();
  };

  const applyRole = async (next: AllRole) => {
    if (!profile || !canManage) return;
    setSavingRole(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ role: next })
      .eq("id", profile.id)
      .select("id, role")
      .maybeSingle();
    setSavingRole(false);
    setRoleConfirmOpen(false);
    setPendingRole(null);
    if (error || !data) {
      if (profile) setRoleDraft((profile.role ?? "customer").toLowerCase());
      console.error("customer role update failed", error);
      toast.error(supabaseErrorMessage(error, "Role was not updated — please try again"));
      return;
    }
    const saved = String((data as { role?: string }).role ?? next).toLowerCase();
    setRoleDraft(saved);
    setProfile((prev) => (prev ? { ...prev, role: saved } : null));
    toast.success(
      `${fullName} is now ${ROLE_LABEL[saved] ?? saved}`,
    );
    onProfileUpdated?.();
  };

  const onRoleSelectChange = (value: string) => {
    if (!profile || !isAllRole(value) || !canManage) return;
    const cur = (profile.role ?? "customer").toLowerCase();
    if (value === cur) return;
    if (value !== "customer") {
      setPendingRole(value);
      setRoleConfirmOpen(true);
      return;
    }
    void applyRole("customer");
  };

  const confirmRoleUpgrade = () => {
    if (pendingRole) void applyRole(pendingRole);
  };

  const creditDisplayEntries = useMemo(
    () => partitionCreditsForDisplay(credits),
    [credits],
  );

  const removeCreditTarget = useMemo(
    () => credits.find((c) => c.id === removeCreditId) ?? null,
    [credits, removeCreditId],
  );

  const openAddComponent = (productId: string, title: string, rows: CreditRow[]) => {
    const sampleExpiry = rows.find((r) => r.expires_at)?.expires_at ?? null;
    setAddComponentGroup({ productId, title });
    setAddComponentKind("wellzone");
    setAddComponentCredits("10");
    setAddComponentUnlimited(false);
    setAddComponentExpires(creditExpiresToDateInput(sampleExpiry));
  };

  const confirmAddComponent = async () => {
    if (!addComponentGroup || !customerId || !canManage) return;
    const isAccessOnly = addComponentKind === "mat" || addComponentKind === "towel";
    const unlimited = addComponentUnlimited || isAccessOnly;
    let total = unlimited ? UNLIMITED_CREDIT_DISPLAY : Math.trunc(Number(addComponentCredits));
    if (!unlimited && (!Number.isFinite(total) || total < 1)) {
      toast.error("Enter at least 1 credit.");
      return;
    }
    if (isAccessOnly && !addComponentUnlimited) {
      total = 1;
    }
    setAddingComponent(true);
    const insertRow = buildBundleComponentCreditRow({
      profileId: customerId,
      productId: addComponentGroup.productId,
      bundleTitle: addComponentGroup.title,
      component: addComponentKind,
      creditsTotal: total,
      creditsRemaining: total,
      isUnlimited: unlimited,
      expiresAt: dateInputToCreditExpires(addComponentExpires),
      paymentId: "manual_component",
      purchasedAt: new Date().toISOString(),
    });
    const { data, error } = await supabase
      .from("user_credits")
      .insert(insertRow)
      .select(USER_CREDIT_ADMIN_SELECT)
      .maybeSingle();
    setAddingComponent(false);
    if (error || !data) {
      console.error("add bundle component failed", error);
      toast.error(supabaseErrorMessage(error, "Could not add component"));
      return;
    }
    const inserted = data as CreditRow;
    const now = Date.now();
    if (isCreditActive(inserted, now)) {
      setCredits((prev) => {
        if (prev.some((c) => c.id === inserted.id)) return prev;
        return [...prev, inserted];
      });
    }
    setAddComponentGroup(null);
    toast.success("Component added");
    onProfileUpdated?.();
    void load();
  };

  const openEditCredit = (row: CreditRow) => {
    setEditCredit(row);
    const unlimited = row.is_unlimited === true;
    setEditUnlimited(unlimited);
    setEditRemaining(
      unlimited ? String(UNLIMITED_CREDIT_DISPLAY) : String(row.credits_remaining ?? 0),
    );
    setEditTotal(
      unlimited ? String(UNLIMITED_CREDIT_DISPLAY) : String(row.credits_total ?? 0),
    );
    setEditExpires(creditExpiresToDateInput(row.expires_at));
  };

  const saveEditCredit = async () => {
    if (!editCredit || !canManage) return;
    setSavingEdit(true);
    const unlimited = editUnlimited;
    const remaining = unlimited
      ? UNLIMITED_CREDIT_DISPLAY
      : Math.max(0, Math.trunc(Number(editRemaining)));
    const total = unlimited
      ? UNLIMITED_CREDIT_DISPLAY
      : Math.max(0, Math.trunc(Number(editTotal)));
    if (!unlimited && (!Number.isFinite(remaining) || !Number.isFinite(total))) {
      toast.error("Enter valid credit numbers.");
      setSavingEdit(false);
      return;
    }
    const expiresAt = dateInputToCreditExpires(editExpires);
    const { data, error } = await supabase
      .from("user_credits")
      .update({
        credits_remaining: remaining,
        credits_total: total,
        expires_at: expiresAt,
        is_unlimited: unlimited,
      })
      .eq("id", editCredit.id)
      .select(USER_CREDIT_ADMIN_SELECT)
      .maybeSingle();
    setSavingEdit(false);
    if (error || !data) {
      console.error("edit credit failed", error);
      toast.error(supabaseErrorMessage(error, "Could not save credit"));
      return;
    }
    const updated = data as CreditRow;
    const now = Date.now();
    setCredits((prev) => {
      const next = prev.map((c) => (c.id === updated.id ? updated : c));
      return next.filter((c) => isCreditActive(c, now));
    });
    setEditCredit(null);
    toast.success("Credit updated");
    onProfileUpdated?.();
  };

  const confirmTopUp = async () => {
    if (!topUpCredit || !canManage || topUpCredit.is_unlimited) return;
    const add = Math.trunc(Number(topUpAmount));
    if (!Number.isFinite(add) || add < 1) {
      toast.error("Enter at least 1 credit to add.");
      return;
    }
    setToppingUp(true);
    const rem = Math.trunc(Number(topUpCredit.credits_remaining ?? 0));
    const tot = Math.trunc(Number(topUpCredit.credits_total ?? 0));
    const { data, error } = await supabase
      .from("user_credits")
      .update({
        credits_remaining: rem + add,
        credits_total: tot + add,
      })
      .eq("id", topUpCredit.id)
      .select(USER_CREDIT_ADMIN_SELECT)
      .maybeSingle();
    setToppingUp(false);
    if (error || !data) {
      console.error("top up credit failed", error);
      toast.error(supabaseErrorMessage(error, "Could not top up credits"));
      return;
    }
    const updated = data as CreditRow;
    setCredits((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    const name = topUpCredit.product_name ?? "package";
    setTopUpCredit(null);
    setTopUpAmount("1");
    toast.success(`Added ${add} credits to ${name}`);
    onProfileUpdated?.();
  };

  const removeCredit = async () => {
    if (!removeCreditId || !canManage) return;
    const removedId = removeCreditId;
    setRemovingCredit(true);
    setRemoveCreditId(null);
    const { data, error } = await supabase
      .from("user_credits")
      .delete()
      .eq("id", removedId)
      .select("id");
    setRemovingCredit(false);
    if (error) {
      console.error("remove credit failed", error);
      const msg = error.message ?? "";
      const friendly = msg.includes("bookings_credit_id_fkey")
        ? "This package was used for a booking. It will be removed and past bookings will no longer link to it — try again after the update deploys."
        : supabaseErrorMessage(error, "Could not remove credit");
      toast.error(friendly);
      await load();
      return;
    }
    if (!data?.length) {
      toast.error("Package was not removed — you may not have permission.");
      await load();
      return;
    }
    setCredits((prev) => prev.filter((c) => c.id !== removedId));
    setCreditTransactions((prev) => prev.filter((tx) => tx.id !== removedId));
    toast.success("Package removed");
    onProfileUpdated?.();
  };

  const componentRowLabel = (row: CreditRow, bundleTitle: string) => {
    const name = row.product_name ?? "Component";
    const prefix = `${bundleTitle} - `;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
    if (name.includes(" - ")) return name.split(" - ").pop() ?? name;
    return name;
  };

  const renderCreditRow = (c: CreditRow, opts?: { bundleTitle?: string; nested?: boolean }) => {
    const totalNum = c.credits_total;
    const totalLabel =
      totalNum == null || !Number.isFinite(Number(totalNum)) ? "—" : String(totalNum);
    const remLabel = c.is_unlimited ? "∞" : String(c.credits_remaining ?? 0);
    const title = opts?.bundleTitle
      ? componentRowLabel(c, opts.bundleTitle)
      : (c.product_name ?? "Pass");
    const showMat = c.mat_access === true;
    const showTowel = c.towel_access === true;

    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm",
          opts?.nested ? "bg-background/60" : "rounded-lg border border-border bg-muted/30",
        )}
      >
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {c.is_unlimited ? (
              <span>Unlimited</span>
            ) : (
              <span>
                {remLabel} / {totalLabel} credits
              </span>
            )}
            {c.expires_at
              ? ` · Exp ${formatStudioDateOnly(c.expires_at)}`
              : " · No expiry"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.is_unlimited ? (
              <span className="inline-flex rounded-full bg-[#a3b693]/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#5f6b52]">
                Unlimited
              </span>
            ) : null}
            {showMat ? (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Mat
              </span>
            ) : null}
            {showTowel ? (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Towel
              </span>
            ) : null}
          </div>
          </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            disabled={!canManage}
            onClick={() => openEditCredit(c)}
          >
            <Pencil className="h-3 w-3 shrink-0" aria-hidden />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            disabled={!canManage || c.is_unlimited === true}
            onClick={() => {
              setTopUpCredit(c);
              setTopUpAmount("1");
            }}
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            Top up
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10"
            disabled={!canManage}
            onClick={() => setRemoveCreditId(c.id)}
          >
            <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
            Remove
          </Button>
        </div>
      </div>
    );
  };

  const addComponentAccessOnly =
    addComponentKind === "mat" || addComponentKind === "towel";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex h-full w-full max-w-full flex-col gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-2xl sm:rounded-l-2xl"
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
          <SheetHeader className="border-b border-border px-6 py-4 text-left">
            <SheetTitle className="font-display text-xl">{title}</SheetTitle>
          </SheetHeader>

          {loading || !profile ? (
            <div className="flex flex-1 flex-col gap-8 px-6 py-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <Skeleton className="mx-auto h-20 w-20 shrink-0 rounded-full sm:mx-0" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-24 rounded-full" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                  <div className="space-y-2 pt-2">
                    <Skeleton className="h-4 w-full max-w-md" />
                    <Skeleton className="h-4 w-full max-w-sm" />
                    <Skeleton className="h-4 w-full max-w-xs" />
                  </div>
                </div>
              </div>
              <section className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </section>
              <section className="space-y-3 border-t border-border pt-6">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </section>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-8 px-6 py-6">
              <section>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {profile.avatar_url?.trim() ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="mx-auto h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-border sm:mx-0"
                    />
                  ) : (
                    <div className="mx-auto grid h-20 w-20 shrink-0 place-content-center rounded-full bg-muted text-xl font-bold text-muted-foreground sm:mx-0">
                      {fullName
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <h3 className="font-display text-2xl font-bold leading-tight">{fullName}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                          {ROLE_LABEL[profile.role?.toLowerCase() ?? "customer"] ??
                            profile.role ??
                            "—"}
                        </span>
                        {(profile.secondary_roles ?? [])
                          .filter((r) => isAllRole(r.toLowerCase()) && r.toLowerCase() !== (profile.role ?? "").toLowerCase())
                          .map((r) => (
                            <span
                              key={r}
                              className="inline-flex rounded-full border border-[#a3b693]/50 bg-[#e8efe3]/80 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#4a6b3c]"
                            >
                              {ROLE_LABEL[r.toLowerCase()] ?? r}
                            </span>
                          ))}
                        {canManage ? (
                          <Popover open={secondaryPopoverOpen} onOpenChange={setSecondaryPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                              >
                                <Pencil className="h-3 w-3" aria-hidden />
                                Edit secondary roles
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80" align="start">
                              <p className="mb-2 text-xs text-muted-foreground">
                                Extra role tags (primary is above). Same person can wear multiple hats.
                              </p>
                              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                                {ALL_ROLES.filter(
                                  (r) => r !== (profile.role ?? "customer").toLowerCase(),
                                ).map((r) => (
                                  <label
                                    key={r}
                                    className="flex cursor-pointer items-center gap-2 text-sm"
                                  >
                                    <Checkbox
                                      checked={secondaryDraft.includes(r)}
                                      onCheckedChange={(checked) => {
                                        setSecondaryDraft((prev) =>
                                          checked === true
                                            ? [...prev, r]
                                            : prev.filter((x) => x !== r),
                                        );
                                      }}
                                    />
                                    {ROLE_LABEL[r]}
                                  </label>
                                ))}
                              </div>
                              <Button
                                type="button"
                                className="mt-3 w-full bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                                disabled={savingSecondary}
                                onClick={() => void saveSecondaryRoles()}
                              >
                                {savingSecondary ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Save secondary roles
                              </Button>
                            </PopoverContent>
                          </Popover>
                        ) : null}
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
                            profile.is_active !== false
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {profile.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                    <dl className="grid gap-2 text-sm">
                      <div className="flex gap-2">
                        <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" /> Email
                        </dt>
                        <dd className="min-w-0 break-all">
                          <span className="block">{profile.email ?? "—"}</span>
                          {canManage && profile.email?.trim() ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-2 text-xs"
                              onClick={() => setSendEmailOpen(true)}
                            >
                              <Mail className="mr-1.5 h-3 w-3" />
                              Send email
                            </Button>
                          ) : null}
                          {canManage && profile.email?.trim() && emailVerified !== true ? (
                            <div className="mt-2 space-y-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="text-xs"
                                disabled={resendBusy}
                                onClick={() => void resendVerificationEmail()}
                              >
                                {resendBusy ? (
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                ) : null}
                                Resend verification email
                              </Button>
                              <p className="text-[11px] leading-snug text-muted-foreground">
                                Uses Supabase Auth email settings. If nothing arrives, confirm Auth →
                                email confirmations are enabled and SMTP (e.g. Resend) allows your domain.
                              </p>
                            </div>
                          ) : null}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" /> Phone
                        </dt>
                        <dd>{profile.phone?.trim() || "—"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" /> DOB
                        </dt>
                        <dd>
                          {profile.date_of_birth
                            ? formatStudioDateOnly(profile.date_of_birth)
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                          <User className="h-3.5 w-3.5" /> Joined
                        </dt>
                        <dd>
                          {profile.created_at
                            ? formatStudioDateNumeric(profile.created_at)
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                          <Shield className="h-3.5 w-3.5" /> Waiver
                        </dt>
                        <dd>
                          {profile.waiver_accepted_at
                            ? `Signed ${formatStudioDateOnly(profile.waiver_accepted_at)}`
                            : "Not signed"}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="customer-active"
                          checked={profile.is_active !== false}
                          disabled={!canManage || togglingActive}
                          onCheckedChange={(v) => void setActive(v)}
                        />
                        <Label htmlFor="customer-active" className="text-sm font-medium">
                          Active member
                        </Label>
                      </div>
                      <div className="grid gap-1.5 sm:min-w-[200px]">
                        <Label className="text-xs">Role</Label>
                        <Select
                          value={roleForSelect(roleDraft)}
                          onValueChange={onRoleSelectChange}
                          disabled={!canManage || savingRole}
                        >
                          <SelectTrigger>
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
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="border-t border-border pt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-display text-lg font-semibold">Credits &amp; packages</h4>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                    disabled={!canManage}
                    onClick={() => openAssignPackage()}
                  >
                    <Package className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Assign package
                  </Button>
                </div>
                {credits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active credits.</p>
                ) : (
                  <ul className="space-y-3">
                    {creditDisplayEntries.map((entry) => {
                      if (entry.kind === "standalone") {
                        return (
                          <li key={entry.row.id}>{renderCreditRow(entry.row)}</li>
                        );
                      }
                      const { group } = entry;
                      return (
                        <li
                          key={group.productId}
                          className="overflow-hidden rounded-lg border border-border bg-muted/20"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                            <p className="font-display text-sm font-semibold">{group.title}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 px-2 text-xs"
                              disabled={!canManage}
                              onClick={() =>
                                openAddComponent(group.productId, group.title, group.rows)
                              }
                            >
                              <Plus className="h-3 w-3 shrink-0" aria-hidden />
                              Add component
                            </Button>
                          </div>
                          <ul className="divide-y divide-border">
                            {group.rows.map((c) => (
                              <li key={c.id}>
                                {renderCreditRow(c, {
                                  bundleTitle: group.title,
                                  nested: true,
                                })}
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <MemberFeesSection profileId={profile.id} canWaive={canManage} />

              <section className="border-t border-border pt-6">
                <h4 className="mb-3 font-display text-lg font-semibold">Credit transaction history</h4>
                {creditTransactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No credit rows yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 font-medium">Assigned</th>
                          <th className="px-3 py-2 font-medium">Credits total</th>
                          <th className="px-3 py-2 font-medium">Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditTransactions.map((tx) => {
                          const pay = (tx.yoco_payment_id ?? "").trim();
                          const payLabel =
                            !pay || pay === "manual_assignment"
                              ? "Manual / comp"
                              : pay.length > 24
                                ? `${pay.slice(0, 12)}…${pay.slice(-6)}`
                                : pay;
                          const assigned =
                            tx.created_at != null ? formatStudioDateTime(tx.created_at) : "—";
                          return (
                            <tr key={tx.id} className="border-t border-border">
                              <td className="px-3 py-2 font-medium">{tx.product_name ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{assigned}</td>
                              <td className="px-3 py-2 tabular-nums">
                                {tx.credits_total == null ? "—" : String(tx.credits_total)}
                              </td>
                              <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">
                                {payLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="border-t border-border pt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-display text-lg font-semibold">Booking history</h4>
                  <Select value={bookingStatusFilter} onValueChange={setBookingStatusFilter}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Filter status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="attended">Attended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no-show">No-show</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {filteredBookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bookings match this filter.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Class</th>
                          <th className="px-3 py-2 font-medium">Date &amp; time</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBookings.map((b) => {
                          const cls = oneClass(b.classes);
                          const starts = cls?.starts_at ? new Date(cls.starts_at) : null;
                          const dateStr = starts ? formatStudioDateNumeric(starts) : "—";
                          const timeStr = starts ? formatStudioTime12Upper(starts) : "—";
                          return (
                            <tr key={b.id} className="border-t border-border">
                              <td className="px-3 py-2 font-medium">{cls?.name ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {dateStr}
                                <span className="block text-xs">{timeStr}</span>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                                    b.status === "attended" &&
                                      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40",
                                    b.status === "confirmed" && "bg-neutral-100 text-neutral-800",
                                    b.status === "cancelled" && "bg-destructive/15 text-destructive",
                                    b.status === "no-show" && "bg-amber-500/15 text-amber-800",
                                  )}
                                >
                                  {b.status}
                                </span>
                              </td>
                              <td className="max-w-[120px] truncate px-3 py-2 text-muted-foreground">
                                {(b.payment_method ?? "—").replace(/_/g, " ")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="border-t border-border pt-6">
                <h4 className="mb-3 font-display text-lg font-semibold">Admin notes</h4>
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  disabled={!canManage}
                  rows={5}
                  placeholder="Internal notes (not visible to the member)…"
                  className="resize-y"
                />
                <Button
                  type="button"
                  className="mt-3"
                  disabled={!canManage || savingNotes}
                  onClick={() => void saveNotes()}
                >
                  {savingNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save notes
                </Button>
              </section>

              {canManage && !profile.deleted_at ? (
                <DeleteMemberSection
                  profileId={profile.id}
                  memberName={fullName}
                  memberRole={profile.role}
                  onDeleted={() => {
                    onProfileUpdated?.();
                    onOpenChange(false);
                  }}
                />
              ) : null}
              {profile.deleted_at ? (
                <p className="border-t border-border pt-6 text-sm text-muted-foreground">
                  Deleted on {new Date(profile.deleted_at).toLocaleDateString("en-ZA")}. Login removed
                  and contact details wiped.
                </p>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {assignOpen ? (
        <AssignPackageDialog
          open
          onOpenChange={setAssignOpen}
          target={assignTarget}
          canAssign={canManage}
          includeAddons
          onCreditInserted={(row: AssignedCreditRow, profileId) => {
            if (profileId !== customerId) return;
            const now = Date.now();
            const nextRow: CreditRow = {
              id: row.id,
              product_id: row.product_id ?? null,
              product_name: row.product_name,
              category: row.category ?? null,
              credits_remaining: row.credits_remaining,
              credits_total: row.credits_total,
              is_unlimited: row.is_unlimited,
              expires_at: row.expires_at,
              mat_access: row.mat_access ?? false,
              towel_access: row.towel_access ?? false,
            };
            if (!isCreditActive(nextRow, now)) return;
            setCredits((prev) => {
              if (prev.some((c) => c.id === nextRow.id)) return prev;
              return [...prev, nextRow];
            });
          }}
          onAssigned={() => {
            void load();
            onProfileUpdated?.();
          }}
        />
      ) : null}

      <SendMemberEmailDialog
        open={sendEmailOpen}
        onOpenChange={setSendEmailOpen}
        target={
          profile?.email?.trim()
            ? {
                displayName:
                  [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
                  "Member",
                email: profile.email.trim(),
              }
            : null
        }
      />

      <AlertDialog
        open={roleConfirmOpen}
        onOpenChange={(o) => {
          setRoleConfirmOpen(o);
          if (!o) {
            setPendingRole(null);
            if (profile) setRoleDraft((profile.role ?? "customer").toLowerCase());
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              This will give them admin access. Only staff with the correct responsibilities should
              receive roles other than Customer. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingRole(null);
                if (profile) setRoleDraft((profile.role ?? "customer").toLowerCase());
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              onClick={(e) => {
                e.preventDefault();
                confirmRoleUpgrade();
              }}
            >
              Save role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={addComponentGroup !== null}
        onOpenChange={(o) => {
          if (!o) setAddComponentGroup(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add credits to this package</DialogTitle>
          </DialogHeader>
          {addComponentGroup ? (
            <div className="grid gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Add a component to{" "}
                <span className="font-medium text-foreground">{addComponentGroup.title}</span>.
              </p>
              <div className="grid gap-1.5">
                <Label>Type</Label>
                <Select
                  value={addComponentKind}
                  onValueChange={(v) => {
                    const kind = v as BundleComponentKind;
                    setAddComponentKind(kind);
                    if (kind === "mat" || kind === "towel") {
                      setAddComponentUnlimited(true);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUNDLE_COMPONENT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <Label htmlFor="add-component-unlimited">Unlimited</Label>
                <Switch
                  id="add-component-unlimited"
                  checked={addComponentUnlimited || addComponentAccessOnly}
                  disabled={addComponentAccessOnly}
                  onCheckedChange={setAddComponentUnlimited}
                />
              </div>
              {!addComponentUnlimited && !addComponentAccessOnly ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="add-component-credits">Number of credits</Label>
                  <Input
                    id="add-component-credits"
                    type="number"
                    min={1}
                    value={addComponentCredits}
                    onChange={(e) => setAddComponentCredits(e.target.value)}
                  />
                </div>
              ) : addComponentAccessOnly ? (
                <p className="text-xs text-muted-foreground">
                  Mat and towel components grant ongoing access for this package period.
                </p>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="add-component-expires">Expiry date</Label>
                <Input
                  id="add-component-expires"
                  type="date"
                  value={addComponentExpires}
                  onChange={(e) => setAddComponentExpires(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddComponentGroup(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              disabled={addingComponent || !canManage}
              onClick={() => void confirmAddComponent()}
            >
              {addingComponent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editCredit !== null}
        onOpenChange={(o) => {
          if (!o) setEditCredit(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit package</DialogTitle>
          </DialogHeader>
          {editCredit ? (
            <div className="grid gap-4 py-2">
              <p className="text-sm font-medium">{editCredit.product_name ?? "Pass"}</p>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <Label htmlFor="edit-unlimited">Unlimited</Label>
                <Switch
                  id="edit-unlimited"
                  checked={editUnlimited}
                  onCheckedChange={(v) => {
                    setEditUnlimited(v);
                    if (v) {
                      setEditRemaining(String(UNLIMITED_CREDIT_DISPLAY));
                      setEditTotal(String(UNLIMITED_CREDIT_DISPLAY));
                    }
                  }}
                />
              </div>
              {!editUnlimited ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-remaining">Credits remaining</Label>
                    <Input
                      id="edit-remaining"
                      type="number"
                      min={0}
                      value={editRemaining}
                      onChange={(e) => setEditRemaining(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-total">Credits total</Label>
                    <Input
                      id="edit-total"
                      type="number"
                      min={0}
                      value={editTotal}
                      onChange={(e) => setEditTotal(e.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="edit-expires">Expiry date</Label>
                <Input
                  id="edit-expires"
                  type="date"
                  value={editExpires}
                  onChange={(e) => setEditExpires(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditCredit(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              disabled={savingEdit || !canManage}
              onClick={() => void saveEditCredit()}
            >
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={topUpCredit !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTopUpCredit(null);
            setTopUpAmount("1");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Top up credits</DialogTitle>
          </DialogHeader>
          {topUpCredit ? (
            <div className="grid gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Add credits to <span className="font-medium text-foreground">{topUpCredit.product_name ?? "this package"}</span>
                . Current balance: {topUpCredit.credits_remaining ?? 0} / {topUpCredit.credits_total ?? 0}
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="top-up-amount">Credits to add</Label>
                <Input
                  id="top-up-amount"
                  type="number"
                  min={1}
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTopUpCredit(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              disabled={toppingUp || !canManage}
              onClick={() => void confirmTopUp()}
            >
              {toppingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeCreditId !== null} onOpenChange={(o) => !o && setRemoveCreditId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove package?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removeCreditTarget?.product_name ?? "this package"} from {fullName}? This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removingCredit}
              onClick={(e) => {
                e.preventDefault();
                void removeCredit();
              }}
            >
              {removingCredit ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
