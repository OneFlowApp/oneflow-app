import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { formatEmailDateTime } from "../_shared/studioFormat.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TemplateName =
  | "booking_confirmation_class"
  | "booking_confirmation_sauna"
  | "class_reminder"
  | "class_reminder_sauna"
  | "booking_cancellation"
  | "late_cancellation"
  | "friend_request"
  | "class_invite"
  | "waiver_reminder"
  | "package_assigned"
  | "marketing"
  | "user_invite"
  | "waitlist_promoted";

type RequestPayload = {
  to?: string;
  /** Send to a member without the caller knowing their address (looked up on the server). */
  to_profile_id?: string;
  template: TemplateName;
  data?: Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOGO_CID = "oneflow-logo";
const SITE_URL =
  Deno.env.get("PUBLIC_APP_URL") ??
  Deno.env.get("SITE_URL") ??
  "https://oneflow1.netlify.app";
/** Public fallback if the bundled logo file cannot be read at runtime. */
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/email/oneflow-logo.png`;

let logoAttachmentBase64: string | null | undefined;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function getLogoAttachment(): Promise<
  { filename: string; content: string; content_id: string } | null
> {
  if (logoAttachmentBase64 === undefined) {
    try {
      const bytes = await Deno.readFile(new URL("./oneflow-logo.png", import.meta.url));
      logoAttachmentBase64 = bytesToBase64(bytes);
    } catch (error) {
      console.error("send-email: could not load oneflow-logo.png", error);
      logoAttachmentBase64 = null;
    }
  }
  if (!logoAttachmentBase64) return null;
  return {
    filename: "oneflow-logo.png",
    content: logoAttachmentBase64,
    content_id: LOGO_CID,
  };
}

async function logoImgTag(): Promise<string> {
  const attachment = await getLogoAttachment();
  const src = attachment ? `cid:${LOGO_CID}` : LOGO_URL;
  return `<img src="${src}" alt="One Flow" width="140" style="display:block;margin:0 auto;border:0;outline:none;height:auto;" />`;
}

function esc(value: unknown): string {
  const s = String(value ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function detailRow(label: string, value: unknown): string {
  return `<p style="font-size:14px;color:#555;padding:4px 0;margin:0;"><span style="font-weight:600;color:#2d2d2d;">${esc(label)}:</span> ${esc(value)}</p>`;
}

function addonPill(text: string): string {
  return `<span style="display:inline-block;background:#a3b693;color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;margin:4px 4px 0 0;">${esc(text)}</span>`;
}

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td align="center">
      <a href="${esc(href)}" style="display:inline-block;background-color:#a3b693;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:999px;">${esc(label)}</a>
    </td>
  </tr>
</table>`;
}

function formatDateTime(value: unknown): { date: string; time: string } {
  return formatEmailDateTime(value);
}

function buildTemplate(template: TemplateName, data: Record<string, unknown> = {}) {
  if (template === "friend_request") {
    const fromName = String(data.from_name ?? "Someone");
    const first = String(data.first_name ?? fromName.split(/\s+/)[0] ?? "A member");
    return {
      subject: `${fromName} wants to connect on One Flow`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Friend request</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">${esc(first)} has sent you a friend request on One Flow. Open the app to accept.</p>
        ${ctaButton("https://oneflow1.netlify.app/me/friends", "View Request")}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  if (template === "waiver_reminder") {
    const firstName = String(data.first_name ?? data.name ?? "there");
    return {
      subject: "Action required — please sign your One Flow waiver",
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Please sign your waiver</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Hi ${esc(firstName)}, we noticed you haven't completed your One Flow studio waiver yet. Please log into the app and complete your profile setup to book classes.</p>
        ${ctaButton("https://oneflow1.netlify.app/onboarding", "Complete waiver")}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  if (template === "package_assigned") {
    const first = String(data.first_name ?? "there");
    const packageName = String(data.package_name ?? "Your package");
    const creditsLine = String(
      data.credits_description ??
        "Your credits are now available and ready to use.",
    );
    const note = data.note ? String(data.note).trim() : "";
    return {
      subject: "Your One Flow package has been activated",
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Package activated</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Hi ${esc(first)}, ${esc(packageName)} has been added to your account by the One Flow team. ${esc(creditsLine)}</p>
        ${note ? `<p style="font-size:14px;line-height:1.5;color:#555;margin:16px 0 0;padding:12px 14px;background:#f5f5f0;border-radius:8px;"><span style="font-weight:600;">Note from the team:</span> ${esc(note)}</p>` : ""}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  if (template === "marketing") {
    const subject = String(data.subject ?? "An update from One Flow");
    const htmlBody = String(data.body_html ?? "");
    return {
      subject,
      content: htmlBody,
    };
  }

  if (template === "user_invite") {
    const first = String(data.first_name ?? "there");
    const roleLabel = String(data.role_label ?? "member");
    const inviteUrl = String(data.invite_url ?? "https://oneflow1.netlify.app/auth");
    return {
      subject: "You're invited to One Flow",
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Welcome to One Flow</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Hi ${esc(first)}, you've been invited to join One Flow as a ${esc(roleLabel)}.</p>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Check your inbox for a separate email with a secure link to set your password. After that, sign in to complete your profile.</p>
        ${ctaButton(inviteUrl, "Open One Flow")}
        <p style="font-size:14px;line-height:1.6;color:#888;margin:16px 0 0;">If you need help, contact the studio at <a href="mailto:hello@oneflow.co.za" style="color:#a3b693;">hello@oneflow.co.za</a>.</p>
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  if (template === "class_invite") {
    const inviterName = String(data.inviter_name ?? "A friend");
    const className = String(data.class_name ?? "a class");
    const when = String(data.when_line ?? "");
    const openApp = String(data.open_url ?? "https://oneflow1.netlify.app/schedule");
    return {
      subject: `${inviterName} invited you to ${className}`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Class invite</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">${esc(inviterName)} invited you to join <strong>${esc(className)}</strong>${when ? ` · ${esc(when)}` : ""}.</p>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Open One Flow to view the invite and respond.</p>
        ${ctaButton(openApp, "View invite")}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  const className = String(data.class_name ?? "Class");
  const guideName = String(data.guide_name ?? "Guide");
  const location = String(data.location ?? "One Flow Studio");
  const dt = formatDateTime(data.starts_at ?? data.date_time);
  const date = String(data.date ?? dt.date);
  const time = String(data.time ?? dt.time);
  const matAddon = Boolean(data.mat_addon);
  const towelAddon = Boolean(data.towel_addon);

  if (template === "class_reminder_sauna") {
    const addons = [towelAddon ? addonPill("🟢 Towel rental booked") : ""].join("");
    return {
      subject: `Reminder — ${className} starts in 1 hour (${time})`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Class starts in 1 hour</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your ${esc(className)} on ${esc(date)} at ${esc(time)} is coming up soon.</p>
        <div style="background:#f5f5f0;border-radius:8px;padding:16px 20px;margin:16px 0;">
          ${detailRow("Date", date)}
          ${detailRow("Time", time)}
        </div>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">What to bring: shower towel only. No workout clothes needed.</p>
        ${addons ? `<div style="margin:8px 0 0;">${addons}</div>` : ""}
        ${ctaButton("https://oneflow1.netlify.app/bookings", "View booking")}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">See you soon — One Flow Team</p>
      `,
    };
  }

  if (template === "class_reminder") {
    const addons = [
      matAddon ? addonPill("🟢 Mat rental booked") : "",
      towelAddon ? addonPill("🟢 Towel rental booked") : "",
    ].join("");
    return {
      subject: `Reminder — ${className} starts in 1 hour (${time})`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Class starts in 1 hour</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your ${esc(className)} class with ${esc(guideName)} starts at ${esc(time)} today.</p>
        <div style="background:#f5f5f0;border-radius:8px;padding:16px 20px;margin:16px 0;">
          ${detailRow("Class", className)}
          ${detailRow("Date", date)}
          ${detailRow("Time", time)}
          ${detailRow("Guide", guideName)}
          ${detailRow("Location", location)}
        </div>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">What to bring: yoga mat (if not renting), water bottle, comfortable clothing. Your check-in QR is in the app under <strong>My bookings</strong>.</p>
        ${addons ? `<div style="margin:8px 0 0;">${addons}</div>` : ""}
        ${ctaButton("https://oneflow1.netlify.app/bookings", "View booking")}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">See you on the mat — One Flow Team</p>
      `,
    };
  }

  if (template === "booking_confirmation_sauna") {
    const addons = [towelAddon ? addonPill("🟢 Towel rental booked") : ""].join("");
    return {
      subject: "Booking Confirmed — Sauna Journey",
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Booking Confirmed</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your Sauna Journey on ${esc(date)} at ${esc(time)} is confirmed.</p>
        <div style="background:#f5f5f0;border-radius:8px;padding:16px 20px;margin:16px 0;">
          ${detailRow("Date", date)}
          ${detailRow("Time", time)}
        </div>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">What to bring: shower towel only. No workout clothes needed.</p>
        ${addons ? `<div style="margin:8px 0 0;">${addons}</div>` : ""}
        <p style="font-size:14px;color:#888;margin:24px 0 0;">See you soon — One Flow Team</p>
      `,
    };
  }

  if (template === "booking_cancellation") {
    return {
      subject: `Booking Cancelled — ${className}`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Booking Cancelled</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your booking for ${esc(className)} on ${esc(date)} at ${esc(time)} has been cancelled. Your credit has been returned to your account.</p>
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  if (template === "late_cancellation") {
    return {
      subject: `Late Cancellation — ${className}`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Late Cancellation</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your booking for ${esc(className)} on ${esc(date)} at ${esc(time)} has been cancelled. Your credit has been returned, however a R100 late cancellation fee will be charged on your next transaction.</p>
        <div style="background:#fff8f0;border-left:3px solid #e8923a;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;color:#c17a30;margin:16px 0;">Late cancellation fee pending: R100</div>
        <p style="font-size:14px;color:#888;margin:24px 0 0;">One Flow Team</p>
      `,
    };
  }

  const addons = [
    matAddon ? addonPill("🟢 Mat rental booked") : "",
    towelAddon ? addonPill("🟢 Towel rental booked") : "",
  ].join("");

  if (template === "waitlist_promoted") {
    return {
      subject: `A spot opened up — you're booked for ${className}`,
      content: `
        <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">You're off the waitlist</h2>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Good news — a spot opened up on <strong>${esc(className)}</strong> and we've booked you in from the waitlist.</p>
        <div style="background:#f5f5f0;border-radius:8px;padding:16px 20px;margin:16px 0;">
          ${detailRow("Class", className)}
          ${detailRow("Date", date)}
          ${detailRow("Time", time)}
          ${detailRow("Guide", guideName)}
          ${detailRow("Location", location)}
        </div>
        <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your QR check-in code is ready in the app under <strong>My bookings</strong>. What to bring: yoga mat (if not renting), water bottle, comfortable clothing.</p>
        ${addons ? `<div style="margin:8px 0 0;">${addons}</div>` : ""}
        ${ctaButton("https://oneflow1.netlify.app/bookings", "View booking")}
        <p style="font-size:13px;line-height:1.6;color:#888;margin:16px 0 0;">Can't make it any more? Cancel from the app — standard 2-hour cancellation policy still applies.</p>
        <p style="font-size:14px;color:#888;margin:24px 0 0;">See you on the mat — One Flow Team</p>
      `,
    };
  }

  return {
    subject: `Booking Confirmed — ${className}`,
    content: `
      <h2 style="font-size:22px;font-weight:600;color:#a3b693;margin:0 0 16px;">Booking Confirmed</h2>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">Your booking for ${esc(className)} on ${esc(date)} at ${esc(time)} with ${esc(guideName)} is confirmed.</p>
      <div style="background:#f5f5f0;border-radius:8px;padding:16px 20px;margin:16px 0;">
        ${detailRow("Class", className)}
        ${detailRow("Date", date)}
        ${detailRow("Time", time)}
        ${detailRow("Guide", guideName)}
        ${detailRow("Location", location)}
      </div>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px;">What to bring: yoga mat (if not renting), water bottle, comfortable clothing.</p>
      ${addons ? `<div style="margin:8px 0 0;">${addons}</div>` : ""}
      <p style="font-size:14px;color:#888;margin:24px 0 0;">See you on the mat — One Flow Team</p>
    `,
  };
}

async function wrapHtml(content: string): Promise<string> {
  const logoImg = await logoImgTag();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f0;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background-color:#a3b693;padding:32px;text-align:center;">
              ${logoImg}
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;color:#2d2d2d;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;background-color:#f5f5f0;text-align:center;border-top:1px solid #e8e8e4;">
              <p style="margin:0 0 8px;font-size:13px;color:#888;">One Flow Yoga &amp; Wellness · Cape Town</p>
              <p style="margin:0;font-size:12px;color:#aaa;">
                <a href="https://oneflow.co.za" style="color:#a3b693;text-decoration:none;">oneflow.co.za</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const STAFF_ROLES = ["director", "management", "marketing", "front_desk", "guide", "boh", "team"];
const MEMBER_BLOCKED_TEMPLATES = new Set(["marketing", "user_invite"]);

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Who may send what:
 * - the app's own server functions (service key): anything;
 * - signed-in staff: anything;
 * - signed-in members: only to their own email (booking confirmations and similar), or a
 *   friend request to someone they have just sent a pending request to (address looked up here);
 * - anyone else: refused.
 * Returns the recipient address, or an error response.
 */
async function authoriseAndResolveRecipient(
  req: Request,
  body: RequestPayload,
): Promise<any> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const admin: any = createClient(url, serviceKey);

  async function emailForProfile(id: string) {
    const { data } = await admin.from("profiles").select("email").eq("id", id).maybeSingle();
    return String((data as any)?.email ?? "").trim();
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: jsonResponse({ error: "Not signed in" }, 401) };

  const recipient = body.to_profile_id ? await emailForProfile(String(body.to_profile_id)) : String(body.to ?? "").trim();
  if (!recipient) return { error: jsonResponse({ error: "No recipient" }, 400) };

  // The app's own server functions.
  if (serviceKey && token === serviceKey) return { to: recipient };

  const userClient: any = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return { error: jsonResponse({ error: "Not signed in" }, 401) };

  const { data: me } = await admin.from("profiles").select("role, secondary_roles, email").eq("id", user.id).maybeSingle();
  const roles = [String((me as any)?.role ?? ""), ...(((me as any)?.secondary_roles ?? []) as string[])].map((r) =>
    String(r).trim().toLowerCase(),
  );
  if (roles.some((r) => STAFF_ROLES.includes(r))) return { to: recipient };

  // Members.
  if (MEMBER_BLOCKED_TEMPLATES.has(body.template)) {
    return { error: jsonResponse({ error: "Not allowed" }, 403) };
  }
  const ownEmails = [String(user.email ?? ""), String((me as any)?.email ?? "")]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (ownEmails.includes(recipient.toLowerCase())) return { to: recipient };

  if (body.template === "friend_request" && body.to_profile_id) {
    const { data: ship } = await admin
      .from("friendships")
      .select("id")
      .eq("requester_id", user.id)
      .eq("addressee_id", String(body.to_profile_id))
      .eq("status", "pending")
      .limit(1);
    if (ship && ship.length > 0) return { to: recipient };
  }
  return { error: jsonResponse({ error: "Not allowed" }, 403) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestPayload;
    if ((!body?.to && !body?.to_profile_id) || !body?.template) {
      return jsonResponse({ error: "Missing to or template" }, 400);
    }
    const allowed = await authoriseAndResolveRecipient(req, body);
    if (allowed.error) return allowed.error;
    const toAddress = String(allowed.to);

    const { subject, content } = buildTemplate(body.template, body.data ?? {});
    const html = await wrapHtml(content);
    const logoAttachment = await getLogoAttachment();

    const resendPayload: any = {
      from: "One Flow <noreply@oneflow.co.za>",
      to: [toAddress],
      subject,
      html,
    };
    if (logoAttachment) {
      resendPayload.attachments = [logoAttachment];
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const resendJson = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: resendJson }), {
        status: resendRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resendJson?.id ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
