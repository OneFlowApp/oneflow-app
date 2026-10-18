import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_CALLBACK_URL = "https://oneflow1.netlify.app/auth/callback";

const ALLOWED_ROLES = new Set([
  "customer",
  "other",
  "guide",
  "management",
  "director",
  "boh",
  "front_desk",
  "marketing",
  "team",
]);

const ROLE_EMAIL_LABEL: Record<string, string> = {
  customer: "member",
  other: "member",
  guide: "guide",
  management: "team member",
  director: "director",
  boh: "team member",
  front_desk: "team member",
  marketing: "team member",
  team: "team member",
};

/**
 * Keep in sync with `ALLOWED_CLASS_TYPE_SLUGS` in `src/lib/allowedClassTypes.ts`
 * (Postgres `class_type` enum). Deno edge functions cannot import the app module.
 *
 * These are ENUM values, not the client-editable `public.class_types` rows added in
 * 20260817120000. `guides.disciplines` stores enum slugs, and the enum is unchanged by
 * that migration, so this list is still correct and must NOT grow when the client creates
 * a new class type in Master. It only changes if someone runs `ALTER TYPE … ADD VALUE`.
 */
const DISCIPLINE_SLUGS = new Set([
  "yoga",
  "sculpt",
  "wellzone",
  "sauna_journey",
  "power",
  "beginner",
  "beginner_sculpt",
  "event",
  "pilates",
  "reformer",
]);

const DISCIPLINE_LABEL_TO_SLUG: Record<string, string> = {
  yoga: "yoga",
  sculpt: "sculpt",
  wellzone: "wellzone",
  sauna_journey: "sauna_journey",
  sauna: "sauna_journey",
  "sauna journey": "sauna_journey",
  power: "power",
  beginner: "beginner",
  beginner_sculpt: "beginner_sculpt",
  "beginner sculpt": "beginner_sculpt",
  event: "event",
  pilates: "pilates",
  reformer: "reformer",
};

function normalizeDisciplines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = String(item).trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase().replace(/\s+/g, "_");
    const slug =
      DISCIPLINE_SLUGS.has(lower) ? lower : (DISCIPLINE_LABEL_TO_SLUG[trimmed.toLowerCase()] ?? null);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

function resolveAdminApiKey(): string {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service) return service;

  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    const secretKeys = JSON.parse(secretKeysRaw) as Record<string, string>;
    if (secretKeys["default"]) return secretKeys["default"];
  }

  throw new Error("No admin API key configured");
}

async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const getByEmail = (
    admin.auth.admin as { getUserByEmail?: (e: string) => Promise<{ data: { user: { id: string } | null } }> }
  ).getUserByEmail;
  if (getByEmail) {
    try {
      const { data } = await getByEmail.call(admin.auth.admin, email);
      if (data?.user?.id) return data.user.id;
    } catch {
      // fall through to listUsers
    }
  }

  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match?.id) return match.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isExistingUserInviteError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("already been registered") ||
    lower.includes("already registered") ||
    lower.includes("user already exists") ||
    lower.includes("email address has already")
  );
}

async function sendBrandedInviteEmail(
  supabaseUrl: string,
  serviceKey: string,
  to: string,
  data: Record<string, unknown>,
): Promise<void> {
  const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      template: "user_invite",
      data,
    }),
  });
  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error("send-email user_invite failed:", errText);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    let serviceKey: string;
    try {
      serviceKey = resolveAdminApiKey();
    } catch {
      return new Response(JSON.stringify({ error: "No admin API key configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerErr,
    } = await callerClient.auth.getUser();

    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", callerUser.id)
      .maybeSingle();

    const callerRole = (callerProfile?.role ?? "").toLowerCase();
    if (callerRole !== "director" && callerRole !== "management") {
      return new Response(JSON.stringify({ error: "Only admins can send invites" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const first_name = String(body?.first_name ?? "").trim();
    const last_name = String(body?.last_name ?? "").trim();
    const disciplines = normalizeDisciplines(body?.disciplines);
    const requestedRole = String(body?.role ?? "guide").trim().toLowerCase();
    const role = ALLOWED_ROLES.has(requestedRole) ? requestedRole : "customer";
    const phone = body?.phone != null ? String(body.phone).trim() : "";
    const date_of_birth = body?.date_of_birth != null ? String(body.date_of_birth).trim() : "";

    if (callerRole !== "director" && (role === "director" || role === "management")) {
      return new Response(
        JSON.stringify({ error: "Only directors can invite management or director roles" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!email || !first_name || !last_name) {
      return new Response(
        JSON.stringify({ error: "email, first_name, and last_name are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "Enter a valid email address (e.g. name@example.com)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(SUPABASE_URL, serviceKey);

    let invitedUserId: string;
    let sentInviteEmail = false;
    let effectiveRole = role;

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: APP_CALLBACK_URL,
      data: { first_name, last_name, role },
    });

    if (inviteErr) {
      if (!isExistingUserInviteError(inviteErr.message)) {
        return new Response(JSON.stringify({ error: inviteErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const existingId = await findAuthUserIdByEmail(admin, email);
      if (!existingId) {
        return new Response(JSON.stringify({ error: inviteErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      invitedUserId = existingId;

      const { data: existingProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", existingId)
        .maybeSingle();
      const existingRole = String(existingProfile?.role ?? "").toLowerCase();
      if (existingRole === "director" || existingRole === "management") {
        effectiveRole = existingRole;
      }
    } else {
      const invitedUser = inviteData.user;
      if (!invitedUser) {
        return new Response(JSON.stringify({ error: "Invite did not return a user" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      invitedUserId = invitedUser.id;
      sentInviteEmail = true;
    }

    const profilePayload: Record<string, unknown> = {
      id: invitedUserId,
      email,
      first_name,
      last_name,
      role: effectiveRole,
    };
    if (phone) profilePayload.phone = phone;
    if (date_of_birth) profilePayload.date_of_birth = date_of_birth;

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" });
    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (role === "guide") {
      const { error: guideErr } = await admin.from("guides").upsert(
        {
          profile_id: invitedUserId,
          disciplines,
          is_active: true,
        },
        { onConflict: "profile_id" },
      );

      if (guideErr) {
        return new Response(JSON.stringify({ error: guideErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (sentInviteEmail) {
      await sendBrandedInviteEmail(SUPABASE_URL, serviceKey, email, {
        first_name,
        last_name,
        role_label: ROLE_EMAIL_LABEL[role] ?? "member",
        invite_url: APP_CALLBACK_URL,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        existing_user: !sentInviteEmail,
        user_id: invitedUserId,
        email,
        first_name,
        last_name,
        full_name: `${first_name} ${last_name}`.trim(),
        role: effectiveRole,
        disciplines,
        existing_user: !sentInviteEmail,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
