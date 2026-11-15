import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, GraduationCap, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export type Concession = {
  kind: "student" | "senior" | null;
  validUntil: string | null;
  percent: number | null;
  nextCheckOn: string | null;
};

const EMPTY: Concession = { kind: null, validUntil: null, percent: null, nextCheckOn: null };

/** The signed-in member's student / senior discount, if approved. */
export function useConcession(enabled: boolean) {
  const [c, setC] = useState<Concession>(EMPTY);
  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase.rpc("my_concession");
    if (error) return;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { kind: string | null; valid_until: string | null; discount_percent: number | null; next_check_on: string | null }
      | null;
    setC({
      kind: row?.kind === "student" || row?.kind === "senior" ? row.kind : null,
      validUntil: row?.valid_until ?? null,
      percent: row?.discount_percent ?? null,
      nextCheckOn: row?.next_check_on ?? null,
    });
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { concession: c, reload: load };
}

function niceDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

/** Shrinks a photo to at most 1600px and re-encodes it as JPEG; PDFs pass through. */
async function fileToPayload(file: File): Promise<{ data: string; type: string }> {
  if (file.type === "application/pdf") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), type: "application/pdf" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a photo we can open. Try a JPG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { data: dataUrl.split(",")[1] ?? "", type: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Quiet "Student or senior?" line at checkout; becomes a green note once approved. */
export function ConcessionPanel({
  concession,
  onChanged,
  promoInUse,
}: {
  concession: Concession;
  onChanged: () => void;
  promoInUse: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (concession.kind) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-[#c5d4b8]/70 bg-[#e8efe3]/50 p-3 text-sm">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4a6b3c]" aria-hidden />
        <p>
          <span className="font-semibold capitalize">{concession.kind} discount:</span> {concession.percent ?? 10}% off
          every pack until {concession.validUntil ? niceDate(concession.validUntil) : ""}.
          {promoInUse ? (
            <span className="block text-xs text-muted-foreground">
              Not used while a promo code is applied. Remove the code to use your discount.
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">Applied automatically at checkout.</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        <GraduationCap className="h-3.5 w-3.5" aria-hidden />
        Student or senior (65+)? Check if you qualify for a discount
      </button>
      <ConcessionDialog open={open} onClose={() => setOpen(false)} onDone={onChanged} nextCheckOn={concession.nextCheckOn} />
    </>
  );
}

function ConcessionDialog({
  open,
  onClose,
  onDone,
  nextCheckOn,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  nextCheckOn: string | null;
}) {
  const [kind, setKind] = useState<"student" | "senior">("student");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ result: string; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setConsent(false);
      setOutcome(null);
    }
  }, [open]);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const mustWait = nextCheckOn != null && nextCheckOn > today;

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    try {
      const payload = await fileToPayload(file);
      const { data, error } = await supabase.functions.invoke("verify-concession", {
        body: { kind, file_base64: payload.data, media_type: payload.type, consent },
      });
      const body = (data ?? {}) as { result?: string; message?: string; error?: string };
      let message = body.message ?? body.error ?? "";
      if (error && !message) {
        try {
          const ctx = (error as { context?: Response }).context;
          const j = ctx ? await ctx.json() : null;
          message = j?.message ?? j?.error ?? error.message;
        } catch {
          message = error.message;
        }
      }
      setOutcome({ result: body.result ?? (error ? "error" : "declined"), message: message || "Something went wrong." });
      if (body.result === "approved") onDone();
    } catch (e) {
      setOutcome({ result: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Student or senior discount</DialogTitle>
          <DialogDescription>
            10% off any pack for 6 months. Students: upload your student card or registration letter for this year.
            Seniors (65+): upload your ID.
          </DialogDescription>
        </DialogHeader>

        {mustWait && !outcome ? (
          <p className="rounded-lg bg-muted/50 p-3 text-sm">
            You've had a check in the last 6 months. You can try again from {niceDate(nextCheckOn!)}.
          </p>
        ) : outcome ? (
          <div
            className={cn(
              "rounded-lg p-3 text-sm",
              outcome.result === "approved" ? "bg-[#e8efe3] text-[#2f4a26]" : "bg-muted/60",
            )}
          >
            <p className="font-semibold">{outcome.message}</p>
            {outcome.result === "unreadable" ? (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setOutcome(null)}>
                Try another photo
              </Button>
            ) : (
              <Button type="button" size="sm" className="mt-3" onClick={onClose}>
                Done
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(["student", "senior"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md py-2 text-sm",
                    k === kind ? "border-2 border-[#a3b693] bg-[#a3b693]/15 font-semibold" : "border border-border",
                  )}
                >
                  {k === "student" ? "Student" : "Senior (65+)"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm">
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">
                {file ? file.name : kind === "student" ? "Photo of student card or registration letter" : "Photo of your ID"}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Make sure the whole document is in the photo, in focus, and your name matches your One Flow account.
              You get one check every 6 months; a photo we can't read doesn't count.
            </p>
            <label className="flex items-start gap-2 text-xs">
              <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
              <span>
                I agree to One Flow sending this document to its automated checking service (Anthropic) to confirm my
                discount. One Flow does not save the photo; only the result is kept.
              </span>
            </label>
            <Button type="button" className="w-full" disabled={!file || !consent || busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? "Checking…" : "Check my discount"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
