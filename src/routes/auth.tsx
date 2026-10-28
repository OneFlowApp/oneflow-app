import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getUser, supabase } from "@/lib/supabase";
import { landingPathFor } from "@/lib/roleAccess";
import { ensureProfileNamesFromOAuth } from "@/lib/oauthProfileNames";
import { applyStoredReferrerToProfile, captureReferrerFromSearch } from "@/lib/referral";
import { STUDIO_WHATSAPP_URL } from "@/lib/studioContact";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import oneflowLogo from "@/assets/oneflow-logo.webp";

export const Route = createFileRoute("/auth")({
  validateSearch: (raw: Record<string, unknown>) => ({
    redirect: typeof raw.redirect === "string" ? raw.redirect : undefined,
    email: typeof raw.email === "string" ? raw.email : undefined,
    // Accept "1"/"true" only — ignore signup=false from recovery redirects.
    signup: raw.signup === "1" || raw.signup === true || raw.signup === "true",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — One Flow" },
      { name: "description", content: "Sign in or create your One Flow account." },
    ],
  }),
  component: AuthLayout,
});

/** Child routes (/auth/reset-password, /auth/callback) render via Outlet. */
function AuthLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/auth") {
    return <Outlet />;
  }
  return <AuthPage />;
}

async function resolveDestination(userId: string, redirectPath?: string) {
  const safeRedirect =
    redirectPath && redirectPath.startsWith("/invite/") ? redirectPath : undefined;

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone, date_of_birth, role, secondary_roles")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.phone || !profile?.date_of_birth) {
    if (safeRedirect) {
      try {
        sessionStorage.setItem("oneflow_auth_redirect", safeRedirect);
      } catch {
        // ignore
      }
    }
    return "/onboarding";
  }
  if (safeRedirect) return safeRedirect;
  return landingPathFor({
    role: (profile.role as string | null) ?? null,
    secondary_roles: (profile.secondary_roles as string[] | null) ?? null,
  });
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  useEffect(() => {
    captureReferrerFromSearch(window.location.search);
  }, []);

  useEffect(() => {
    if (search.email) setEmail(search.email);
    if (search.signup) setMode("signup");
  }, [search.email, search.signup]);

  useEffect(() => {
    // Only handle OAuth/magic-link codes on the sign-in page itself.
    // Recovery PKCE codes belong to /auth/reset-password — do not steal them here.
    if (window.location.pathname !== "/auth") return;

    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (!code) return;

      window.history.replaceState({}, "", "/auth");
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.session?.user) {
        await ensureProfileNamesFromOAuth(data.session.user);
        await applyStoredReferrerToProfile(data.session.user.id);
        const dest = await resolveDestination(data.session.user.id, search.redirect);
        navigate({ to: dest });
      }
    };
    void init();
  }, [navigate, search.redirect]);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);

  const passwordResetRedirect = () =>
    `${window.location.origin}/auth/reset-password`;

  const handleForgotSubmit = async () => {
    const trimmed = resetEmail.trim();
    if (!trimmed) {
      toast.error("Enter your email address.");
      return;
    }
    setResetSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: passwordResetRedirect(),
    });
    setResetSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Check your email for a password reset link");
    setForgotOpen(false);
    setResetEmail("");
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      if (error.message === "Invalid login credentials") {
        toast.error("Incorrect email or password.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    const user = await getUser();
    if (user) {
      const dest = await resolveDestination(user.id, search.redirect);
      navigate({ to: dest });
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password || !confirmPassword) {
      toast.error("Fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session?.user) {
      await applyStoredReferrerToProfile(data.session.user.id);
      const dest = await resolveDestination(data.session.user.id, search.redirect);
      navigate({ to: dest });
      return;
    }
    toast.success("Check your email to confirm your account, then sign in.");
    setMode("signin");
    setPassword("");
    setConfirmPassword("");
  };

  // const signInWithGoogle = async () => {
  //   setLoading(true);
  //   const { error } = await supabase.auth.signInWithOAuth({
  //     provider: "google",
  //     options: {
  //       redirectTo: `${window.location.origin}/auth`,
  //     },
  //   });
  //   if (error) {
  //     toast.error(error.message);
  //     setLoading(false);
  //   }
  // };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 py-10">
      <img src={oneflowLogo} alt="One Flow" className="mb-6 h-14 w-auto" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-display text-center text-xl font-semibold text-card-foreground">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {mode === "signin" ? "Welcome back to One Flow." : "Join One Flow with email and password."}
        </p>

        {mode === "signin" ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSignIn()}
                placeholder="you@example.com"
                className="h-11 bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSignIn()}
                placeholder="••••••••"
                className="h-11 bg-background"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setResetEmail(email.trim());
                setForgotOpen(true);
              }}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </button>
            <Button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={loading}
              className="h-11 w-full bg-primary text-base text-primary-foreground hover:bg-primary/90"
            >
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="h-11 bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-confirm">Confirm password</Label>
              <Input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSignUp()}
                placeholder="Repeat password"
                className="h-11 bg-background"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleSignUp()}
              disabled={loading}
              className="h-11 w-full bg-primary text-base text-primary-foreground hover:bg-primary/90"
            >
              {loading ? "Creating…" : "Create Account"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By creating an account you agree to our{" "}
              <button type="button" className="underline underline-offset-4">
                Terms
              </button>{" "}
              and{" "}
              <button type="button" className="underline underline-offset-4">
                Privacy Policy
              </button>
              .
            </p>
          </div>
        )}

        {/* <Divider />
        <Button
          type="button"
          onClick={() => void signInWithGoogle()}
          variant="outline"
          className="h-11 w-full border-border bg-background"
          disabled={loading}
        >
          <GoogleIcon />
          Continue with Google
        </Button> */}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                className="font-semibold text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("signup");
                  setPassword("");
                  setConfirmPassword("");
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="font-semibold text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("signin");
                  setPassword("");
                  setConfirmPassword("");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Need help?{" "}
        <a
          href={STUDIO_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Contact the studio
        </a>
      </p>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Reset password</DialogTitle>
            <DialogDescription>
              We&apos;ll send a link to your email to choose a new password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleForgotSubmit()}
              placeholder="you@example.com"
              className="h-11 bg-background"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setForgotOpen(false)}
              disabled={resetSending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleForgotSubmit()} disabled={resetSending}>
              {resetSending ? "Sending…" : "Send link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// function Divider() {
//   return (
//     <div className="relative py-4">
//       <div className="absolute inset-0 flex items-center">
//         <div className="w-full border-t border-border" />
//       </div>
//       <div className="relative flex justify-center text-xs uppercase">
//         <span className="bg-card px-2 text-muted-foreground">or</span>
//       </div>
//     </div>
//   );
// }

// function GoogleIcon() {
//   return (
//     <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
//       <path
//         fill="#4285F4"
//         d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
//       />
//       <path
//         fill="#34A853"
//         d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
//       />
//       <path
//         fill="#FBBC05"
//         d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
//       />
//       <path
//         fill="#EA4335"
//         d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
//       />
//     </svg>
//   );
// }
