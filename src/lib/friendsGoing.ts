import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type FriendGoing = {
  friend_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

/**
 * Accepted friends booked into each class, keyed by class id. Only friends who switched on
 * "Show friends the classes I book" appear (the database function enforces this).
 */
export function useFriendsGoing(classIds: string[], userId: string | null | undefined) {
  const [byClass, setByClass] = useState<Map<string, FriendGoing[]>>(() => new Map());
  const key = classIds.slice().sort().join(",");

  useEffect(() => {
    if (!userId || !key) {
      setByClass(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("friends_booked", { p_class_ids: key.split(",") });
      if (cancelled) return;
      if (error) {
        console.warn("friends going", error.message);
        setByClass(new Map());
        return;
      }
      const next = new Map<string, FriendGoing[]>();
      for (const r of (data ?? []) as (FriendGoing & { class_id: string })[]) {
        const list = next.get(r.class_id) ?? [];
        list.push({
          friend_id: r.friend_id,
          first_name: r.first_name,
          last_name: r.last_name,
          avatar_url: r.avatar_url,
        });
        next.set(r.class_id, list);
      }
      setByClass(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, userId]);

  return byClass;
}

/** "Sarah is going", "Sarah and Tom are going", "Sarah and 2 friends are going". */
export function friendsGoingLabel(friends: FriendGoing[]): string {
  const names = friends.map((f) => f.first_name?.trim() || "A friend");
  if (names.length === 1) return `${names[0]} is going`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are going`;
  return `${names[0]} and ${names.length - 1} friends are going`;
}
