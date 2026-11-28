import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Daily error email: at 07:30 Cape Town time, lists yesterday's error pop-ups (from app_errors),
 * grouped by error and what people were doing, with who saw them. No errors, no email.
 * Sent to studio_settings 'error_digest_email'.
 *
 * Called by the database schedule (cron). Verify JWT is OFF, so it is protected another way:
 * it only runs from 07:00 Cape Town time, and only once per day (error_digest_runs).
 */

const TZ = "Africa/Johannesburg";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

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

async function recipient(sb: any): Promise<string> {
  const { data } = await sb.from("studio_settings").select("value").eq("key", "error_digest_email").maybeSingle();
  return String((data as any)?.value ?? "").trim() || "jeanae@oneflow.co.za";
}

async function sendInstant(sb: any, apiKey: string, id: string) {
  const { data: e } = await sb
    .from("app_errors")
    .select("id, profile_id, created_at, kind, message, path, activity, details, user_agent, emailed_at, profile:profile_id(first_name, last_name, email, phone)")
    .eq("id", id)
    .maybeSingle();
  if (!e || e.kind !== "payment" || e.emailed_at) return json({ skipped: "not a new payment error" });

  // Same error in the last 15 minutes already emailed: don't flood the inbox during an outage.
  // Paid-but-no-pass is checked per member, so every member it happens to is emailed.
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  let recentQ = sb
    .from("app_errors")
    .select("id")
    .eq("kind", "payment")
    .eq("message", e.message)
    .not("emailed_at", "is", null)
    .gte("emailed_at", since);
  if ((e.details as any)?.["Money taken"] === "Yes") {
    recentQ = e.profile_id ? recentQ.eq("profile_id", e.profile_id) : recentQ.is("profile_id", null);
  }
  const { data: recent } = await recentQ.limit(1);
  if (recent && recent.length > 0) return json({ skipped: "same error emailed in the last 15 minutes" });

  const { data: claimed } = await sb
    .from("app_errors")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", id)
    .is("emailed_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return json({ skipped: "already emailed" });

  const p = Array.isArray(e.profile) ? e.profile[0] : e.profile;
  const who = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || "Member" : "Not signed in";
  const d = (e.details ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ["When", `${new Date(e.created_at).toLocaleString("en-ZA", { timeZone: TZ, hour12: false })}`],
    ["Member", who],
    ["Email", p?.email ?? ""],
    ["Phone", p?.phone ?? ""],
    ["Error", String(e.message ?? "")],
    ["Trying to", String(e.activity ?? "")],
    ["Page", String(e.path ?? "")],
    ...Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]),
    ["Phone or browser", String(e.user_agent ?? "")],
  ];
  const moneyTaken = d["Money taken"] === "Yes";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,sans-serif;color:#1f1f1f">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:20px;margin:0 0 6px">${moneyTaken ? "Paid, but the pass wasn't added" : "A payment failed on our side"}</h1>
      <p style="margin:0 0 16px;color:#6b6b6b">${
        moneyTaken
          ? "Yoco took the money but the app couldn't add the pass. Load it for them by hand and let them know."
          : "The member couldn't get to the payment page because of an error in the app. Contact them so the sale isn't lost."
      }</p>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:10px;font-size:15px">${rows
        .filter(([, v]) => v)
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 12px;border-top:1px solid #eee;color:#6b6b6b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:10px 12px;border-top:1px solid #eee">${esc(v)}</td></tr>`,
        )
        .join("")}</table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b6b6b">More of the same error in the next 15 minutes won't email again; they'll be in tomorrow's 07:30 error email.</p>
    </div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "One Flow <noreply@oneflow.co.za>",
      to: [await recipient(sb)],
      subject: `${moneyTaken ? "URGENT: paid but no pass" : "Payment failed"}: ${who}`,
      html,
    }),
  });
  if (!res.ok) {
    await sb.from("app_errors").update({ emailed_at: null }).eq("id", id);
    return json({ error: `Email failed: ${res.status}` }, 500);
  }
  return json({ sent: true, instant: id });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "Missing RESEND_API_KEY" }, 500);
  const sb: any = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // A payment failure on our side: email it straight away.
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* no body: the daily run */
  }
  if (body?.instant_id) return await sendInstant(sb, apiKey, String(body.instant_id));

  const now = capeParts(new Date());
  if (now.hour < 7) return json({ skipped: "too early", cape_hour: now.hour });
  const yesterday = addDays(now.ymd, -1);

  const { data: claimed, error: claimErr } = await sb
    .from("error_digest_runs")
    .upsert({ run_day: now.ymd }, { onConflict: "run_day", ignoreDuplicates: true })
    .select("run_day");
  if (claimErr) return json({ error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ skipped: "already sent today", day: now.ymd });

  // Yesterday, midnight to midnight Cape Town time (UTC+2, no daylight saving).
  const from = new Date(`${yesterday}T00:00:00+02:00`).toISOString();
  const to = new Date(`${now.ymd}T00:00:00+02:00`).toISOString();
  const { data: errors, error } = await sb
    .from("app_errors")
    .select("created_at, message, path, activity, user_agent, profile:profile_id(first_name, last_name, email)")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return json({ error: error.message }, 500);
  const list = (errors ?? []) as any[];
  await sb.from("error_digest_runs").update({ errors_count: list.length }).eq("run_day", now.ymd);
  if (list.length === 0) return json({ sent: false, reason: "no errors", day: yesterday });

  const to_email = await recipient(sb);

  // Group the same error on the same kind of task together.
  type Group = { message: string; activity: string; count: number; people: Set<string>; times: string[]; paths: Set<string> };
  const groups = new Map<string, Group>();
  for (const e of list) {
    const message = String(e.message ?? "");
    const activity = String(e.activity ?? "");
    const key = `${message}|${activity}`;
    const g = groups.get(key) ?? { message, activity, count: 0, people: new Set(), times: [], paths: new Set() };
    g.count++;
    const p = Array.isArray(e.profile) ? e.profile[0] : e.profile;
    const name = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Member" : "Not signed in";
    g.people.add(name);
    g.times.push(time(e.created_at));
    if (e.path) g.paths.add(String(e.path));
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

  const rows = sorted
    .map(
      (g) => `<tr>
        <td style="padding:12px;border-top:1px solid #eee;vertical-align:top;font-weight:600;white-space:nowrap">${g.count}&times;</td>
        <td style="padding:12px;border-top:1px solid #eee;vertical-align:top">
          <div style="font-weight:600">${esc(g.message)}</div>
          <div style="color:#6b6b6b;font-size:13px;margin-top:4px">Trying to ${esc(g.activity || "use the app")} &middot; ${esc([...g.paths].join(", "))}</div>
          <div style="color:#6b6b6b;font-size:13px;margin-top:4px">Who: ${esc([...g.people].join(", "))}</div>
          <div style="color:#6b6b6b;font-size:13px;margin-top:4px">When: ${esc(g.times.slice(0, 12).join(", "))}${g.times.length > 12 ? " &hellip;" : ""}</div>
        </td>
      </tr>`,
    )
    .join("");
  const dayLabel = new Date(`${yesterday}T12:00:00Z`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,sans-serif;color:#1f1f1f">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:20px;margin:0 0 6px">App errors, ${esc(dayLabel)}</h1>
      <p style="margin:0 0 16px;color:#6b6b6b">${list.length} error pop-up${list.length === 1 ? "" : "s"}, ${sorted.length} different problem${sorted.length === 1 ? "" : "s"}. Most frequent first.</p>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:10px;font-size:15px">${rows}</table>
    </div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "One Flow <noreply@oneflow.co.za>",
      to: [to_email],
      subject: `App errors yesterday: ${list.length} pop-up${list.length === 1 ? "" : "s"}`,
      html,
    }),
  });
  if (!res.ok) return json({ error: `Email failed: ${res.status}` }, 500);
  return json({ sent: true, errors: list.length, day: yesterday });
});
