/**
 * Compatibility layer over `roleAccess.ts` — every check here follows the
 * combined access of the person's main role and secondary roles.
 */
import {
  canEdit,
  canEnterAdmin,
  canUseMemberApp,
  rolesOf,
  type RoleProfile,
} from "@/lib/roleAccess";

/** Profile fields used for admin access checks. */
export type AdminRoleProfile = RoleProfile;

/** Email / promotions / client comms. */
export const MARKETING_COMMS_ADMIN_ROUTES = [
  "/admin/email",
  "/admin/client-comms",
  "/admin/promotions",
] as const;

/** Primary + secondary roles, lowercased, deduped. */
export function profileRoleSet(profile: AdminRoleProfile): Set<string> {
  return rolesOf(profile);
}

/** Can change Email, Client comms and Promo codes. */
export function canAccessMarketingAdmin(profile: AdminRoleProfile): boolean {
  return (
    canEdit(profile, "email") || canEdit(profile, "client-comms") || canEdit(profile, "promotions")
  );
}

export function isMarketingCommsAdminPath(pathname: string): boolean {
  return MARKETING_COMMS_ADMIN_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Has at least one admin page. */
export function canEnterAdminArea(profile: AdminRoleProfile): boolean {
  return canEnterAdmin(profile);
}

/** Member app access (and admin sidebar link to it) — every signed-in role. */
export function canViewCustomerApp(profile: AdminRoleProfile): boolean {
  return canUseMemberApp(profile);
}
