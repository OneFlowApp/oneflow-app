import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHECK_IN_STAFF_ROLES = new Set([
  "director",
  "management",
  "front_desk",
  "guide",
  "boh",
]);

type ChallengeWindow = {
  enabled: boolean;
  start: string;
  end: string;
};

const DEFAULT_CHALLENGE_WINDOW: ChallengeWindow = {
  enabled: true,
  start: "2026-05-01",
  end: "2026-05-31",
};

async function loadChallengeWindow(admin: SupabaseClient): Promise<ChallengeWindow> {
  const { data } = await admin
    .from("studio_settings")
    .select("value")
    .eq("key", "movement_challenge")
    .maybeSingle();

  const raw = (data as { value?: string | null } | null)?.value;
  if (!raw?.trim()) return DEFAULT_CHALLENGE_WINDOW;

  try {
    const parsed = JSON.parse(raw) as {
      enabled?: boolean;
      start_date?: string;
      end_date?: string;
    };
    return {
      enabled: parsed.enabled !== false,
      start: String(parsed.start_date ?? DEFAULT_CHALLENGE_WINDOW.start).trim(),
      end: String(parsed.end_date ?? DEFAULT_CHALLENGE_WINDOW.end).trim(),
    };
  } catch {
    return DEFAULT_CHALLENGE_WINDOW;
  }
}

function isChallengeClassDate(dateStr: string, window: ChallengeWindow): boolean {
  if (!window.enabled) return false;
  return dateStr >= window.start && dateStr <= window.end;
}

type DebugStep = Record<string, unknown>;

function adminApiKey(): string {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service) return service;

  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    const secretKeys = JSON.parse(secretKeysRaw) as Record<string, string>;
    if (secretKeys["default"]) return secretKeys["default"];
  }

  throw new Error("No admin API key configured");
}

function createAdminClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function classDateFromStartsAtIso(startsAtIso: string): string {
  return new Date(startsAtIso).toISOString().split("T")[0] ?? "";
}

async function findAuthUserIdByEmail(
  admin: SupabaseClient,
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

  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit?.id) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const debug: Record<string, DebugStep> = {};

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerErr,
    } = await caller.auth.getUser();

    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized", debug }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await caller
      .from("profiles")
      .select("role")
      .eq("id", callerUser.id)
      .maybeSingle();

    const callerRole = String(callerProfile?.role ?? "").toLowerCase();
    if (!CHECK_IN_STAFF_ROLES.has(callerRole)) {
      return new Response(JSON.stringify({ ok: false, error: "You do not have permission to check in walk-ins", debug }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const profile_id_in = String(body?.profile_id ?? "").trim();
    const first_name = String(body?.first_name ?? "").trim();
    const last_name = String(body?.last_name ?? "").trim();
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const class_id = String(body?.class_id ?? "").trim();
    const credit_id_raw = String(body?.credit_id ?? "").trim();
    const credit_id = credit_id_raw.length > 0 ? credit_id_raw : null;
    const payment_method_in = String(body?.payment_method ?? "").trim().toLowerCase();
    const payment_method =
      payment_method_in === "credit" && credit_id ? "credit" : "cash";

    if (!class_id) {
      return new Response(JSON.stringify({ ok: false, error: "class_id is required", debug }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile_id_in && (!first_name || !last_name || !email)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Provide profile_id (existing member) or first_name, last_name, and email (new person)",
          debug,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (payment_method === "credit" && !credit_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "credit_id is required when payment_method is credit", debug }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createAdminClient(SUPABASE_URL, adminApiKey());
    const waiverAt = new Date().toISOString();

    let profileId: string | undefined;
    let createdProfile = false;
    let role = "customer";

    if (profile_id_in) {
      const { data: existingById, error: byIdErr } = await admin
        .from("profiles")
        .select("id, role, waiver_accepted_at")
        .eq("id", profile_id_in)
        .maybeSingle();

      debug.profile_lookup = { mode: "by_id", existingById, byIdErr };
      console.log("[walk-in-checkin] after profile lookup by id", debug.profile_lookup);

      if (byIdErr) {
        return new Response(JSON.stringify({ ok: false, error: byIdErr.message, debug }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!existingById?.id) {
        return new Response(JSON.stringify({ ok: false, error: "Member profile not found", debug }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      profileId = existingById.id as string;
      role = String(existingById.role ?? "customer");

      if (!existingById.waiver_accepted_at) {
        const { error: waiverErr } = await admin
          .from("profiles")
          .update({ waiver_accepted_at: waiverAt })
          .eq("id", profileId);

        debug.waiver_update = { profileId, waiverErr };
        console.log("[walk-in-checkin] after waiver update", debug.waiver_update);

        if (waiverErr) {
          console.error("[walk-in-checkin] waiver update failed", waiverErr);
          return new Response(JSON.stringify({ ok: false, error: waiverErr.message, debug }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } else {
      const { data: existingProfile, error: lookupErr } = await admin
        .from("profiles")
        .select("id, role, waiver_accepted_at")
        .ilike("email", email)
        .maybeSingle();

      debug.profile_lookup = { mode: "by_email", existingProfile, lookupErr };
      console.log("[walk-in-checkin] after profile lookup by email", debug.profile_lookup);

      if (lookupErr) {
        return new Response(JSON.stringify({ ok: false, error: lookupErr.message, debug }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      profileId = existingProfile?.id as string | undefined;
      role = String(existingProfile?.role ?? "customer");

      if (!profileId) {
        const { data: createData, error: createUserErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { first_name, last_name, role: "customer" },
        });

        if (createUserErr) {
          const msg = createUserErr.message.toLowerCase();
          const alreadyRegistered =
            msg.includes("already") || msg.includes("registered") || msg.includes("exists");

          if (!alreadyRegistered) {
            debug.profile_create = { createUserErr };
            console.error("[walk-in-checkin] profile create failed", createUserErr);
            return new Response(JSON.stringify({ ok: false, error: createUserErr.message, debug }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const authUserId = await findAuthUserIdByEmail(admin, email);
          if (!authUserId) {
            debug.profile_create = { createUserErr, note: "auth user not found after duplicate email error" };
            return new Response(JSON.stringify({ ok: false, error: createUserErr.message, debug }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          profileId = authUserId;
        } else {
          profileId = createData.user?.id;
          if (!profileId) {
            return new Response(JSON.stringify({ ok: false, error: "Auth user was not created", debug }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        const { error: upsertErr } = await admin.from("profiles").upsert(
          {
            id: profileId,
            email,
            first_name,
            last_name,
            role: "customer",
            waiver_accepted_at: waiverAt,
          },
          { onConflict: "id" },
        );

        debug.profile_create = { profileId, upsertErr, createdAuthUser: !createUserErr };
        console.log("[walk-in-checkin] after profile creation", debug.profile_create);

        if (upsertErr) {
          console.error("[walk-in-checkin] profile upsert failed", upsertErr);
          return new Response(JSON.stringify({ ok: false, error: upsertErr.message, debug }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        createdProfile = true;
      } else if (!existingProfile?.waiver_accepted_at) {
        const { error: waiverErr } = await admin
          .from("profiles")
          .update({ waiver_accepted_at: waiverAt })
          .eq("id", profileId);

        debug.waiver_update = { profileId, waiverErr };
        console.log("[walk-in-checkin] after waiver update", debug.waiver_update);

        if (waiverErr) {
          console.error("[walk-in-checkin] waiver update failed", waiverErr);
          return new Response(JSON.stringify({ ok: false, error: waiverErr.message, debug }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (credit_id) {
      const { data: creditRow, error: creditErr } = await admin
        .from("user_credits")
        .select("id, profile_id, credits_remaining, is_unlimited, expires_at")
        .eq("id", credit_id)
        .maybeSingle();

      debug.credit_lookup = { creditRow, creditErr };
      if (creditErr) {
        return new Response(JSON.stringify({ ok: false, error: creditErr.message, debug }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!creditRow?.id || String(creditRow.profile_id) !== profileId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Selected credit does not belong to this member", debug }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (creditRow.expires_at && new Date(String(creditRow.expires_at)).getTime() < Date.now()) {
        return new Response(JSON.stringify({ ok: false, error: "Selected credit has expired", debug }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!creditRow.is_unlimited && Number(creditRow.credits_remaining ?? 0) < 1) {
        return new Response(JSON.stringify({ ok: false, error: "Selected credit has no remaining classes", debug }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: classRow, error: classErr } = await admin
      .from("classes")
      .select("id, starts_at")
      .eq("id", class_id)
      .maybeSingle();

    if (classErr || !classRow?.starts_at) {
      return new Response(JSON.stringify({ ok: false, error: classErr?.message ?? "Class not found", debug }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const checkedAt = new Date().toISOString();
    const qrToken = crypto.randomUUID();
    // A class that hasn't started yet: book the person in, don't check them in.
    const notStarted = new Date(String(classRow.starts_at)).getTime() > Date.now();

    const { data: existingBooking, error: existingBookErr } = await admin
      .from("bookings")
      .select("id, status, credit_id")
      .eq("profile_id", profileId)
      .eq("class_id", class_id)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingBookErr) {
      return new Response(JSON.stringify({ ok: false, error: existingBookErr.message, debug }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let bookingId: string;

    if (existingBooking?.id && notStarted) {
      // Already booked into a class that hasn't started: nothing to do.
      bookingId = existingBooking.id as string;
    } else if (existingBooking?.id) {
      // Already booked — mark attended only. Do not attach a new credit (avoids double-deduct).
      const { data: updated, error: updateErr } = await admin
        .from("bookings")
        .update({
          status: "attended",
          checked_in: true,
          checked_in_at: checkedAt,
        })
        .eq("id", existingBooking.id)
        .select("id")
        .single();

      debug.booking_insert = { mode: "update_existing", existingBooking, updated, updateErr };
      console.log("[walk-in-checkin] after booking insert", debug.booking_insert);

      if (updateErr || !updated?.id) {
        console.error("[walk-in-checkin] booking update failed", updateErr);
        return new Response(JSON.stringify({ ok: false, error: updateErr?.message ?? "Could not update booking", debug }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookingId = updated.id as string;
    } else {
      const insertRow: Record<string, unknown> = {
        profile_id: profileId,
        class_id,
        status: notStarted ? "confirmed" : "attended",
        payment_method,
        qr_token: qrToken,
        checked_in: !notStarted,
        checked_in_at: notStarted ? null : checkedAt,
        booked_by: callerUser.id,
      };
      if (payment_method === "credit" && credit_id) {
        insertRow.credit_id = credit_id;
      }

      const { data: inserted, error: bookErr } = await admin
        .from("bookings")
        .insert(insertRow)
        .select("id")
        .single();

      debug.booking_insert = { mode: "insert", inserted, bookErr, payment_method, credit_id };
      console.log("[walk-in-checkin] after booking insert", debug.booking_insert);

      if (bookErr || !inserted?.id) {
        console.error("[walk-in-checkin] booking insert failed", bookErr);
        return new Response(JSON.stringify({ ok: false, error: bookErr?.message ?? "Could not create booking", debug }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookingId = inserted.id as string;
    }

    const classDate = classDateFromStartsAtIso(classRow.starts_at as string);
    const challengeWindow = await loadChallengeWindow(admin);
    if (!notStarted && classDate && isChallengeClassDate(classDate, challengeWindow)) {
      const { error: challengeErr } = await admin.from("challenge_checkins").upsert(
        {
          profile_id: profileId,
          class_date: classDate,
          booking_id: bookingId,
        },
        { onConflict: "booking_id" },
      );

      debug.challenge_checkin = { classDate, challengeErr };
      console.log("[walk-in-checkin] after challenge_checkins insert", debug.challenge_checkin);

      if (challengeErr) {
        console.error("[walk-in-checkin] challenge_checkins upsert failed", challengeErr);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        profile_id: profileId,
        booking_id: bookingId,
        booked_only: notStarted,
        role,
        created_profile: createdProfile,
        payment_method,
        debug,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[walk-in-checkin] error", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: message, debug }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
