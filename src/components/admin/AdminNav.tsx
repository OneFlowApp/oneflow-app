import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LogOut, type LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  QrCode,
  CalendarDays,
  BookOpen,
  Users,
  Package,
  UserCog,
  GraduationCap,
  DollarSign,
  Receipt,
  BarChart3,
  FileText,
  Trophy,
  Award,
  Megaphone,
  Mail,
  Send,
  Settings,
  Download,
} from "lucide-react";
import { canUseMemberApp, canOpenAdminPage, type RoleProfile } from "@/lib/roleAccess";
import { cn } from "@/lib/utils";

/** Profile fields used for admin access checks. */
export type AdminRoleProfile = RoleProfile;

export interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Whether this admin URL is open to the person (nav + deep-link guard in `admin.tsx`). */
export function isPathAllowedForRestrictedAdmin(profile: AdminRoleProfile, pathname: string) {
  return canOpenAdminPage(profile, pathname);
}

/** Menu items for every page the person's combined roles allow. */
export function navItemsForRole(profile: AdminRoleProfile): AdminNavItem[] {
  return adminNavItems.filter((i) => canOpenAdminPage(profile, i.to));
}

export const adminNavItems: AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutGrid },
  { to: "/admin/check-in", label: "Check-In", icon: QrCode },
  { to: "/admin/schedule", label: "Master", icon: CalendarDays },
  { to: "/admin/bookings", label: "Bookings", icon: BookOpen },
  { to: "/admin/customers", label: "Customers", icon: Users },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/staff", label: "Staff", icon: UserCog },
  { to: "/admin/guides", label: "Guides", icon: GraduationCap },
  { to: "/admin/payouts", label: "Payouts", icon: DollarSign },
  { to: "/admin/transactions", label: "Transactions", icon: Receipt },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/waivers", label: "Waivers", icon: FileText },
  { to: "/admin/badges", label: "Badges", icon: Trophy },
  { to: "/admin/challenge", label: "Home spotlight", icon: Award },
  { to: "/admin/promotions", label: "Promo codes", icon: Megaphone },
  { to: "/admin/email", label: "Email", icon: Mail },
  { to: "/admin/client-comms", label: "Client Comms", icon: Send },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/install-app", label: "Install App", icon: Download },
];

export function AdminNav({
  collapsed,
  onNavigate,
  profile,
  fill = true,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  profile: AdminRoleProfile;
  /** When false, parent supplies the scroll container (mobile drawer). */
  fill?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = navItemsForRole(profile);

  return (
    <nav
      className={cn("overflow-y-auto px-2 py-3", fill && "min-h-0 flex-1")}
    >
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active =
            item.to === "/admin"
              ? pathname === "/admin"
              : pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40",
                  collapsed && "justify-center px-2",
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AdminSidebarFooter({
  collapsed,
  profile,
  emailLine,
  roleLine,
  onNavigate,
  onSignOut,
}: {
  collapsed: boolean;
  profile: AdminRoleProfile;
  emailLine: string;
  roleLine: string;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  const showCustomerView = canUseMemberApp(profile);

  return (
    <div className="flex shrink-0 flex-col border-t border-sidebar-border">
      {showCustomerView ? (
        <Link
          to="/"
          onClick={onNavigate}
          title={collapsed ? "My Customer View" : undefined}
          className={cn(
            "flex w-full items-center gap-2 text-xs font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50",
            collapsed ? "justify-center px-0 py-3" : "px-3 py-2.5 text-left",
          )}
        >
          <Home className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <span>My Customer View</span>}
        </Link>
      ) : null}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-3 text-xs",
          showCustomerView && "border-t border-sidebar-border",
          collapsed && "justify-center px-0",
        )}
      >
        {!collapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-sidebar-foreground">{emailLine}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {roleLine}
              </p>
            </div>
            <button
              type="button"
              aria-label="Sign out"
              onClick={onSignOut}
              className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label="Sign out"
            onClick={onSignOut}
            className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
