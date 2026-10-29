import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — One Flow Admin" }] }),
  component: SettingsPage,
});

const SETTING_KEYS = [
  "studio_name",
  "studio_phone",
  "studio_email",
  "late_cancel_fee_zar",
  "no_show_fee_zar",
  "late_cancel_window_minutes",
  "credit_loss_window_minutes",
  "late_fee_pay_hours",
  "booking_open_days_ahead",
  "checkin_open_minutes_before",
  "flow_points_per_class",
  "flow_points_conversion_rate",
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

const DEFAULT_VALUES: Record<SettingKey, string> = {
  studio_name: "One Flow",
  studio_phone: "+27 82 553 3033",
  studio_email: "info@oneflow.co.za",
  late_cancel_fee_zar: "100",
  no_show_fee_zar: "200",
  late_cancel_window_minutes: "120",
  credit_loss_window_minutes: "60",
  late_fee_pay_hours: "24",
  booking_open_days_ahead: "30",
  checkin_open_minutes_before: "120",
  flow_points_per_class: "10",
  flow_points_conversion_rate: "10",
};

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SettingsPage() {
  const [values, setValues] = useState<Record<SettingKey, string>>(DEFAULT_VALUES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearChecking, setClearChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("studio_settings").select("key, value");
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load settings"));
      setLoading(false);
      return;
    }
    const next = { ...DEFAULT_VALUES };
    for (const row of (data ?? []) as { key: string; value: string | null }[]) {
      if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
        next[row.key as SettingKey] = row.value ?? "";
      }
    }
    setValues(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: SettingKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const saveAll = async () => {
    setSaving(true);
    const user = await getUser();
    const updatedBy = user?.id ?? null;
    const upserts = SETTING_KEYS.map((key) => ({
      key,
      value: values[key],
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("studio_settings").upsert(upserts, { onConflict: "key" });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not save settings"));
      return;
    }
    toast.success("Settings saved");
  };

  const exportData = async () => {
    setExporting(true);
    const [profilesRes, bookingsRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, email, phone, role, created_at"),
      supabase
        .from("bookings")
        .select(
          "id, profile_id, class_id, status, payment_method, checked_in, checked_in_at, created_at",
        ),
    ]);
    setExporting(false);

    if (profilesRes.error) {
      toast.error(supabaseErrorMessage(profilesRes.error, "Could not export profiles"));
      return;
    }
    if (bookingsRes.error) {
      toast.error(supabaseErrorMessage(bookingsRes.error, "Could not export bookings"));
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);

    const profileHeader = ["id", "first_name", "last_name", "email", "phone", "role", "created_at"];
    const profileBody = (profilesRes.data ?? []).map((p: Record<string, unknown>) => [
      String(p.id ?? ""),
      String(p.first_name ?? ""),
      String(p.last_name ?? ""),
      String(p.email ?? ""),
      String(p.phone ?? ""),
      String(p.role ?? ""),
      String(p.created_at ?? ""),
    ]);
    downloadCsv(`profiles-${stamp}.csv`, [profileHeader, ...profileBody]);

    const bookingHeader = [
      "id",
      "profile_id",
      "class_id",
      "status",
      "payment_method",
      "checked_in",
      "checked_in_at",
      "created_at",
    ];
    const bookingBody = (bookingsRes.data ?? []).map((b: Record<string, unknown>) => [
      String(b.id ?? ""),
      String(b.profile_id ?? ""),
      String(b.class_id ?? ""),
      String(b.status ?? ""),
      String(b.payment_method ?? ""),
      String(b.checked_in ?? ""),
      String(b.checked_in_at ?? ""),
      String(b.created_at ?? ""),
    ]);
    downloadCsv(`bookings-${stamp}.csv`, [bookingHeader, ...bookingBody]);

    toast.success("Data exported");
  };

  const startClearTestData = async () => {
    setClearChecking(true);
    const { count, error } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true });
    setClearChecking(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not check booking count"));
      return;
    }
    if ((count ?? 0) >= 10) {
      toast.error("Refusing to clear test data — more than 10 bookings exist.");
      return;
    }
    setClearOpen(true);
  };

  const confirmClearTestData = async () => {
    setClearOpen(false);
    const { error: bErr } = await supabase
      .from("bookings")
      .delete()
      .gte("created_at", "1970-01-01");
    if (bErr) {
      toast.error(supabaseErrorMessage(bErr, "Could not clear bookings"));
      return;
    }
    toast.success("Test bookings cleared");
  };

  const fields = useMemo(
    () => [
      {
        section: "General",
        items: [
          { key: "studio_name" as SettingKey, label: "Studio name", type: "text" },
          { key: "studio_phone" as SettingKey, label: "Phone", type: "tel" },
          { key: "studio_email" as SettingKey, label: "Email", type: "email" },
        ],
      },
      {
        section: "Booking rules",
        items: [
          {
            key: "late_cancel_fee_zar" as SettingKey,
            label: "Late cancellation fee (ZAR)",
            type: "number",
          },
          {
            key: "late_cancel_window_minutes" as SettingKey,
            label: "Late cancellation starts (mins before class)",
            type: "number",
          },
          {
            key: "credit_loss_window_minutes" as SettingKey,
            label: "Class packs: credit is used if cancelled within (mins before class)",
            type: "number",
          },
          {
            key: "late_fee_pay_hours" as SettingKey,
            label: "Class packs: hours to pay the late fee and keep the credit",
            type: "number",
          },
          {
            key: "no_show_fee_zar" as SettingKey,
            label: "Memberships: no-show fee (ZAR)",
            type: "number",
          },
          {
            key: "booking_open_days_ahead" as SettingKey,
            label: "Days ahead bookings open",
            type: "number",
          },
          {
            key: "checkin_open_minutes_before" as SettingKey,
            label: "Check-in opens (mins before class)",
            type: "number",
          },
        ],
      },
      {
        section: "Flow Points",
        items: [
          {
            key: "flow_points_per_class" as SettingKey,
            label: "Points earned per class attended",
            type: "number",
          },
          {
            key: "flow_points_conversion_rate" as SettingKey,
            label: "Rand discount per 100 points at checkout (e.g. 10 = R10 off per 100 pts)",
            type: "number",
          },
        ],
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Studio-wide settings used across the app."
        actions={
          <Button
            type="button"
            onClick={() => void saveAll()}
            disabled={loading || saving}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        }
      />

      <div className="space-y-6">
        {fields.map((group) => (
          <section key={group.section} className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">{group.section}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.items.map((item) => (
                <div key={item.key} className="grid gap-1.5">
                  <Label htmlFor={`set-${item.key}`}>{item.label}</Label>
                  <Input
                    id={`set-${item.key}`}
                    type={item.type}
                    value={values[item.key]}
                    onChange={(e) => update(item.key, e.target.value)}
                    disabled={loading}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}

        <PricingSectionsPanel />

        <AccessGroupsPanel />

        <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h3 className="font-display text-lg font-semibold text-destructive">Danger zone</h3>
          </div>
          <p className="mt-1 text-xs text-destructive/80">Destructive actions. Use with care.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void exportData()}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export all data (CSV)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => void startClearTestData()}
              disabled={clearChecking}
            >
              {clearChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Clear test data
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Clear test data only works while there are fewer than 10 bookings on the system.
          </p>
        </section>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all test bookings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete every booking row. Profiles and products are kept. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmClearTestData()}
            >
              Yes, delete bookings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pricing sections & access groups                                           */
/* -------------------------------------------------------------------------- */

type OrderedRow = { id: string; sort_order: number };

type PricingSectionRow = OrderedRow & {
  name: string;
  caption: string | null;
  is_active: boolean;
};

type AccessGroupRow = OrderedRow & {
  name: string;
  class_types: string[];
  is_active: boolean;
};

const CLASS_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "yoga", label: "Yoga" },
  { value: "power", label: "Power" },
  { value: "beginner", label: "Beginner Yoga" },
  { value: "sculpt", label: "Sculpt" },
  { value: "beginner_sculpt", label: "Beginner Sculpt" },
  { value: "pilates", label: "Mat Pilates" },
  { value: "reformer", label: "Reformer" },
  { value: "wellzone", label: "Wellzone" },
  { value: "sauna_journey", label: "Sauna Journey" },
  { value: "event", label: "Events" },
];

const CLASS_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CLASS_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

function nextSortOrder(rows: OrderedRow[]): number {
  return rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.sort_order)) + 1;
}

/** Postgres unique violations get a friendlier message than the raw constraint name. */
function saveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "23505") {
    return "That name is already in use. Pick a different name.";
  }
  return supabaseErrorMessage(error, fallback);
}

/**
 * Moves the row at `index` one step up or down and persists the new order.
 * Normally swaps sort_order with the neighbour; if the two share a value
 * (legacy data), renumbers the whole list so the swap actually takes effect.
 */
async function persistMove<T extends OrderedRow>(
  table: "pricing_sections" | "access_groups",
  rows: T[],
  index: number,
  direction: -1 | 1,
): Promise<{ rows: T[] | null; error: unknown }> {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return { rows: null, error: null };

  const reordered = [...rows];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  let next: T[];
  if (rows[index].sort_order !== rows[target].sort_order) {
    next = reordered.map((r) => {
      if (r.id === rows[index].id) return { ...r, sort_order: rows[target].sort_order };
      if (r.id === rows[target].id) return { ...r, sort_order: rows[index].sort_order };
      return r;
    });
  } else {
    next = reordered.map((r, i) => ({ ...r, sort_order: i }));
  }

  const before = new Map(rows.map((r) => [r.id, r.sort_order]));
  const changed = next.filter((r) => before.get(r.id) !== r.sort_order);
  const results = await Promise.all(
    changed.map((r) => supabase.from(table).update({ sort_order: r.sort_order }).eq("id", r.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed) return { rows: null, error: failed.error };
  return { rows: next, error: null };
}

function ReorderButtons({
  index,
  count,
  disabled,
  onMove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ConfirmDeleteDialog({
  open,
  title,
  description,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PricingSectionsPanel() {
  const [rows, setRows] = useState<PricingSectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PricingSectionRow | null>(null);
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PricingSectionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pricing_sections")
      .select("id, name, caption, sort_order, is_active")
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load pricing sections"));
      return;
    }
    setRows(
      (data ?? []).map((raw: Record<string, unknown>) => ({
        id: String(raw.id),
        name: String(raw.name ?? ""),
        caption: raw.caption == null ? null : String(raw.caption),
        sort_order: Number(raw.sort_order ?? 0),
        is_active: Boolean(raw.is_active),
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setCaption("");
    setFormOpen(true);
  };

  const openEdit = (row: PricingSectionRow) => {
    setEditing(row);
    setName(row.name);
    setCaption(row.caption ?? "");
    setFormOpen(true);
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    const trimmedCaption = caption.trim() || null;
    setSaving(true);
    const { error } = editing
      ? await supabase
          .from("pricing_sections")
          .update({ name: trimmedName, caption: trimmedCaption })
          .eq("id", editing.id)
      : await supabase.from("pricing_sections").insert({
          name: trimmedName,
          caption: trimmedCaption,
          sort_order: nextSortOrder(rows),
          is_active: true,
        });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(saveErrorMessage(error, "Could not save section"));
      return;
    }
    toast.success(editing ? "Section updated" : "Section added");
    setFormOpen(false);
    void load();
  };

  const toggleActive = async (row: PricingSectionRow, value: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: value } : r)));
    const { error } = await supabase
      .from("pricing_sections")
      .update({ is_active: value })
      .eq("id", row.id);
    if (error) {
      console.error(error);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: !value } : r)));
      toast.error(supabaseErrorMessage(error, "Could not update section"));
      return;
    }
    toast.success(value ? `"${row.name}" is now visible` : `"${row.name}" is now hidden`);
  };

  const move = async (index: number, direction: -1 | 1) => {
    setBusy(true);
    const result = await persistMove("pricing_sections", rows, index, direction);
    setBusy(false);
    if (result.error) {
      console.error(result.error);
      toast.error(supabaseErrorMessage(result.error, "Could not reorder sections"));
      void load();
      return;
    }
    if (result.rows) {
      setRows(result.rows);
      toast.success("Order saved");
    }
  };

  const startDelete = async (row: PricingSectionRow) => {
    setCheckingId(row.id);
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("pricing_section_id", row.id);
    setCheckingId(null);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not check packs in this section"));
      return;
    }
    const n = count ?? 0;
    if (n > 0) {
      toast.error(`Move the ${n} packs in this section to another section first.`);
      return;
    }
    setDeleteTarget(row);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("pricing_sections").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not delete section"));
      return;
    }
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
    void load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">Pricing sections</h3>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          Add section
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pricing sections yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
              onClick={() => openEdit(row)}
            >
              <ReorderButtons
                index={index}
                count={rows.length}
                disabled={busy}
                onMove={(d) => void move(index, d)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                {row.caption ? (
                  <p className="truncate text-xs text-muted-foreground">{row.caption}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Label
                  htmlFor={`section-visible-${row.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Visible
                </Label>
                <Switch
                  id={`section-visible-${row.id}`}
                  checked={row.is_active}
                  onCheckedChange={(v) => void toggleActive(row, v)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  aria-label={`Delete ${row.name}`}
                  disabled={checkingId === row.id}
                  onClick={() => void startDelete(row)}
                >
                  {checkingId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={(o) => !saving && setFormOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit section" : "Add section"}</DialogTitle>
            <DialogDescription>Sections group packs on the pricing page.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="section-name">Name</Label>
              <Input
                id="section-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="section-caption">Caption (optional)</Label>
              <Input
                id="section-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim()}
                className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This section has no packs in it. Deleting it cannot be undone."
        busy={deleting}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}

function AccessGroupsPanel() {
  const [rows, setRows] = useState<AccessGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccessGroupRow | null>(null);
  const [name, setName] = useState("");
  const [classTypes, setClassTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccessGroupRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("access_groups")
      .select("id, name, class_types, sort_order, is_active")
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load access groups"));
      return;
    }
    setRows(
      (data ?? []).map((raw: Record<string, unknown>) => ({
        id: String(raw.id),
        name: String(raw.name ?? ""),
        class_types: Array.isArray(raw.class_types) ? raw.class_types.map(String) : [],
        sort_order: Number(raw.sort_order ?? 0),
        is_active: Boolean(raw.is_active),
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setClassTypes([]);
    setFormOpen(true);
  };

  const openEdit = (row: AccessGroupRow) => {
    setEditing(row);
    setName(row.name);
    setClassTypes(row.class_types);
    setFormOpen(true);
  };

  const toggleClassType = (value: string, checked: boolean) => {
    setClassTypes((prev) =>
      checked ? (prev.includes(value) ? prev : [...prev, value]) : prev.filter((v) => v !== value),
    );
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    if (classTypes.length === 0) {
      toast.error("Tick at least one class type");
      return;
    }
    // Keep the stored order consistent with the tick box list.
    const orderedTypes = CLASS_TYPE_OPTIONS.map((o) => o.value)
      .filter((v) => classTypes.includes(v))
      .concat(classTypes.filter((v) => !(v in CLASS_TYPE_LABELS)));
    setSaving(true);
    const { error } = editing
      ? await supabase
          .from("access_groups")
          .update({ name: trimmedName, class_types: orderedTypes })
          .eq("id", editing.id)
      : await supabase.from("access_groups").insert({
          name: trimmedName,
          class_types: orderedTypes,
          sort_order: nextSortOrder(rows),
          is_active: true,
        });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(saveErrorMessage(error, "Could not save group"));
      return;
    }
    toast.success(editing ? "Group updated" : "Group added");
    setFormOpen(false);
    void load();
  };

  const toggleActive = async (row: AccessGroupRow, value: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: value } : r)));
    const { error } = await supabase
      .from("access_groups")
      .update({ is_active: value })
      .eq("id", row.id);
    if (error) {
      console.error(error);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: !value } : r)));
      toast.error(supabaseErrorMessage(error, "Could not update group"));
      return;
    }
    toast.success(value ? `"${row.name}" switched on` : `"${row.name}" switched off`);
  };

  const move = async (index: number, direction: -1 | 1) => {
    setBusy(true);
    const result = await persistMove("access_groups", rows, index, direction);
    setBusy(false);
    if (result.error) {
      console.error(result.error);
      toast.error(supabaseErrorMessage(result.error, "Could not reorder groups"));
      void load();
      return;
    }
    if (result.rows) {
      setRows(result.rows);
      toast.success("Order saved");
    }
  };

  const startDelete = async (row: AccessGroupRow) => {
    setCheckingId(row.id);
    const { data, error } = await supabase
      .from("product_allowances")
      .select("product_id")
      .contains("group_ids", [row.id]);
    setCheckingId(null);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not check packs using this group"));
      return;
    }
    const packs = new Set((data ?? []).map((r: Record<string, unknown>) => String(r.product_id)));
    const n = packs.size;
    if (n > 0) {
      toast.error(
        `This group is used by ${n} packs. Untick it on those packs first, or switch the group off instead.`,
      );
      return;
    }
    setDeleteTarget(row);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("access_groups").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not delete group"));
      return;
    }
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
    void load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Access groups</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Access groups are the tick boxes used in What's included on each pack.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          Add group
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No access groups yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
              onClick={() => openEdit(row)}
            >
              <ReorderButtons
                index={index}
                count={rows.length}
                disabled={busy}
                onMove={(d) => void move(index, d)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                {row.class_types.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.class_types.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {CLASS_TYPE_LABELS[t] ?? t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Label htmlFor={`group-active-${row.id}`} className="text-xs text-muted-foreground">
                  Active
                </Label>
                <Switch
                  id={`group-active-${row.id}`}
                  checked={row.is_active}
                  onCheckedChange={(v) => void toggleActive(row, v)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  aria-label={`Delete ${row.name}`}
                  disabled={checkingId === row.id}
                  onClick={() => void startDelete(row)}
                >
                  {checkingId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={(o) => !saving && setFormOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit group" : "Add group"}</DialogTitle>
            <DialogDescription>Choose which class types this group covers.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label>Class types</Label>
              <div className="grid grid-cols-2 gap-2">
                {CLASS_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    htmlFor={`group-type-${opt.value}`}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`group-type-${opt.value}`}
                      checked={classTypes.includes(opt.value)}
                      onCheckedChange={(c) => toggleClassType(opt.value, c === true)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {classTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Tick at least one class type.</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim() || classTypes.length === 0}
                className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="No packs use this group. Deleting it cannot be undone."
        busy={deleting}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
