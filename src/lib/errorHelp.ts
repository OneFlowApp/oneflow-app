import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { STUDIO_PHONE_E164, whatsappDigits } from "@/lib/studioContact";

/**
 * Every error pop-up gets a "WhatsApp us" button. It opens WhatsApp to the studio with the error
 * and what the person was doing already written in, ready to send (they can edit it first).
 */

let studioDigits = STUDIO_PHONE_E164;
let installed = false;

/** What the person was most likely doing, from the page they're on. */
function activityFor(path: string): string {
  const p = path.toLowerCase();
  if (p.startsWith("/pricing") || p.startsWith("/payment")) return "buy a pass";
  if (p.startsWith("/schedule")) return "book a class";
  if (p.startsWith("/gift")) return "gift or claim a pass";
  if (p.startsWith("/onboarding") || p.startsWith("/signup") || p.startsWith("/login") || p.startsWith("/auth"))
    return "sign up or sign in";
  if (p.startsWith("/admin/payouts")) return "submit or view an invoice";
  if (p.startsWith("/admin/bookings")) return "manage bookings";
  if (p.startsWith("/admin/customers")) return "manage a customer";
  if (p.startsWith("/admin/transactions")) return "view transactions";
  if (p.startsWith("/admin")) return `use the admin page ${path}`;
  if (p === "/" || p === "") return "use the home screen";
  return `use the ${path} page`;
}

function errorText(message: unknown): string {
  let text = typeof message === "string" ? message : message instanceof Error ? message.message : "";
  // Drop technical "at https://…" traces so the message stays readable.
  text = text.replace(/\s+at\s+(async\s+)?(\S+\s+)?\(?https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return (text || "Something went wrong").slice(0, 300);
}

export function whatsappHelpUrl(message: unknown): string {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const text = `Hi One Flow, I got this error: "${errorText(message)}". I am trying to ${activityFor(path)}. Please can you help?`;
  return `https://wa.me/${studioDigits}?text=${encodeURIComponent(text)}`;
}

// Same error twice within 30 seconds is logged once.
let lastLogged = { text: "", at: 0 };

/** Saves the error for the daily error email. Never throws. */
function logError(message: unknown) {
  try {
    const text = errorText(message);
    const now = Date.now();
    if (text === lastLogged.text && now - lastLogged.at < 30000) return;
    lastLogged = { text, at: now };
    const path = window.location.pathname.slice(0, 200);
    void supabase
      .from("app_errors")
      .insert({
        message: text.slice(0, 500),
        path,
        activity: activityFor(path).slice(0, 200),
        user_agent: navigator.userAgent.slice(0, 300),
      })
      .then(() => undefined);
  } catch {
    /* logging must never get in the way */
  }
}

/** Call once at app start. */
export function installErrorHelp() {
  if (installed) return;
  installed = true;
  void supabase.rpc("studio_whatsapp_number").then(({ data }) => {
    const d = whatsappDigits(typeof data === "string" ? data : null);
    if (d) studioDigits = d;
  });
  const original = toast.error.bind(toast);
  toast.error = ((message: Parameters<typeof toast.error>[0], data?: Parameters<typeof toast.error>[1]) => {
    logError(message);
    return original(message, {
      duration: 10000,
      action: {
        label: "WhatsApp us",
        onClick: () => {
          window.open(whatsappHelpUrl(message), "_blank", "noopener");
        },
      },
      ...data,
    });
  }) as typeof toast.error;
}
