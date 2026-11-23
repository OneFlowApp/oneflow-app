import { supabase } from "@/lib/supabase";

/** A guide's invoicing details (Payouts → Your invoicing details). */
export type GuideInvoiceDetails = {
  invoice_name: string;
  id_or_reg_number: string;
  vat_number: string;
  address: string;
  phone: string;
  email: string;
  bank_name: string;
  account_holder: string;
  account_number: string;
  branch_code: string;
  account_type: string;
};

export const EMPTY_DETAILS: GuideInvoiceDetails = {
  invoice_name: "",
  id_or_reg_number: "",
  vat_number: "",
  address: "",
  phone: "",
  email: "",
  bank_name: "",
  account_holder: "",
  account_number: "",
  branch_code: "",
  account_type: "",
};

/** The studio's details on every guide invoice. */
export type BillTo = { name: string; address: string; reg: string; vat: string; email: string };

export const EMPTY_BILL_TO: BillTo = { name: "", address: "", reg: "", vat: "", email: "" };

/** What a guide must fill in before they can submit. */
export function missingDetails(d: GuideInvoiceDetails): string[] {
  const out: string[] = [];
  if (!d.invoice_name.trim()) out.push("name on invoice");
  if (!d.bank_name.trim()) out.push("bank");
  if (!d.account_holder.trim()) out.push("account holder");
  if (!d.account_number.trim()) out.push("account number");
  if (!d.branch_code.trim()) out.push("branch code");
  return out;
}

export async function loadGuideDetails(profileId: string): Promise<GuideInvoiceDetails> {
  const { data } = await supabase
    .from("guide_invoice_details")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  const out = { ...EMPTY_DETAILS };
  if (data)
    for (const k of Object.keys(out) as (keyof GuideInvoiceDetails)[])
      out[k] = String((data as Record<string, unknown>)[k] ?? "");
  return out;
}

export async function loadBillTo(): Promise<BillTo> {
  const { data } = await supabase
    .from("studio_settings")
    .select("key, value")
    .like("key", "invoice_bill_to_%");
  const m = new Map(
    ((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? ""]),
  );
  return {
    name: m.get("invoice_bill_to_name") ?? "",
    address: m.get("invoice_bill_to_address") ?? "",
    reg: m.get("invoice_bill_to_reg") ?? "",
    vat: m.get("invoice_bill_to_vat") ?? "",
    email: m.get("invoice_bill_to_email") ?? "",
  };
}

/** e.g. INV-202611-3F9A (cycle month + start of the invoice id). */
export function invoiceNumberFor(id: string, periodEnd: string | null): string {
  const ym = (periodEnd ?? new Date().toISOString()).slice(0, 7).replace("-", "");
  return `INV-${ym}-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const rand = (n: number) =>
  `R${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });

type InvoiceLine = {
  class_name: string;
  class_type: string;
  starts_at: string;
  participants: number;
  rate_zar: number;
  free?: boolean;
};

/** The invoice as an email-ready HTML block: guide's details, Billed to (Longkloof), classes, total, bank details. */
export function invoiceHtml(args: {
  number: string;
  submittedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  lines: InvoiceLine[];
  total: number;
  from: GuideInvoiceDetails;
  billTo: BillTo;
}): string {
  const { number, submittedAt, periodStart, periodEnd, lines, total, from, billTo } = args;
  const td = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;color:#333;"';
  const tdr =
    'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;color:#333;text-align:right;"';
  const line = (label: string, v: string) => (v.trim() ? `${esc(label)}${esc(v)}<br/>` : "");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#333;">
    <h2 style="font-size:20px;margin:0 0 4px;">${from.vat_number.trim() ? "Tax invoice" : "Invoice"}</h2>
    <p style="font-size:13px;margin:0 0 16px;color:#666;">
      ${esc(number)} · Date ${esc(day(submittedAt))}${periodStart && periodEnd ? ` · Period ${esc(day(periodStart))} to ${esc(day(periodEnd))}` : ""}
    </p>
    <table width="100%" style="border-collapse:collapse;margin:0 0 16px;"><tr>
      <td valign="top" style="width:50%;font-size:13px;line-height:1.5;padding-right:12px;">
        <strong>From</strong><br/>
        ${line("", from.invoice_name)}${line("", from.address).replace(/\n/g, "<br/>")}${line("ID / Reg: ", from.id_or_reg_number)}${line("VAT: ", from.vat_number)}${line("", from.phone)}${line("", from.email)}
      </td>
      <td valign="top" style="width:50%;font-size:13px;line-height:1.5;">
        <strong>Billed to</strong><br/>
        ${line("", billTo.name)}${line("", billTo.address).replace(/\n/g, "<br/>")}${line("Reg: ", billTo.reg)}${line("VAT: ", billTo.vat)}${line("", billTo.email)}
      </td>
    </tr></table>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f4f7f0;">
        <th align="left" ${td}>Date</th><th align="left" ${td}>Class</th><th align="right" ${tdr}>People</th><th align="right" ${tdr}>Amount</th>
      </tr>
      ${lines
        .map(
          (l) =>
            `<tr><td ${td}>${esc(day(l.starts_at))}</td><td ${td}>${esc(l.class_name)}</td><td ${tdr}>${esc(l.participants)}</td><td ${tdr}>${l.free ? "Free" : esc(rand(l.rate_zar))}</td></tr>`,
        )
        .join("")}
      <tr><td colspan="3" ${tdr}><strong>Total</strong></td><td ${tdr}><strong>${esc(rand(total))}</strong></td></tr>
    </table>
    <p style="font-size:13px;line-height:1.5;margin:16px 0 0;">
      <strong>Banking details</strong><br/>
      ${line("Bank: ", from.bank_name)}${line("Account holder: ", from.account_holder)}${line("Account number: ", from.account_number)}${line("Branch code: ", from.branch_code)}${line("Account type: ", from.account_type)}
    </p>
  </div>`;
}
