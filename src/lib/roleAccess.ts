/**
 * Single source of truth for staff access.
 *
 * A person's access is the union of every role they hold: their main role
 * (`profiles.role`) plus every tag in `profiles.secondary_roles`.
 */

/** Profile fields used for access checks. */
export type RoleProfile = {
  role: string | null;
  secondary_roles?: readonly string[] | null;
};

export type StaffRole = "director" | "management" | "marketing" | "front_desk" | "guide" | "boh";

/** One admin page = one area (the first segment after `/admin`). */
export type AdminArea =
  | "dashboard"
  | "check-in"
  | "schedule"
  | "bookings"
  | "customers"
  | "products"
  | "staff"
  | "guides"
  | "payouts"
  | "transactions"
  | "reports"
  | "waivers"
  | "badges"
  | "challenge"
  | "promotions"
  | "email"
  | "client-comms"
  | "settings"
  | "install-app";

const ALL_AREAS: readonly AdminArea[] = [
  "dashboard",
  "check-in",
  "schedule",
  "bookings",
  "customers",
  "products",
  "staff",
  "guides",
  "payouts",
  "transactions",
  "reports",
  "waivers",
  "badges",
  "challenge",
  "promotions",
  "email",
  "client-comms",
  "settings",
  "install-app",
];

/** Legacy admin URLs that forward to another area. */
const AREA_ALIASES: Record<string, AdminArea> = { scheduling: "schedule" };

const except = (...excluded: AdminArea[]) => ALL_AREAS.filter((a) => !excluded.includes(a));

/** Pages each role can open (shown in the admin menu). */
const PAGES: Record<StaffRole, readonly AdminArea[]> = {
  director: ALL_AREAS,
  management: except("payouts"),
  marketing: except("schedule", "payouts", "transactions"),
  front_desk: ["check-in", "bookings"],
  guide: ["check-in", "bookings"],
  boh: ["bookings"],
};

/** Areas each role can change. Every other page they open is view only. */
const EDIT: Record<StaffRole, readonly AdminArea[]> = {
  director: ALL_AREAS,
  management: except("payouts"),
  marketing: ["email", "client-comms", "promotions"],
  front_desk: ["check-in", "bookings"],
  guide: ["check-in"],
  boh: [],
};

/** Roles that may see a member's email address and date of birth. */
const MEMBER_PRIVATE_DETAIL_ROLES: readonly StaffRole[] = ["director", "management", "marketing"];

function isStaffRole(r: string): r is StaffRole {
  return Object.prototype.hasOwnProperty.call(PAGES, r);
}

/** Main role + secondary roles, trimmed, lowercased and deduped. */
export function rolesOf(profile: RoleProfile | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!profile) return out;
  const primary = (profile.role ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const raw of profile.secondary_roles ?? []) {
    const s = String(raw).trim().toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

export function hasRole(profile: RoleProfile | null | undefined, role: string): boolean {
  return rolesOf(profile).has(role.toLowerCase());
}

function staffRolesOf(profile: RoleProfile | null | undefined): StaffRole[] {
  return [...rolesOf(profile)].filter(isStaffRole);
}

/** Admin area for a pathname, or null when the path is not an admin page. */
export function adminAreaForPath(pathname: string): AdminArea | null {
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;
  const seg = pathname.slice("/admin".length).split("/").filter(Boolean)[0];
  if (!seg) return "dashboard";
  if (AREA_ALIASES[seg]) return AREA_ALIASES[seg];
  return (ALL_AREAS as readonly string[]).includes(seg) ? (seg as AdminArea) : null;
}

export function canOpenAdminArea(profile: RoleProfile | null | undefined, area: AdminArea): boolean {
  return staffRolesOf(profile).some((r) => PAGES[r].includes(area));
}

/** Whether the person may open this admin URL. */
export function canOpenAdminPage(profile: RoleProfile | null | undefined, path: string): boolean {
  const area = adminAreaForPath(path);
  return area != null && canOpenAdminArea(profile, area);
}

/** Whether the person may change things in this area (save, edit, delete, add). */
export function canEdit(profile: RoleProfile | null | undefined, area: AdminArea): boolean {
  return staffRolesOf(profile).some((r) => EDIT[r].includes(area));
}

/** Holds any role other than customer (lands on the Admin Dashboard after sign-in). */
export function isStaff(profile: RoleProfile | null | undefined): boolean {
  return [...rolesOf(profile)].some((r) => r !== "customer");
}

/** Has at least one admin page available. */
export function canEnterAdmin(profile: RoleProfile | null | undefined): boolean {
  return ALL_AREAS.some((a) => canOpenAdminArea(profile, a));
}

/** Member app is available to every signed-in person, staff included. */
export function canUseMemberApp(_profile: RoleProfile | null | undefined): boolean {
  return true;
}

/** Email address and date of birth are hidden unless Director, Management or Marketing. */
export function canSeeMemberPrivateDetails(profile: RoleProfile | null | undefined): boolean {
  return MEMBER_PRIVATE_DETAIL_ROLES.some((r) => hasRole(profile, r));
}

/** Admin path for an area. */
export function adminPathForArea(area: AdminArea): string {
  return area === "dashboard" ? "/admin" : `/admin/${area}`;
}

/** Preferred landing order for staff; first one their access allows wins. */
const LANDING_ORDER: readonly AdminArea[] = ["dashboard", "check-in", "bookings", ...ALL_AREAS];

/** First admin page this person may open, or null when they have none. */
export function firstAdminPath(profile: RoleProfile | null | undefined): string | null {
  const area = LANDING_ORDER.find((a) => canOpenAdminArea(profile, a));
  return area ? adminPathForArea(area) : null;
}

/** Where a signed-in, onboarded person lands: first allowed admin page, else the member app. */
export function landingPathFor(profile: RoleProfile | null | undefined): string {
  if (!isStaff(profile)) return "/";
  return firstAdminPath(profile) ?? "/";
}

/** Strongest role order, matching the database's get_my_role(). */
const ROLE_STRENGTH = [
  "director",
  "management",
  "front_desk",
  "guide",
  "marketing",
  "boh",
  "team",
  "customer",
] as const;

/**
 * The single strongest role a person holds across their main role and tags.
 * Use this wherever a page compares one role string (e.g. `=== "director"`),
 * so a Guide tagged Director is treated as a Director.
 */
export function effectiveRole(profile: RoleProfile | null | undefined): string | null {
  const roles = rolesOf(profile);
  for (const r of ROLE_STRENGTH) if (roles.has(r)) return r;
  const first = [...roles][0];
  return first ?? null;
}
