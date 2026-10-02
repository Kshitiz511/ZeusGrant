import { useState } from "react";
import { Empty, Failed, Loading, Panel, Pill } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminSettings, usePutSetting } from "@/lib/admin-hooks";
import type { AdminSetting } from "@/lib/admin-api";

export function AdminConfig() {
  const q = useAdminSettings();
  const put = usePutSetting();
  const [edits, setEdits] = useState<Record<string, string>>({});

  if (q.isLoading) return <Panel title="Settings"><Loading label="Loading settings" /></Panel>;
  if (q.isError) return <Panel title="Settings"><Failed error={q.error} /></Panel>;

  const settings = q.data!.settings;
  if (settings.length === 0) return <Panel title="Settings"><Empty>No managed settings.</Empty></Panel>;

  const groups = settings.reduce<Record<string, AdminSetting[]>>((acc, s) => {
    (acc[s.group] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Settings changed here take effect without a redeploy. Secrets are never returned in full —
        the value column shows a preview only, and saving replaces rather than appends.
      </p>

      {Object.entries(groups).map(([group, rows]) => (
        <Panel key={group} title={group}>
          <div className="divide-y divide-border/50">
            {rows.map((s) => {
              const dirty = edits[s.key] !== undefined;
              return (
                <div key={s.key} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Provenance matters more than the value: a setting
                          coming from the environment cannot be changed here,
                          and an operator who edits it anyway would see their
                          change appear to save and then do nothing. */}
                      <Pill tone={s.source === "database" ? "ok" : "mute"}>{s.source}</Pill>
                      {s.is_secret && <Pill tone="warn">secret</Pill>}
                    </div>
                  </div>

                  {s.help && <p className="mt-1 text-xs text-muted-foreground">{s.help}</p>}
                  {(s.minimum !== null || s.maximum !== null) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Accepted range: {s.minimum ?? "—"} to {s.maximum ?? "—"}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={dirty ? edits[s.key] : s.value ?? ""}
                      onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
                      placeholder={s.is_secret ? "Enter a new value to replace" : "Not set"}
                      className="h-8 w-72"
                    />
                    <Button
                      size="sm"
                      disabled={!dirty || put.isPending}
                      onClick={() =>
                        put.mutate(
                          { key: s.key, value: edits[s.key] },
                          {
                            onSuccess: () => {
                              const next = { ...edits };
                              delete next[s.key];
                              setEdits(next);
                            },
                          },
                        )
                      }
                    >
                      Save
                    </Button>
                    {dirty && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const next = { ...edits };
                          delete next[s.key];
                          setEdits(next);
                        }}
                      >
                        Discard
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}

      {put.isError && <p className="text-sm text-destructive">{(put.error as Error).message}</p>}
    </div>
  );
}
