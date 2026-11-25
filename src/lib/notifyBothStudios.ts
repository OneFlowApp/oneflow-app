import { supabase } from "@/lib/supabase";

/** Where every Longkloof & Green Point purchase, load or upgrade is reported. */
export const BOTH_STUDIOS_EMAIL = "deeds@oneflow.co.za";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Email the studio inbox when a member gets Access to: Longkloof & Green Point from the
 * admin side (pack loaded at the desk, or a pack upgraded). Online purchases are emailed
 * by the payment webhook. Never blocks the action: a failed email is only logged.
 */
export async function notifyBothStudios(
  heading: string,
  member: string,
  pack: string,
  details: Record<string, string>,
): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const rows = Object.entries({
    Member: member,
    Pack: pack,
    ...details,
    "Done by": me.user?.email ?? "",
  })
    .filter(([, v]) => String(v).trim())
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`,
    )
    .join("");
  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      to: BOTH_STUDIOS_EMAIL,
      template: "marketing",
      data: {
        subject: `Longkloof & Green Point: ${member} (${pack})`,
        body_html: `<p>${esc(heading)} Please load them on the Green Point side.</p><table>${rows}</table>`,
      },
    },
  });
  if (error) console.error("notifyBothStudios: email failed", error);
}

/** Same, looking up the member and pack from a credit row (used after an upgrade). */
export async function notifyBothStudiosForCredit(
  creditId: string,
  heading: string,
  details: Record<string, string>,
): Promise<void> {
  const { data } = await supabase
    .from("user_credits")
    .select("product_name, expires_at, profiles(first_name, last_name, email)")
    .eq("id", creditId)
    .maybeSingle();
  const row = data as {
    product_name?: string | null;
    expires_at?: string | null;
    profiles?: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
    } | null;
  } | null;
  const p = Array.isArray(row?.profiles) ? row?.profiles[0] : row?.profiles;
  const member = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown member";
  await notifyBothStudios(heading, member, row?.product_name ?? "Pack", {
    Email: p?.email ?? "",
    Expires: row?.expires_at ? String(row.expires_at).slice(0, 10) : "",
    ...details,
  });
}
