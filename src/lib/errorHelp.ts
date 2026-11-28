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

/** A payment the app couldn't start because of our side: logged as 'payment', which emails at once. */
function logPaymentFailure(message: string, details: Record<string, string>) {
  try {
    const path = window.location.pathname.slice(0, 200);
    void supabase
      .from("app_errors")
      .insert({
        kind: "payment",
        message: message.slice(0, 500),
        path,
        activity: activityFor(path).slice(0, 200),
        user_agent: navigator.userAgent.slice(0, 300),
        details: { "Money taken": "No", ...details },
      })
      .then(() => undefined);
  } catch {
    /* logging must never get in the way */
  }
}

/**
 * Watch every call to the checkout function. Failures that are ours (couldn't reach it, it crashed,
 * or Yoco refused to open a payment) are reported. Normal "no" answers (class full, already booked)
 * come back with a message and are not.
 */
function watchCheckout() {
  const proto = Object.getPrototypeOf(supabase.functions) as {
    invoke: (name: string, opts?: { body?: unknown }) => Promise<{ data: unknown; error: unknown }>;
  };
  if (!proto?.invoke || (proto as { __watched?: boolean }).__watched) return;
  (proto as { __watched?: boolean }).__watched = true;
  const original = proto.invoke;
  proto.invoke = async function (this: unknown, name: string, opts?: { body?: unknown }) {
    const result = await original.call(this, name, opts);
    if (name !== "yoco-checkout") return result;
    try {
      const body = (opts?.body ?? {}) as Record<string, unknown>;
      const what = String(body.pack_id ?? body.invite_id ?? body.pause_id ?? (body.fee_ids ? "fees" : ""));
      const err = result.error as { name?: string; message?: string; context?: { status?: number } } | null;
      if (err) {
        const status = Number(err.context?.status ?? 0);
        const ours = err.name === "FunctionsFetchError" || err.name === "FunctionsRelayError" || status >= 500;
        if (ours) {
          logPaymentFailure(`Checkout failed: ${err.message ?? "no response"}${status ? ` (${status})` : ""}`, {
            "Paying for": what,
          });
        }
      } else {
        const data = (result.data ?? {}) as Record<string, unknown>;
        if (!data.redirectUrl && !data.error) {
          const yocoMsg = String(data.message ?? data.displayMessage ?? data.description ?? "").slice(0, 200);
          logPaymentFailure(`Yoco didn't open a payment${yocoMsg ? `: ${yocoMsg}` : ""}`, { "Paying for": what });
        }
      }
    } catch {
      /* never get in the way of the payment */
    }
    return result;
  };
}

/** Call once at app start. */
export function installErrorHelp() {
  if (installed) return;
  installed = true;
  watchCheckout();
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
