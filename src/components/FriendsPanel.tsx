import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getUser, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type FriendShipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string | null;
};

type ProfileMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  email?: string | null;
};

function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function fullName(p: Pick<ProfileMini, "first_name" | "last_name">): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Member";
}

function initials(p: Pick<ProfileMini, "first_name" | "last_name">): string {
  const f = (p.first_name?.trim() || "M").charAt(0);
  const l = (p.last_name?.trim() || f).charAt(0);
  return (f + l).toUpperCase();
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-2xl font-bold">{title}</h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function FriendsPanel() {
  const [userId, setUserId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [ships, setShips] = useState<FriendShipRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});
  const [results, setResults] = useState<ProfileMini[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [shareBookings, setShareBookings] = useState(false);
  const [savingShare, setSavingShare] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("profiles")
      .select("share_bookings_with_friends")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        setShareBookings(Boolean((data as { share_bookings_with_friends?: boolean } | null)?.share_bookings_with_friends));
      });
  }, [userId]);

  const toggleShare = async (next: boolean) => {
    if (!userId) return;
    setSavingShare(true);
    setShareBookings(next);
    const { error } = await supabase
      .from("profiles")
      .update({ share_bookings_with_friends: next })
      .eq("id", userId);
    setSavingShare(false);
    if (error) {
      setShareBookings(!next);
      toast.error(error.message);
      return;
    }
    toast.success(next ? "Friends can now see the classes you book" : "Your bookings are hidden from friends");
  };

  const refreshFriendships = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);

    if (error) {
      console.error(error);
      toast.error(error.message);
      setShips([]);
      return;
    }

    const rows = (data ?? []) as FriendShipRow[];
    setShips(rows);

    const ids = new Set<string>();
    for (const s of rows) {
      if (s.requester_id !== uid) ids.add(s.requester_id);
      if (s.addressee_id !== uid) ids.add(s.addressee_id);
    }
    if (ids.size === 0) {
      setProfilesById({});
      return;
    }

    // member_directory exposes names and photos only; other members' contact details stay private.
    const { data: profs, error: pErr } = await supabase
      .from("member_directory")
      .select("id, first_name, last_name, avatar_url")
      .in("id", [...ids]);

    if (pErr) {
      console.error(pErr);
      return;
    }

    const map: Record<string, ProfileMini> = {};
    for (const p of (profs ?? []) as ProfileMini[]) {
      map[p.id] = p;
    }
    setProfilesById(map);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (!user) {
        setUserId(null);
        setLoading(false);
        return;
      }
      setUserId(user.id);
      await refreshFriendships(user.id);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshFriendships]);

  useEffect(() => {
    if (!userId || debouncedQ.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setSearching(true);
      const pattern = `%${escapeIlike(debouncedQ)}%`;
      const { data, error } = await supabase
        .from("member_directory")
        .select("id, first_name, last_name, avatar_url")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .neq("id", userId)
        .eq("is_active", true)
        .eq("is_searchable", true)
        .limit(10);

      if (cancelled) return;
      setSearching(false);
      if (error) {
        console.error(error);
        toast.error(error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as ProfileMini[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, userId]);

  const relationTo = useCallback(
    (otherId: string) => {
      for (const s of ships) {
        if (s.status === "accepted") {
          if (
            (s.requester_id === userId && s.addressee_id === otherId) ||
            (s.addressee_id === userId && s.requester_id === otherId)
          ) {
            return "friends" as const;
          }
        }
        if (s.status === "pending") {
          if (
            (s.requester_id === userId && s.addressee_id === otherId) ||
            (s.addressee_id === userId && s.requester_id === otherId)
          ) {
            return "requested" as const;
          }
        }
      }
      return "none" as const;
    },
    [ships, userId],
  );

  const incoming = useMemo(() => {
    if (!userId) return [];
    return ships.filter((s) => s.status === "pending" && s.addressee_id === userId);
  }, [ships, userId]);

  const acceptedFriends = useMemo(() => {
    if (!userId) return [] as { ship: FriendShipRow; profile: ProfileMini }[];
    const out: { ship: FriendShipRow; profile: ProfileMini }[] = [];
    for (const s of ships) {
      if (s.status !== "accepted") continue;
      const other = s.requester_id === userId ? s.addressee_id : s.requester_id;
      const profile = profilesById[other];
      if (profile) out.push({ ship: s, profile });
    }
    out.sort((a, b) => fullName(a.profile).localeCompare(fullName(b.profile)));
    return out;
  }, [ships, profilesById, userId]);

  const addFriend = async (target: ProfileMini) => {
    if (!userId) return;
    if (relationTo(target.id) !== "none") return;
    setAddingId(target.id);
    const myName = await loadMyDisplayName(userId);
    const { error } = await supabase.from("friendships").insert({
      requester_id: userId,
      addressee_id: target.id,
      status: "pending",
    });
    if (error) {
      toast.error(error.message);
      setAddingId(null);
      return;
    }
    // The email function looks up the recipient's address on the server, so members never see it.
    await supabase.functions.invoke("send-email", {
      body: {
        to_profile_id: target.id,
        template: "friend_request",
        data: {
          from_name: myName,
          first_name: myName.split(/\s+/)[0] ?? myName,
        },
      },
    });
    toast.success("Friend request sent");
    await refreshFriendships(userId);
    setAddingId(null);
  };

  const respond = async (shipId: string, accept: boolean) => {
    if (!userId) return;
    setUpdatingId(shipId);
    const { error } = await supabase
      .from("friendships")
      .update({ status: accept ? "accepted" : "declined" })
      .eq("id", shipId)
      .eq("addressee_id", userId);
    setUpdatingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(accept ? "Friend request accepted" : "Declined");
    await refreshFriendships(userId);
  };

  if (loading) {
    return (
      <Panel title="Friends">
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Friends">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Show friends the classes I book</p>
          <p className="text-xs text-muted-foreground">
            Your friends see your first name on classes you&apos;re booked into. Turn it on to
            see which classes your friends have booked too.
          </p>
        </div>
        <Switch
          checked={shareBookings}
          disabled={savingShare || !userId}
          onCheckedChange={(v) => void toggleShare(v)}
          aria-label="Show friends the classes I book"
        />
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by first or last name"
          className="w-full rounded-lg border border-border bg-muted/60 py-3 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>
      {q.trim().length > 0 && (
        <ul className="divide-y divide-border">
          {debouncedQ.length < 2 ? (
            <li className="py-4 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </li>
          ) : searching ? (
            <li className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </li>
          ) : results.length === 0 ? (
            <li className="py-4 text-center text-sm text-muted-foreground">No people found.</li>
          ) : (
            results.map((p) => {
              const rel = relationTo(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0">
                  <Avatar p={p} />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{fullName(p)}</p>
                  {rel === "friends" ? (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      Friends ✓
                    </span>
                  ) : rel === "requested" ? (
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Requested
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1 border-[#a3b693]/60 text-[#4a6b3c]"
                      disabled={addingId === p.id}
                      onClick={() => void addFriend(p)}
                    >
                      {addingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" />
                      )}
                      Add Friend
                    </Button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}

      <div>
        <h4 className="text-sm font-semibold text-foreground">Requests</h4>
        {incoming.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {incoming.map((s) => {
              const other = profilesById[s.requester_id];
              if (!other) {
                return (
                  <li key={s.id} className="py-3 text-sm text-muted-foreground">
                    Loading…
                  </li>
                );
              }
              const busy = updatingId === s.id;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0">
                  <Avatar p={other} />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{fullName(other)}</p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      className="h-8"
                      onClick={() => void respond(s.id, true)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Accept"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busy}
                      onClick={() => void respond(s.id, false)}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">Your friends</h4>
        {acceptedFriends.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No friends yet. Search above to connect.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {acceptedFriends.map(({ ship, profile: p }) => (
              <li key={ship.id} className="flex items-center gap-3 py-3 first:pt-0">
                <Avatar p={p} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{fullName(p)}</p>
                <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  Friends
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function Avatar({ p }: { p: ProfileMini }) {
  const url = p.avatar_url?.trim();
  const ini = initials(p);
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-semibold",
      )}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : ini}
    </div>
  );
}

async function loadMyDisplayName(uid: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", uid)
    .maybeSingle();
  const p = data as { first_name?: string | null; last_name?: string | null } | null;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  return name || "A member";
}
