import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
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

type Status = {
  product_id: string | null;
  product_name: string | null;
  active_until: string | null;
  renew_due: boolean;
};

const DISMISS_KEY = "oneflow.cfReminderDismissed";

/** Home: from a day before a Continuous Flow pack ends, ask the member to renew in the app. */
export function ContinuousFlowReminder() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const u = await getUser();
      if (!u) return;
      const { data } = await supabase.rpc("continuous_flow_status");
      const row = (Array.isArray(data) ? data[0] : data) as Status | null;
      if (cancelled || !row?.renew_due || !row.product_id || !row.active_until) return;
      let dismissed: string | null = null;
      try {
        dismissed = window.sessionStorage.getItem(DISMISS_KEY);
      } catch {
        /* storage unavailable */
      }
      if (dismissed === row.active_until) return;
      setStatus(row);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.active_until || !status.product_id) return null;
  const ends = new Date(status.active_until);
  const ended = ends.getTime() < Date.now();
  const when = ends.toLocaleString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Johannesburg",
  });

  const later = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, status.active_until ?? "");
    } catch {
      /* storage unavailable */
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : later())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-[#4a6b3c]" aria-hidden />
            {ended ? "Renew today to keep your price" : "Your Continuous Flow ends soon"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {status.product_name ?? "Your pack"} {ended ? "ended" : "ends"} on {when}.{" "}
            {ended
              ? "Renew today to keep your Continuous Flow price. After a break of more than a day it pauses for 12 months."
              : "Renew now to keep your Continuous Flow price. Your new month starts when this one ends, so you won't lose any days."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={later}>
            Later
          </Button>
          <Button
            type="button"
            className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/pricing", search: { renew: status.product_id ?? undefined } as never });
            }}
          >
            Pay now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
