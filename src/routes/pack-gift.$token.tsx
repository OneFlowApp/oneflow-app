import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { formatRewardDate } from "@/lib/gameboard";
import oneflowLogo from "@/assets/oneflow-logo.webp";

export const Route = createFileRoute("/pack-gift/$token")({
  head: () => ({ meta: [{ title: "A gift for you — One Flow" }] }),
  component: PackGiftPage,
});

type Preview = {
  ok: boolean;
  from?: string;
  pack?: string;
  message?: string | null;
  claim_by?: string | null;
  state?: "open" | "claimed" | "expired";
};

const AUTH_REDIRECT_KEY = "oneflow_auth_redirect";

/** A friend bought this person a pass: claim it onto their profile. */
function PackGiftPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, authReady } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    void supabase
      .rpc("pack_gift_preview", { p_token: token })
      .then(({ data, error }) => setPreview(error ? { ok: false } : (data as Preview)));
  }, [token]);

  const signIn = (signup: boolean) => {
    try {
      sessionStorage.setItem(AUTH_REDIRECT_KEY, `/pack-gift/${token}`);
    } catch {
      // ignore
    }
    void navigate({
      to: "/auth",
      search: { redirect: `/pack-gift/${token}`, ...(signup ? { signup: "1" } : {}) } as never,
    });
  };

  const claim = async () => {
    setClaiming(true);
    const { data, error } = await supabase.rpc("claim_pack_gift", { p_token: token });
    setClaiming(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not claim this gift"));
      return;
    }
    toast.success(`${String(data ?? "Your pass")} is on your profile. Book your first class!`);
    void navigate({ to: "/schedule" });
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10 text-center">
      <img src={oneflowLogo} alt="One Flow" className="mb-6 h-12 w-auto" />
      {!preview || !authReady ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : !preview.ok ? (
        <p className="max-w-sm text-sm text-muted-foreground">This gift link isn&apos;t valid.</p>
      ) : (
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6">
          <Gift className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="mt-3 font-display text-2xl font-semibold">
            {preview.from} bought you {preview.pack ?? "a pass"}
          </h1>
          {preview.message ? <p className="mt-3 text-sm italic">“{preview.message}”</p> : null}
          {preview.state === "open" ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                A pass at One Flow Longkloof. It starts the day you claim it. Claim it by{" "}
                {formatRewardDate(preview.claim_by ?? null)}.
              </p>
              {user ? (
                <Button className="mt-5 w-full" disabled={claiming} onClick={() => void claim()}>
                  {claiming ? "Claiming…" : "Claim my gift"}
                </Button>
              ) : (
                <div className="mt-5 space-y-2">
                  <Button className="w-full" onClick={() => signIn(true)}>
                    Create an account to claim
                  </Button>
                  <button
                    type="button"
                    onClick={() => signIn(false)}
                    className="w-full text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    I already have an account
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {preview.state === "claimed"
                ? "This gift has already been claimed."
                : "This gift link has expired. Please contact the studio."}{" "}
              <Link to="/schedule" className="font-medium text-primary underline-offset-2 hover:underline">
                See our classes
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
