import { useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth";
import { resolveDisplayTimezone, syncProfileTimezone } from "@/lib/profileTimezone";
import { STUDIO_TIMEZONE } from "@/lib/timezone";

export function useTimezone() {
  const { user, profile } = useAuth();

  const detected = useMemo(() => {
    if (typeof window === "undefined") return STUDIO_TIMEZONE;
    return resolveDisplayTimezone(null);
  }, []);

  // Classes happen in Cape Town, so members always see studio time, whatever their phone is set to.
  const timeZone = STUDIO_TIMEZONE;
  const studioTimeZone = STUDIO_TIMEZONE;
  const usesStudioTime = timeZone === studioTimeZone;

  useEffect(() => {
    if (!user?.id) return;
    if (!detected || detected === profile?.timezone) return;
    void syncProfileTimezone(user.id, detected);
  }, [user?.id, detected, profile?.timezone]);

  return { timeZone, studioTimeZone, usesStudioTime, detected };
}
