import { type ReactNode, useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeft, Menu } from "lucide-react";
import { AdminNav, AdminSidebarFooter, adminNavItems, navItemsForRole } from "./AdminNav";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import logo from "@/assets/oneflow-logo.webp";
import { AdminGlobalSearch } from "@/components/admin/AdminGlobalSearch";
import { useAuth } from "@/contexts/auth";
import { supabase } from "@/lib/supabase";
import { adminAreaForPath, canEdit, canOpenAdminArea } from "@/lib/roleAccess";

type AdminProfile = {
  email: string | null;
  role: string | null;
  secondary_roles: string[] | null;
};

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, profile: authProfile } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<AdminProfile | null>(null);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCheckInKiosk = pathname === "/admin/check-in";

  useEffect(() => {
    if (isCheckInKiosk) setCollapsed(true);
  }, [isCheckInKiosk]);

  useEffect(() => {
    setProfile({
      email: user?.email ?? null,
      role: authProfile?.role ?? null,
      secondary_roles: authProfile?.secondary_roles ?? null,
    });
  }, [user?.email, authProfile?.role, authProfile?.secondary_roles]);

  const visibleNav = navItemsForRole({
    role: profile?.role ?? null,
    secondary_roles: profile?.secondary_roles ?? null,
  });
  const currentLabel =
    visibleNav.find(
      (i) =>
        (i.to === "/admin" && pathname === "/admin") ||
        (i.to !== "/admin" && (pathname === i.to || pathname.startsWith(i.to + "/"))),
    )?.label ??
    adminNavItems.find(
      (i) =>
        (i.to === "/admin" && pathname === "/admin") ||
        (i.to !== "/admin" && (pathname === i.to || pathname.startsWith(i.to + "/"))),
    )?.label ??
    "Admin";

  const emailLine = profile?.email ?? "…";
  const roleLine = (profile?.role ?? "—").toString();
  const roleProfile = {
    role: profile?.role ?? null,
    secondary_roles: profile?.secondary_roles ?? null,
  };

  // Pages someone can open but not change show a "View only" note (the database blocks saves there too).
  const area = adminAreaForPath(pathname);
  const viewOnly =
    area != null &&
    area !== "dashboard" &&
    area !== "install-app" &&
    canOpenAdminArea(roleProfile, area) &&
    !canEdit(roleProfile, area);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] md:flex",
          collapsed ? "w-16" : "w-56",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <Link to="/admin" className="flex items-center gap-2">
            <img src={logo} alt="One Flow" className="h-8 w-8 object-contain" />
          </Link>
        </div>

        {!collapsed ? (
          <div className="border-b border-sidebar-border px-2 py-2">
            <AdminGlobalSearch />
          </div>
        ) : (
          <div className="flex justify-center border-b border-sidebar-border py-2">
            <AdminGlobalSearch className="h-9 w-9 min-w-9 max-w-none justify-center px-0 [&_span]:sr-only [&_kbd]:hidden" />
          </div>
        )}

        <AdminNav collapsed={collapsed} profile={roleProfile} />

        <AdminSidebarFooter
          collapsed={collapsed}
          profile={roleProfile}
          emailLine={emailLine}
          roleLine={roleLine}
          onSignOut={() => void signOut()}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
              >
                <Menu className="h-5 w-5 shrink-0" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-0">
              <SheetHeader className="shrink-0 border-b border-sidebar-border px-4 py-4">
                <SheetTitle className="flex items-center gap-2 text-left">
                  <img src={logo} alt="One Flow" className="h-7 w-7 object-contain" />
                  <span className="font-display text-base font-semibold">One.flow</span>
                </SheetTitle>
              </SheetHeader>
              <div className="shrink-0 border-b border-sidebar-border px-3 py-2">
                <AdminGlobalSearch className="max-w-none border-border bg-background text-foreground hover:bg-muted" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <AdminNav
                    collapsed={false}
                    fill={false}
                    profile={roleProfile}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
                <AdminSidebarFooter
                  collapsed={false}
                  profile={roleProfile}
                  emailLine={emailLine}
                  roleLine={roleLine}
                  onNavigate={() => setMobileOpen(false)}
                  onSignOut={() => void signOut()}
                />
              </div>
            </SheetContent>
          </Sheet>

          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted md:inline-flex"
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4 shrink-0" />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" />
            )}
          </button>

          <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold">
            {currentLabel}
          </h1>
        </header>
        <main
          data-admin-scroll
          className={cn(
            "min-h-0 flex-1 scroll-touch px-4 py-5 md:px-6 md:py-8",
            isCheckInKiosk
              ? "flex flex-col overflow-hidden max-[599px]:overflow-y-auto max-[599px]:scroll-touch py-3 md:py-4"
              : "overflow-y-auto",
          )}
        >
          {viewOnly ? (
            <div
              role="note"
              className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <span className="font-semibold">View only.</span> You can look at this page, but changes
              you make here will not be saved.
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
