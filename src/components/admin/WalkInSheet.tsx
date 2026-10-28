import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { pickNextUpcomingClassId } from "@/lib/checkInUpcoming";
import {
  bookingConfirmationEmailData,
  bookingConfirmationTemplateForClassType,
} from "@/lib/bookingConfirmationEmail";
import { isBookableClassCredit } from "@/lib/bookingCredits";
import { userCreditCoversClassType } from "@/lib/allowedClassTypes";
import { isBookableMember } from "@/lib/bookableMembers";
import { isUserCreditActiveNow, userCreditPillLabel } from "@/lib/activeUserCredits";
import { walkInCheckInToastMessage } from "@/lib/flowPoints";
import { LIABILITY_WAIVER } from "@/lib/liabilityWaiver";
import { supabase } from "@/lib/supabase";
import { formatStudioDateTime } from "@/lib/timezone";
import { edgeFunctionErrorMessage, supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth";
import { canSeeMemberPrivateDetails } from "@/lib/roleAccess";

const SAGE = "#a3b693";
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LEN = 2;

type WalkInMode = "existing" | "new";

type FutureClassRow = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  class_type: string;
  guide_name: string | null;
  location: string | null;
};

type MemberHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  secondary_roles: string[] | null;
  waiver_accepted_at: string | null;
};

type CreditOption = {
  id: string;
  product_name: string | null;
  credits_remaining: number | null;
  is_unlimited: boolean | null;
  expires_at: string | null;
  allowed_class_types: string[] | null;
  category: string | null;
  mat_access?: boolean | null;
  towel_access?: boolean | null;
};

function formatClassOptionLabel(c: FutureClassRow): string {
  const when = formatStudioDateTime(c.starts_at, {
    weekday: "short",
    hour12: true,
  });
  return `${c.name} · ${when}`;
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Contact line under a member: email for Director/Management/Marketing, phone for everyone else. */
function memberContact(m: Pick<MemberHit, "email" | "phone">, showPrivate: boolean, empty: string): string {
  if (showPrivate) return m.email?.trim() || empty;
  return m.phone?.trim() || empty;
}

function memberName(m: Pick<MemberHit, "first_name" | "last_name">): string {
  return [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || "Member";
}

function memberLabel(m: Pick<MemberHit, "first_name" | "last_name" | "email">): string {
  const name = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim();
  return name || m.email?.trim() || "Member";
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
};

export function WalkInSheet({ open, onOpenChange, onDone }: Props) {
  const { profile: viewer } = useAuth();
  const showPrivate = canSeeMemberPrivateDetails(viewer);
  const [mode, setMode] = useState<WalkInMode>("existing");

  const [memberQuery, setMemberQuery] = useState("");
  const debouncedMemberQuery = useDebouncedValue(memberQuery.trim(), SEARCH_DEBOUNCE_MS);
  const [memberHits, setMemberHits] = useState<MemberHit[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberHit | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const [classId, setClassId] = useState("");
  const [futureClasses, setFutureClasses] = useState<FutureClassRow[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  const [credits, setCredits] = useState<CreditOption[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(false);
  /** `"cash"` = comp / no credit; otherwise a user_credits id. */
  const [paymentChoice, setPaymentChoice] = useState<string>("cash");

  const [waiverAgreed, setWaiverAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setMemberQuery("");
    setMemberHits([]);
    setSelectedMember(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setClassId("");
    setWaiverAgreed(false);
    setCredits([]);
    setPaymentChoice("cash");
    setFutureClasses([]);

    void (async () => {
      setLoadingClasses(true);
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, starts_at, ends_at, class_type, guide_name, location")
        .eq("is_cancelled", false)
        .gte("starts_at", nowIso)
        .order("starts_at")
        .limit(250);

      if (error) {
        console.error("walk-in: future classes load failed", error);
        toast.error(supabaseErrorMessage(error, "Could not load upcoming classes"));
        setFutureClasses([]);
        setLoadingClasses(false);
        return;
      }

      const rows = (data ?? []) as FutureClassRow[];
      setFutureClasses(rows);
      const defaultId = pickNextUpcomingClassId(rows);
      setClassId(defaultId ?? rows[0]?.id ?? "");
      setLoadingClasses(false);
    })();
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "existing" || selectedMember) {
      setMemberHits([]);
      setSearchingMembers(false);
      return;
    }
    if (debouncedMemberQuery.length < SEARCH_MIN_LEN) {
      setMemberHits([]);
      setSearchingMembers(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setSearchingMembers(true);
      const pat = `%${debouncedMemberQuery}%`;
      const selectCols =
        "id, first_name, last_name, email, phone, role, secondary_roles, waiver_accepted_at";
      const [fnRes, lnRes, emRes] = await Promise.all([
        supabase.from("profiles").select(selectCols).ilike("first_name", pat).limit(12),
        supabase.from("profiles").select(selectCols).ilike("last_name", pat).limit(12),
        supabase.from("profiles").select(selectCols).ilike("email", pat).limit(12),
      ]);

      if (cancelled) return;

      if (fnRes.error || lnRes.error || emRes.error) {
        console.error("walk-in member search failed", fnRes.error ?? lnRes.error ?? emRes.error);
        toast.error("Could not search members");
        setMemberHits([]);
        setSearchingMembers(false);
        return;
      }

      const byId = new Map<string, MemberHit>();
      for (const raw of [...(fnRes.data ?? []), ...(lnRes.data ?? []), ...(emRes.data ?? [])]) {
        const row = raw as MemberHit;
        if (!isBookableMember(row)) continue;
        byId.set(row.id, row);
      }
      setMemberHits([...byId.values()].slice(0, 12));
      setSearchingMembers(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, selectedMember, debouncedMemberQuery]);

  const selectedClass = useMemo(
    () => futureClasses.find((c) => c.id === classId) ?? null,
    [futureClasses, classId],
  );

  useEffect(() => {
    if (!open || mode !== "existing" || !selectedMember?.id) {
      setCredits([]);
      setPaymentChoice("cash");
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoadingCredits(true);
      const { data, error } = await supabase
        .from("user_credits")
        .select(
          "id, product_name, credits_remaining, is_unlimited, expires_at, allowed_class_types, category, mat_access, towel_access",
        )
        .eq("profile_id", selectedMember.id)
        .is("refunded_at", null);

      if (cancelled) return;

      if (error) {
        console.error("walk-in credits load failed", error);
        toast.error(supabaseErrorMessage(error, "Could not load member credits"));
        setCredits([]);
        setPaymentChoice("cash");
        setLoadingCredits(false);
        return;
      }

      const classType = selectedClass?.class_type ?? "";
      const nowMs = Date.now();
      const eligible = ((data ?? []) as CreditOption[]).filter((c) => {
        if (!isBookableClassCredit(c)) return false;
        if (!isUserCreditActiveNow(c, nowMs)) return false;
        if (
          classType &&
          !userCreditCoversClassType({
            category: c.category,
            allowed_class_types: c.allowed_class_types,
            classType,
          })
        ) {
          return false;
        }
        return true;
      });

      setCredits(eligible);
      setPaymentChoice(eligible[0]?.id ?? "cash");
      setLoadingCredits(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, selectedMember?.id, selectedClass?.class_type]);

  const needsWaiver =
    mode === "new" || (mode === "existing" && selectedMember && !selectedMember.waiver_accepted_at);

  const memberDetailsComplete = useMemo(() => {
    if (mode === "existing") return Boolean(selectedMember?.id);
    return (
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      isValidEmail(email)
    );
  }, [mode, selectedMember, firstName, lastName, email]);

  const canCheckIn =
    memberDetailsComplete &&
    Boolean(classId) &&
    (!needsWaiver || waiverAgreed) &&
    !saving &&
    !loadingClasses &&
    futureClasses.length > 0 &&
    !(mode === "existing" && loadingCredits);

  const clearSelectedMember = () => {
    setSelectedMember(null);
    setMemberQuery("");
    setMemberHits([]);
    setCredits([]);
    setPaymentChoice("cash");
    setWaiverAgreed(false);
  };

  const submit = async () => {
    if (!classId) {
      toast.error("Choose a class.");
      return;
    }
    if (needsWaiver && !waiverAgreed) {
      toast.error("The member must agree to the waiver before check-in.");
      return;
    }

    const payment_method = paymentChoice === "cash" ? "cash" : "credit";
    const credit_id = paymentChoice === "cash" ? null : paymentChoice;

    setSaving(true);

    try {
      let body: Record<string, unknown>;
      let displayName: string;
      let emailForConfirm: string | null = null;

      if (mode === "existing") {
        if (!selectedMember?.id) {
          toast.error("Select an existing member.");
          setSaving(false);
          return;
        }
        displayName = showPrivate ? memberLabel(selectedMember) : memberName(selectedMember);
        emailForConfirm = selectedMember.email?.trim() || null;
        body = {
          profile_id: selectedMember.id,
          class_id: classId,
          payment_method,
          credit_id,
        };
      } else {
        const fn = firstName.trim();
        const ln = lastName.trim();
        const em = email.trim().toLowerCase();
        if (!fn || !ln || !em) {
          toast.error("First name, last name, and email are required.");
          setSaving(false);
          return;
        }
        if (!isValidEmail(em)) {
          toast.error("Enter a valid email address.");
          setSaving(false);
          return;
        }
        displayName = `${fn} ${ln}`.trim();
        emailForConfirm = em;
        body = {
          first_name: fn,
          last_name: ln,
          email: em,
          class_id: classId,
          payment_method: "cash",
          credit_id: null,
        };
      }

      console.log("[walk-in] submit start", { mode, body });

      const { data, error: fnErr } = await supabase.functions.invoke("walk-in-checkin", {
        body,
      });

      if (fnErr) {
        console.error("[walk-in] error", fnErr, data);
        toast.error(await edgeFunctionErrorMessage(fnErr, data, "Walk-in check-in failed"));
        setSaving(false);
        return;
      }

      const result = data as {
        ok?: boolean;
        error?: string;
        role?: string;
      };

      if (!result?.ok) {
        console.error("[walk-in] error", result);
        toast.error(result.error ?? "Walk-in check-in failed");
        setSaving(false);
        return;
      }

      if (emailForConfirm && selectedClass?.starts_at) {
        await supabase.functions.invoke("send-email", {
          body: {
            to: emailForConfirm,
            template: bookingConfirmationTemplateForClassType(selectedClass.class_type),
            data: bookingConfirmationEmailData({
              className: selectedClass.name,
              startsAtIso: selectedClass.starts_at,
              guideName: selectedClass.guide_name,
              location: selectedClass.location,
              matAddon: false,
              towelAddon: false,
            }),
          },
        });
      }

      toast.success(walkInCheckInToastMessage(displayName, result.role ?? "customer"));
      setSaving(false);
      onOpenChange(false);
      onDone();
    } catch (err) {
      console.error("[walk-in] error", err);
      toast.error(supabaseErrorMessage(err, "Walk-in check-in failed"));
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Walk-in check-in</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("existing");
                setWaiverAgreed(false);
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                mode === "existing"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Existing member
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("new");
                clearSelectedMember();
                setWaiverAgreed(false);
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                mode === "new"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              New person
            </button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-3">
              {selectedMember ? (
                <div className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card px-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      {showPrivate ? memberLabel(selectedMember) : memberName(selectedMember)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {memberContact(selectedMember, showPrivate, showPrivate ? "No email on file" : "No phone on file")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2"
                    onClick={clearSelectedMember}
                    aria-label="Clear selected member"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="walkin-member-search">Search member</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="walkin-member-search"
                      value={memberQuery}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      placeholder="Name or email…"
                      className="pl-9"
                      autoComplete="off"
                    />
                    {searchingMembers ? (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Type at least 2 characters. Includes secondary-role customers.
                  </p>
                  {debouncedMemberQuery.length >= SEARCH_MIN_LEN && !searchingMembers ? (
                    memberHits.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                        No matching members. Switch to New person if this is a first-timer.
                      </p>
                    ) : (
                      <ul className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {memberHits.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                              onClick={() => {
                                setSelectedMember(m);
                                setMemberQuery("");
                                setMemberHits([]);
                                setWaiverAgreed(false);
                              }}
                            >
                              <span className="font-medium">{showPrivate ? memberLabel(m) : memberName(m)}</span>
                              <span className="text-xs text-muted-foreground">
                                {memberContact(m, showPrivate, "—")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="walkin-fn">
                  First name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="walkin-fn"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="walkin-ln">
                  Last name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="walkin-ln"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="walkin-email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="walkin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="grid gap-1.5">
            <Label>Class</Label>
            <Select value={classId} onValueChange={setClassId} disabled={loadingClasses}>
              <SelectTrigger>
                <SelectValue
                  placeholder={loadingClasses ? "Loading classes…" : "Pick a class"}
                />
              </SelectTrigger>
              <SelectContent>
                {futureClasses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatClassOptionLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Defaults to the next upcoming class today; all future classes are listed.
            </p>
          </div>

          {mode === "existing" && selectedMember ? (
            <div className="grid gap-1.5">
              <Label>Payment</Label>
              {loadingCredits ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading credits…
                </p>
              ) : (
                <Select value={paymentChoice} onValueChange={setPaymentChoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {credits.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {userCreditPillLabel(c)}
                      </SelectItem>
                    ))}
                    <SelectItem value="cash">Comp — no credit (cash)</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {!loadingCredits && credits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No eligible credits for this class — will check in as cash/comp.
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === "new" ? (
            <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              New person walk-ins are checked in as cash/comp. Use Existing member to deduct a pack.
            </p>
          ) : null}

          {memberDetailsComplete && needsWaiver ? (
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                One Flow waiver
              </p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {LIABILITY_WAIVER}
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={waiverAgreed}
                  onCheckedChange={(v) => setWaiverAgreed(v === true)}
                  className="mt-0.5"
                />
                <span>Member has read and agrees to the waiver</span>
              </label>
            </div>
          ) : null}
        </div>
        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </SheetClose>
          <Button
            type="button"
            disabled={!canCheckIn}
            onClick={() => void submit()}
            className="gap-2 text-white hover:opacity-90"
            style={{ backgroundColor: SAGE }}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Check className="h-4 w-4 shrink-0" aria-hidden />
            )}
            Check in
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
