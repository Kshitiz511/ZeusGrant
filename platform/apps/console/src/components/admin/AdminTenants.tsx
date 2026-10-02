import { useState } from "react";
import { Empty, Failed, Loading, Panel, Pill, when } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminTenant, useAdminTenants, useSetTenantStatus } from "@/lib/admin-hooks";
import type { AdminTenant } from "@/lib/admin-api";

export function AdminTenants() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useAdminTenants({ search: search || undefined, status: status || undefined });

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Panel
        title={q.data ? `${q.data.total} tenant${q.data.total === 1 ? "" : "s"}` : "Tenants"}
        action={
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or slug"
              className="h-8 w-48"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        }
      >
        {q.isLoading ? (
          <Loading label="Loading tenants" />
        ) : q.isError ? (
          <Failed error={q.error} />
        ) : q.data!.tenants.length === 0 ? (
          <Empty>No tenants match that filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-semibold">Workspace</th>
                  <th className="px-5 py-2 font-semibold">Status</th>
                  <th className="px-5 py-2 font-semibold">Billing</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.tenants.map((t: AdminTenant) => (
                  <tr
                    key={t.id}
                    onClick={() => setOpen(t.id)}
                    className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.slug}</p>
                    </td>
                    <td className="px-5 py-2.5">
                      <Pill tone={t.status === "active" ? "ok" : t.status === "suspended" ? "bad" : "mute"}>
                        {t.status}
                      </Pill>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">
                      {t.stripe_customer_id ? "Stripe linked" : "No Stripe customer"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <TenantDetailPane tenantId={open} />
    </div>
  );
}

function TenantDetailPane({ tenantId }: { tenantId: string | null }) {
  const q = useAdminTenant(tenantId);
  const mutate = useSetTenantStatus();
  const [reason, setReason] = useState("");

  if (!tenantId) {
    return (
      <Panel title="Detail">
        <Empty>Select a tenant to see members, subscriptions and limit overrides.</Empty>
      </Panel>
    );
  }
  if (q.isLoading) return <Panel title="Detail"><Loading label="Loading tenant" /></Panel>;
  if (q.isError) return <Panel title="Detail"><Failed error={q.error} /></Panel>;

  const d = q.data!;
  const suspended = d.tenant.status === "suspended";
  const nextStatus = suspended ? "active" : "suspended";

  return (
    <Panel title={d.tenant.name}>
      <div className="space-y-5 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Members
          </p>
          <p className="mt-1 text-sm text-foreground">{d.members.length}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Subscriptions
          </p>
          {d.subscriptions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {d.subscriptions.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">{String(s.module_id)}</span>
                  <span className="text-xs text-muted-foreground">
                    {String(s.plan_id)} · {String(s.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Limit overrides
          </p>
          {d.limit_overrides.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              None. This tenant gets exactly what its plans grant.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {d.limit_overrides.map((o) => (
                <li key={o.limit_key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">{o.limit_key}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {o.limit_value === null ? "Unlimited" : o.limit_value}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Suspension is destructive and the consequence is spelled out, not
            implied by the button label. A reason is mandatory because it is
            what the audit row carries, and an audit trail of unexplained
            suspensions is not much better than no trail at all. */}
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">
            {suspended ? "Restore access" : "Suspend this workspace"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {suspended
              ? "Members will be able to sign in again immediately."
              : "Every member is signed out and blocked from signing in. Background jobs keep their data; nothing is deleted."}
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (recorded in the audit trail)"
            className="mt-2 h-8"
          />
          <Button
            size="sm"
            variant={suspended ? "default" : "destructive"}
            className="mt-2"
            disabled={reason.trim().length === 0 || mutate.isPending}
            onClick={() =>
              mutate.mutate(
                { id: d.tenant.id, status: nextStatus, reason: reason.trim() },
                { onSuccess: () => setReason("") },
              )
            }
          >
            {mutate.isPending ? "Working…" : suspended ? "Restore access" : "Suspend workspace"}
          </Button>
          {mutate.isError && (
            <p className="mt-2 text-xs text-destructive">
              {(mutate.error as Error).message}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">Created {when(d.tenant.created_at)}</p>
      </div>
    </Panel>
  );
}
