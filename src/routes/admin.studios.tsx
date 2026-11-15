import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

export const Route = createFileRoute("/admin/studios")({
  head: () => ({ meta: [{ title: "Studios — One Flow Admin" }] }),
  component: StudiosPage,
});

type Studio = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  report_email: string | null;
  is_live: boolean;
  live_from: string | null;
  sort_order: number;
};

type Counts = { classes: number; packs: number; staff: number };

const EMPTY: Omit<Studio, "id"> = {
  code: "",
  name: "",
  address: "",
  phone: "",
  whatsapp: "",
  email: "",
  report_email: "deeds@oneflow.co.za",
  is_live: false,
  live_from: null,
  sort_order: 0,
};

function codeFromName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Director only: the studios (locations) the app runs, each with its own details and payment account. */
function StudiosPage() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Omit<Studio, "id"> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("studios").select("*").order("sort_order").order("name");
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load studios"));
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Studio[];
    setStudios(list);
    const next: Record<string, Counts> = {};
    await Promise.all(
      list.map(async (s) => {
        const [c, p, st] = await Promise.all([
          supabase.from("classes").select("id", { count: "exact", head: true }).eq("studio_id", s.id),
          supabase.from("product_studios").select("product_id", { count: "exact", head: true }).eq("studio_id", s.id),
          supabase.from("staff_studios").select("profile_id", { count: "exact", head: true }).eq("studio_id", s.id),
        ]);
        next[s.id] = { classes: c.count ?? 0, packs: p.count ?? 0, staff: st.count ?? 0 };
      }),
    );
    setCounts(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const code = (editing.id ? editing.code : codeFromName(editing.code || name)).trim();
    if (!name) {
      toast.error("Give the studio a name");
      return;
    }
    if (!code) {
      toast.error("Give the studio a short code");
      return;
    }
    setSaving(true);
    const row = {
      name,
      code,
      address: editing.address?.trim() || null,
      phone: editing.phone?.trim() || null,
      whatsapp: editing.whatsapp?.trim() || null,
      email: editing.email?.trim() || null,
      report_email: editing.report_email?.trim() || null,
      is_live: editing.is_live,
      live_from: editing.live_from || null,
      sort_order: editing.id ? editing.sort_order : studios.length + 1,
    };
    const { error } = editing.id
      ? await supabase.from("studios").update(row).eq("id", editing.id)
      : await supabase.from("studios").insert(row);
    setSaving(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save the studio"));
      return;
    }
    toast.success(editing.id ? "Studio saved" : `${name} added`);
    setEditing(null);
    await load();
  };

  const field = (key: keyof Omit<Studio, "id">, label: string, type = "text", hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`studio-${key}`}>{label}</Label>
      <Input
        id={`studio-${key}`}
        type={type}
        value={(editing?.[key] as string | null) ?? ""}
        onChange={(e) => setEditing((s) => (s ? { ...s, [key]: e.target.value } : s))}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Studios"
        description="Each location with its own details, schedule, packs, guides and bank account. Members, history and Flow Points are shared across all studios."
        actions={
          <Button type="button" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add studio
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {studios.map((s) => {
            const c = counts[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setEditing({ ...s })}
                className="rounded-xl border border-border bg-card p-5 text-left transition hover:border-[#a3b693]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-[#5f7a52]" aria-hidden />
                    <h3 className="font-display text-xl font-semibold">{s.name}</h3>
                  </div>
                  <span
                    className={
                      s.is_live
                        ? "rounded-full bg-[#a3b693]/20 px-2.5 py-0.5 text-xs font-semibold text-[#3f5636]"
                        : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
                    }
                  >
                    {s.is_live ? "Live" : s.live_from ? `Goes live ${s.live_from}` : "Not live yet"}
                  </span>
                </div>
                {s.address ? <p className="mt-2 text-sm text-muted-foreground">{s.address}</p> : null}
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-muted/50 py-2">
                    <dt className="text-xs text-muted-foreground">Classes</dt>
                    <dd className="font-semibold">{c?.classes ?? 0}</dd>
                  </div>
                  <div className="rounded-lg bg-muted/50 py-2">
                    <dt className="text-xs text-muted-foreground">Packs usable</dt>
                    <dd className="font-semibold">{c?.packs ?? 0}</dd>
                  </div>
                  <div className="rounded-lg bg-muted/50 py-2">
                    <dt className="text-xs text-muted-foreground">Staff</dt>
                    <dd className="font-semibold">{c?.staff ?? 0}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Payment account: Yoco keys saved as <code>YOCO_SECRET_KEY_{s.code.toUpperCase()}</code>
                </p>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing?.id ? `Edit ${editing.name}` : "Add a studio"}</SheetTitle>
          </SheetHeader>
          {editing ? (
            <div className="mt-6 space-y-4">
              {field("name", "Studio name")}
              {editing.id ? (
                <p className="text-xs text-muted-foreground">
                  Short code: <code>{editing.code}</code> (fixed, used for its payment account)
                </p>
              ) : (
                field(
                  "code",
                  "Short code (optional)",
                  "text",
                  `Letters and numbers only. Leave blank to use "${codeFromName(editing.name) || "studio_name"}".`,
                )
              )}
              {field("address", "Address")}
              {field("phone", "Phone", "tel")}
              {field("whatsapp", "WhatsApp number", "tel")}
              {field("email", "Studio email", "email")}
              {field("report_email", "Reports and upgrade emails go to", "email")}
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Live for members</p>
                  <p className="text-xs text-muted-foreground">Members can see and book this studio's classes.</p>
                </div>
                <Switch
                  checked={editing.is_live}
                  onCheckedChange={(v) => setEditing((s) => (s ? { ...s, is_live: v } : s))}
                />
              </div>
              {field("live_from", "Planned go-live date", "date")}
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Bank account</p>
                <p className="mt-1">
                  Each studio is paid into its own Yoco account. For safety, Yoco's secret keys are never typed into
                  the dashboard. They're saved once in Supabase as{" "}
                  <code>YOCO_SECRET_KEY_{codeFromName(editing.code || editing.name).toUpperCase() || "CODE"}</code> and{" "}
                  <code>YOCO_WEBHOOK_SECRET_{codeFromName(editing.code || editing.name).toUpperCase() || "CODE"}</code>.
                </p>
              </div>
              <Button type="button" className="w-full" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                {editing.id ? "Save studio" : "Add studio"}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
