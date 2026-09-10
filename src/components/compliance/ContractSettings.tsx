import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { CONTRACT_TYPES, REMINDER_DAYS, REMINDER_SCHEDULE, type ComplianceContract } from "@/lib/compliance";

export function ContractSettings({
  contract,
  onSave,
}: {
  contract: ComplianceContract;
  onSave: (patch: Partial<ComplianceContract>) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    name: contract.name,
    funder: contract.funder,
    contract_number: contract.contract_number ?? "",
    contract_type: contract.contract_type,
    period_start: contract.period_start ?? "",
    period_end: contract.period_end ?? "",
    award_amount: contract.award_amount ?? "",
    owner_name: contract.owner_name ?? "",
    default_reminder_days: contract.default_reminder_days ?? [...REMINDER_DAYS],
  });
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: number) =>
    setDraft((d) => ({
      ...d,
      default_reminder_days: d.default_reminder_days.includes(day)
        ? d.default_reminder_days.filter((x) => x !== day)
        : [...d.default_reminder_days, day].sort((a, b) => b - a),
    }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name: draft.name,
        funder: draft.funder,
        contract_number: draft.contract_number || null,
        contract_type: draft.contract_type,
        period_start: draft.period_start || null,
        period_end: draft.period_end || null,
        award_amount: draft.award_amount === "" ? null : Number(draft.award_amount),
        owner_name: draft.owner_name || null,
        default_reminder_days: draft.default_reminder_days,
      });
      toast.success("Contract settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
        <Field label="Contract name">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Contracting party">
          <Input
            value={draft.funder}
            onChange={(e) => setDraft({ ...draft, funder: e.target.value })}
          />
        </Field>
        <Field label="Contract / award number">
          <Input
            value={draft.contract_number}
            onChange={(e) => setDraft({ ...draft, contract_number: e.target.value })}
          />
        </Field>
        <Field label="Contract type">
          <Select
            value={draft.contract_type}
            onValueChange={(v) => setDraft({ ...draft, contract_type: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTRACT_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Period start">
          <Input
            type="date"
            value={draft.period_start}
            onChange={(e) => setDraft({ ...draft, period_start: e.target.value })}
          />
        </Field>
        <Field label="Period end">
          <Input
            type="date"
            value={draft.period_end}
            onChange={(e) => setDraft({ ...draft, period_end: e.target.value })}
          />
        </Field>
        <Field label="Contract value">
          <Input
            type="number"
            value={String(draft.award_amount)}
            onChange={(e) => setDraft({ ...draft, award_amount: e.target.value })}
          />
        </Field>
        <Field label="Project owner">
          <Input
            value={draft.owner_name}
            onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })}
          />
        </Field>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold text-foreground">Default reminder schedule</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applies to every task on this contract unless a task overrides it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {REMINDER_DAYS.map((day) => (
            <label
              key={day}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={draft.default_reminder_days.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {day} days before
            </label>
          ))}
        </div>
        <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
          {REMINDER_SCHEDULE.map((r) => (
            <li key={r.days}>
              <span className="font-semibold text-foreground">
                {r.days === 0 ? "Day of" : `${r.days} days before`}
              </span>{" "}
              — {r.alert}
            </li>
          ))}
          <li>
            <span className="font-semibold text-foreground">Overdue</span> — daily reminder to the
            assignee, escalation to the owner after 3 days.
          </li>
        </ul>
      </div>

      <Button variant="hero" disabled={saving} onClick={() => void save()}>
        {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
        Save settings
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
