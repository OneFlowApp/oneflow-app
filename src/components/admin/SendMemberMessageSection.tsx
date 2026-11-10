import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getUser } from "@/lib/supabase";
import { sendInAppMessagesToMembers } from "@/lib/studioMemberMessages";

/** Customer profile: send this member an in-app message (Messages inbox + bell on Home). */
export function SendMemberMessageSection({ profileId, memberName }: { profileId: string; memberName: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!body.trim()) {
      toast.error("Write a message first");
      return;
    }
    setBusy(true);
    try {
      const me = await getUser();
      const { sent } = await sendInAppMessagesToMembers({
        fromProfileId: me?.id ?? null,
        profileIds: [profileId],
        subject: subject.trim() || null,
        body,
        messageType: "direct",
      });
      if (sent > 0) {
        toast.success(`Message sent to ${memberName}`);
        setSubject("");
        setBody("");
      } else {
        toast.error("The message could not be sent");
      }
    } catch (e) {
      console.error("send member message", e);
      toast.error("The message could not be sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-1 font-display text-lg font-semibold">Send a message</h4>
      <p className="mb-3 text-sm text-muted-foreground">
        Arrives in {memberName}&apos;s Messages in the app, and lights up the bell on their Home
        screen.
      </p>
      <div className="grid gap-2">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your message"
          rows={4}
        />
        <Button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => void send()}
          className="gap-2 justify-self-start bg-[#a3b693] text-white hover:bg-[#8fa67d]"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send message
        </Button>
      </div>
    </section>
  );
}
