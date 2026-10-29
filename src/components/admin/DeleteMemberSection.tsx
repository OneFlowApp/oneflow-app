import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

/**
 * "Delete member": removes their login and wipes contact details. Their name, payments and
 * booking history stay, listed under Deleted members on the Customers page.
 */
export function DeleteMemberSection({
  profileId,
  memberName,
  memberRole,
  onDeleted,
}: {
  profileId: string;
  memberName: string;
  memberRole: string | null;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const isStaff = (memberRole ?? "customer").toLowerCase() !== "customer";

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("archive_member", { p_profile_id: profileId });
    setBusy(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not delete this member"));
      return;
    }
    toast.success(`${memberName} deleted. Their records are under Deleted members.`);
    setOpen(false);
    onDeleted();
  };

  return (
    <section className="border-t border-border pt-6">
      <h4 className="mb-2 font-display text-lg font-semibold text-destructive">Delete member</h4>
      <p className="mb-3 text-sm text-muted-foreground">
        Removes their login and wipes their email, phone, date of birth and photo. Future bookings
        are cancelled. Their name, payments and past bookings are kept under Deleted members.
      </p>
      {isStaff ? (
        <p className="text-sm text-muted-foreground">
          This person has a staff role. Change their role to Customer before deleting them.
        </p>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={() => {
            setTyped("");
            setOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete member
        </Button>
      )}

      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {memberName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              They will no longer be able to sign in, and their contact details are wiped. This
              cannot be undone. Type <span className="font-semibold">DELETE</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || typed.trim() !== "DELETE"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
