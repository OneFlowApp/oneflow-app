import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Daily guide schedule: at 16:00 Cape Town time each guide gets one email listing
 * their classes for tomorrow (time, class, room, bookings). Guides with no classes get nothing.
 *
 * Called by the database schedule (cron). Verify JWT is OFF, so it is protected another way:
 * it only runs from 15:00 Cape Town time, and only once per day (guide_schedule_runs).
 */

const TZ = "Africa/Johannesburg";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** yyyy-mm-dd and hour for a moment, in Cape Town time. */
function capeParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "Missing RESEND_API_KEY" }, 500);
  const sb: any = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const now = capeParts(new Date());
  if (now.hour < 15) return json({ skipped: "too early", cape_hour: now.hour });
  const tomorrow = addDays(now.ymd, 1);

  // Once per day: claim today's run. A second call the same day does nothing.
  const { data: claimed, error: claimErr } = await sb
    .from("guide_schedule_runs")
    .upsert({ run_day: now.ymd }, { onConflict: "run_day", ignoreDuplicates: true })
    .select("run_day");
  if (claimErr) return json({ error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ skipped: "already sent today", day: now.ymd });

  // Tomorrow, midnight to midnight Cape Town time (UTC+2, no daylight saving).
  const from = new Date(`${tomorrow}T00:00:00+02:00`).toISOString();
  const to = new Date(`${addDays(tomorrow, 1)}T00:00:00+02:00`).toISOString();

  const { data: classes, error } = await sb
    .from("classes")
    .select("id, name, title_override, starts_at, ends_at, location, capacity, booked_count, guide_id, is_cancelled")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .not("guide_id", "is", null)
    .order("starts_at");
  if (error) return json({ error: error.message }, 500);

  const live = (classes ?? []).filter((c: any) => !c.is_cancelled);
  if (live.length === 0) return json({ sent: 0, day: tomorrow, note: "no classes tomorrow" });

  const guideIds = [...new Set(live.map((c: any) => String(c.guide_id)))];
  const { data: guides } = await sb
    .from("guides")
    .select("id, is_active, profile:profile_id(first_name, email)")
    .in("id", guideIds);

  const dayLabel = new Date(`${tomorrow}T12:00:00+02:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });

  let sent = 0;
  const failed: string[] = [];
  for (const g of guides ?? []) {
    const prof = Array.isArray(g.profile) ? g.profile[0] : g.profile;
    const email = String(prof?.email ?? "").trim();
    if (!email || g.is_active === false) continue;
    const mine = live.filter((c: any) => String(c.guide_id) === String(g.id));
    if (mine.length === 0) continue;

    const rows = mine
      .map((c: any) => {
        const title = esc(String(c.title_override || c.name || "Class"));
        const room = c.location ? esc(String(c.location)) : "";
        const booked = `${c.booked_count ?? 0}${c.capacity ? ` / ${c.capacity}` : ""} booked`;
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e6e2da;font-weight:600;white-space:nowrap;vertical-align:top">${time(c.starts_at)}${c.ends_at ? `&ndash;${time(c.ends_at)}` : ""}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e6e2da;vertical-align:top">${title}${room ? `<br><span style="color:#6b6b6b;font-size:13px">${room}</span>` : ""}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e6e2da;color:#3d4f36;white-space:nowrap;vertical-align:top">${booked}</td>
        </tr>`;
      })
      .join("");

    const first = esc(String(prof?.first_name ?? "").trim() || "there");
    const html = `<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#2b2b2b">
      <div style="max-width:560px;margin:0 auto;padding:28px 20px">
        <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5f7a52;margin:0 0 8px">One Flow</p>
        <h1 style="font-size:22px;margin:0 0 6px">Hi ${first}, here&rsquo;s your schedule for tomorrow</h1>
        <p style="margin:0 0 18px;color:#555">${esc(dayLabel)} &middot; ${mine.length} class${mine.length === 1 ? "" : "es"}</p>
        <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:10px;font-size:15px">${rows}</table>
        <p style="margin:18px 0 0;font-size:13px;color:#6b6b6b">Bookings are as of 4pm today and can still change. If you can&rsquo;t teach any of these, please let the studio know as soon as possible.</p>
      </div></body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "One Flow <noreply@oneflow.co.za>",
        to: [email],
        subject: `Your classes tomorrow, ${dayLabel}`,
        html,
      }),
    });
    if (res.ok) sent++;
    else failed.push(email);
  }

  await sb.from("guide_schedule_runs").update({ emails_sent: sent }).eq("run_day", now.ymd);
  return json({ sent, failed: failed.length, day: tomorrow });
});
