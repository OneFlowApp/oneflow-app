import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Row for class guide dropdowns.
 * `guide_id` is **`guides.id`** (matches `classes.guide_id` when that FK targets `guides`,
 * and matches the check-in embed `guides ( profile_id )`). Legacy DBs may still point
 * `classes.guide_id` at `profiles.id` — then use `profile_id` on each row for saves if needed.
 */
export type GuideSelectRow = {
  /** `guides.id` for the class FK / dropdown value */
  guide_id: string;
  /** `profiles.id` — same as `guides.profile_id` */
  profile_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type ProfileEmbed = {
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
} | null;

function oneProfile(raw: unknown): ProfileEmbed {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const x = raw[0] as ProfileEmbed | undefined;
    return x ?? null;
  }
  return raw as ProfileEmbed;
}

/** PostgREST may return the FK embed under `profiles`, aliased `profile`, or (legacy) nested on `profile_id`. */
function profilesFromGuideRow(row: Record<string, unknown>): ProfileEmbed {
  const nested =
    typeof row.profile_id === "object" && row.profile_id !== null && !Array.isArray(row.profile_id)
      ? row.profile_id
      : null;
  return oneProfile(row.profiles ?? row.profile ?? nested);
}

const LOG = "[guidesForSelect]";

function guideLabel(g: Pick<GuideSelectRow, "first_name" | "last_name">): string {
  return [g.first_name, g.last_name].filter(Boolean).join(" ").trim();
}

/**
 * Active guides with profile names for class forms.
 * Uses `guides`, then names and photos from `member_directory`.
 */
export async function fetchGuidesForClassSelect(
  client: SupabaseClient = supabase,
): Promise<{
  data: GuideSelectRow[];
  error: PostgrestError | null;
}> {
  console.log(LOG, "fetchGuidesForClassSelect start");

  // Names come from member_directory below (members cannot read guides' full profiles).
  const selectStr = "id, profile_id";

  const res = await client
    .from("guides")
    .select(selectStr)
    .or("is_active.eq.true,is_active.is.null");

  console.log(LOG, "fetchGuidesForClassSelect after supabase", {
    select: selectStr,
    error: res.error,
    rowCount: res.data?.length ?? 0,
    firstRow: res.data?.[0] ?? null,
  });

  if (res.error) {
    console.error(LOG, "guides query failed", res.error);
    return { data: [], error: res.error };
  }

  const rawRows = (res.data ?? []) as Record<string, unknown>[];

  let mapped: GuideSelectRow[] = rawRows.map((row) => {
    const guidesTableId = row.id != null ? String(row.id) : "";
    const profileId = row.profile_id != null ? String(row.profile_id) : "";
    const p = profilesFromGuideRow(row);
    return {
      guide_id: guidesTableId,
      profile_id: profileId,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  });

  const needsNames = mapped.filter((m) => m.profile_id && !guideLabel(m)).map((m) => m.profile_id);
  if (needsNames.length > 0) {
    const { data: profs, error: pErr } = await client
      .from("member_directory")
      .select("id, first_name, last_name, avatar_url")
      .in("id", [...new Set(needsNames)]);
    console.log(LOG, "profiles fallback for names", {
      error: pErr,
      requested: needsNames.length,
      returned: profs?.length ?? 0,
    });
    if (!pErr && profs?.length) {
      const byId = new Map(
        profs.map((p: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }) => [
          String(p.id),
          p,
        ]),
      );
      mapped = mapped.map((m) => {
        if (guideLabel(m)) return m;
        const p = byId.get(m.profile_id);
        if (!p) return m;
        return {
          ...m,
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });
    }
  }

  mapped = mapped.filter((m) => m.guide_id.length > 0);

  mapped.sort((a, b) =>
    (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, { sensitivity: "base" }),
  );

  console.log(LOG, "mapped guide options", {
    count: mapped.length,
    sample: mapped.slice(0, 5),
  });

  return { data: mapped, error: null };
}
