import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

type PaidWhere = "green_point" | "studio" | "none";

/** Upgrade a member's existing pack to Access to: Longkloof & Green Point, recording the payment. */
export function UpgradeAccessDialog({
  credit,
  onClose,
  onDone,
}: {
  credit: { id: string; title: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paidWhere, setPaidWhere] = useState<PaidWhere>("green_point");
  const [amount, setAmount] = useState("350");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (credit) {
      setPaidWhere("green_point");
      setAmount("350");
      setReference("");
    }
  }, [credit]);

  if (!credit) return null;

  const save = async () => {
    const zar = Number(amount.replace(",", "."));
    if (paidWhere !== "none" && !(zar > 0)) {
      toast.error("Enter the amount paid.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("upgrade_credit_access", {
      p_credit_id: credit.id,
      p_paid_where: paidWhere,
      p_amount_zar: paidWhere === "none" ? 0 : zar,
      p_reference: reference,
    });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not upgrade this pack"));
      return;
    }
    toast.success("Upgraded: Access to Longkloof & Green Point");
    onDone();
    onClose();
  };

  const options: [PaidWhere, string][] = [
    ["green_point", "Paid at De Waterkant"],
    ["studio", "Paid at Longkloof desk"],
    ["none", "No charge"],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Upgrade {credit.title}</DialogTitle>
          <DialogDescription>Adds Access to: Longkloof &amp; Green Point to this pack until it ends.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Payment</Label>
            <div className="grid grid-cols-3 gap-2">
              {options.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPaidWhere(v)}
                  className={
                    paidWhere === v
                      ? "rounded-md border-2 border-[#a3b693] bg-[#a3b693]/15 px-1 py-2 text-xs font-semibold"
                      : "rounded-md border border-border px-1 py-2 text-xs"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {paidWhere !== "none" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="upgrade-amount">Amount paid (R)</Label>
                <Input id="upgrade-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="upgrade-ref">Receipt / reference</Label>
                <Input
                  id="upgrade-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          ) : null}
          <Button type="button" className="w-full" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Upgrade pack
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
