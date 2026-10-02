import { useState } from "react";
import { Empty, Failed, Loading, Panel, Pill, when } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminModels, useSetModelPrice } from "@/lib/admin-hooks";

export function AdminModels() {
  const q = useAdminModels();
  const setPrice = useSetModelPrice();
  const [draft, setDraft] = useState<{ model: string; input: string; output: string } | null>(null);

  if (q.isLoading) return <Panel title="Models"><Loading label="Loading model prices" /></Panel>;
  if (q.isError) return <Panel title="Models"><Failed error={q.error} /></Panel>;

  const { models, unpriced_models: unpriced } = q.data!;

  const save = () => {
    if (!draft) return;
    setPrice.mutate(
      { model: draft.model, input: draft.input, output: draft.output },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <div className="space-y-5">
      {/* The unpriced list is the point of this screen. A model with no price
          records NULL cost on every call, so its spend never appears in any
          rollup -- which is exactly how a runaway bill stays hidden. */}
      {unpriced.length > 0 && (
        <Panel title="Running with no price">
          <div className="space-y-2 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              These models are being called but have no price configured. Every call records a NULL
              cost, so their spend is invisible in all reporting until a price is set.
            </p>
            <div className="flex flex-wrap gap-2">
              {unpriced.map((m) => (
                <button
                  key={m}
                  onClick={() => setDraft({ model: m, input: "", output: "" })}
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-xs font-medium text-destructive"
                >
                  {m} — set price
                </button>
              ))}
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title="Configured prices"
        action={
          <Button size="sm" variant="outline" onClick={() => setDraft({ model: "", input: "", output: "" })}>
            Add model
          </Button>
        }
      >
        {models.length === 0 ? (
          <Empty>No model prices configured.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-semibold">Model</th>
                  <th className="px-5 py-2 text-right font-semibold">Input / 1M</th>
                  <th className="px-5 py-2 text-right font-semibold">Output / 1M</th>
                  <th className="px-5 py-2 font-semibold">Updated</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-foreground">{m.model}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                      ${String(m.input_per_million_usd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                      ${String(m.output_per_million_usd)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">
                      {when(m.updated_at)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            model: m.model,
                            input: String(m.input_per_million_usd),
                            output: String(m.output_per_million_usd),
                          })
                        }
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {draft && (
        <Panel title={draft.model ? `Price: ${draft.model}` : "New model price"}>
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            {!draft.model && (
              <label className="text-xs text-muted-foreground">
                Model id
                <Input
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="gpt-4o-mini"
                  className="mt-1 h-8 w-56"
                />
              </label>
            )}
            <label className="text-xs text-muted-foreground">
              Input USD per 1M tokens
              <Input
                value={draft.input}
                onChange={(e) => setDraft({ ...draft, input: e.target.value })}
                placeholder="0.1500"
                className="mt-1 h-8 w-40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Output USD per 1M tokens
              <Input
                value={draft.output}
                onChange={(e) => setDraft({ ...draft, output: e.target.value })}
                placeholder="0.6000"
                className="mt-1 h-8 w-40"
              />
            </label>
            <Button
              size="sm"
              onClick={save}
              disabled={!draft.model || !draft.input || !draft.output || setPrice.isPending}
            >
              {setPrice.isPending ? "Saving…" : "Save price"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
          {setPrice.isError && (
            <p className="px-5 pb-4 text-xs text-destructive">
              {(setPrice.error as Error).message}
            </p>
          )}
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            Changing a price does not restate history. Calls already recorded keep the cost they
            were charged at, so a correction fixes future spend rather than rewriting past reports.
          </p>
        </Panel>
      )}

      {unpriced.length === 0 && models.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <Pill tone="ok">All priced</Pill> Every model in use has a price, so cost reporting is
          complete.
        </p>
      )}
    </div>
  );
}
