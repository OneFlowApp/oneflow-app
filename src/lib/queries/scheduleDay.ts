import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { dayBoundsForDateKey } from "@/lib/timezone";
import { queryKeys } from "./queryKeys";

export type ScheduleDayClassRow = {
  id: string;
  name: string;
  title_override: string | null;
  class_type: string;
  class_type_id: string | null;
  location: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  is_cancelled: boolean;
  guide_name: string | null;
  description?: string;
  product_id?: string | null;
  /** Ticked "Free class" in Admin → Schedule: members book with no credit or payment. */
  is_free?: boolean | null;
};

export async function fetchScheduleDayClasses(
  dateKey: string,
  studioTimeZone: string,
): Promise<ScheduleDayClassRow[]> {
  const { startUtcIso, endUtcIso } = dayBoundsForDateKey(dateKey, studioTimeZone);
  const { data, error } = await supabase
    .from("classes")
    .select(
      "id, name, title_override, guide_name, class_type, class_type_id, location, starts_at, ends_at, capacity, booked_count, is_cancelled, description, product_id, is_free",
    )
    .gte("starts_at", startUtcIso)
    .lte("starts_at", endUtcIso)
    .eq("is_cancelled", false)
    .order("starts_at");

  if (error) {
    console.error("fetchScheduleDayClasses", error);
    return [];
  }

  return (data ?? []).map((c) => {
    const raw = c as Record<string, unknown>;
    return {
      ...(c as ScheduleDayClassRow),
      guide_name:
        typeof raw.guide_name === "string" && raw.guide_name.trim()
          ? raw.guide_name.trim()
          : null,
    };
  });
}

export function useScheduleDayClasses(dateKey: string, studioTimeZone: string) {
  return useQuery({
    queryKey: [...queryKeys.scheduleDay(dateKey), studioTimeZone] as const,
    queryFn: () => fetchScheduleDayClasses(dateKey, studioTimeZone),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
