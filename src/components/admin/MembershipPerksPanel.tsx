import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type Perk = {
  id: string;
  title: string;
  description: string | null;
  link_url: string | null;
  discount_code: string | null;
  sort_order: number;
  is_active: boolean;
};

/** Links must be full https:// web addresses (a bare domain gets https:// added). */
function cleanUrl(raw: string): string | null | false {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : false;
  } catch {
    return false;
  }
}

/** Admin → Settings: "Membership perks" shown on members' digital membership card. */
export function MembershipPerksPanel() {
  const [rows, setRows] = useState<Perk[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("membership_perks")
      .select("id, title, description, link_url, discount_code, sort_order, is_active")
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not load membership perks"));
      return;
    }
    setRows((data ?? []) as Perk[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim()) {
      toast.error("Give the perk a title");
      return;
    }
    const url = cleanUrl(linkUrl);
    if (url === false) {
      toast.error("Enter a full web address, e.g. https://famke.co.za");
      return;
    }
    setBusy(true);
    const nextOrder = rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order)) + 10 : 10;
    const { error } = await supabase.from("membership_perks").insert({
      title: title.trim(),
      description: description.trim() || null,
      link_url: url,
      discount_code: discountCode.trim() || null,
      sort_order: nextOrder,
    });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not add the perk"));
      return;
    }
    setTitle("");
    setDescription("");
    setLinkUrl("");
    setDiscountCode("");
    toast.success("Perk added");
    await load();
  };

  const update = async (id: string, patch: Partial<Perk>) => {
    const { error } = await supabase.from("membership_perks").update(patch).eq("id", id);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save"));
      return false;
    }
    await load();
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("membership_perks").delete().eq("id", id);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not delete"));
      return;
    }
    toast.success("Perk deleted");
    await load();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const a = rows[index];
    const b = rows[index + dir];
    if (!a || !b) return;
    await supabase.from("membership_perks").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("membership_perks").update({ sort_order: a.sort_order }).eq("id", b.id);
    await load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-lg font-semibold">Membership perks</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Shown on the digital membership card of members with a valid paid package. Add a link to
        open a website when the perk is tapped, and a discount code for online purchases.
      </p>

      {loading ? (
        <Loader2 className="mt-4 h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.length === 0 ? <li className="text-sm text-muted-foreground">No perks yet.</li> : null}
          {rows.map((p, i) => (
            <li key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Input
                    defaultValue={p.title}
                    aria-label="Perk title"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== p.title) void update(p.id, { title: v });
                    }}
                  />
                  <Input
                    defaultValue={p.description ?? ""}
                    placeholder="Short description (optional)"
                    aria-label="Perk description"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (p.description ?? "")) void update(p.id, { description: v || null });
                    }}
                  />
                  <Input
                    defaultValue={p.link_url ?? ""}
                    placeholder="Link (optional), e.g. https://famke.co.za"
                    aria-label="Perk link"
                    onBlur={(e) => {
                      const url = cleanUrl(e.target.value);
                      if (url === false) {
                        toast.error("Enter a full web address, e.g. https://famke.co.za");
                        return;
                      }
                      if (url !== (p.link_url ?? null)) void update(p.id, { link_url: url });
                    }}
                  />
                  <Input
                    defaultValue={p.discount_code ?? ""}
                    placeholder="Discount code for online use (optional)"
                    aria-label="Perk discount code"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (p.discount_code ?? "")) void update(p.id, { discount_code: v || null });
                    }}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" disabled={i === rows.length - 1} onClick={() => void move(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={p.is_active}
                    onCheckedChange={(v) => void update(p.id, { is_active: v })}
                    aria-label="Visible to members"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(p.id)}
                    aria-label="Delete perk"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 rounded-lg border border-dashed border-border p-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New perk, e.g. 10% off Famke items" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
        />
        <Input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Link (optional), e.g. https://famke.co.za"
        />
        <Input
          value={discountCode}
          onChange={(e) => setDiscountCode(e.target.value)}
          placeholder="Discount code for online use (optional)"
        />
        <Button type="button" disabled={busy} onClick={() => void add()} className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add perk
        </Button>
      </div>
    </section>
  );
}
