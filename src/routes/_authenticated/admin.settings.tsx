import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell, usePlatformRole } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  getPlatformSettings,
  updatePlatformSettings,
  type PlatformSettings,
} from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings | GrantMatch Admin" },
      {
        name: "description",
        content: "Feature flags, AI rate limits and the platform announcement banner.",
      },
      { property: "og:title", content: "Platform Settings | GrantMatch Admin" },
      { property: "og:description", content: "Internal platform configuration for staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { isAdmin } = usePlatformRole();
  const load = useServerFn(getPlatformSettings);
  const save = useServerFn(updatePlatformSettings);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  useEffect(() => {
    void load()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [load]);

  const persist = async (next: PlatformSettings) => {
    setSettings(next);
    try {
      await save({ data: next });
      toast.success("Settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    }
  };

  if (!settings) {
    return (
      <AdminShell title="Platform settings">
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Platform settings"
      description="Feature flags, AI rate limits and the announcement banner."
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Feature flags</h2>
          <ul className="mt-4 divide-y divide-border">
            {Object.entries(settings.feature_flags).map(([flag, on]) => (
              <li key={flag} className="flex items-center justify-between py-3 text-sm">
                <span className="font-semibold text-foreground">{flag.replace(/_/g, " ")}</span>
                <Switch
                  checked={on}
                  disabled={!isAdmin}
                  onCheckedChange={(v) =>
                    void persist({
                      ...settings,
                      feature_flags: { ...settings.feature_flags, [flag]: v },
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">AI rate limits (per hour, per org)</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(settings.rate_limits).map(([job, limit]) => (
              <label key={job} className="text-sm">
                <span className="text-muted-foreground">{job.replace(/_/g, " ")}</span>
                <Input
                  type="number"
                  min={0}
                  disabled={!isAdmin}
                  value={limit}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      rate_limits: { ...settings.rate_limits, [job]: Number(e.target.value) },
                    })
                  }
                  onBlur={() => void persist(settings)}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Announcement banner</h2>
          <p className="text-sm text-muted-foreground">
            Shown to every signed-in user. Leave empty to hide it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              className="max-w-xl"
              disabled={!isAdmin}
              value={settings.announcement_banner}
              onChange={(e) => setSettings({ ...settings, announcement_banner: e.target.value })}
              placeholder="Scheduled maintenance Saturday 2am–4am ET"
            />
            <Button variant="outline" disabled={!isAdmin} onClick={() => void persist(settings)}>
              Save banner
            </Button>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
