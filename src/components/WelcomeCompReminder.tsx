import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getUser, supabase } from "@/lib/supabase";

const DISMISS_KEY = "oneflow.welcomeCompDismissed";

/** Home: while the free welcome class is unused, remind the member each time they open the app. */
export function WelcomeCompReminder() {
  const navigate = useNavigate();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (window.sessionStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        /* storage unavailable */
      }
      const u = await getUser();
      if (!u) return;
      const { data } = await supabase
        .from("user_credits")
        .select("expires_at")
        .eq("profile_id", u.id)
        .eq("yoco_payment_id", "welcome_comp")
        .gt("credits_remaining", 0)
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();
      const row = data as { expires_at?: string | null } | null;
      if (cancelled || !row?.expires_at) return;
      setExpiresAt(row.expires_at);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!expiresAt) return null;
  const until = new Date(expiresAt).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Johannesburg",
  });

  const close = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-[#4a6b3c]" aria-hidden />
            Your first class is on us
          </DialogTitle>
          <DialogDescription className="text-left">
            Welcome to One Flow. You have one free class waiting, valid until {until}. Pick any class on the schedule
            and book it with your free class.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close}>
            Later
          </Button>
          <Button
            type="button"
            className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            onClick={() => {
              close();
              void navigate({ to: "/schedule" });
            }}
          >
            Book my class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
