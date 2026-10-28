import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Megaphone,
  MessageSquare,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ensureMarketingAdminAccess } from "@/lib/ensureMarketingAdminAccess";
import { isBookableMember } from "@/lib/bookableMembers";
import {
  ALL_MEMBERS_RECIPIENT,
  fetchAllMemberProfileIds,
  sendInAppMessagesToMembers,
} from "@/lib/studioMemberMessages";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/client-comms")({
  beforeLoad: ({ location }) => ensureMarketingAdminAccess(location.pathname),
  head: () => ({ meta: [{ title: "Client Comms — One Flow Admin" }] }),
  component: ClientCommsPage,
});

const TZ = "Africa/Johannesburg";
const PAGE_SIZE = 20;

type MessageRow = {
  id: string;
  from_profile_id: string | null;
  to_profile_id: string | null;
  subject: string | null;
  body: string;
  is_read: boolean;
  message_type: "direct" | "broadcast" | "announcement";
  created_at: string;
  fromName: string;
  toName: string;
};

type ProfileLite = { id: string; fullName: string; email: string };

type MemberMessageRow = {
  id: string;
  profile_id: string;
  subject: string | null;
  body: string;
  status: "unread" | "read";
  created_at: string;
  memberName: string;
  memberEmail: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ClientCommsPage() {
  const [tab, setTab] = useState<string>("inbox");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [members, setMembers] = useState<ProfileLite[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Inbox / Sent filters
  const [inboxQuery, setInboxQuery] = useState("");
  const [sentQuery, setSentQuery] = useState("");
  const [inboxPage, setInboxPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);

  // Send tab
  const [sendSearch, setSendSearch] = useState("");
  const [sendToId, setSendToId] = useState<string>("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sending, setSending] = useState(false);

  // Announcements
  const [annSubject, setAnnSubject] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annSending, setAnnSending] = useState(false);

  const [memberMessages, setMemberMessages] = useState<MemberMessageRow[]>([]);
  const [memberMsgQuery, setMemberMsgQuery] = useState("");
  const [selectedMemberMsg, setSelectedMemberMsg] = useState<MemberMessageRow | null>(null);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setMe(user.id);

    const [msgsRes, membersRes, memberMsgsRes] = await Promise.all([
      supabase
        .from("studio_messages")
        .select("id, from_profile_id, to_profile_id, subject, body, is_read, message_type, created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("profiles")
        .select("id, first_name, last_name, email, role, secondary_roles")
        .order("first_name", { ascending: true })
        .limit(2000),
      supabase
        .from("member_messages")
        .select(
          "id, profile_id, subject, body, status, created_at, profiles(first_name, last_name, email)",
        )
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const profileMap = new Map<string, string>();
    if (membersRes.data) {
      for (const p of membersRes.data as Record<string, unknown>[]) {
        const fn = String(p.first_name ?? "").trim();
        const ln = String(p.last_name ?? "").trim();
        const name = `${fn} ${ln}`.trim() || String(p.email ?? "Member");
        profileMap.set(String(p.id), name);
      }
      setMembers(
        (membersRes.data as Record<string, unknown>[])
          .filter((p) =>
            isBookableMember({
              role: String(p.role ?? ""),
              secondary_roles: (p.secondary_roles as string[] | null) ?? null,
            }),
          )
          .map((p) => ({
            id: String(p.id),
            fullName:
              `${p.first_name ?? ""} ${p.last_name ?? ""}`.toString().trim() ||
              String(p.email ?? "Member"),
            email: String(p.email ?? ""),
          })),
      );
    }

    if (msgsRes.error) {
      console.error(msgsRes.error);
      toast.error(supabaseErrorMessage(msgsRes.error, "Could not load messages"));
      setMessages([]);
    } else {
      const rows: MessageRow[] = (msgsRes.data ?? []).map((raw: Record<string, unknown>) => ({
        id: String(raw.id),
        from_profile_id: (raw.from_profile_id as string | null) ?? null,
        to_profile_id: (raw.to_profile_id as string | null) ?? null,
        subject: (raw.subject as string | null) ?? null,
        body: String(raw.body ?? ""),
        is_read: Boolean(raw.is_read),
        message_type: ((raw.message_type as string) ?? "direct") as MessageRow["message_type"],
        created_at: String(raw.created_at ?? new Date().toISOString()),
        fromName:
          (raw.from_profile_id ? profileMap.get(String(raw.from_profile_id)) : null) ?? "—",
        toName:
          (raw.to_profile_id ? profileMap.get(String(raw.to_profile_id)) : null) ??
          (raw.message_type === "announcement" ? "All members" : "—"),
      }));
      setMessages(rows);
    }

    if (memberMsgsRes.error) {
      console.error(memberMsgsRes.error);
      toast.error(supabaseErrorMessage(memberMsgsRes.error, "Could not load member messages"));
      setMemberMessages([]);
    } else {
      const mapped: MemberMessageRow[] = (memberMsgsRes.data ?? []).map(
        (raw: Record<string, unknown>) => {
          const prof = raw.profiles as
            | { first_name?: string; last_name?: string; email?: string }
            | { first_name?: string; last_name?: string; email?: string }[]
            | null;
          const p = Array.isArray(prof) ? prof[0] : prof;
          const fn = String(p?.first_name ?? "").trim();
          const ln = String(p?.last_name ?? "").trim();
          const em = String(p?.email ?? "").trim();
          return {
            id: String(raw.id),
            profile_id: String(raw.profile_id),
            subject: (raw.subject as string | null) ?? null,
            body: String(raw.body ?? ""),
            status: (raw.status as "unread" | "read") ?? "unread",
            created_at: String(raw.created_at ?? new Date().toISOString()),
            memberName: `${fn} ${ln}`.trim() || em || "Member",
            memberEmail: em,
          };
        },
      );
      setMemberMessages(mapped);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inbox = useMemo(() => {
    const q = inboxQuery.trim().toLowerCase();
    return messages
      .filter((m) => m.to_profile_id === me || m.message_type === "announcement")
      .filter((m) =>
        !q || `${m.fromName} ${m.subject ?? ""} ${m.body}`.toLowerCase().includes(q),
      );
  }, [messages, me, inboxQuery]);

  const sent = useMemo(() => {
    const q = sentQuery.trim().toLowerCase();
    return messages
      .filter((m) => m.from_profile_id === me)
      .filter((m) =>
        !q || `${m.toName} ${m.subject ?? ""} ${m.body}`.toLowerCase().includes(q),
      );
  }, [messages, me, sentQuery]);

  const announcements = useMemo(
    () => messages.filter((m) => m.message_type === "announcement"),
    [messages],
  );

  useEffect(() => {
    setInboxPage(1);
  }, [inboxQuery]);
  useEffect(() => {
    setSentPage(1);
  }, [sentQuery]);

  const inboxPageCount = Math.max(1, Math.ceil(inbox.length / PAGE_SIZE));
  const inboxRows = inbox.slice((inboxPage - 1) * PAGE_SIZE, inboxPage * PAGE_SIZE);
  const sentPageCount = Math.max(1, Math.ceil(sent.length / PAGE_SIZE));
  const sentRows = sent.slice((sentPage - 1) * PAGE_SIZE, sentPage * PAGE_SIZE);

  const unreadCount = inbox.filter((m) => !m.is_read).length;
  const unreadMemberCount = memberMessages.filter((m) => m.status === "unread").length;

  const filteredMemberMessages = useMemo(() => {
    const q = memberMsgQuery.trim().toLowerCase();
    return memberMessages.filter((m) => {
      if (!q) return true;
      return `${m.memberName} ${m.memberEmail} ${m.subject ?? ""} ${m.body}`
        .toLowerCase()
        .includes(q);
    });
  }, [memberMessages, memberMsgQuery]);

  const openMemberMessage = async (row: MemberMessageRow) => {
    setSelectedMemberMsg(row);
    setReplySubject(row.subject?.trim() ? `Re: ${row.subject.trim()}` : "Re: your message to One Flow");
    setReplyBody("");
    if (row.status === "unread") {
      const { error } = await supabase
        .from("member_messages")
        .update({ status: "read" })
        .eq("id", row.id);
      if (!error) {
        setMemberMessages((prev) =>
          prev.map((m) => (m.id === row.id ? { ...m, status: "read" as const } : m)),
        );
        setSelectedMemberMsg({ ...row, status: "read" });
      }
    }
  };

  const sendMemberReply = async () => {
    if (!selectedMemberMsg) return;
    const body = replyBody.trim();
    if (!body) {
      toast.error("Write a reply message");
      return;
    }
    const subject = replySubject.trim() || "Reply from One Flow";
    setReplying(true);
    const user = await getUser();
    const { data: inserted, error: msgErr } = await supabase
      .from("studio_messages")
      .insert({
        from_profile_id: user?.id ?? null,
        to_profile_id: selectedMemberMsg.profile_id,
        subject,
        body,
        message_type: "direct",
      })
      .select("id")
      .maybeSingle();
    if (msgErr || !inserted?.id) {
      setReplying(false);
      toast.error(supabaseErrorMessage(msgErr, "Could not send reply"));
      return;
    }
    const { error: notifErr } = await supabase.from("notifications").insert({
      profile_id: selectedMemberMsg.profile_id,
      type: "message",
      title: subject,
      body: body.slice(0, 200) || null,
      metadata: { studio_message_id: inserted.id },
    });
    setReplying(false);
    if (notifErr) {
      console.warn("notifications insert", notifErr);
    }
    toast.success(`Reply sent to ${selectedMemberMsg.memberName} in the app`);
    setReplyBody("");
    setSelectedMemberMsg(null);
  };

  const markRead = async (id: string) => {
    const { error } = await supabase
      .from("studio_messages")
      .update({ is_read: true })
      .eq("id", id);
    if (error) {
      console.error(error);
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
  };

  const sendDirect = async () => {
    if (!sendBody.trim() && !sendSubject.trim()) {
      toast.error("Add a subject or body");
      return;
    }
    if (!sendToId) {
      toast.error("Pick a recipient");
      return;
    }
    setSending(true);
    const user = await getUser();

    if (sendToId === ALL_MEMBERS_RECIPIENT) {
      try {
        const ids = await fetchAllMemberProfileIds();
        if (ids.length === 0) {
          toast.error("No members to message");
          setSending(false);
          return;
        }
        const { sent, failed } = await sendInAppMessagesToMembers({
          fromProfileId: user?.id ?? null,
          profileIds: ids,
          subject: sendSubject.trim() || null,
          body: sendBody.trim(),
          messageType: "direct",
        });
        setSending(false);
        if (sent === 0) {
          toast.error("Could not send messages — check permissions and try again.");
          return;
        }
        if (failed > 0) {
          toast.error(`Sent to ${sent} members, ${failed} failed.`);
        } else {
          toast.success(`Message sent to ${sent} member${sent === 1 ? "" : "s"}`);
        }
        setSendSubject("");
        setSendBody("");
        setSendToId("");
        setSendSearch("");
        await load();
        return;
      } catch (e) {
        console.error(e);
        setSending(false);
        toast.error(e instanceof Error ? e.message : "Could not load members");
        return;
      }
    }

    const { data: inserted, error: msgErr } = await supabase
      .from("studio_messages")
      .insert({
        from_profile_id: user?.id ?? null,
        to_profile_id: sendToId,
        subject: sendSubject.trim() || null,
        body: sendBody.trim(),
        message_type: "direct",
      })
      .select("id")
      .maybeSingle();
    if (msgErr || !inserted?.id) {
      setSending(false);
      toast.error(supabaseErrorMessage(msgErr, "Could not send"));
      return;
    }
    await supabase.from("notifications").insert({
      profile_id: sendToId,
      type: "message",
      title: sendSubject.trim() || "New message",
      body: sendBody.trim().slice(0, 200) || null,
      metadata: { studio_message_id: inserted.id },
    });
    setSending(false);
    setSendSubject("");
    setSendBody("");
    setSendToId("");
    setSendSearch("");
    toast.success("Message sent");
    await load();
  };

  const sendAnnouncement = async () => {
    if (!annSubject.trim() && !annBody.trim()) {
      toast.error("Add a subject or body");
      return;
    }
    setAnnSending(true);
    const user = await getUser();
    try {
      const ids = await fetchAllMemberProfileIds();
      if (ids.length === 0) {
        setAnnSending(false);
        toast.error("No members to announce to");
        return;
      }
      const { sent, failed } = await sendInAppMessagesToMembers({
        fromProfileId: user?.id ?? null,
        profileIds: ids,
        subject: annSubject.trim() || null,
        body: annBody.trim(),
        messageType: "announcement",
      });
      setAnnSending(false);
      if (sent === 0) {
        toast.error("Could not send announcement — check permissions and try again.");
        return;
      }
      if (failed > 0) {
        toast.error(`Announcement sent to ${sent} members, ${failed} failed.`);
      } else {
        toast.success(`Announcement sent to ${sent} member${sent === 1 ? "" : "s"}`);
      }
      setAnnSubject("");
      setAnnBody("");
      await load();
    } catch (e) {
      console.error(e);
      setAnnSending(false);
      toast.error(e instanceof Error ? e.message : "Could not load members");
    }
  };

  const filteredMembers = useMemo(() => {
    const q = sendSearch.trim().toLowerCase();
    if (!q) return members.slice(0, 50);
    return members.filter((m) => `${m.fullName} ${m.email}`.toLowerCase().includes(q)).slice(0, 50);
  }, [members, sendSearch]);

  const allMembersLabel = `All members (${members.length})`;

  return (
    <div>
      <PageHeader
        title="Client Comms"
        description="Direct messages and studio-wide announcements."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="inbox" className="gap-1">
            Inbox
            {unreadCount > 0 && (
              <span className="ml-1 rounded-full bg-[#a3b693] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="member-inbox" className="gap-1">
            From members
            {unreadMemberCount > 0 && (
              <span className="ml-1 rounded-full bg-[#a3b693] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unreadMemberCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="send">Send message</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-0">
          <div className="mb-4 max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                placeholder="Search inbox…"
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card">
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : inboxRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">Inbox is empty.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {inboxRows.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "cursor-pointer px-5 py-3 hover:bg-muted/30",
                      !m.is_read && "bg-[#e8efe3]/40",
                    )}
                    onClick={() => void markRead(m.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span
                            className={cn(
                              "font-semibold",
                              !m.is_read && "text-[#3d4f36]",
                            )}
                          >
                            {m.fromName}
                          </span>
                          {m.subject && (
                            <span className="ml-2 text-muted-foreground">· {m.subject}</span>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                          {m.body}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(m.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!loading && inbox.length > 0 && (
            <PaginationFooter
              page={inboxPage}
              pageCount={inboxPageCount}
              total={inbox.length}
              onPrev={() => setInboxPage((p) => Math.max(1, p - 1))}
              onNext={() => setInboxPage((p) => Math.min(inboxPageCount, p + 1))}
            />
          )}
        </TabsContent>

        <TabsContent value="member-inbox" className="mt-0">
          <div className="mb-4 max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={memberMsgQuery}
                onChange={(e) => setMemberMsgQuery(e.target.value)}
                placeholder="Search member messages…"
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card">
              {loading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredMemberMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <MessageSquare className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">No member messages yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredMemberMessages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "cursor-pointer px-5 py-3 hover:bg-muted/30",
                        m.status === "unread" && "bg-[#e8efe3]/40",
                        selectedMemberMsg?.id === m.id && "ring-1 ring-inset ring-[#a3b693]/50",
                      )}
                      onClick={() => void openMemberMessage(m)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{m.memberName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.subject?.trim() || "(No subject)"}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                            {m.body}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-xs text-muted-foreground">
                            {formatDate(m.created_at)}
                          </span>
                          {m.status === "unread" ? (
                            <span className="mt-1 block text-[10px] font-semibold uppercase text-[#a3b693]">
                              Unread
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              {selectedMemberMsg ? (
                <>
                  <h3 className="font-display text-lg font-semibold">{selectedMemberMsg.memberName}</h3>
                  <p className="text-xs text-muted-foreground">{selectedMemberMsg.memberEmail || "—"}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {selectedMemberMsg.subject?.trim() || "No subject"} ·{" "}
                    {formatDate(selectedMemberMsg.created_at)}
                  </p>
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap">
                    {selectedMemberMsg.body}
                  </div>
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="member-reply-subject">Reply subject</Label>
                      <Input
                        id="member-reply-subject"
                        value={replySubject}
                        onChange={(e) => setReplySubject(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="member-reply-body">Reply</Label>
                      <Textarea
                        id="member-reply-body"
                        rows={5}
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder="Your reply…"
                      />
                    </div>
                    <Button
                      type="button"
                      disabled={replying || !replyBody.trim()}
                      className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                      onClick={() => void sendMemberReply()}
                    >
                      {replying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send reply in app
                    </Button>
                  </div>
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Select a message to read and reply.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="send" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <Label className="mb-1.5 block">Recipient</Label>
              <Input
                value={sendSearch}
                onChange={(e) => setSendSearch(e.target.value)}
                placeholder="Search by name or email…"
              />
              <ul className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border bg-background text-sm">
                <li>
                  <button
                    type="button"
                    onClick={() => setSendToId(ALL_MEMBERS_RECIPIENT)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left font-semibold hover:bg-muted/40",
                      sendToId === ALL_MEMBERS_RECIPIENT && "bg-[#e8efe3]/60",
                    )}
                  >
                    <span>{allMembersLabel}</span>
                    <Megaphone className="h-4 w-4 shrink-0 text-[#5f6b52]" aria-hidden />
                  </button>
                </li>
                {filteredMembers.length === 0 ? (
                  <li className="px-3 py-2 text-muted-foreground">No individual matches</li>
                ) : (
                  filteredMembers.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSendToId(m.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40",
                          sendToId === m.id && "bg-[#e8efe3]/60 font-semibold",
                        )}
                      >
                        <span className="truncate">{m.fullName}</span>
                        <span className="ml-2 truncate text-xs text-muted-foreground">
                          {m.email}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="grid gap-1.5">
                <Label htmlFor="msg-subject">Subject</Label>
                <Input
                  id="msg-subject"
                  value={sendSubject}
                  onChange={(e) => setSendSubject(e.target.value)}
                />
              </div>
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="msg-body">Message</Label>
                <Textarea
                  id="msg-body"
                  rows={8}
                  value={sendBody}
                  onChange={(e) => setSendBody(e.target.value)}
                />
              </div>
              <Button
                type="button"
                onClick={() => void sendDirect()}
                disabled={sending || !sendToId}
                className="mt-4 gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendToId === ALL_MEMBERS_RECIPIENT ? "Send to all members" : "Send message"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="announcements" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-display text-lg font-semibold">New announcement</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Sent to every active customer. Generates an in-app notification.
              </p>
              <div className="mt-4 grid gap-1.5">
                <Label htmlFor="ann-subject">Subject</Label>
                <Input
                  id="ann-subject"
                  value={annSubject}
                  onChange={(e) => setAnnSubject(e.target.value)}
                />
              </div>
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="ann-body">Body</Label>
                <Textarea
                  id="ann-body"
                  rows={8}
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                />
              </div>
              <Button
                type="button"
                onClick={() => void sendAnnouncement()}
                disabled={annSending}
                className="mt-4 gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
              >
                {annSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Megaphone className="h-4 w-4" />
                )}
                Broadcast to all members
              </Button>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-display text-lg font-semibold">Recent announcements</h3>
              {loading ? (
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : announcements.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No announcements sent yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {announcements.slice(0, 6).map((m) => (
                    <li key={m.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-semibold">{m.subject || "Announcement"}</p>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{m.body}</p>
                      <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatDate(m.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sent" className="mt-0">
          <div className="mb-4 max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={sentQuery}
                onChange={(e) => setSentQuery(e.target.value)}
                placeholder="Search sent…"
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card">
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : sentRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Send className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">No messages sent yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {sentRows.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-semibold">To: {m.toName}</span>
                          {m.subject && (
                            <span className="ml-2 text-muted-foreground">· {m.subject}</span>
                          )}
                          {m.message_type === "announcement" && (
                            <span className="ml-2 rounded-full bg-[#e8efe3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3d4f36]">
                              Announcement
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                          {m.body}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(m.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!loading && sent.length > 0 && (
            <PaginationFooter
              page={sentPage}
              pageCount={sentPageCount}
              total={sent.length}
              onPrev={() => setSentPage((p) => Math.max(1, p - 1))}
              onNext={() => setSentPage((p) => Math.min(sentPageCount, p + 1))}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PaginationFooter({
  page,
  pageCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        Page {page} of {pageCount} · {total} total
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= pageCount}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
