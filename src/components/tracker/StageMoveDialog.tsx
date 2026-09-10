import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STAGE_LABEL, type GrantRecord } from "@/lib/tracker";

/**
 * Confirmation prompt shown when a card moves to Submitted or Awarded — those
 * stages need a date and an amount for the awards analytics to be meaningful.
 */
export function StageMoveDialog({
  record,
  toStage,
  onCancel,
  onConfirm,
}: {
  record: GrantRecord | null;
  toStage: string | null;
  onCancel: () => void;
  onConfirm: (patch: Partial<GrantRecord>) => Promise<void> | void;
}) {
  const isAward = toStage === "awarded";
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const open = Boolean(record && toStage);

  const submit = async () => {
    setBusy(true);
    try {
      const value = amount ? Number(amount) : null;
      await onConfirm(
        isAward
          ? { decision_date_actual: date, awarded_amount: value }
          : { submission_date: date, submitted_amount: value ?? record?.requested_amount ?? null },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to {toStage ? STAGE_LABEL[toStage] : ""}</DialogTitle>
          <DialogDescription>
            {isAward
              ? "Confirm the award date and the amount you actually received — it may differ from the amount requested."
              : "Confirm the submission date and the amount you submitted for."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="stage-date">{isAward ? "Award date" : "Submission date"}</Label>
            <Input id="stage-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="stage-amount">{isAward ? "Award amount received" : "Submitted amount"}</Label>
            <Input
              id="stage-amount"
              type="number"
              min="0"
              placeholder={record?.requested_amount ? String(record.requested_amount) : "0"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="hero" onClick={submit} disabled={busy}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
