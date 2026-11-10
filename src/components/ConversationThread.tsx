import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getUser, supabase } from "@/lib/supabase";
import { sendInAppMessagesToMembers } from "@/lib/studioMemberMessages";
import { cn } from "@/lib/utils";

type Line = {
  id: string;
  from: "studio" | "member";
  subject: string | null;
  body: string;
  at: string;
  kind: "direct" | "announcement";
};

const TZ = "Africa/Johannesburg";

const LINK_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi;

/** Message text with web addresses turned into tappable links (opened in a new tab). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(LINK_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium text-[#2f6b8a] underline underline-offset-2"
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * One running conversation between the studio and a member, like a chat: studio messages
 * (studio_messages) and the member's messages (member_messages) in date order, every message kept.
 * mode "member": the member's own Messages page. mode "studio": staff on the customer profile.
 */
export function ConversationThread({
  profileId,
  mode,
  memberName,
  className,
}: {
  profileId: string;
  mode: "member" | "studio";
  memberName?: string;
  className?: string;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const [studio, member] = await Promise.all([
      supabase
        .from("studio_messages")
        .select("id, subject, body, created_at, message_type, is_read")
        .eq("to_profile_id", profileId)
        .in("message_type", ["direct", "announcement"])
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("member_messages")
        .select("id, subject, body, created_at, status")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    if (studio.error) console.warn("conversation studio", studio.error.message);
    if (member.error) console.warn("conversation member", member.error.message);
    const out: Line[] = [
      ...((studio.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: `s-${r.id}`,
        from: "studio" as const,
        subject: (r.subject as string | null) ?? null,
        body: String(r.body ?? ""),
        at: String(r.created_at),
        kind: (r.message_type === "announcement" ? "announcement" : "direct") as Line["kind"],
      })),
      ...((member.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: `m-${r.id}`,
        from: "member" as const,
        subject: (r.subject as string | null) ?? null,
        body: String(r.body ?? ""),
        at: String(r.created_at),
        kind: "direct" as const,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    setLines(out);

    // Opening the conversation marks the other side's messages as read.
    if (mode === "member") {
      const unread = ((studio.data ?? []) as { id: string; is_read: boolean }[]).filter((r) => !r.is_read);
      if (unread.length > 0) {
        await supabase
          .from("studio_messages")
          .update({ is_read: true })
          .in(
            "id",
            unread.map((r) => r.id),
          );
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("profile_id", profileId)
          .eq("type", "message")
          .eq("is_read", false);
      }
    } else {
      const unread = ((member.data ?? []) as { id: string; status: string }[]).filter((r) => r.status === "unread");
      if (unread.length > 0) {
        await supabase
          .from("member_messages")
          .update({ status: "read" })
          .in(
            "id",
            unread.map((r) => r.id),
          );
      }
    }
  }, [profileId, mode]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      if (mode === "member") {
        const { error } = await supabase.from("member_messages").insert({ profile_id: profileId, body });
        if (error) throw error;
      } else {
        const me = await getUser();
        const { sent } = await sendInAppMessagesToMembers({
          fromProfileId: me?.id ?? null,
          profileIds: [profileId],
          subject: null,
          body,
          messageType: "direct",
        });
        if (sent < 1) throw new Error("not sent");
      }
      setDraft("");
      await load();
    } catch (e) {
      console.error("conversation send", e);
      toast.error("Your message could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const mine = (l: Line) => (mode === "member" ? l.from === "member" : l.from === "studio");
  const otherName = mode === "member" ? "One Flow" : memberName || "Member";

  let lastDay = "";
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl bg-[#efeae2] p-3">
        {lines === null ? (
          <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />
        ) : lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {mode === "member"
              ? "No messages yet. Send the studio a message below."
              : `No messages with ${otherName} yet.`}
          </p>
        ) : (
          lines.map((l) => {
            const day = dayLabel(l.at);
            const showDay = day !== lastDay;
            lastDay = day;
            const own = mine(l);
            return (
              <div key={l.id}>
                {showDay ? (
                  <p className="my-2 text-center">
                    <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                      {day}
                    </span>
                  </p>
                ) : null}
                <div className={cn("flex", own ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                      own ? "rounded-br-sm bg-[#dcebd0] text-[#1f2a1c]" : "rounded-bl-sm bg-white text-foreground",
                    )}
                  >
                    {!own ? (
                      <p className="mb-0.5 text-[11px] font-semibold text-[#4a6b3c]">
                        {l.from === "studio" ? "One Flow" : otherName}
                        {l.kind === "announcement" ? " · announcement" : ""}
                      </p>
                    ) : null}
                    {l.subject ? <p className="font-semibold">{l.subject}</p> : null}
                    <p className="whitespace-pre-wrap break-words">
                      <Linkified text={l.body} />
                    </p>
                    <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{timeLabel(l.at)}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={mode === "member" ? "Message the studio" : `Message ${otherName}`}
          rows={2}
          className="min-h-[44px] flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          disabled={sending || !draft.trim()}
          onClick={() => void send()}
          className="h-11 w-11 shrink-0 rounded-full bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
