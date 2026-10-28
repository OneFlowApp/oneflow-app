import { redirect } from "@tanstack/react-router";
import { canOpenAdminPage, firstAdminPath } from "@/lib/roleAccess";
import { getUser, supabase } from "@/lib/supabase";

/** Route `beforeLoad` guard for marketing admin pages (Email, Client comms, Promo codes). */
export async function ensureMarketingAdminAccess(path: string) {
  const user = await getUser();
  if (!user) {
    throw redirect({ to: "/auth" });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role, secondary_roles")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("ensureMarketingAdminAccess", error);
    throw redirect({ to: "/admin" });
  }

  const profile = {
    role: (data?.role as string | null) ?? null,
    secondary_roles: (data?.secondary_roles as string[] | null) ?? null,
  };
  if (!canOpenAdminPage(profile, path)) {
    throw redirect({ to: firstAdminPath(profile) ?? "/" });
  }
}
