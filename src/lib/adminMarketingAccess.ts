/** Profile fields used for admin marketing access checks. */
export type AdminRoleProfile = {
  role: string | null;
  secondary_roles?: string[] | null;
};

/** Email / promotions / client comms — require marketing admin permission. */
export const MARKETING_COMMS_ADMIN_ROUTES = [
  "/admin/email",
  "/admin/client-comms",
  "/admin/promotions",
] as const;

/** @deprecated Use MARKETING_COMMS_ADMIN_ROUTES */
export const MARKETING_ADMIN_ROUTES = MARKETING_COMMS_ADMIN_ROUTES;

/** Financial admin routes — marketing-scoped staff cannot open these. */
export const MARKETING_FINANCIAL_ADMIN_ROUTES = [
  "/admin/payouts",
  "/admin/transactions",
  "/admin/reports",
] as const;

const STANDARD_ADMIN_PRIMARY_ROLES = new Set([
  "director",
  "management",
  "guide",
  "front_desk",
  "boh",
]);

/** Primary + secondary roles, lowercased, deduped. */
export function profileRoleSet(profile: AdminRoleProfile): Set<string> {
  const out = new Set<string>();
  const primary = (profile.role ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const raw of profile.secondary_roles ?? []) {
    const s = String(raw).trim().toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

/** Email / promotions / client comms admin. */
export function canAccessMarketingAdmin(profile: AdminRoleProfile): boolean {
  const roles = profileRoleSet(profile);
  return (
    roles.has("director") ||
    roles.has("management") ||
    roles.has("marketing")
  );
}

export function isMarketingCommsAdminPath(pathname: string): boolean {
  return MARKETING_COMMS_ADMIN_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** @deprecated Use isMarketingCommsAdminPath */
export function isMarketingAdminPath(pathname: string): boolean {
  return isMarketingCommsAdminPath(pathname);
}

export function isMarketingFinancialAdminPath(pathname: string): boolean {
  return MARKETING_FINANCIAL_ADMIN_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Whether a marketing-scoped user may open this admin URL (all admin except financial). */
export function isMarketingScopedAdminPathAllowed(pathname: string): boolean {
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
  return !isMarketingFinancialAdminPath(pathname);
}

/** Any admin area access (staff + marketing primary or secondary). */
export function canEnterAdminArea(profile: AdminRoleProfile): boolean {
  const primary = (profile.role ?? "").trim().toLowerCase();
  if (STANDARD_ADMIN_PRIMARY_ROLES.has(primary)) return true;
  if (primary === "marketing") return true;
  return profileRoleSet(profile).has("marketing");
}

/** Marketing access without director/management primary role. */
export function isMarketingScopedStaff(profile: AdminRoleProfile): boolean {
  if (!canAccessMarketingAdmin(profile)) return false;
  const primary = (profile.role ?? "").trim().toLowerCase();
  return primary !== "director" && primary !== "management";
}

/** Default landing route for marketing-scoped staff. */
export function defaultMarketingAdminPath(): string {
  return "/admin";
}

const CUSTOMER_APP_ROLES = [
  "customer",
  "director",
  "management",
  "team",
  "guide",
  "front_desk",
  "boh",
  "marketing",
];

/** Member app access (and admin sidebar link to it) — every signed-in role. */
export function canViewCustomerApp(profile: AdminRoleProfile): boolean {
  const roles = profileRoleSet(profile);
  return CUSTOMER_APP_ROLES.some((r) => roles.has(r));
}
