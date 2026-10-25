import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getUser, supabase } from "@/lib/supabase";

/** May challenge stamps are written on studio check-in (see upsertMayChallengeCheckIn), not here. */

export const Route = createFileRoute("/payment/success")({
  head: () => ({
    meta: [{ title: "Payment successful — One Flow" }],
  }),
  component: PaymentSuccessPage,
});

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  allowed_class_types: string[] | null;
  credit_count: number | null;
  validity_days: number | null;
};

type PageState =
  | { status: "loading" }
  | { status: "confirming" }
  | { status: "pending" }
  | { status: "guest" }
  | { status: "error"; message: string }
  | {
      status: "success";
      productName: string;
      creditsAdded: number;
      isUnlimited: boolean;
    }
  | { status: "success_class_invite" }
  | { status: "success_class_booked"; productName: string; className: string }
  | { status: "success_generic" };

const CLASS_INVITE_FINALIZE_KEY = "oneflow_class_invite_finalized";

const CREDIT_POLL_INTERVAL_MS = 2000;
const CREDIT_POLL_TIMEOUT_MS = 40000;
const CREDIT_RECENT_WINDOW_MS = 60 * 60 * 1000;

type CreditRow = { id: string; is_unlimited: boolean | null };

/** Polls `user_credits` until the webhook-created credit for this pack appears, or times out. */
async function waitForPackCredits(args: {
  profileId: string;
  packId: string;
  isCancelled: () => boolean;
}): Promise<CreditRow[] | null> {
  const deadline = Date.now() + CREDIT_POLL_TIMEOUT_MS;
  while (!args.isCancelled()) {
    const since = new Date(Date.now() - CREDIT_RECENT_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("user_credits")
      .select("id, is_unlimited")
      .eq("profile_id", args.profileId)
      .eq("product_id", args.packId)
      .gte("purchased_at", since)
      .order("purchased_at", { ascending: false });
    if (error) console.error("user_credits poll", error);
    if (data && data.length > 0) return data as CreditRow[];
    if (Date.now() + CREDIT_POLL_INTERVAL_MS > deadline) return null;
    await new Promise((r) => setTimeout(r, CREDIT_POLL_INTERVAL_MS));
  }
  return null;
}

async function autoBookClassAfterTicketPurchase(args: {
  profileId: string;
  classId: string;
  creditId: string | null;
}): Promise<{ ok: true; className: string } | { ok: false; message: string }> {
  const { data: cls, error: classErr } = await supabase
    .from("classes")
    .select("name")
    .eq("id", args.classId)
    .maybeSingle();
  if (classErr || !cls) {
    return { ok: false, message: "Could not find that class to complete your booking." };
  }
  const className = String((cls as { name?: string }).name ?? "your class");

  const { error: bookErr } = await supabase.from("bookings").insert({
    profile_id: args.profileId,
    class_id: args.classId,
    status: "confirmed",
    payment_method: "credit",
    credit_id: args.creditId,
    flow_points_used: 0,
    mat_addon: false,
    towel_addon: false,
    qr_token: globalThis.crypto.randomUUID(),
  });

  if (bookErr) {
    if (bookErr.code === "23505") {
      return { ok: true, className };
    }
    return { ok: false, message: bookErr.message ?? "Could not complete your booking." };
  }
  return { ok: true, className };
}

function PaymentSuccessPage() {
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const params = new URLSearchParams(window.location.search);
      const packId = params.get("pack_id");
      const profileId = params.get("profile_id");
      const classInviteId = params.get("class_invite_id");
      const classId = params.get("class_id");
      const autoBook = params.get("auto_book") === "1";

      const user = await getUser();
      if (!user) {
        if (!cancelled) setState({ status: "guest" });
        return;
      }

      if (classInviteId && profileId) {
        if (user.id !== profileId) {
          if (!cancelled) {
            setState({ status: "error", message: "This payment is linked to a different account." });
          }
          return;
        }
        const dedupeKey = `${CLASS_INVITE_FINALIZE_KEY}:${classInviteId}`;
        if (sessionStorage.getItem(dedupeKey)) {
          if (!cancelled) setState({ status: "success_class_invite" });
          return;
        }
        const { error: finErr } = await supabase.functions.invoke("finalize-class-invite", {
          body: { class_invite_id: classInviteId, after_payment: true },
        });
        if (finErr) {
          console.error(finErr);
          if (!cancelled) {
            setState({
              status: "error",
              message: finErr.message ?? "Could not complete the class invite.",
            });
          }
          return;
        }
        sessionStorage.setItem(dedupeKey, "1");
        if (!cancelled) setState({ status: "success_class_invite" });
        return;
      }

      if (!packId || !profileId) {
        if (!cancelled) setState({ status: "success_generic" });
        return;
      }

      if (user.id !== profileId) {
        if (!cancelled)
          setState({ status: "error", message: "This purchase is linked to a different account." });
        return;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, name, category, allowed_class_types, credit_count, validity_days")
        .eq("id", packId)
        .order("category", { ascending: true })
        .order("name", { ascending: true })
        .maybeSingle();

      if (productError || !product) {
        console.error(productError);
        if (!cancelled) setState({ status: "error", message: "Could not load this product." });
        return;
      }

      const p = product as ProductRow;
      const creditCountRaw = p.credit_count;
      const creditCount =
        typeof creditCountRaw === "number" ? creditCountRaw : Number(creditCountRaw ?? 0) || 0;
      const isUnlimited = creditCount >= 999;

      // Credits are created by the yoco-webhook function once Yoco confirms the payment.
      if (!cancelled) setState({ status: "confirming" });
      const credits = await waitForPackCredits({ profileId, packId, isCancelled: () => cancelled });
      if (cancelled) return;

      if (!credits) {
        setState({ status: "pending" });
        return;
      }

      if (classId && autoBook) {
        const creditId = credits[0]?.id ?? null;
        const booked = await autoBookClassAfterTicketPurchase({
          profileId,
          classId,
          creditId,
        });
        if (!booked.ok) {
          if (!cancelled) {
            setState({
              status: "error",
              message: booked.message,
            });
          }
          return;
        }
        if (!cancelled) {
          setState({
            status: "success_class_booked",
            productName: p.name,
            className: booked.className,
          });
        }
        return;
      }

      if (!cancelled) {
        const bundleUnlimited = isUnlimited || credits.some((row) => row.is_unlimited);
        setState({
          status: "success",
          productName: p.name,
          creditsAdded: bundleUnlimited ? 0 : creditCount,
          isUnlimited: bundleUnlimited,
        });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 py-12 text-center">
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full bg-[#22c55e]/15 ring-4 ring-[#22c55e]/25"
          aria-hidden
        >
          <Check
            className="h-14 w-14 stroke-[2.5] text-[#16a34a]"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </div>

        {state.status === "loading" ? (
          <>
            <Loader2 className="mt-8 h-10 w-10 animate-spin text-[#4a6b3c]" aria-label="Loading" />
            <p className="mt-4 text-sm text-muted-foreground">Confirming your purchase…</p>
          </>
        ) : state.status === "confirming" ? (
          <>
            <Loader2 className="mt-8 h-10 w-10 animate-spin text-[#4a6b3c]" aria-label="Loading" />
            <p className="mt-4 text-sm text-muted-foreground">Confirming your payment...</p>
          </>
        ) : state.status === "pending" ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-bold tracking-tight text-[#3d4f36] dark:text-foreground">
              Payment successful!
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Your payment went through, but your pack is taking a little longer to appear. Please
              check My Account in a few minutes, or contact the studio.
            </p>
          </>
        ) : state.status === "guest" ? (
          <>
            <h1 className="mt-8 font-display text-2xl font-bold text-[#3d4f36] dark:text-foreground">
              Sign in
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to see your updated credits.
            </p>
          </>
        ) : state.status === "error" ? (
          <>
            <h1 className="mt-8 font-display text-2xl font-bold text-[#3d4f36] dark:text-foreground">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
          </>
        ) : state.status === "success_generic" ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-bold tracking-tight text-[#3d4f36] dark:text-foreground">
              Payment successful!
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Your credits will appear shortly if payment completed.
            </p>
          </>
        ) : state.status === "success_class_invite" ? (
          <>
            <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[#3d4f36] dark:text-foreground">
              Payment successful!
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Your friend has been notified and can book the class from their account.
            </p>
          </>
        ) : state.status === "success_class_booked" ? (
          <>
            <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[#3d4f36] dark:text-foreground">
              You&apos;re booked!
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{state.className}</span> is confirmed.
              Ticket: {state.productName}.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[#3d4f36] dark:text-foreground">
              Payment successful! Your credits have been added.
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{state.productName}</span>
              {state.isUnlimited ? (
                <> — unlimited access</>
              ) : (
                <>
                  {" "}
                  — <span className="font-semibold text-foreground">{state.creditsAdded}</span>{" "}
                  credits added
                </>
              )}
            </p>
          </>
        )}

        {state.status !== "success_class_booked" ? (
          <Link
            to="/schedule"
            className="mt-10 inline-flex items-center justify-center gap-2 rounded-full bg-[#4a6b3c] px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 dark:bg-primary dark:text-primary-foreground"
          >
            <CalendarDays className="h-4 w-4" />
            Go to schedule
          </Link>
        ) : (
          <Link
            to="/schedule"
            className="mt-10 inline-flex items-center justify-center gap-2 rounded-full bg-[#4a6b3c] px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 dark:bg-primary dark:text-primary-foreground"
          >
            <CalendarDays className="h-4 w-4" />
            View schedule
          </Link>
        )}
      </div>
    </AppShell>
  );
}
