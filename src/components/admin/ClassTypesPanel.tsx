/**
 * Master → Class types.
 *
 * Editing a type here cascades to every class of that type, because titles are derived at
 * render time from category + type and nothing copies the name into `public.classes`.
 * Renaming "Power" retitles all 30 scheduled Power classes with a single row update.
 *
 * Types are retired with `is_active`. "Delete" hides a type from this list for good (it sets
 * `deleted_at` and switches it off) but keeps the row: past classes, bookings and
 * `guides.disciplines` still point at it. Deleted types can be restored. There is no DELETE
 * grant on the table.
 *
 * Categories are seeded (Yoga, Sculpt, Pilates, Wellzone, Events) and may be added
 * only by inheriting an existing category's `legacy_class_type`, so credit rules stay
 * on the Postgres enum. Standalone billing is deferred. Credit rules for Wellzone vs
 * everything else still key on that enum — a category with no inherited enum cannot
 * be created from this dialog.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { useClassCatalog } from "@/contexts/classCatalog";
import { uniqueClassTaxonomySlug } from "@/lib/classTypeOptions";
import { classTypeTheme } from "@/lib/allowedClassTypes";
import type { ClassTypeRow } from "@/lib/classTypeCatalog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CategoryPicker } from "@/components/admin/CategoryPicker";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = { canManage: boolean };

type DraftType = {
  name: string;
  categoryId: string;
  sortOrder: string;
  isActive: boolean;
  isFreeIntro: boolean;
  isGuided: boolean;
};

const EMPTY_DRAFT: DraftType = {
  name: "",
  categoryId: "",
  sortOrder: "0",
  isActive: true,
  isFreeIntro: false,
  isGuided: true,
};

function draftFromRow(row: ClassTypeRow): DraftType {
  return {
    name: row.name,
    categoryId: row.category_id,
    sortOrder: String(row.sort_order),
    isActive: row.is_active,
    isFreeIntro: row.is_free_intro,
    isGuided: row.is_guided,
  };
}

function uniqueSlug(name: string, taken: ReadonlySet<string>): string | null {
  return uniqueClassTaxonomySlug(name, taken);
}

export function ClassTypesPanel({ canManage }: Props) {
  const { catalog, ready, reload } = useClassCatalog();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftType>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** Type id whose is_active switch is mid-write. */
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /** Type waiting for the delete confirmation. */
  const [deleteRow, setDeleteRow] = useState<ClassTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const categories = useMemo(
    () =>
      catalog.categories
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [catalog.categories],
  );

  const grouped = useMemo(
    () =>
      categories.map((category) => ({
        category,
        types: catalog.types
          .filter((t) => t.category_id === category.id && !t.deleted_at)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      })),
    [categories, catalog.types],
  );

  const deletedTypes = useMemo(
    () =>
      catalog.types
        .filter((t) => Boolean(t.deleted_at))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.types],
  );

  const takenSlugs = useMemo(
    () => new Set(catalog.types.map((t) => t.slug)),
    [catalog.types],
  );

  const editingRow = useMemo(
    () => (editingId ? (catalog.types.find((t) => t.id === editingId) ?? null) : null),
    [editingId, catalog.types],
  );

  useEffect(() => {
    if (dialogOpen || categories.length === 0) return;
    setDraft((d) => (d.categoryId ? d : { ...d, categoryId: categories[0].id }));
  }, [dialogOpen, categories]);

  const openCreate = useCallback(() => {
    if (!canManage) return;
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, categoryId: categories[0]?.id ?? "" });
    setDialogOpen(true);
  }, [canManage, categories]);

  const openEdit = useCallback(
    (row: ClassTypeRow) => {
      if (!canManage) return;
      setEditingId(row.id);
      setDraft(draftFromRow(row));
      setDialogOpen(true);
    },
    [canManage],
  );

  const save = async () => {
    if (!canManage) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Type name is required");
      return;
    }
    if (!draft.categoryId) {
      toast.error("Pick a category");
      return;
    }
    const sortOrder = Number(draft.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      toast.error("Order must be a number");
      return;
    }
    const category = catalog.categoryById.get(draft.categoryId);
    if (!category) {
      toast.error("That category no longer exists — reload and try again");
      return;
    }

    setSaving(true);
    try {
      if (editingRow) {
        const previousCategory = catalog.categoryById.get(editingRow.category_id);
        // Only re-inherit the enum value when it was inherited in the first place. Moving
        // "Power" between categories must not silently change which credits cover it —
        // its legacy_class_type is `power`, not its old category's billing enum.
        const parentLegacy = previousCategory?.legacy_class_type ?? previousCategory?.slug;
        const inherited =
          previousCategory != null && editingRow.legacy_class_type === parentLegacy;
        const legacy =
          inherited && draft.categoryId !== editingRow.category_id
            ? category.legacy_class_type
            : editingRow.legacy_class_type;

        const { error } = await supabase
          .from("class_types")
          .update({
            name,
            category_id: draft.categoryId,
            legacy_class_type: legacy,
            is_active: draft.isActive,
            is_free_intro: draft.isFreeIntro,
            is_guided: draft.isGuided,
            sort_order: Math.round(sortOrder),
          })
          .eq("id", editingRow.id);
        if (error) throw error;
        toast.success(`“${name}” updated — every class of this type follows`);
      } else {
        const slug = uniqueSlug(name, takenSlugs);
        if (!slug) {
          toast.error("Could not derive a slug from that name — try a different one");
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("class_types").insert({
          category_id: draft.categoryId,
          slug,
          name,
          // Inherit the category's billing enum — never the category slug, which may not
          // be a public.class_type value once inherited categories exist.
          legacy_class_type: category.legacy_class_type,
          is_active: draft.isActive,
          is_free_intro: draft.isFreeIntro,
          is_guided: draft.isGuided,
          sort_order: Math.round(sortOrder),
        });
        if (error) throw error;
        toast.success(`“${category.name}: ${name}” created — schedule it from Week`);
      }

      setDialogOpen(false);
      setEditingId(null);
      await reload();
    } catch (e: unknown) {
      console.error("class type save failed", e);
      toast.error(supabaseErrorMessage(e, "Could not save class type"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: ClassTypeRow, next: boolean) => {
    if (!canManage) return;
    setTogglingId(row.id);
    const { error } = await supabase
      .from("class_types")
      .update({ is_active: next })
      .eq("id", row.id);
    setTogglingId(null);
    if (error) {
      console.error("class type toggle failed", error);
      toast.error(supabaseErrorMessage(error, "Could not update class type"));
      return;
    }
    await reload();
  };

  const confirmDelete = async () => {
    if (!canManage || !deleteRow) return;
    setDeleting(true);
    const { error } = await supabase
      .from("class_types")
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq("id", deleteRow.id);
    setDeleting(false);
    if (error) {
      console.error("class type delete failed", error);
      toast.error(supabaseErrorMessage(error, "Could not delete class type"));
      return;
    }
    toast.success(`“${deleteRow.name}” deleted. You can restore it under Deleted types.`);
    setDeleteRow(null);
    setDialogOpen(false);
    setEditingId(null);
    await reload();
  };

  const restore = async (row: ClassTypeRow) => {
    if (!canManage) return;
    setRestoringId(row.id);
    const { error } = await supabase
      .from("class_types")
      .update({ deleted_at: null })
      .eq("id", row.id);
    setRestoringId(null);
    if (error) {
      console.error("class type restore failed", error);
      toast.error(supabaseErrorMessage(error, "Could not restore class type"));
      return;
    }
    toast.success(`“${row.name}” restored. Switch it on when you want to use it again.`);
    await reload();
  };

  if (!ready) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Class types are not set up yet.</p>
        <p className="mt-1">
          Push <code className="font-mono text-xs">20260817120000_class_categories_and_types.sql</code>{" "}
          to create the categories and types tables, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Renaming a type retitles every class of that type. Switch a type off to pause it, or
          open it and press Delete to remove an old type from this list. Past classes keep
          their name.
        </p>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            <Plus className="h-4 w-4" /> New type
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        {grouped.map(({ category, types }) => (
          <section key={category.id}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-border pb-1">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#3d4f36]">
                {category.name}
                <span className="ml-2 font-sans font-medium normal-case tracking-normal text-muted-foreground">
                  — {types.length} type{types.length === 1 ? "" : "s"}
                </span>
              </h2>
            </div>
            {types.length === 0 ? (
              <p className="px-1 py-1.5 text-xs text-muted-foreground">No types yet</p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {types.map((t) => {
                  const theme = classTypeTheme(t.slug);
                  return (
                    <li key={t.id} className="border-b border-border last:border-b-0">
                      <div
                        role={canManage ? "button" : undefined}
                        tabIndex={canManage ? 0 : undefined}
                        onClick={() => openEdit(t)}
                        onKeyDown={(e) => {
                          if (!canManage) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openEdit(t);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-3 border-l-4 px-3 py-2 transition",
                          theme.tint,
                          canManage && "cursor-pointer hover:bg-muted/40",
                          !t.is_active && "opacity-55",
                        )}
                        style={{
                          borderLeftColor: theme.accent,
                          backgroundColor: theme.tintBg || undefined,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <p className="truncate font-display text-sm font-semibold text-foreground">
                              {category.name}: {t.name}
                            </p>
                            {t.is_free_intro ? (
                              <span className="shrink-0 rounded-full border border-[#c5d4b8] bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#3d4f36]">
                                Free intro
                              </span>
                            ) : null}
                            {!t.is_guided ? (
                              <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Unguided
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            <span className="font-mono">{t.slug}</span> · order {t.sort_order}
                          </p>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {togglingId === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                          <Switch
                            checked={t.is_active}
                            onCheckedChange={(v) => void toggleActive(t, v)}
                            disabled={!canManage || togglingId === t.id}
                            aria-label={`${t.name} active`}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      {deletedTypes.length > 0 ? (
        <section className="mt-6 rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setShowDeleted((o) => !o)}
            aria-expanded={showDeleted}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold"
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", showDeleted && "rotate-90")}
              aria-hidden
            />
            Deleted types
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {deletedTypes.length}
            </span>
          </button>
          {showDeleted ? (
            <ul className="divide-y divide-border border-t border-border">
              {deletedTypes.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {(catalog.categoryById.get(t.category_id)?.name ?? "Class") + ": " + t.name}
                  </span>
                  {canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={restoringId === t.id}
                      onClick={() => void restore(t)}
                    >
                      {restoringId === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <AlertDialog open={deleteRow !== null} onOpenChange={(o) => !deleting && !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteRow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              It disappears from this list and can no longer be scheduled. Classes already on the
              schedule and past bookings keep their name. You can restore it later under Deleted
              types.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRow ? "Edit class type" : "New class type"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="ct-name">Name</Label>
              <Input
                id="ct-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Flow State"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Classes show as{" "}
                <span className="font-medium text-foreground">
                  {(catalog.categoryById.get(draft.categoryId)?.name ?? "Category") +
                    ": " +
                    (draft.name.trim() || "Name")}
                </span>
                .
              </p>
            </div>
            <div>
              <CategoryPicker
                categories={categories}
                value={draft.categoryId}
                onChange={(categoryId) => setDraft((d) => ({ ...d, categoryId }))}
                onCreated={async (categoryId) => {
                  await reload();
                  setDraft((d) => ({ ...d, categoryId }));
                }}
                canCreate={canManage}
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="ct-order">Order within category</Label>
              <Input
                id="ct-order"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="ct-active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground">
                  Off hides it from class creation. Existing classes keep their type.
                </p>
              </div>
              <Switch
                id="ct-active"
                checked={draft.isActive}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="ct-free" className="cursor-pointer">
                  Free intro
                </Label>
                <p className="text-xs text-muted-foreground">
                  Books with no credit and no payment.
                </p>
              </div>
              <Switch
                id="ct-free"
                checked={draft.isFreeIntro}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, isFreeIntro: v }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="ct-guided" className="cursor-pointer">
                  Has a guide
                </Label>
                <p className="text-xs text-muted-foreground">
                  Off for unguided sessions — class creation stops asking for a guide and
                  bulk reassignment skips them.
                </p>
              </div>
              <Switch
                id="ct-guided"
                checked={draft.isGuided}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, isGuided: v }))}
              />
            </div>
            {editingRow ? (
              <p className="text-xs text-muted-foreground">
                Slug <span className="font-mono">{editingRow.slug}</span> is fixed — guide
                records and existing bookings reference it.
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {editingRow && canManage ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 sm:mr-auto"
                onClick={() => setDeleteRow(editingRow)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingRow ? "Save changes" : "Create type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
