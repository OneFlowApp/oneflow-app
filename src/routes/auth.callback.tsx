import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { landingPathFor } from "@/lib/roleAccess";
import { ensureProfileNamesFromOAuth } from "@/lib/oauthProfileNames";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

type ProfileGate = {
  phone: string | null;
  date_of_birth: string | null;
  role: string | null;
  secondary_roles: string[] | null;
  onboarding_complete?: boolean | null;
};

/** Read Supabase auth `type` from hash and/or query (password reset links use type=recovery). */
function getAuthCallbackType(): string | null {
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
  );
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") || queryParams.get("type");
}

/** PKCE code, magic-link token, or implicit/hash tokens (Supabase uses access_token in fragment). */
function hasOAuthOrMagicLinkCallback(): boolean {
  const search = new URLSearchParams(window.location.search);
  if (search.has("code") || search.has("token")) return true;
  const hashRaw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hash = new URLSearchParams(hashRaw);
  return hash.has("access_token") || hash.has("refresh_token") || hash.has("token");
}

async function loadProfileGate(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("phone, date_of_birth, role, secondary_roles, onboarding_complete")
    .eq("id", userId)
    .maybeSingle();
  return data as ProfileGate | null;
}

async function resolveDestination(userId: string): Promise<string> {
  const profile = await loadProfileGate(userId);

  if (!profile || !profile.phone || !profile.date_of_birth) return "/onboarding";

  return landingPathFor(profile);
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    const run = async () => {
      // Absolute first: password recovery — never run session/onboarding logic on this path.
      const type = getAuthCallbackType();
      if ((type ?? "").toLowerCase() === "recovery") {
        if (!done.current) {
          done.current = true;
          const next = `/auth/reset-password${window.location.search}${window.location.hash}`;
          window.location.replace(next);
        }
        return;
      }

      if (done.current) return;

      if (!hasOAuthOrMagicLinkCallback()) {
        done.current = true;
        navigate({ to: "/auth" });
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.session?.user) {
          done.current = true;
          navigate({ to: "/auth" });
          return;
        }
        window.history.replaceState({}, "", "/auth/callback");
        await ensureProfileNamesFromOAuth(data.session.user);
        done.current = true;
        const dest = await resolveDestination(data.session.user.id);
        navigate({ to: dest });
        return;
      }

      // Implicit or magic-link session established from URL fragment / existing session after redirect.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        await ensureProfileNamesFromOAuth(session.user);
        done.current = true;
        const dest = await resolveDestination(session.user.id);
        navigate({ to: dest });
        return;
      }

      done.current = true;
      navigate({ to: "/auth" });
    };

    void run();
  }, [navigate]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
