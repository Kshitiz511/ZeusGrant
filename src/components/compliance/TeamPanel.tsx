import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useContractTeam } from "@/hooks/useTaskDetail";
import { TEAM_ROLES } from "@/lib/compliance";

export function TeamPanel({
  contractId,
  userId,
  enabled,
}: {
  contractId: string;
  userId: string;
  enabled: boolean;
}) {
  const { team, invite, setRole, remove } = useContractTeam(contractId, userId);
  const [form, setForm] = useState({ name: "", email: "", role: "contributor" });

  if (!enabled) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Contract team management is available on Growth and above.
      </p>
    );
  }

  const submit = async () => {
    try {
      await invite(form.name.trim(), form.email.trim(), form.role);
      setForm({ name: "", email: "", role: "contributor" });
      toast.success("Team member added to this contract.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold text-foreground">Invite a team member</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            placeholder="Full name"
            className="max-w-[12rem]"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="Email"
            type="email"
            className="max-w-[16rem]"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEAM_ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!form.name.trim() || !form.email.trim()}
            onClick={() => void submit()}
          >
            <UserPlus className="mr-2 size-4" /> Add
          </Button>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {TEAM_ROLES.map((r) => (
            <li key={r.id}>
              <span className="font-semibold text-foreground">{r.label}</span> — {r.hint}
            </li>
          ))}
        </ul>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {team.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{m.member_name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.member_email}</p>
            </div>
            <Badge variant="secondary" className="capitalize">
              {m.member_role}
            </Badge>
            <Select value={m.member_role} onValueChange={(v) => void setRole(m.id, v)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_ROLES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => void remove(m.id)}>
              <Trash2 className="size-4 text-destructive" />
              <span className="sr-only">Remove {m.member_name}</span>
            </Button>
          </li>
        ))}
        {!team.length && (
          <li className="p-4 text-sm text-muted-foreground">
            No team members on this contract yet.
          </li>
        )}
      </ul>
    </div>
  );
}
