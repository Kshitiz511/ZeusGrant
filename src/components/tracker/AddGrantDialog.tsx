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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FUNDER_TYPES, STAGES } from "@/lib/tracker";
import type { NewGrantRecord } from "@/hooks/useGrantTracker";

export function AddGrantDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewGrantRecord) => Promise<void>;
}) {
  const [form, setForm] = useState({
    grant_name: "",
    funder: "",
    funder_type: "federal",
    stage: "identified",
    requested_amount: "",
    deadline: "",
    portal_url: "",
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.grant_name.trim() || !form.funder.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        grant_name: form.grant_name.trim(),
        funder: form.funder.trim(),
        funder_type: form.funder_type,
        stage: form.stage,
        requested_amount: form.requested_amount ? Number(form.requested_amount) : null,
        deadline: form.deadline || null,
        portal_url: form.portal_url || null,
      });
      onOpenChange(false);
      setForm({
        grant_name: "",
        funder: "",
        funder_type: "federal",
        stage: "identified",
        requested_amount: "",
        deadline: "",
        portal_url: "",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a grant to the tracker</DialogTitle>
          <DialogDescription>
            Track any opportunity — including ones you found outside GrantMatch.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="g-name">Grant name</Label>
            <Input id="g-name" value={form.grant_name} onChange={(e) => set("grant_name")(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-funder">Funder</Label>
            <Input id="g-funder" value={form.funder} onChange={(e) => set("funder")(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Funder type</Label>
              <Select value={form.funder_type} onValueChange={set("funder_type")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUNDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={set("stage")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-amount">Requested amount</Label>
              <Input
                id="g-amount"
                type="number"
                min="0"
                value={form.requested_amount}
                onChange={(e) => set("requested_amount")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-deadline">Deadline</Label>
              <Input
                id="g-deadline"
                type="date"
                value={form.deadline}
                onChange={(e) => set("deadline")(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-url">Grant portal link</Label>
            <Input
              id="g-url"
              placeholder="https://"
              value={form.portal_url}
              onChange={(e) => set("portal_url")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="hero" onClick={submit} disabled={busy || !form.grant_name || !form.funder}>
            Add to tracker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
