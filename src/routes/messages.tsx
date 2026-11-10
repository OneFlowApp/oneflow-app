import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { ConversationThread } from "@/components/ConversationThread";
import { AppShell } from "@/components/AppShell";
import { MessageStudioButton } from "@/components/MessageStudioSheet";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [{ title: "Messages — One Flow" }],
  }),
  component: MessagesPage,
});

const TZ = "Africa/Johannesburg";

type StudioMessageRow = {
  id: string;
  subject: string | null;
  body: string;
  is_read: boolean;
  created_at: string;
};

type SentMessageRow = {
  id: string;
  subject: string | null;
  body: string;
  created_at: string;
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function markStudioMessageRead(messageId: string, profileId: string) {
  const { error: msgErr } = await supabase
    .from("studio_messages")
    .update({ is_read: true })
    .eq("id", messageId)
    .eq("to_profile_id", profileId);
  if (msgErr) throw msgErr;

  const { error: notifErr } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("profile_id", profileId)
    .eq("type", "message")
    .contains("metadata", { studio_message_id: messageId });
  if (notifErr) console.warn("mark notification read", notifErr);
}

function MessagesPage() {
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState<StudioMessageRow[]>([]);
  const [sent, setSent] = useState<SentMessageRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getUser();
    if (!user) {
      setProfileId(null);
      setInbox([]);
      setSent([]);
      setLoading(false);
      return;
    }
    setProfileId(user.id);

    const [{ data: inboxRows, error: inboxErr }, { data: sentRows, error: sentErr }] =
      await Promise.all([
        supabase
          .from("studio_messages")
          .select("id, subject, body, is_read, created_at")
          .eq("to_profile_id", user.id)
          .in("message_type", ["direct", "announcement"])
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("member_messages")
          .select("id, subject, body, created_at")
          .eq("profile_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    if (inboxErr) {
      console.error(inboxErr);
      toast.error(supabaseErrorMessage(inboxErr, "Could not load messages"));
    } else {
      setInbox((inboxRows ?? []) as StudioMessageRow[]);
    }
    if (sentErr) {
      console.error(sentErr);
    } else {
      setSent((sentRows ?? []) as SentMessageRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openMessage = async (row: StudioMessageRow) => {
    setSelectedId(row.id);
    const uid = profileId ?? (await getUser())?.id ?? null;
    if (!uid || row.is_read) return;
    try {
      await markStudioMessageRead(row.id, uid);
      setInbox((prev) => prev.map((m) => (m.id === row.id ? { ...m, is_read: true } : m)));
    } catch (e) {
      console.error(e);
      toast.error("Could not mark message as read");
    }
  };

  return (
    <AppShell>
      <header className="safe-top flex items-center gap-3 px-5 pt-3 pb-2">
        <Link
          to="/"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-lg font-semibold">Messages with One Flow</h1>

      </header>

      <main className="flex h-[calc(100dvh-170px)] min-h-[420px] flex-col px-5 pb-4 pt-2">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : profileId ? (
          <ConversationThread profileId={profileId} mode="member" className="flex-1" />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">Sign in to see your messages.</p>
        )}
      </main>
    </AppShell>
  );
}
