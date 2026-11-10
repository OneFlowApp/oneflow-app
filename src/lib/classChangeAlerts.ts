import { supabase } from "@/lib/supabase";
import { sendInAppMessagesToMembers } from "@/lib/studioMemberMessages";

/** What members see about a class: when, and what it's called. */
export type ClassSnapshot = {
  id: string;
  starts_at: string;
  ends_at: string;
  class_type_id: string | null;
  title: string;
};

const TZ = "Africa/Johannesburg";

function when(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-ZA", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} at ${time}`;
}

export async function snapshotClasses(ids: string[]): Promise<Map<string, ClassSnapshot>> {
  const out = new Map<string, ClassSnapshot>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("classes")
    .select("id, starts_at, ends_at, class_type_id, name, title_override")
    .in("id", ids);
  if (error) throw error;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(String(r.id), {
      id: String(r.id),
      starts_at: String(r.starts_at),
      ends_at: String(r.ends_at),
      class_type_id: r.class_type_id == null ? null : String(r.class_type_id),
      title: String((r.title_override as string | null)?.trim() || (r.name as string | null) || "Class"),
    });
  }
  return out;
}

/**
 * After a class (or series) is edited in Master: tell everyone booked into an upcoming class
 * whose time, length or class changed. In-app message (Messages + bell) and an email.
 * Returns how many members were told.
 */
export async function alertBookedMembersOfChanges(
  before: Map<string, ClassSnapshot>,
  fromProfileId: string | null,
): Promise<number> {
  if (before.size === 0) return 0;
  const after = await snapshotClasses([...before.keys()]);
  const now = Date.now();
  const changed = [...before.values()]
    .map((b) => ({ b, a: after.get(b.id) }))
    .filter(
      (x): x is { b: ClassSnapshot; a: ClassSnapshot } =>
        Boolean(x.a) &&
        new Date(x.a!.starts_at).getTime() > now &&
        (x.a!.starts_at !== x.b.starts_at ||
          x.a!.ends_at !== x.b.ends_at ||
          x.a!.class_type_id !== x.b.class_type_id ||
          x.a!.title !== x.b.title),
    );
  if (changed.length === 0) return 0;

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("class_id, profile_id, status")
    .in(
      "class_id",
      changed.map((c) => c.a.id),
    )
    .neq("status", "cancelled");
  if (error) throw error;

  const told = new Set<string>();
  for (const { a, b } of changed) {
    const people = [
      ...new Set(
        ((bookings ?? []) as { class_id: string; profile_id: string | null }[])
          .filter((x) => x.class_id === a.id && x.profile_id)
          .map((x) => String(x.profile_id)),
      ),
    ];
    if (people.length === 0) continue;

    const parts: string[] = [];
    if (a.title !== b.title) parts.push(`${b.title} is now ${a.title}`);
    if (a.starts_at !== b.starts_at) parts.push(`it's now on ${when(a.starts_at)} (was ${when(b.starts_at)})`);
    if (a.ends_at !== b.ends_at && a.starts_at === b.starts_at) {
      const mins = Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000);
      parts.push(`it now runs for ${mins} minutes`);
    }
    if (parts.length === 0) parts.push("the class details have been updated");

    await sendInAppMessagesToMembers({
      fromProfileId,
      profileIds: people,
      subject: `Change to your class: ${a.title}`,
      body: `Heads up: ${parts.join(", and ")}. You're still booked in. If the change doesn't work for you, please contact the studio.`,
      messageType: "direct",
    });

    for (const pid of people) {
      told.add(pid);
      void supabase.functions
        .invoke("send-email", {
          body: {
            template: "class_changed",
            to_profile_id: pid,
            data: {
              class_name: a.title,
              old_class_name: b.title,
              new_class_name: a.title,
              old_starts_at: b.starts_at,
              new_starts_at: a.starts_at,
            },
          },
        })
        .catch((e) => console.warn("class_changed email", e));
    }
  }
  return told.size;
}
