import { supabase } from "@/lib/supabase";
import { formatStudioDateShort, formatStudioTime12Upper } from "@/lib/timezone";

export type ClassInvitePublicPayload = {
  ok: boolean;
  code?: string;
  inviter_name?: string;
  invite?: {
    id: string;
    status: string;
    paid_by_inviter: boolean;
    invitee_email: string | null;
    invitee_name: string | null;
    invitee_id: string | null;
    booking_id: string | null;
  };
  class?: {
    id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    location: string | null;
    guide_name: string | null;
    is_cancelled: boolean;
  };
};

export type RespondClassInviteResult = {
  ok: boolean;
  code?: string;
  message?: string;
  status?: string;
  booked?: boolean;
  booking_id?: string;
  next?: "book";
  class_id?: string;
};

export async function fetchClassInvitePublic(
  inviteId: string,
): Promise<ClassInvitePublicPayload> {
  const { data, error } = await supabase.rpc("get_class_invite_public", {
    p_invite_id: inviteId,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as ClassInvitePublicPayload;
}

export async function respondClassInvite(
  inviteId: string,
  action: "accept" | "decline",
): Promise<RespondClassInviteResult> {
  const { data, error } = await supabase.rpc("respond_class_invite", {
    p_invite_id: inviteId,
    p_action: action,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as RespondClassInviteResult;
}

export function formatInviteWhenLine(startsAtIso: string): string {
  const starts = new Date(startsAtIso);
  if (Number.isNaN(starts.getTime())) return "";
  return `${formatStudioDateShort(starts)} · ${formatStudioTime12Upper(starts)}`;
}

export const PENDING_CLASS_INVITE_KEY = "oneflow_pending_class_invite_id";

export function storePendingClassInviteId(inviteId: string): void {
  try {
    sessionStorage.setItem(PENDING_CLASS_INVITE_KEY, inviteId);
  } catch {
    // ignore
  }
}

export function consumePendingClassInviteId(): string | null {
  try {
    const id = sessionStorage.getItem(PENDING_CLASS_INVITE_KEY);
    if (id) sessionStorage.removeItem(PENDING_CLASS_INVITE_KEY);
    return id;
  } catch {
    return null;
  }
}

const AUTH_REDIRECT_KEY = "oneflow_auth_redirect";

/** After onboarding, return stored invite URL or pending invite id route. */
export function consumePostOnboardingInvitePath(): string | null {
  try {
    const redirect = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    if (redirect?.startsWith("/invite/") || redirect?.startsWith("/gift/")) {
      sessionStorage.removeItem(AUTH_REDIRECT_KEY);
      return redirect;
    }
  } catch {
    // ignore
  }
  const inviteId = consumePendingClassInviteId();
  return inviteId ? `/invite/${inviteId}` : null;
}
