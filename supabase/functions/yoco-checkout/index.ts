import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBillNote, classTitleFromLookup } from "./billNote.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Yoco customer_reference: 1–100 chars shown on the payment page. */
function yocoCustomerReference(name: string): string {
  const trimmed = name.trim() || "Member";
  return trimmed.length > 100 ? trimmed.slice(0, 100) : trimmed;
}

function yocoCustomerDescription(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > 100 ? trimmed.slice(0, 100) : trimmed;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function classIdFromInput(raw: Record<string, unknown>, successUrl: string): string | null {
  const direct = String(raw.class_id ?? raw.classId ?? "").trim();
  if (direct) return direct;
  const blob = String(successUrl ?? "");
  try {
    const url = blob.includes("://") ? new URL(blob) : new URL(blob, "https://local.invalid");
    const id = url.searchParams.get("class_id");
    if (id) return id;
  } catch {
    /* ignore */
  }
  const m = blob.match(/[?&]class_id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type ClassBillFields = { classTitle: string; startsAt: string | null };

async function lookupClassBillFields(
  supabase: ReturnType<typeof createClient>,
  classId: string,
): Promise<ClassBillFields | null> {
  const { data } = await supabase
    .from("classes")
    .select("id, name, title_override, starts_at, class_type_id")
    .eq("id", classId)
    .maybeSingle();
  if (!data) return null;

  let categoryName: string | null = null;
  let typeName: string | null = null;
  const typeId = (data as { class_type_id?: string | null }).class_type_id;
  if (typeId) {
    const { data: typeRow } = await supabase
      .from("class_types")
      .select("name, category_id")
      .eq("id", typeId)
      .maybeSingle();
    typeName = (typeRow as { name?: string | null } | null)?.name ?? null;
    const categoryId = (typeRow as { category_id?: string | null } | null)?.category_id;
    if (categoryId) {
      const { data: catRow } = await supabase
        .from("class_categories")
        .select("name")
        .eq("id", categoryId)
        .maybeSingle();
      categoryName = (catRow as { name?: string | null } | null)?.name ?? null;
    }
  }

  return {
    startsAt: (data as { starts_at?: string | null }).starts_at ?? null,
    classTitle: classTitleFromLookup({
      titleOverride: (data as { title_override?: string | null }).title_override,
      storedName: (data as { name?: string | null }).name,
      categoryName,
      typeName,
    }),
  };
}

/** A member holds an active, paid pack: not expired, not refunded, sessions left or unlimited, not free/staff. */
async function isActiveMember(supabase: any, profileId: string) {
  const { data, error } = await supabase
    .from("user_credits")
    .select("credits_remaining, is_unlimited, expires_at, refunded_at, entry_type, products(price_zar, is_staff_only, name)")
    .eq("profile_id", profileId);
  if (error || !data) return false;
  const now = Date.now();
  return (data as any[]).some((c: any) => {
    const prod = one(c.products as any);
    if (!prod) return false;
    if (c.refunded_at) return false;
    if (c.entry_type === "free") return false;
    if (c.expires_at && new Date(c.expires_at).getTime() <= now) return false;
    if (!c.is_unlimited && !(Number(c.credits_remaining) > 0)) return false;
    if (!(Number(prod.price_zar) > 0) || prod.is_staff_only) return false;
    if (String(prod.name ?? "").toLowerCase().includes("staff")) return false;
    return true;
  });
}

/** Unpaid late cancel and no-show fees for a member (from member_fees). */
async function loadUnpaidFees(supabase: any, profileId: string) {
  const { data } = await supabase
    .from("member_fees")
    .select("id, amount_zar, kind")
    .eq("profile_id", profileId)
    .eq("status", "unpaid");
  const rows: any[] = data ?? [];
  const cents = rows.reduce((sum: number, r: any) => sum + Math.round(Number(r.amount_zar || 0) * 100), 0);
  return { ids: rows.map((r: any) => String(r.id)), cents };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const YOCO_SECRET = Deno.env.get("YOCO_SECRET_KEY")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const raw = await req.json();
  console.log("yoco-checkout body keys:", raw && typeof raw === "object" ? Object.keys(raw) : raw);

  if (raw?.type === "class_invite") {
    const class_invite_id = String(raw.class_invite_id ?? "");
    const inviter_profile_id = String(raw.inviter_profile_id ?? "");
    const success_url = String(raw.success_url ?? "");
    const cancel_url = String(raw.cancel_url ?? "");

    if (!class_invite_id || !inviter_profile_id || !success_url || !cancel_url) {
      return new Response(
        JSON.stringify({ error: "class_invite_id, inviter_profile_id, success_url, cancel_url required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: inv, error: invErr } = await supabase
      .from("class_invites")
      .select("id, inviter_id, status, paid_by_inviter, class_id, classes(id, name)")
      .eq("id", class_invite_id)
      .maybeSingle();

    if (invErr || !inv) {
      return new Response(JSON.stringify({ error: "Invite not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const invRow = inv as {
      inviter_id: string;
      status: string | null;
      paid_by_inviter: boolean | null;
    };
    if (invRow.inviter_id !== inviter_profile_id || invRow.status !== "pending_payment") {
      return new Response(JSON.stringify({ error: "Invalid invite for checkout" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!invRow.paid_by_inviter) {
      return new Response(JSON.stringify({ error: "Invite is not pay-for-friend" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The invite price is set on the server only; any amount sent by the app is ignored.
    const zar = Number(Deno.env.get("CLASS_INVITE_AMOUNT_ZAR") ?? "180");
    const amountCents = Math.round(zar * 100);

    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", inviter_profile_id)
      .maybeSingle();
    const buyerName =
      [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(" ") || "Member";
    const classJoin = (inv as { classes?: { id?: string; name?: string } | { id?: string; name?: string }[] | null }).classes;
    const classRow = one(classJoin);
    const inviteClassId =
      String((inv as { class_id?: string | null }).class_id ?? classRow?.id ?? "").trim() || null;
    const className = classRow?.name;
    const inviteDescription = className
      ? `Class invite — ${className}`
      : "One Flow — class invite (pay for friend)";
    const inviteClass = inviteClassId ? await lookupClassBillFields(supabase, inviteClassId) : null;
    const inviteBillNote = buildBillNote({
      id: class_invite_id,
      kind: "class",
      classTitle: inviteClass?.classTitle ?? className ?? "Class invite",
      startsAt: inviteClass?.startsAt,
      firstName: inviterProfile?.first_name,
      lastName: inviterProfile?.last_name,
    });

    const invitePayload = {
      amount: amountCents,
      currency: "ZAR",
      customer_reference: yocoCustomerReference(buyerName),
      customer_description: yocoCustomerDescription(inviteDescription),
      description: "One Flow — class invite (pay for friend)",
      successUrl: success_url,
      cancelUrl: cancel_url,
      failureUrl: cancel_url,
      metadata: {
        type: "class_invite",
        class_invite_id,
        inviter_profile_id,
        buyer_name: buyerName,
        billNote: inviteBillNote,
      },
    };
    console.log("yoco class_invite request:", JSON.stringify(invitePayload));

    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YOCO_SECRET}`,
      },
      body: JSON.stringify(invitePayload),
    });

    const checkout = await yocoRes.json();
    console.log("yoco class_invite status:", yocoRes.status);
    console.log("yoco class_invite body:", JSON.stringify(checkout));
    return new Response(JSON.stringify(checkout), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pay outstanding late cancel / no-show fees on their own.
  if (raw?.type === "fees") {
    const feeProfileId = String(raw.profile_id ?? "");
    const feeAuth = req.headers.get("Authorization") ?? "";
    let feeUserId: string | null = null;
    if (feeAuth.startsWith("Bearer ") && SUPABASE_ANON_KEY) {
      const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: feeAuth } } });
      const { data: u } = await c.auth.getUser();
      feeUserId = u.user?.id ?? null;
    }
    if (!feeUserId || feeUserId !== feeProfileId) {
      return new Response(JSON.stringify({ error: "Please sign in to pay your fees." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fees = await loadUnpaidFees(supabase, feeProfileId);
    if (fees.cents <= 0) {
      return new Response(JSON.stringify({ error: "There are no fees to pay." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: feeProfile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", feeProfileId)
      .maybeSingle();
    const feeBuyer = [feeProfile?.first_name, feeProfile?.last_name].filter(Boolean).join(" ") || "Member";
    const feePayload = {
      amount: fees.cents,
      currency: "ZAR",
      lineItems: [{ displayName: "Outstanding studio fees", quantity: 1, pricingDetails: { price: fees.cents } }],
      customer_reference: yocoCustomerReference(feeBuyer),
      customer_description: yocoCustomerDescription("Outstanding studio fees"),
      description: `Outstanding studio fees — ${feeBuyer}`,
      successUrl: String(raw.success_url ?? ""),
      cancelUrl: String(raw.cancel_url ?? ""),
      failureUrl: String(raw.cancel_url ?? ""),
      metadata: { type: "fees", profile_id: feeProfileId, fee_ids: fees.ids.join(","), buyer_name: feeBuyer },
    };
    const feeRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${YOCO_SECRET}` },
      body: JSON.stringify(feePayload),
    });
    const feeCheckout = await feeRes.json();
    console.log("yoco fees status:", feeRes.status);
    return new Response(JSON.stringify(feeCheckout), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { pack_id, profile_id, success_url, cancel_url } = raw;
  console.log("pack_id:", pack_id, "profile_id:", profile_id);

  const authHeader = req.headers.get("Authorization") ?? "";
  let authedUserId: string | null = null;
  if (authHeader.startsWith("Bearer ") && SUPABASE_ANON_KEY) {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await authClient.auth.getUser();
    authedUserId = authData.user?.id ?? null;
  }

  const flowPointsUsedRaw = Number(raw?.flow_points_used ?? 0);
  const flowPointsUsed = Number.isFinite(flowPointsUsedRaw)
    ? Math.max(0, Math.floor(flowPointsUsedRaw))
    : 0;
  const flowPointsDiscountZar = Number(raw?.flow_points_discount_zar ?? 0);

  if (flowPointsUsed > 0) {
    if (!authedUserId || authedUserId !== String(profile_id)) {
      return new Response(
        JSON.stringify({ error: "Sign in to redeem Flow Points on your own account." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const { data: pack, error: packError } = await supabase
    .from("products")
    .select("*")
    .eq("id", pack_id)
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .single();
  console.log("pack result:", JSON.stringify(pack), "error:", JSON.stringify(packError));

  if (!pack) {
    return new Response(JSON.stringify({ error: "Pack not found" }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  const packRow: any = pack;
  if (packRow.is_active === false || packRow.is_staff_only === true) {
    return new Response(JSON.stringify({ error: "This pack is not available to buy." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!authedUserId || authedUserId !== String(profile_id)) {
    return new Response(JSON.stringify({ error: "Please sign in to buy a pack." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const listPriceZar = Number(packRow.price_zar);
  const memberPriceZar = Number(packRow.member_price_zar ?? 0);
  let memberPriceApplied = false;
  let priceZar = listPriceZar;
  if (memberPriceZar > 0 && memberPriceZar < listPriceZar && (await isActiveMember(supabase, String(profile_id)))) {
    priceZar = memberPriceZar;
    memberPriceApplied = true;
  }

  const upgradePriceZar = Number(packRow.upgrade_price_zar ?? 0);
  const openAccessUpgrade =
    raw?.open_access_upgrade === true && upgradePriceZar > 0 && packRow.access_scope !== "open_access";
  const upgradeCents = openAccessUpgrade ? Math.round(upgradePriceZar * 100) : 0;

  // Outstanding late cancel / no-show fees are added to the purchase.
  const unpaidFees = await loadUnpaidFees(supabase, String(profile_id));
  const lateFeeCents = unpaidFees.cents;
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, late_cancel_fee_pending, flow_points")
    .eq("id", profile_id)
    .maybeSingle();
  const buyerName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Member";
  const hasLateCancelFee = unpaidFees.ids.length > 0;
  const baseAmountCents = Number.isFinite(priceZar) ? Math.round(priceZar * 100) : NaN;

  let promoDiscountCents = 0;
  let promoApplied: { id: string; code: string } | null = null;
  const rawPromoCode = String(raw?.promo_code ?? "").trim().toUpperCase();
  if (rawPromoCode) {
    const { data: promo } = await supabase
      .from("promotions")
      .select(
        "id, code, discount_type, discount_value, applies_to, max_uses, uses_count, valid_from, valid_until, is_active",
      )
      .eq("code", rawPromoCode)
      .maybeSingle();
    const p = promo as
      | {
          id: string;
          code: string;
          discount_type: string;
          discount_value: number;
          applies_to: string;
          max_uses: number | null;
          uses_count: number | null;
          valid_from: string | null;
          valid_until: string | null;
          is_active: boolean;
        }
      | null;
    if (p && p.is_active) {
      const now = Date.now();
      const validFrom = p.valid_from ? new Date(p.valid_from).getTime() : null;
      const validUntil = p.valid_until ? new Date(p.valid_until).getTime() : null;
      const inWindow =
        (validFrom == null || now >= validFrom) && (validUntil == null || now <= validUntil);
      const usesOk = p.max_uses == null || (p.uses_count ?? 0) < p.max_uses;
      const packCategory = String((pack as { category?: string }).category ?? "");
      const appliesOk =
        p.applies_to === "all" ||
        (p.applies_to === "yoga" && packCategory === "yoga") ||
        (p.applies_to === "wellzone" && packCategory === "wellzone");
      if (inWindow && usesOk && appliesOk && Number.isFinite(baseAmountCents)) {
        if (p.discount_type === "percentage") {
          promoDiscountCents = Math.min(
            baseAmountCents,
            Math.round((baseAmountCents * Number(p.discount_value)) / 100),
          );
        } else {
          promoDiscountCents = Math.min(
            baseAmountCents,
            Math.round(Number(p.discount_value) * 100),
          );
        }
        promoApplied = { id: p.id, code: p.code };
      }
    }
  }

  const afterPromoCents = Number.isFinite(baseAmountCents)
    ? Math.max(0, baseAmountCents - promoDiscountCents)
    : NaN;

  let flowDiscountCents = 0;
  if (flowPointsUsed > 0 && Number.isFinite(afterPromoCents)) {
    const { data: rateRow } = await supabase
      .from("studio_settings")
      .select("value")
      .eq("key", "flow_points_conversion_rate")
      .maybeSingle();
    const rateRaw = Number((rateRow as { value?: string } | null)?.value);
    const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 10;

    const balance = Math.max(
      0,
      Math.floor(Number((profile as { flow_points?: number } | null)?.flow_points ?? 0)),
    );
    if (flowPointsUsed > balance) {
      return new Response(JSON.stringify({ error: "Not enough Flow Points for this checkout." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedDiscountCents = Math.round(flowPointsUsed * rate);
    const clientDiscountCents = Math.round(flowPointsDiscountZar * 100);
    if (Math.abs(expectedDiscountCents - clientDiscountCents) > 2) {
      return new Response(JSON.stringify({ error: "Flow Points discount does not match the conversion rate." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    flowDiscountCents = Math.min(expectedDiscountCents, afterPromoCents);
    if (flowDiscountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Flow Points cannot be applied to this checkout amount." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const packOnlyCents = Number.isFinite(afterPromoCents)
    ? Math.max(100, afterPromoCents - flowDiscountCents)
    : NaN;
  const packPayableCents = Number.isFinite(packOnlyCents) ? packOnlyCents + upgradeCents : NaN;
  const lateFeeApplied = hasLateCancelFee && lateFeeCents > 0;
  const amountCents = Number.isFinite(packPayableCents)
    ? packPayableCents + (lateFeeApplied ? lateFeeCents : 0)
    : NaN;
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return new Response(JSON.stringify({ error: "Invalid price_zar on product" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (promoApplied) {
    const { data: cur } = await supabase
      .from("promotions")
      .select("uses_count")
      .eq("id", promoApplied.id)
      .maybeSingle();
    const next = (Number((cur as { uses_count?: number } | null)?.uses_count ?? 0) || 0) + 1;
    await supabase.from("promotions").update({ uses_count: next }).eq("id", promoApplied.id);
  }

  const packName = String((pack as { name?: string }).name ?? "One Flow purchase");
  const packLinePriceCents = Number.isFinite(packOnlyCents)
    ? packOnlyCents
    : Math.round(priceZar * 100);
  const lineItems: Array<{
    displayName: string;
    quantity: number;
    pricingDetails: { price: number };
  }> = [
    {
      displayName: `${packName} — ${buyerName}`,
      quantity: 1,
      pricingDetails: { price: packLinePriceCents },
    },
  ];
  if (openAccessUpgrade) {
    lineItems.push({
      displayName: "Open Access upgrade (Longkloof + Green Point)",
      quantity: 1,
      pricingDetails: { price: upgradeCents },
    });
  }
  if (lateFeeApplied) {
    lineItems.push({
      displayName: "Outstanding studio fees",
      quantity: 1,
      pricingDetails: { price: lateFeeCents },
    });
  }

  const classId = classIdFromInput(
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {},
    String(success_url ?? ""),
  );
  const classBill = classId ? await lookupClassBillFields(supabase, classId) : null;
  const packBillNote = classBill
    ? buildBillNote({
        id: classId!,
        kind: "class",
        classTitle: classBill.classTitle,
        startsAt: classBill.startsAt,
        firstName: profile?.first_name,
        lastName: profile?.last_name,
      })
    : buildBillNote({
        id: String(pack_id ?? ""),
        kind: "package",
        packageName: packName,
        firstName: profile?.first_name,
        lastName: profile?.last_name,
      });

  const packPayload = {
    amount: amountCents,
    currency: "ZAR",
    lineItems,
    customer_reference: yocoCustomerReference(buyerName),
    customer_description: yocoCustomerDescription(packName),
    description: `${packName}${openAccessUpgrade ? " + Open Access" : ""} — ${buyerName}${
      lateFeeApplied ? ` + R${Math.round(lateFeeCents / 100)} outstanding fees` : ""
    }`,
    successUrl: success_url,
    cancelUrl: cancel_url,
    failureUrl: cancel_url,
    metadata: {
      pack_id,
      profile_id,
      buyer_name: buyerName,
      late_cancel_fee_applied: lateFeeApplied,
      description: lateFeeApplied ? `+ R${Math.round(lateFeeCents / 100)} outstanding fees` : "",
      fee_ids: lateFeeApplied ? unpaidFees.ids.join(",") : "",
      open_access_upgrade: openAccessUpgrade,
      upgrade_amount_zar: openAccessUpgrade ? upgradePriceZar : 0,
      member_price_applied: memberPriceApplied,
      amount_paid_zar: Number.isFinite(packPayableCents) ? Math.round(packPayableCents) / 100 : null,
      promo_code_applied: promoApplied?.code ?? null,
      promo_discount_zar: promoDiscountCents > 0 ? Math.round(promoDiscountCents / 100) : 0,
      flow_points_used: flowPointsUsed > 0 ? flowPointsUsed : 0,
      flow_points_discount_zar:
        flowDiscountCents > 0 ? Math.round((flowDiscountCents / 100) * 100) / 100 : 0,
      billNote: packBillNote,
    },
  };
  console.log("yoco pack request:", JSON.stringify(packPayload));

  const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${YOCO_SECRET}`,
    },
    body: JSON.stringify(packPayload),
  });

  const checkout = await yocoRes.json();
  console.log("yoco status:", yocoRes.status);
  console.log("yoco body:", JSON.stringify(checkout));
  return new Response(JSON.stringify(checkout), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
