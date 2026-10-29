// yoco-webhook: the only place paid pack credits are created.
// Every request must carry a valid Yoco signature (YOCO_WEBHOOK_SECRET).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UNLIMITED = 999;
const ALL_TYPES = ["yoga", "sculpt", "pilates", "wellzone", "sauna_journey", "power", "beginner", "beginner_sculpt", "event", "reformer"];
const SEEKER_YOGA_TYPES = ["yoga", "sculpt", "pilates", "power", "beginner", "beginner_sculpt", "event"];
const WELLZONE_TYPES = ["wellzone", "sauna_journey"];
const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyYocoSignature(headers: Headers, rawBody: string, secret: string | undefined): Promise<boolean> {
  if (!secret) {
    console.error("yoco-webhook: YOCO_WEBHOOK_SECRET is not set");
    return false;
  }
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  for (const part of signatureHeader.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma >= 0 ? part.slice(comma + 1) : part;
    if (sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

type Allowance = { label: string; class_types: string[] | null; credits: number; sort_order: number | null };
type Product = {
  id: string;
  name: string;
  category: string | null;
  allowed_class_types: string[] | null;
  credit_count: number | null;
  validity_days: number | null;
  access_scope?: string | null;
  mat_included?: boolean | null;
  shower_towel_included?: boolean | null;
  product_allowances?: Allowance[] | null;
};

/** Packs built in Admin: one balance per allowance (e.g. On The Mat unlimited, Wellzone 8, Reformer 2). */
function buildAllowanceRows(p: Product, profileId: string, paymentId: string, now: Date) {
  const expiresAt = p.validity_days ? new Date(now.getTime() + p.validity_days * 86400000).toISOString() : null;
  const allowances = [...(p.product_allowances ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const many = allowances.length > 1;
  return allowances.map((a, i) => {
    const credits = Math.max(1, Number(a.credits) || 1);
    const unlimited = credits >= UNLIMITED;
    return {
      profile_id: profileId,
      product_id: p.id,
      product_name: many ? `${p.name} - ${a.label}` : p.name,
      category: p.category ?? "yoga",
      allowed_class_types: a.class_types ?? [],
      credits_total: unlimited ? UNLIMITED : credits,
      credits_remaining: unlimited ? UNLIMITED : credits,
      is_unlimited: unlimited,
      expires_at: expiresAt,
      yoco_payment_id: paymentId,
      purchased_at: now.toISOString(),
      mat_access: i === 0 && Boolean(p.mat_included),
      towel_access: i === 0 && Boolean(p.shower_towel_included),
    };
  });
}

function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as any)[c]);
}

const OPEN_ACCESS_NOTIFY_EMAIL = "deeds@oneflow.co.za";

async function notifyOpenAccessPurchase(details: any) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("yoco-webhook: RESEND_API_KEY not set, Open Access email not sent", details);
    return;
  }
  const rows = Object.entries(details)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`)
    .join("");
  const html = `<p>A member has bought an <b>Open Access</b> pack at Longkloof. Please load them on the Green Point side.</p><table>${rows}</table>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "One Flow <noreply@oneflow.co.za>",
        to: [OPEN_ACCESS_NOTIFY_EMAIL],
        subject: `Open Access purchase: ${details["Member"] ?? ""} (${details["Pack"] ?? ""})`,
        html,
      }),
    });
    if (!res.ok) console.error("yoco-webhook: Open Access email failed", res.status, await res.text());
  } catch (e) {
    console.error("yoco-webhook: Open Access email error", e);
  }
}

function isSeeker(p: Product) {
  return p.id.toLowerCase().startsWith("df5794ea") || p.name.toLowerCase().includes("seeker");
}
function isSage(p: Product) {
  return p.id.toLowerCase().startsWith("e8ea33ba") || p.name.toLowerCase().includes("sage");
}
function defaultTypesForCategory(category: string): string[] {
  const k = category.trim().toLowerCase();
  if (k === "yoga" || k === "power" || k === "mat_towel") return [...SEEKER_YOGA_TYPES];
  if (k === "wellzone") return [...WELLZONE_TYPES];
  return [...ALL_TYPES];
}

function buildCreditRows(p: Product, profileId: string, paymentId: string, now: Date) {
  const expiresAt = p.validity_days ? new Date(now.getTime() + p.validity_days * 86400000).toISOString() : null;
  const purchasedAt = now.toISOString();
  const count = typeof p.credit_count === "number" ? p.credit_count : Number(p.credit_count ?? 0) || 0;
  const unlimited = count >= UNLIMITED;
  const category = p.category ?? "yoga";
  const base = {
    profile_id: profileId,
    product_id: p.id,
    expires_at: expiresAt,
    yoco_payment_id: paymentId,
    purchased_at: purchasedAt,
  };

  let main: any = {
    ...base,
    product_name: p.name,
    category,
    allowed_class_types: p.allowed_class_types?.length ? p.allowed_class_types : defaultTypesForCategory(category),
    credits_total: count,
    credits_remaining: count,
    is_unlimited: unlimited,
    mat_access: false,
    towel_access: false,
  };
  const extras: any[] = [];
  const n = p.name.trim().toLowerCase();

  if (isSeeker(p)) {
    main = { ...main, product_name: "The Seeker - Yoga", category: "yoga", allowed_class_types: [...SEEKER_YOGA_TYPES],
      credits_total: UNLIMITED, credits_remaining: UNLIMITED, is_unlimited: true, mat_access: true, towel_access: true };
    extras.push({ ...base, product_name: "The Seeker - Wellzone", category: "wellzone", allowed_class_types: [...WELLZONE_TYPES],
      credits_total: 10, credits_remaining: 10, is_unlimited: false, mat_access: false, towel_access: false });
    extras.push({ ...base, product_name: "The Seeker - Café", category: "cafe", allowed_class_types: [],
      credits_total: 10, credits_remaining: 10, is_unlimited: false, mat_access: false, towel_access: false });
  } else if (isSage(p)) {
    main = { ...main, product_name: "The Sage - Yoga", category: "yoga",
      credits_total: UNLIMITED, credits_remaining: UNLIMITED, is_unlimited: true, mat_access: true, towel_access: true };
    extras.push({ ...base, product_name: "The Sage - Wellzone", category: "wellzone", allowed_class_types: [...WELLZONE_TYPES],
      credits_total: UNLIMITED, credits_remaining: UNLIMITED, is_unlimited: true, mat_access: false, towel_access: false });
    extras.push({ ...base, product_name: "The Sage - Café", category: "cafe", allowed_class_types: [],
      credits_total: 10, credits_remaining: 10, is_unlimited: false, mat_access: false, towel_access: false });
  } else {
    if (n.includes("mat monthly") || n.includes("mat storage") || (n.includes("mat") && n.includes("access"))) {
      main.mat_access = true;
    } else if (n.includes("towel monthly") || n.includes("towel access") || n === "towel" || n.startsWith("towel ")) {
      main.towel_access = true;
    }
    if (n.includes("café") || n.includes("cafe")) {
      main = { ...main, category: "cafe",
        credits_total: count > 0 ? count : 10, credits_remaining: count > 0 ? count : 10, is_unlimited: false };
    }
  }
  return [main, ...extras];
}

serve(async (req) => {
  const rawBody = await req.text();
  if (!(await verifyYocoSignature(req.headers, rawBody, Deno.env.get("YOCO_WEBHOOK_SECRET")))) {
    console.warn("yoco-webhook: rejected request with missing or invalid signature");
    return new Response("invalid signature", { status: 401 });
  }

  let event: { type?: string; payload?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid body", { status: 400 });
  }
  if (event.type !== "payment.succeeded") return new Response("ok", { status: 200 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const paymentType = String(metadata.type ?? "");

  // Class invite payments: inviter paid for a friend's class.
  if (paymentType === "class_invite") {
    const classInviteId = String(metadata.class_invite_id ?? "").trim();
    if (!classInviteId) return new Response("ok", { status: 200 });
    const checkoutId = String(metadata.checkoutId ?? payload.id ?? "");
    const yocoPaymentId = String(payload.id ?? checkoutId);

    const { data: inv } = await supabase
      .from("class_invites")
      .select("id, invitee_id, invitee_email")
      .eq("id", classInviteId)
      .maybeSingle();
    const invRow = inv as { invitee_id: string | null; invitee_email: string | null } | null;
    if (invRow && !invRow.invitee_id && invRow.invitee_email) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", invRow.invitee_email)
        .maybeSingle();
      const existingId = (existing as { id?: string } | null)?.id;
      if (existingId) {
        await supabase
          .from("class_invites")
          .update({ invitee_id: existingId, invitee_email: null, invitee_name: null })
          .eq("id", classInviteId);
      }
    }

    const { error: rpcErr } = await supabase.rpc("record_paid_class_invite", {
      p_class_invite_id: classInviteId,
      p_yoco_payment_id: yocoPaymentId,
      p_checkout_id: checkoutId,
    });
    if (rpcErr) {
      console.error("record_paid_class_invite", rpcErr);
      return new Response("rpc failed", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  // Outstanding fees paid on their own.
  if (paymentType === "fees") {
    const feeProfileId = String(metadata.profile_id ?? "").trim();
    const feePaymentId = String(payload.id ?? "").trim();
    const feeIds = String(metadata.fee_ids ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!feeProfileId || !feePaymentId) return new Response("ok", { status: 200 });
    const { data: done } = await supabase.from("member_fees").select("id").eq("yoco_payment_id", feePaymentId).limit(1);
    if (done && done.length > 0) return new Response("ok", { status: 200 });
    const { error: feeErr } = await supabase.rpc("settle_member_fees", {
      p_profile_id: feeProfileId,
      p_payment_id: feePaymentId,
      p_fee_ids: feeIds.length > 0 ? feeIds : null,
    });
    if (feeErr) {
      console.error("yoco-webhook: settle fees failed", feeErr);
      return new Response("settle failed", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  // Pack purchases.
  const packId = String(metadata.pack_id ?? "").trim();
  const profileId = String(metadata.profile_id ?? "").trim();
  const paymentId = String(payload.id ?? "").trim();
  if (!packId || !profileId || !paymentId) {
    console.error("yoco-webhook: payment without pack_id, profile_id or payment id", { packId, profileId, paymentId });
    return new Response("ok", { status: 200 });
  }

  // Yoco can deliver the same event more than once: only credit each payment once.
  const { data: already } = await supabase.from("user_credits").select("id").eq("yoco_payment_id", paymentId).limit(1);
  if (already && already.length > 0) return new Response("ok", { status: 200 });

  const { data: pack, error: packErr } = await supabase
    .from("products")
    .select("id, name, category, allowed_class_types, credit_count, validity_days, access_scope, mat_included, shower_towel_included, product_allowances(label, class_types, credits, sort_order)")
    .eq("id", packId)
    .maybeSingle();
  if (packErr) {
    console.error("yoco-webhook: product lookup failed", packErr);
    return new Response("lookup failed", { status: 500 });
  }
  if (!pack) {
    console.error("yoco-webhook: paid for a product that does not exist", packId);
    return new Response("ok", { status: 200 });
  }

  const product = pack as Product;
  const now = new Date();
  const rows: any[] = (product.product_allowances?.length ?? 0) > 0
    ? buildAllowanceRows(product, profileId, paymentId, now)
    : buildCreditRows(product, profileId, paymentId, now);

  const upgraded = metadata.open_access_upgrade === true || metadata.open_access_upgrade === "true";
  const upgradeAmount = Number(metadata.upgrade_amount_zar ?? 0) || 0;
  const isOpenAccess = upgraded || product.access_scope === "open_access";
  const paidMeta = Number(metadata.amount_paid_zar);
  const paidZar = Number.isFinite(paidMeta) && paidMeta > 0 ? paidMeta : null;
  rows.forEach((r, i) => {
    r.access_scope = isOpenAccess ? "open_access" : "longkloof";
    r.paid_at_studio = "longkloof";
    r.entry_type = "purchase";
    if (i === 0 && paidZar !== null) r.amount_paid_zar = paidZar;
    if (upgraded) {
      r.upgraded_at = now.toISOString();
      r.upgrade_amount_zar = i === 0 ? upgradeAmount : 0;
      r.upgrade_paid_at_studio = "longkloof";
    }
  });

  const { error: insertErr } = await supabase.from("user_credits").insert(rows);
  if (insertErr) {
    console.error("yoco-webhook: credit insert failed", insertErr);
    return new Response("insert failed", { status: 500 });
  }

  const pointsUsed = Math.max(0, Math.floor(Number(metadata.flow_points_used ?? 0) || 0));
  if (pointsUsed > 0) {
    const { data: prof } = await supabase.from("profiles").select("flow_points").eq("id", profileId).maybeSingle();
    const current = Number((prof as { flow_points?: number } | null)?.flow_points ?? 0);
    await supabase.from("profiles").update({ flow_points: Math.max(0, current - pointsUsed) }).eq("id", profileId);
    const { error: logErr } = await supabase
      .from("flow_points")
      .insert({ profile_id: profileId, points: -pointsUsed, reason: "pack_redemption" });
    if (logErr) console.warn("yoco-webhook: flow points log insert failed", logErr.message);
  }

  if (metadata.late_cancel_fee_applied === true || metadata.late_cancel_fee_applied === "true") {
    await supabase.from("profiles").update({ late_cancel_fee_pending: false }).eq("id", profileId);
    const paidFeeIds = String(metadata.fee_ids ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (paidFeeIds.length > 0) {
      const { error: feeErr } = await supabase.rpc("settle_member_fees", {
        p_profile_id: profileId,
        p_payment_id: paymentId,
        p_fee_ids: paidFeeIds,
      });
      if (feeErr) console.error("yoco-webhook: settle fees with pack failed", feeErr);
    }
  }

  if (isOpenAccess) {
    const { data: who } = await supabase
      .from("profiles")
      .select("first_name, last_name, email, phone")
      .eq("id", profileId)
      .maybeSingle();
    const w: any = who ?? {};
    const expires = rows[0]?.expires_at ? new Date(String(rows[0].expires_at)).toISOString().slice(0, 10) : "No expiry";
    await notifyOpenAccessPurchase({
      "Member": [w.first_name, w.last_name].filter(Boolean).join(" ") || "Unknown",
      "Email": w.email ?? "",
      "Phone": w.phone ?? "",
      "Pack": product.name,
      "Includes": rows.map((r) => `${r.product_name}: ${r.is_unlimited ? "Unlimited" : r.credits_total}`).join("; "),
      "Open Access upgrade": upgraded ? `Yes (+R${upgradeAmount})` : "No, Open Access pack",
      "Amount paid": paidZar !== null ? `R${paidZar.toFixed(2)}` : "",
      "Purchased": now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
      "Expires": expires,
      "Yoco payment": paymentId,
    });
  }

  return new Response("ok", { status: 200 });
});
