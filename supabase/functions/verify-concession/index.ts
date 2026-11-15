// Student and senior discount check.
// The member sends a photo of their ID (senior) or student card / registration letter (student).
// Claude reads the document; this function then applies the rules itself:
//   senior  → a valid South African ID number (check digit) or a date of birth, age 65+, name matches
//   student → a real university or college, name matches, valid for the current year
// The photo is never saved. Only the result is recorded in concession_checks.
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional).
// Deploy with Verify JWT ON.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Africa/Johannesburg";
const MAX_BASE64_CHARS = 7_000_000; // about 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** South African ID numbers end in a Luhn check digit. */
function luhnValid(id: string): boolean {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    let n = Number(id[id.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** YYMMDD at the start of an SA ID number → a date of birth. */
function dobFromSaId(id: string): string | null {
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  const nowYY = Number(todayIso().slice(2, 4));
  const year = yy > nowYY ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function ageOn(dobIso: string, onIso: string): number {
  const [by, bm, bd] = dobIso.split("-").map(Number);
  const [y, m, d] = onIso.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

function words(s: string | null | undefined): string[] {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/[\s'-]+/)
    .filter((w) => w.length > 0);
}

/** The surname must appear, and the first name (or its initial) too. */
function nameMatches(docName: string | null, first: string | null, last: string | null): boolean {
  const doc = words(docName);
  if (doc.length === 0) return false;
  const lastWords = words(last);
  const firstWords = words(first);
  if (lastWords.length === 0) return false;
  const lastOk = lastWords.every((w) => doc.includes(w));
  if (!lastOk) return false;
  if (firstWords.length === 0) return true;
  const f = firstWords[0];
  return doc.includes(f) || doc.some((w) => w.length <= 2 && w[0] === f[0]);
}

type Reading = {
  readable: boolean;
  document_type: string;
  full_name: string | null;
  id_number: string | null;
  date_of_birth: string | null;
  institution: string | null;
  institution_is_recognised_tertiary: boolean | null;
  valid_until: string | null;
  academic_year: number | null;
  looks_altered: boolean;
  notes: string;
};

const PROMPT = (kind: string) => `You are checking a document for a ${kind} discount at a South African yoga studio.
Read the document in the image and reply with ONLY a JSON object, no other text:
{
 "readable": true or false (false if blurry, cut off, too dark, or not a document),
 "document_type": one of "sa_id_card", "sa_id_book", "passport", "drivers_licence", "student_card", "registration_letter", "other",
 "full_name": the person's full name exactly as printed, or null,
 "id_number": the 13-digit South African ID number if printed (digits only), or null,
 "date_of_birth": "YYYY-MM-DD" if printed, or null,
 "institution": the university, college or school name if any, or null,
 "institution_is_recognised_tertiary": true if it is a real, recognised university, university of technology, TVET college or registered private higher education institution; false if not; null if no institution,
 "valid_until": the card's expiry date "YYYY-MM-DD" if printed, or null,
 "academic_year": the academic or registration year if printed (a number), or null,
 "looks_altered": true if the document looks edited, photocopied over, a screen of a screen, or not genuine,
 "notes": one short sentence on anything that stands out
}
Only report what is printed. Never guess numbers or dates.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  if (!ANTHROPIC_KEY) return json({ error: "Discount checks aren't set up yet. Please ask the studio." }, 503);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  const userId = u.user?.id;
  if (!userId) return json({ error: "Please sign in first." }, 401);

  let body: { kind?: string; file_base64?: string; media_type?: string; consent?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const kind = body.kind === "senior" ? "senior" : body.kind === "student" ? "student" : null;
  const media = String(body.media_type ?? "");
  const data = String(body.file_base64 ?? "");
  if (!kind) return json({ error: "Choose student or senior." }, 400);
  if (body.consent !== true) return json({ error: "Please agree to the document check first." }, 400);
  if (!ALLOWED_TYPES.includes(media) || !data) return json({ error: "Please upload a photo (JPG or PNG) or a PDF." }, 400);
  if (data.length > MAX_BASE64_CHARS) return json({ error: "That file is too big. Please use a photo under 5 MB." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE);

  const { data: settingsRows } = await admin.from("studio_settings").select("key, value").like("key", "concession_%");
  const s = Object.fromEntries(((settingsRows ?? []) as { key: string; value: string }[]).map((r) => [r.key, Number(r.value)]));
  const validMonths = s.concession_valid_months > 0 ? s.concession_valid_months : 6;
  const retryMonths = s.concession_retry_months > 0 ? s.concession_retry_months : 6;
  const seniorAge = s.concession_senior_age > 0 ? s.concession_senior_age : 65;
  const today = todayIso();

  // Already approved, or checked too recently?
  const { data: last } = await admin
    .from("concession_checks")
    .select("result, checked_at, valid_until, revoked_at")
    .eq("profile_id", userId)
    .in("result", ["approved", "declined"])
    .order("checked_at", { ascending: false })
    .limit(1);
  const prev = (last ?? [])[0] as { result: string; checked_at: string; valid_until: string | null; revoked_at: string | null } | undefined;
  if (prev?.result === "approved" && !prev.revoked_at && prev.valid_until && prev.valid_until >= today) {
    return json({ result: "approved", message: `You're already approved until ${prev.valid_until}.`, valid_until: prev.valid_until });
  }
  if (prev) {
    const nextOn = addMonthsIso(new Date(prev.checked_at).toLocaleDateString("en-CA", { timeZone: TZ }), retryMonths);
    if (nextOn > today) {
      return json({ result: "wait", message: `You can try again from ${nextOn}.`, next_check_on: nextOn }, 429);
    }
  }

  const { data: prof } = await admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle();
  const first = (prof as { first_name?: string } | null)?.first_name ?? null;
  const lastName = (prof as { last_name?: string } | null)?.last_name ?? null;

  // Ask Claude to read the document.
  const block =
    media === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: media, data } }
      : { type: "image", source: { type: "base64", media_type: media, data } };
  let reading: Reading | null = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: [block, { type: "text", text: PROMPT(kind) }] }],
      }),
    });
    const out = await res.json();
    if (!res.ok) {
      console.error("verify-concession: anthropic error", res.status, JSON.stringify(out));
      return json({ error: "We couldn't check your document right now. Please try again later." }, 502);
    }
    const text = ((out.content ?? []) as { type: string; text?: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    reading = match ? (JSON.parse(match[0]) as Reading) : null;
  } catch (e) {
    console.error("verify-concession: read failed", e);
    return json({ error: "We couldn't check your document right now. Please try again later." }, 502);
  }

  const record = async (result: "approved" | "declined" | "unreadable", reason: string, validUntil: string | null) => {
    const summary = reading
      ? [reading.document_type, reading.institution, reading.academic_year, reading.valid_until].filter(Boolean).join(" · ")
      : null;
    await admin.from("concession_checks").insert({
      profile_id: userId,
      kind,
      result,
      reason,
      document_summary: summary,
      valid_until: validUntil,
    });
  };

  if (!reading || !reading.readable) {
    await record("unreadable", "Photo could not be read", null);
    return json({
      result: "unreadable",
      message: "We couldn't read that photo. Please try again with a clear, well-lit photo of the whole document. This try doesn't count.",
    });
  }

  const decline = async (reason: string) => {
    await record("declined", reason, null);
    return json({ result: "declined", message: "Unfortunately, you do not qualify.", reason });
  };

  if (reading.looks_altered) return decline("The document doesn't look genuine");
  if (!nameMatches(reading.full_name, first, lastName)) {
    return decline("The name on the document doesn't match your One Flow account");
  }

  if (kind === "senior") {
    let dob: string | null = null;
    const id = (reading.id_number ?? "").replace(/\D/g, "");
    if (id.length === 13) {
      if (!luhnValid(id)) return decline("The ID number isn't valid");
      dob = dobFromSaId(id);
    }
    if (!dob && reading.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(reading.date_of_birth)) dob = reading.date_of_birth;
    if (!dob) return decline("No date of birth could be confirmed on the document");
    if (ageOn(dob, today) < seniorAge) return decline(`The senior discount is for ${seniorAge} and older`);
  } else {
    if (!["student_card", "registration_letter"].includes(reading.document_type)) {
      return decline("This isn't a student card or registration letter");
    }
    if (reading.institution_is_recognised_tertiary !== true) {
      return decline("The institution isn't a recognised university or college");
    }
    const year = Number(today.slice(0, 4));
    const current =
      (reading.valid_until != null && /^\d{4}-\d{2}-\d{2}$/.test(reading.valid_until) && reading.valid_until >= today) ||
      Number(reading.academic_year) === year;
    if (!current) return decline("The document doesn't show you're registered this year");
  }

  const validUntil = addMonthsIso(today, validMonths);
  await record("approved", kind === "senior" ? "Senior: age confirmed" : `Student: ${reading.institution ?? ""}`.trim(), validUntil);
  return json({
    result: "approved",
    message: `You qualify! Your ${kind} discount is active until ${validUntil}.`,
    valid_until: validUntil,
  });
});
