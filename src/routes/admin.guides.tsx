import { createFileRoute } from "@tanstack/react-router";
import { effectiveRole } from "@/lib/roleAccess";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, UserCog, Filter, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getUser, supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/auth";
import { edgeFunctionErrorMessage, isValidEmail, supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  AssignPackageDialog,
  type AssignPackageTarget,
} from "@/components/admin/AssignPackageDialog";
import { GuideActivePackagePills } from "@/components/admin/GuideActivePackagePills";
import {
  fetchActiveUserCreditsByProfileIds,
  type GuideCreditPillRow,
} from "@/lib/activeUserCredits";
import {
  CLASS_TYPE_SLUG_LABEL,
  GUIDE_DISCIPLINE_SLUGS,
  humanizeClassTypeSlug,
  isAllowedClassTypeSlug,
  type AllowedClassTypeSlug,
} from "@/lib/allowedClassTypes";

export const Route = createFileRoute("/admin/guides")({
  head: () => ({
    meta: [{ title: "Guides — One Flow Admin" }],
  }),
  component: GuidesPage,
});

const SAGE = "#a3b693";
const SAGE_BORDER = "border-[#c5d4b8]/80";

/** Stored in `guides.disciplines` text[] — slug values only (full class_type enum). */
type GuideDisciplineSlug = AllowedClassTypeSlug;

/**
 * Read through to the canonical record rather than snapshotting it: labels are hydrated
 * from `class_types` at boot, so renaming "Power" in Master must relabel the discipline
 * checkbox here too.
 */
function guideDisciplineLabel(slug: GuideDisciplineSlug): string {
  return CLASS_TYPE_SLUG_LABEL[slug] ?? humanizeClassTypeSlug(slug);
}

function disciplineFilterKeys(): { key: GuideDisciplineSlug; label: string }[] {
  return GUIDE_DISCIPLINE_SLUGS.map((key) => ({ key, label: guideDisciplineLabel(key) }));
}
type RoleType = "director" | "management" | "guide" | "customer" | "other";

type GuideSortKey = "name_asc" | "name_desc" | "joined_asc" | "active_first";

type GuideRow = {
  /** `guides.id` */
  guideId: string;
  /** `profiles.id` (same as `guides.profile_id`) — used for edits, packages, toggles. */
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  profileRole: string | null;
  bio: string | null;
  photoUrl: string | null;
  fullName: string;
  disciplines: string[];
  active: boolean;
  classesThisWeek: number;
  joinedAt: string | null;
  packages: GuideCreditPillRow[];
};

type GuideTableRow = {
  id: string;
  is_active: boolean | null;
  bio: string | null;
  disciplines: unknown;
  photo_url: string | null;
  profile_id: string;
};

type GuideProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string | null;
};

function disciplineValueToSlug(value: string): GuideDisciplineSlug | null {
  const raw = value.trim();
  if (!raw) return null;
  const v = raw.toLowerCase().replace(/\s+/g, "_");
  if (v === "sauna" || v === "sauna_journey") return "sauna_journey";
  if ((GUIDE_DISCIPLINE_SLUGS as readonly string[]).includes(v)) return v as GuideDisciplineSlug;
  const fromLabel = GUIDE_DISCIPLINE_SLUGS.find(
    (slug) => guideDisciplineLabel(slug).toLowerCase() === raw.toLowerCase(),
  );
  return fromLabel ?? null;
}

function disciplinesRawToSlugs(raw: unknown): GuideDisciplineSlug[] {
  if (!Array.isArray(raw)) return [];
  const out: GuideDisciplineSlug[] = [];
  for (const item of raw) {
    const slug = disciplineValueToSlug(String(item));
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

function guideRowDisciplineKeys(disciplines: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of disciplines) {
    const slug = disciplineValueToSlug(raw);
    if (slug) out.add(slug);
    else if (isAllowedClassTypeSlug(raw)) out.add(raw);
    else if (raw.toLowerCase().includes("sauna")) out.add("sauna_journey");
  }
  return out;
}

function GuideDisciplinePills({ disciplines }: { disciplines: string[] }) {
  const slugs = disciplinesRawToSlugs(disciplines);
  if (slugs.length === 0) {
    return <span className="text-xs text-muted-foreground">No disciplines set</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {slugs.map((slug) => (
        <span
          key={slug}
          className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
        >
          {guideDisciplineLabel(slug)}
        </span>
      ))}
    </div>
  );
}

function titleCase(value: string): string {
  const v = value.trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function roleType(role: string | null | undefined): RoleType {
  const r = (role ?? "").toLowerCase();
  if (r === "director") return "director";
  if (r === "management") return "management";
  if (r === "guide") return "guide";
  if (r === "customer") return "customer";
  return "other";
}

function initials(firstName: string, lastName: string, email: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (first || last) return `${first.charAt(0) || ""}${last.charAt(0) || ""}`.toUpperCase() || "G";
  return email.charAt(0).toUpperCase() || "G";
}

function GuidesPage() {
  const { user, profile } = useAuth();
  const viewerRole = roleType(effectiveRole(profile));
  const [rows, setRows] = useState<GuideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [disciplines, setDisciplines] = useState<GuideDisciplineSlug[]>([]);
  const [active, setActive] = useState(true);
  const [sort, setSort] = useState<GuideSortKey>("name_asc");
  const [activeListFilter, setActiveListFilter] = useState<"all" | "active" | "inactive">("all");
  const [disciplineFilters, setDisciplineFilters] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignPackageTarget | null>(null);

  const resetForm = useCallback(() => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setDisciplines([]);
    setActive(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setEditingId(null);
    setEditingGuideId(null);
    resetForm();
  }, [resetForm]);

  const populateForm = useCallback((row: GuideRow) => {
    setFirstName(row.firstName);
    setLastName(row.lastName);
    setEmail(row.email);
    setDisciplines(disciplinesRawToSlugs(row.disciplines));
    setActive(row.active);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }

    const weekStart = new Date();
    const day = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [guidesRes, classesRes] = await Promise.all([
      supabase
        .from("guides")
        .select("id, is_active, bio, disciplines, photo_url, profile_id")
        .order("id"),
      supabase
        .from("classes")
        .select("guide_name")
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .eq("is_cancelled", false),
    ]);

    const { data: guidesData, error: guidesError } = guidesRes;
    console.log("guides:", guidesData, guidesError);

    if (guidesError) {
      console.error("guides fetch error:", guidesError);
      toast.error(supabaseErrorMessage(guidesError, "Could not load guides"));
      setRows([]);
      setLoading(false);
      return;
    }

    if (classesRes.error) {
      console.error(classesRes.error);
      toast.error(supabaseErrorMessage(classesRes.error, "Could not load weekly classes"));
    }

    const guideRows = (guidesData ?? []) as GuideTableRow[];
    const profileIds = [
      ...new Set(guideRows.map((g) => g.profile_id).filter((id): id is string => Boolean(id))),
    ];

    const profilesById = new Map<string, GuideProfileRow>();
    if (profileIds.length > 0) {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, phone, avatar_url, created_at")
        .in("id", profileIds);

      console.log("guide profiles:", profilesData, profilesError);

      if (profilesError) {
        console.error("guide profiles fetch error:", profilesError);
        toast.error(supabaseErrorMessage(profilesError, "Could not load guide profiles"));
      } else {
        for (const p of (profilesData ?? []) as GuideProfileRow[]) {
          profilesById.set(String(p.id), p);
        }
      }
    }

    const classCountByGuideName = new Map<string, number>();
    for (const c of (classesRes.data ?? []) as { guide_name: string | null }[]) {
      const key = (c.guide_name ?? "").trim().toLowerCase();
      if (!key) continue;
      classCountByGuideName.set(key, (classCountByGuideName.get(key) ?? 0) + 1);
    }

    const mapped: Omit<GuideRow, "packages">[] = [];
    for (const guide of guideRows) {
      const profile = profilesById.get(String(guide.profile_id)) ?? null;

      const firstName = titleCase(profile?.first_name ?? "");
      const lastName = titleCase(profile?.last_name ?? "");
      const fullName = `${firstName} ${lastName}`.trim() || "Guide";
      const classesThisWeek = classCountByGuideName.get(fullName.toLowerCase()) ?? 0;

      mapped.push({
        guideId: String(guide.id),
        id: String(guide.profile_id),
        firstName,
        lastName,
        email: (profile?.email ?? "").trim(),
        phone: (profile?.phone ?? "").trim(),
        avatarUrl: profile?.avatar_url ?? null,
        profileRole: null,
        bio: guide.bio ?? null,
        photoUrl: guide.photo_url ?? null,
        fullName,
        disciplines: disciplinesRawToSlugs(guide.disciplines),
        active: guide.is_active !== false,
        classesThisWeek,
        joinedAt: profile?.created_at ?? null,
      });
    }

    mapped.sort((a, b) =>
      a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" }),
    );

    const creditMap = await fetchActiveUserCreditsByProfileIds(mapped.map((r) => r.id));
    const withPackages: GuideRow[] = mapped.map((row) => ({
      ...row,
      packages: creditMap.get(row.id) ?? [],
    }));

    setRows(withPackages);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = viewerRole === "director" || viewerRole === "management";
  const canAssignPackages = viewerRole === "director" || viewerRole === "management";

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      switch (sort) {
        case "name_desc":
          return b.fullName.localeCompare(a.fullName);
        case "joined_asc": {
          const ta = a.joinedAt ?? "";
          const tb = b.joinedAt ?? "";
          return ta.localeCompare(tb);
        }
        case "active_first": {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.fullName.localeCompare(b.fullName);
        }
        case "name_asc":
        default:
          return a.fullName.localeCompare(b.fullName);
      }
    });
    return list;
  }, [rows, sort]);

  const guidesFilterCount = Number(activeListFilter !== "all") + disciplineFilters.length;

  const clearGuidesFilters = () => {
    setActiveListFilter("all");
    setDisciplineFilters([]);
  };

  const toggleDisciplineFilterKey = (key: string) => {
    setDisciplineFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const displayedRows = useMemo(() => {
    return sortedRows.filter((row) => {
      if (activeListFilter === "active" && !row.active) return false;
      if (activeListFilter === "inactive" && row.active) return false;
      if (disciplineFilters.length > 0) {
        const keys = guideRowDisciplineKeys(row.disciplines);
        if (!disciplineFilters.some((f) => keys.has(f))) return false;
      }
      return true;
    });
  }, [sortedRows, activeListFilter, disciplineFilters]);

  const toggleDiscipline = (slug: GuideDisciplineSlug) => {
    setDisciplines((prev) =>
      prev.includes(slug) ? prev.filter((d) => d !== slug) : [...prev, slug],
    );
  };

  const openInvite = () => {
    setEditingId(null);
    setEditingGuideId(null);
    resetForm();
    setActive(true);
    setSheetOpen(true);
  };

  const openEdit = (row: GuideRow) => {
    setEditingId(row.id);
    setEditingGuideId(row.guideId);
    populateForm(row);
    setSheetOpen(true);
  };

  const saveGuide = async () => {
    if (!canManage) {
      toast.error("Only directors and management can manage guides.");
      return;
    }

    const payload = {
      first_name: titleCase(firstName),
      last_name: titleCase(lastName),
      email: email.trim().toLowerCase(),
      disciplines,
      active,
    };

    if (!payload.first_name || !payload.last_name || !payload.email) {
      toast.error("First name, last name, and email are required.");
      return;
    }
    if (!isValidEmail(payload.email)) {
      toast.error("Enter a valid email address (e.g. name@example.com).");
      return;
    }

    setSaving(true);

    try {
      if (!editingId) {
        const { data, error } = await supabase.functions.invoke<{
          success?: boolean;
          existing_user?: boolean;
          error?: string;
        }>("invite-guide", {
          body: {
            email: payload.email,
            first_name: payload.first_name,
            last_name: payload.last_name,
            role: "guide",
            disciplines,
          },
        });

        if (error) {
          throw new Error(await edgeFunctionErrorMessage(error, data, "Could not send invite"));
        }
        if (data?.error) {
          throw new Error(data.error.trim() || "Invite rejected by server");
        }

        toast.success(
          data?.existing_user
            ? "Guide added — they already have an account, so no invite email was sent."
            : "Guide invited.",
        );
        closeSheet();
        void load();
        return;
      }

      if (!editingGuideId) {
        toast.error("Missing guide record — refresh and try again.");
        return;
      }

      const nextRole = payload.active ? "guide" : "customer";

      const [profileRes, guidesRes] = await Promise.all([
        supabase
          .from("profiles")
          .update({
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            role: nextRole,
          })
          .eq("id", editingId),
        supabase
          .from("guides")
          .update({
            disciplines: payload.disciplines,
            is_active: payload.active,
          })
          .eq("id", editingGuideId),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (guidesRes.error) throw guidesRes.error;

      toast.success(payload.active ? "Guide updated." : "Guide deactivated and access removed.");
      closeSheet();
      void load();
    } catch (e: unknown) {
      console.error("guide save failed", e);
      const msg = supabaseErrorMessage(e, "Unknown error");
      toast.error(
        editingId ? `Failed to update guide: ${msg}` : `Failed to invite guide: ${msg}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: GuideRow, next: boolean) => {
    if (!canManage) {
      toast.error("Only directors and management can manage guides.");
      return;
    }

    try {
      const [profileRes, guidesRes] = await Promise.all([
        supabase
          .from("profiles")
          .update({ role: next ? "guide" : "customer" })
          .eq("id", row.id),
        supabase
          .from("guides")
          .upsert(
            { profile_id: row.id, disciplines: row.disciplines, is_active: next },
            { onConflict: "profile_id" },
          ),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (guidesRes.error) throw guidesRes.error;

      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== row.id) return r;
          return { ...r, active: next };
        }),
      );
      toast.success(next ? "Guide activated." : "Guide deactivated.");
    } catch (e: unknown) {
      console.error("guide status toggle failed", e);
      toast.error(`Failed to update role: ${supabaseErrorMessage(e, "Could not update guide status")}`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Guides"
        description={loading ? "Loading…" : `${rows.length} guides`}
        actions={
          <Button
            type="button"
            onClick={openInvite}
            disabled={!canManage}
            className="bg-[#a3b693] text-[#243120] hover:bg-[#93a985]"
          >
            <Plus className="h-4 w-4" /> Invite Guide
          </Button>
        }
      />

      {!canManage && !loading && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Only directors can invite, edit, or deactivate guides.
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filters
            {guidesFilterCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {guidesFilterCount}
              </span>
            ) : null}
          </span>
          {guidesFilterCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs text-muted-foreground"
              onClick={clearGuidesFilters}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["All", "all" as const],
              ["Active", "active" as const],
              ["Inactive", "inactive" as const],
            ] as const
          ).map(([label, key]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={activeListFilter === key ? "default" : "outline"}
              className={
                activeListFilter === key ? "bg-[#a3b693] text-[#243120] hover:bg-[#93a985]" : ""
              }
              onClick={() => setActiveListFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-auto sm:py-1.5">
            Disciplines
          </span>
          {disciplineFilterKeys().map(({ key, label }) => {
            const on = disciplineFilters.includes(key);
            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className={on ? "bg-[#a3b693] text-[#243120] hover:bg-[#93a985]" : ""}
                onClick={() => toggleDisciplineFilterKey(key)}
              >
                {label}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={sort} onValueChange={(v) => setSort(v as GuideSortKey)}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Name A–Z</SelectItem>
              <SelectItem value="name_desc">Name Z–A</SelectItem>
              <SelectItem value="joined_asc">Date joined</SelectItem>
              <SelectItem value="active_first">Active first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={"min-w-0 overflow-x-auto rounded-2xl border bg-card shadow-sm " + SAGE_BORDER}
      >
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading guides…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No guides found.</div>
        ) : displayedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No guides match your filters.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#a3b693]/15">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Guide</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Disciplines</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Classes This Week</th>
                <th className="px-5 py-3 font-medium">Packages</th>
                <th className="px-5 py-3 font-medium text-right">Deactivate</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => (
                <tr
                  key={row.guideId}
                  className="cursor-pointer border-t border-border hover:bg-[#a3b693]/5"
                  onClick={() => openEdit(row)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-9 w-9 place-content-center rounded-full text-xs font-bold"
                        style={{ backgroundColor: SAGE, color: "#1f2d1a" }}
                        aria-hidden
                      >
                        {initials(row.firstName, row.lastName, row.email)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.fullName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate px-5 py-3 text-muted-foreground">
                    {row.email || "—"}
                  </td>
                  <td className="max-w-[min(240px,36vw)] px-5 py-3">
                    <GuideDisciplinePills disciplines={row.disciplines} />
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        row.active
                          ? "bg-green-100 text-green-800"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">
                    {row.classesThisWeek}
                  </td>
                  <td
                    className="max-w-[min(280px,40vw)] px-5 py-3 align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.packages.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No packages</span>
                    ) : (
                      <GuideActivePackagePills
                        credits={row.packages}
                        onPillClick={
                          canAssignPackages
                            ? () => {
                                setAssignTarget({
                                  profileId: row.id,
                                  displayName: row.fullName,
                                  email: row.email || null,
                                  firstName: row.firstName,
                                });
                                setAssignOpen(true);
                              }
                            : undefined
                        }
                      />
                    )}
                  </td>
                  <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-2">
                      <Switch
                        checked={row.active}
                        onCheckedChange={(next) => void toggleActive(row, next)}
                        disabled={!canManage}
                        aria-label={`Toggle ${row.fullName} active`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={(open) => (open ? setSheetOpen(true) : closeSheet())}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit guide" : "Invite guide"}</SheetTitle>
            <SheetDescription>
              {editingId
                ? "Update guide details, disciplines, and access state."
                : "Send an invite email and create a guide account."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="guide-first">First name</Label>
              <Input
                id="guide-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guide-last">Last name</Label>
              <Input
                id="guide-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guide-email">Email</Label>
              <Input
                id="guide-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={Boolean(editingId)}
              />
              {editingId && (
                <p className="text-xs text-muted-foreground">Email is locked for existing users.</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Disciplines</Label>
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
                {GUIDE_DISCIPLINE_SLUGS.map((slug) => {
                  const checked = disciplines.includes(slug);
                  return (
                    <label key={slug} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDiscipline(slug)}
                      />
                      <span>{guideDisciplineLabel(slug)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {editingId && (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Status</p>
                  <p className="text-xs text-muted-foreground">
                    Turn off to remove admin access (role becomes customer).
                  </p>
                </div>
                <Switch checked={active} onCheckedChange={setActive} disabled={!canManage} />
              </div>
            )}
          </div>

          <SheetFooter className="mt-8">
            <Button type="button" variant="outline" onClick={closeSheet} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveGuide()}
              disabled={saving || !canManage}
              className="bg-[#a3b693] text-[#243120] hover:bg-[#93a985]"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCog className="h-4 w-4" />
              )}
              {editingId ? "Save changes" : "Send invite"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {assignOpen ? (
        <AssignPackageDialog
          open
          onOpenChange={(o) => {
            setAssignOpen(o);
            if (!o) setAssignTarget(null);
          }}
          target={assignTarget}
          canAssign={canAssignPackages}
          onAssigned={() => void load()}
        />
      ) : null}
    </div>
  );
}
