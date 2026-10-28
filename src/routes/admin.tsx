import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/components/admin/AdminShell";
import { isPathAllowedForRestrictedAdmin } from "@/components/admin/AdminNav";
import { canEnterAdmin, firstAdminPath, type RoleProfile } from "@/lib/roleAccess";
import { useAuth } from "@/contexts/auth";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — One Flow" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
      <h2 className="font-display text-2xl font-semibold">Admin failed to load</h2>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "An unexpected error occurred."}
      </p>
      <Button type="button" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  ),
});

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authReady, profile, profileReady } = useAuth();
  const roleProfile = useMemo<RoleProfile>(
    () => ({
      role: profile?.role ?? null,
      secondary_roles: profile?.secondary_roles ?? null,
    }),
    [profile?.role, profile?.secondary_roles],
  );

  useEffect(() => {
    if (!authReady || !user || !profileReady) return;
    if (!canEnterAdmin(roleProfile)) return;

    if (!isPathAllowedForRestrictedAdmin(roleProfile, pathname)) {
      const to = firstAdminPath(roleProfile) ?? "/";
      if (to !== pathname) navigate({ to, replace: true });
    }
  }, [authReady, user, profileReady, roleProfile, pathname, navigate]);

  const loading = !authReady || (!!user && !profileReady);
  const canAccess = !!user && canEnterAdmin(roleProfile);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        You do not have access to the admin area.
      </div>
    );
  }

  const pageAllowed = isPathAllowedForRestrictedAdmin(roleProfile, pathname);

  return (
    <AdminShell>
      <AdminErrorBoundary>
        {pageAllowed ? (
          <Outlet />
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
            Checking access…
          </div>
        )}
      </AdminErrorBoundary>
    </AdminShell>
  );
}

class AdminErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "An unexpected admin error occurred.",
    };
  }

  componentDidCatch(error: unknown) {
    console.error("admin layout render error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
          <h2 className="font-display text-2xl font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {this.state.message || "An unexpected error occurred. Please try again."}
          </p>
          <Button
            type="button"
            onClick={() => this.setState({ hasError: false, message: "" })}
            variant="outline"
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
