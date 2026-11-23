import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  type BillTo,
  type GuideInvoiceDetails,
  loadBillTo,
  missingDetails,
} from "@/lib/guideInvoice";

const FIELDS: { key: keyof GuideInvoiceDetails; label: string; multiline?: boolean }[] = [
  { key: "invoice_name", label: "Name or business name on invoice" },
  { key: "id_or_reg_number", label: "ID or company registration number" },
  { key: "vat_number", label: "VAT number (if registered)" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address", multiline: true },
  { key: "bank_name", label: "Bank" },
  { key: "account_holder", label: "Account holder" },
  { key: "account_number", label: "Account number" },
  { key: "branch_code", label: "Branch code" },
  { key: "account_type", label: "Account type (e.g. Cheque, Savings)" },
];

/** Guides: their own invoicing and banking details. Only they and Directors / Management can see them. */
export function GuideInvoiceDetailsCard({
  profileId,
  details,
  onSaved,
}: {
  profileId: string;
  details: GuideInvoiceDetails;
  onSaved: (d: GuideInvoiceDetails) => void;
}) {
  const [form, setForm] = useState<GuideInvoiceDetails>(details);
  const [saving, setSaving] = useState(false);
  const missing = missingDetails(details);
  const [open, setOpen] = useState(missing.length > 0);
  useEffect(() => {
    setForm(details);
    if (missingDetails(details).length > 0) setOpen(true);
  }, [details]);

  const save = async () => {
    setSaving(true);
    const row = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, String(v).trim() || null]),
    );
    const { error } = await supabase
      .from("guide_invoice_details")
      .upsert({ profile_id: profileId, ...row, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not save your details"));
      return;
    }
    toast.success("Invoicing details saved");
    onSaved(form);
    setOpen(false);
  };

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-display text-base font-semibold">Your invoicing details</h4>
          <p className="text-xs text-muted-foreground">
            {missing.length > 0
              ? `Needed before you can submit: ${missing.join(", ")}.`
              : `${details.invoice_name} · ${details.bank_name} ····${details.account_number.slice(-4)}`}
          </p>
        </div>
        {!open ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? "sm:col-span-2" : undefined}>
              <Label htmlFor={`gid-${f.key}`} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              {f.multiline ? (
                <Textarea
                  id={`gid-${f.key}`}
                  rows={2}
                  value={form[f.key]}
                  onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`gid-${f.key}`}
                  value={form[f.key]}
                  onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="bg-[#5f7a52] text-white hover:bg-[#4f6844]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save details
            </Button>
            {missing.length === 0 ? (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const BILL_TO_FIELDS: { key: keyof BillTo; setting: string; label: string; multiline?: boolean }[] =
  [
    { key: "name", setting: "invoice_bill_to_name", label: "Company name" },
    { key: "reg", setting: "invoice_bill_to_reg", label: "Registration number" },
    { key: "vat", setting: "invoice_bill_to_vat", label: "VAT number" },
    { key: "email", setting: "invoice_bill_to_email", label: "Email" },
    { key: "address", setting: "invoice_bill_to_address", label: "Address", multiline: true },
  ];

/** Directors / Management: the studio's details printed as "Billed to" on every guide invoice. */
export function BillToSection() {
  const [form, setForm] = useState<BillTo | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void loadBillTo().then(setForm);
  }, []);
  if (!form) return null;
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("studio_settings").upsert(
      BILL_TO_FIELDS.map((f) => ({ key: f.setting, value: form[f.key].trim() })),
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) toast.error(supabaseErrorMessage(error, "Could not save"));
    else toast.success("Invoice details saved");
  };
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <h4 className="font-display text-base font-semibold">Billed to (on every guide invoice)</h4>
      <p className="text-xs text-muted-foreground">
        Longkloof&apos;s details. Guides see these on their invoice and the copy they email
        themselves.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {BILL_TO_FIELDS.map((f) => (
          <div key={f.key} className={f.multiline ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`bt-${f.key}`} className="text-xs text-muted-foreground">
              {f.label}
            </Label>
            {f.multiline ? (
              <Textarea
                id={`bt-${f.key}`}
                rows={3}
                value={form[f.key]}
                onChange={(e) => setForm((x) => (x ? { ...x, [f.key]: e.target.value } : x))}
              />
            ) : (
              <Input
                id={`bt-${f.key}`}
                value={form[f.key]}
                onChange={(e) => setForm((x) => (x ? { ...x, [f.key]: e.target.value } : x))}
              />
            )}
          </div>
        ))}
        <div className="sm:col-span-2">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-[#5f7a52] text-white hover:bg-[#4f6844]"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}
