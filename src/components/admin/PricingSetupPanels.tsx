import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

/** Pricing sections (Admin → Products) and access groups (Admin → Settings). */

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

export function PricingSectionsPanel({ onChanged }: { onChanged?: () => void } = {}) {
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
    void load().then(() => onChanged?.());
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
    onChanged?.();
  };

  const move = async (index: number, direction: -1 | 1) => {
    setBusy(true);
    const result = await persistMove("pricing_sections", rows, index, direction);
    setBusy(false);
    if (result.error) {
      console.error(result.error);
      toast.error(supabaseErrorMessage(result.error, "Could not reorder sections"));
      void load().then(() => onChanged?.());
      return;
    }
    if (result.rows) {
      setRows(result.rows);
      toast.success("Order saved");
      onChanged?.();
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
    void load().then(() => onChanged?.());
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

export function AccessGroupsPanel() {
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

