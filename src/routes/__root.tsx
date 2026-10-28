import { useEffect, useRef } from "react";
import { Outlet, Link, createRootRoute, HeadContent, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { PageTransition } from "@/components/PageTransition";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClassCatalogProvider } from "@/contexts/classCatalog";
import { canEnterAdmin, landingPathFor } from "@/lib/roleAccess";
import { captureReferrerFromSearch } from "@/lib/referral";

function CustomerBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hide =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth") ||
    pathname === "/onboarding";
  if (hide) return null;
  return <BottomNav />;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "One Flow" },
      {
        name: "description",
        content: "Book classes, track Flow Points, and manage your One Flow journey.",
      },
      { name: "author", content: "One Flow" },
      { name: "theme-color", content: "#a3b693" },
      { property: "og:title", content: "One Flow" },
      {
        property: "og:description",
        content: "Book classes, track Flow Points, and manage your One Flow journey.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function isAuthPublicPath(pathname: string) {
  return pathname.startsWith("/auth") || pathname === "/faq" || pathname.startsWith("/invite");
}

/** Recovery link creates a session — must stay on this page to set a new password. */
function isPasswordResetPath(pathname: string) {
  return pathname === "/auth/reset-password";
}

function ReferralCapture() {
  const search = useRouterState({ select: (s) => s.location.search }) as unknown as
    | string
    | Record<string, unknown>
    | undefined;
  useEffect(() => {
    const str =
      typeof search === "string"
        ? search
        : search
          ? new URLSearchParams(search as Record<string, string>).toString()
          : "";
    captureReferrerFromSearch(str);
  }, [search]);
  return null;
}

function ProtectedOutlet() {
  const navigate = useNavigate();
  const { user, authReady, profile, profileReady } = useAuth();
  const initialRouteResolved = useRef(false);

  const onboardingDone = profile?.onboarding_complete === true;
  const roleProfile = {
    role: profile?.role ?? null,
    secondary_roles: profile?.secondary_roles ?? null,
  };
  // Staff land on the first admin page their combined roles allow; everyone else on "/".
  const landingPath = landingPathFor(roleProfile);
  const hasAdminAccess = canEnterAdmin(roleProfile);

  useEffect(() => {
    if (initialRouteResolved.current) return;
    if (!authReady) return;
    if (user && !profileReady) return;

    const pathname = window.location.pathname;
    let target: string | null = null;

    const publicPath = isAuthPublicPath(pathname);

    if (!user) {
      if (!publicPath) target = "/auth";
      initialRouteResolved.current = true;
      if (target && target !== pathname) navigate({ to: target, replace: true });
      return;
    }

    const onOnboarding = pathname === "/onboarding";
    const onAdmin = pathname.startsWith("/admin");
    const onAuth = pathname.startsWith("/auth");
    const onResetPassword = isPasswordResetPath(pathname);

    // Password recovery creates a temporary session; never redirect away until
    // the user finishes setting a new password on /auth/reset-password.
    if (onResetPassword) {
      initialRouteResolved.current = true;
      return;
    }

    if (!onboardingDone) {
      if (!onOnboarding) target = "/onboarding";
      initialRouteResolved.current = true;
      if (target && target !== pathname) navigate({ to: target, replace: true });
      return;
    }

    if (onOnboarding || onAuth) {
      target = landingPath;
      initialRouteResolved.current = true;
      if (target && target !== pathname) navigate({ to: target, replace: true });
      return;
    }

    if (!hasAdminAccess && onAdmin) {
      target = "/";
      initialRouteResolved.current = true;
      if (target && target !== pathname) navigate({ to: target, replace: true });
      return;
    }

    initialRouteResolved.current = true;
  }, [authReady, user?.id, profileReady, onboardingDone, landingPath, hasAdminAccess, navigate]);

  const sessionResolving = !authReady || (!!user && !profileReady);
  const onResetPassword =
    typeof window !== "undefined" && isPasswordResetPath(window.location.pathname);

  // Let the reset-password page mount immediately so it can catch PASSWORD_RECOVERY
  // / hash tokens before auth profile resolution finishes.
  if (sessionResolving && !onResetPassword) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <PageTransition>
      <Outlet />
    </PageTransition>
  );
}

function RootComponent() {
  return (
    <>
      <HeadContent />
      <AuthProvider>
        <ClassCatalogProvider>
          <ReferralCapture />
          <ProtectedOutlet />
          <CustomerBottomNav />
        </ClassCatalogProvider>
      </AuthProvider>
      <Toaster position="top-center" />
    </>
  );
}
