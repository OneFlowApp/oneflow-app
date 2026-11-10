import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { getUser, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Bell linking to Messages. Turns sage with a red count when there are unread messages in the inbox. */
export function NotificationBell({ className }: { className?: string }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const user = await getUser();
      if (!user || cancelled) return;
      // Count unread messages in the inbox itself (the source of truth for Messages), so the bell
      // lights up even when a separate notification row wasn't written.
      const { count } = await supabase
        .from("studio_messages")
        .select("id", { count: "exact", head: true })
        .eq("to_profile_id", user.id)
        .eq("is_read", false);
      if (!cancelled) setUnread(typeof count === "number" ? count : 0);
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(t);
    };
  }, []);

  const has = unread > 0;
  return (
    <Link
      to="/messages"
      aria-label={has ? `Messages, ${unread} unread` : "Messages"}
      className={cn(
        "relative z-30 flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
        has ? "border-[#a3b693] bg-[#a3b693] text-white" : "border-border bg-card text-foreground",
        className,
      )}
    >
      <Bell className="h-4 w-4" />
      {has ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
