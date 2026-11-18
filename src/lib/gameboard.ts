import { supabase } from "@/lib/supabase";

export type GameboardReward = {
  id: string;
  kind: "gift" | "message" | "sachet";
  label: string;
  message: string | null;
  status: "won" | "used" | "expired";
  won_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  gift_token: string | null;
  gift_claimed: boolean;
};

export type GameboardWeek = {
  week_start: string;
  attended: number;
  goal: number;
  goal_met: boolean;
  plays_left: number;
};

export type GameboardState = {
  ok: boolean;
  reason?: "signed_out" | "staff";
  tier: "member" | "green" | "bronze" | "silver" | "gold";
  goal: number;
  min_goal: number;
  plays_per_week: number;
  can_peek: boolean;
  play_week: string | null;
  weeks: GameboardWeek[];
  open_play_id: string | null;
  open_play_peeked: number | null;
  tiles: number;
  rewards: GameboardReward[];
};

export type GameboardPick = {
  id: string;
  kind: GameboardReward["kind"];
  label: string;
  message: string | null;
  expires_at: string | null;
  gift_token: string | null;
  board: string[];
};

export async function fetchGameboard(): Promise<GameboardState> {
  const { data, error } = await supabase.rpc("my_gameboard");
  if (error) throw error;
  return data as GameboardState;
}

export async function startGameboardPlay(): Promise<string> {
  const { data, error } = await supabase.rpc("start_gameboard_play");
  if (error) throw error;
  return String(data);
}

export async function peekGameboardTile(playId: string, index: number): Promise<string> {
  const { data, error } = await supabase.rpc("peek_gameboard_tile", { p_play_id: playId, p_index: index });
  if (error) throw error;
  return String(data);
}

export async function pickGameboardTile(playId: string, index: number): Promise<GameboardPick> {
  const { data, error } = await supabase.rpc("pick_gameboard_tile", { p_play_id: playId, p_index: index });
  if (error) throw error;
  return data as GameboardPick;
}

export function giftLink(token: string): string {
  return `${window.location.origin}/gift/${token}`;
}

/** Share the gift link (phone share sheet), or copy it. */
export async function shareGift(token: string, label: string): Promise<"shared" | "copied"> {
  const url = giftLink(token);
  const text = `I won a gift for you at One Flow: ${label.replace(/ to a friend$/i, "").replace(/^Gift /, "")}. Claim it here:`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: "A gift from One Flow", text, url });
      return "shared";
    } catch {
      // cancelled: fall through to copy
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  return "copied";
}

export function formatRewardDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  });
}

export const TIER_NAME: Record<GameboardState["tier"], string> = {
  member: "Member",
  green: "Green",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};
