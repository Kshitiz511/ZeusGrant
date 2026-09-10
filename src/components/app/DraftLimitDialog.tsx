import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddOnStore } from "@/components/app/AddOnStore";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** End of the current billing cycle (YYYY-MM-DD). */
  cycleEnd: string;
  onPurchaseStarted?: () => void;
};

/** Shown when the plan + add-on draft allowance for the cycle is exhausted. */
export function DraftLimitDialog({ open, onOpenChange, cycleEnd, onPurchaseStarted }: Props) {
  const resets = new Date(`${cycleEnd}T00:00:00Z`).toLocaleDateString();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>You've used all your proposal drafts for this billing cycle</DialogTitle>
          <DialogDescription>
            Your next drafts become available on {resets}. Existing drafts stay editable — you can
            keep working on, exporting and reviewing anything you have already started.
          </DialogDescription>
        </DialogHeader>
        <AddOnStore draftsOnly {...(onPurchaseStarted ? { onPurchaseStarted } : {})} />
        <div className="pt-2">
          <Button variant="outline" asChild>
            <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>Upgrade your plan instead</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
