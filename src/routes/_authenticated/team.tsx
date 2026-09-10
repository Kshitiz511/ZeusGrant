import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { ORG_TEAM_ROLES, useOrgTeam } from "@/hooks/useOrgTeam";
import { useClientWorkspaces } from "@/hooks/useClientWorkspaces";
import { formatLimit } from "@/lib/entitlements";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team & Clients | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content: "Manage organization seats, roles and client workspaces included with your plan.",
      },
      { property: "og:title", content: "Team & Clients | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Invite teammates, assign roles and run separate client workspaces.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { user } = useAuth();
  const ent = useEntitlements(user?.id);
  const team = useOrgTeam(user?.id);
  const clients = useClientWorkspaces(user?.id);

  const [invite, setInvite] = useState({ name: "", email: "", role: "contributor" });
  const [client, setClient] = useState({ client_name: "", org_type: "", mission: "" });

  // The owner occupies one seat.
  const seatsUsed = team.members.length + 1;
  const seatCap = ent.limits.team_seats;
  const seatsLeft = seatCap === null ? null : Math.max(0, seatCap - seatsUsed);
  const workspaceCap = ent.limits.client_workspaces ?? 1;
  const workspacesEnabled = workspaceCap > 1;

  const submitInvite = async () => {
    if (seatsLeft !== null && seatsLeft <= 0) {
      toast.error("All seats on your plan are in use. Upgrade to add more teammates.");
      return;
    }
    try {
      await team.invite(invite.name.trim(), invite.email.trim(), invite.role);
      setInvite({ name: "", email: "", role: "contributor" });
      toast.success("Teammate invited.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not invite teammate");
    }
  };

  const submitClient = async () => {
    if (clients.workspaces.length >= workspaceCap) {
      toast.error(`Your plan includes ${workspaceCap} client workspaces.`);
      return;
    }
    try {
      await clients.create({
        client_name: client.client_name.trim(),
        org_type: client.org_type || null,
        mission: client.mission || null,
      });
      setClient({ client_name: "", org_type: "", mission: "" });
      toast.success("Client workspace created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create workspace");
    }
  };

  return (
    <AppShell
      title="Team & clients"
      description="Seats, roles and client workspaces included with your plan."
    >
      <SubscriptionGate loading={ent.loading} hasAccess={ent.hasAccess} feature="Team management">
        <div className="space-y-8">
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Organization team</h2>
                <p className="text-sm text-muted-foreground">
                  {seatsUsed} of {formatLimit(seatCap)} seats in use.
                </p>
              </div>
              <Badge variant="secondary">{ent.limits.plan_id} plan</Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Input
                placeholder="Full name"
                className="max-w-[12rem]"
                value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              />
              <Input
                placeholder="Work email"
                type="email"
                className="max-w-[16rem]"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              />
              <Select value={invite.role} onValueChange={(v) => setInvite({ ...invite, role: v })}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_TEAM_ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!invite.name.trim() || !invite.email.trim()}
                onClick={() => void submitInvite()}
              >
                <UserPlus className="mr-2 size-4" /> Invite
              </Button>
            </div>

            <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
              {team.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{m.member_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.member_email}</p>
                  </div>
                  <Badge variant={m.status === "active" ? "default" : "secondary"} className="capitalize">
                    {m.status}
                  </Badge>
                  <Select value={m.member_role} onValueChange={(v) => void team.setRole(m.id, v)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_TEAM_ROLES.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.status !== "active" && (
                    <Button size="sm" variant="ghost" onClick={() => void team.setStatus(m.id, "active")}>
                      Mark active
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void team.remove(m.id)}>
                    <Trash2 className="size-4 text-destructive" />
                    <span className="sr-only">Remove {m.member_name}</span>
                  </Button>
                </li>
              ))}
              {!team.members.length && (
                <li className="p-4 text-sm text-muted-foreground">
                  You are the only person in this workspace.
                </li>
              )}
            </ul>

            <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
              {ORG_TEAM_ROLES.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold text-foreground">{r.label}</span> — {r.hint}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground">Client workspaces</h2>
            <p className="text-sm text-muted-foreground">
              {workspacesEnabled
                ? `${clients.workspaces.length} of ${workspaceCap} client workspaces used.`
                : "Client workspaces are part of the Consultant / Agency plan."}
            </p>

            {workspacesEnabled && (
              <>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Client name"
                    value={client.client_name}
                    onChange={(e) => setClient({ ...client, client_name: e.target.value })}
                  />
                  <Input
                    placeholder="Organization type (e.g. Nonprofit)"
                    value={client.org_type}
                    onChange={(e) => setClient({ ...client, org_type: e.target.value })}
                  />
                  <Textarea
                    placeholder="Mission / funding focus"
                    className="sm:col-span-2"
                    value={client.mission}
                    onChange={(e) => setClient({ ...client, mission: e.target.value })}
                  />
                </div>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={!client.client_name.trim()}
                  onClick={() => void submitClient()}
                >
                  <Building2 className="mr-2 size-4" /> Add client workspace
                </Button>

                <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {clients.workspaces.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{w.client_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {w.org_type ?? "Client"} · {w.mission ?? "No mission on file"}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void clients.remove(w.id)}>
                        <Trash2 className="size-4 text-destructive" />
                        <span className="sr-only">Remove {w.client_name}</span>
                      </Button>
                    </li>
                  ))}
                  {!clients.workspaces.length && (
                    <li className="p-4 text-sm text-muted-foreground">No client workspaces yet.</li>
                  )}
                </ul>
              </>
            )}
          </section>
        </div>
      </SubscriptionGate>
    </AppShell>
  );
}
