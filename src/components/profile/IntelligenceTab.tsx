import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROFILE_CATEGORIES, SOURCE_BADGE } from "@/lib/profile-intelligence";
import type { DataPoint } from "@/hooks/useProfileIntelligence";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-rose-100 text-rose-800",
};

export function IntelligenceTab({
  userId,
  dataPoints,
  onChange,
}: {
  userId: string;
  dataPoints: DataPoint[];
  onChange: () => Promise<void> | void;
}) {
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [newCategory, setNewCategory] = useState("identity");
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");

  const filtered = dataPoints.filter((d) => {
    if (source !== "all" && d.source_type !== source) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return d.field_name.toLowerCase().includes(q) || d.field_value.toLowerCase().includes(q);
  });

  async function addPoint() {
    if (!newField.trim() || !newValue.trim()) {
      toast.error("Add both a label and a value.");
      return;
    }
    const { error } = await supabase.from("org_profile_data_points").insert({
      user_id: userId,
      category: newCategory,
      field_name: newField.trim(),
      field_value: newValue.trim(),
      source_type: "manual",
      confidence: "high",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewField("");
    setNewValue("");
    await onChange();
  }

  async function updateValue(id: string, value: string) {
    await supabase
      .from("org_profile_data_points")
      .update({ field_value: value, source_type: "manual", confidence: "high" })
      .eq("id", id);
    await onChange();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a fact manually</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-56"
            placeholder="Label (e.g. EIN)"
            value={newField}
            onChange={(e) => setNewField(e.target.value)}
          />
          <Input
            className="min-w-64 flex-1"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button onClick={() => void addPoint()}>
            <Plus className="mr-2 size-4" /> Add
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search your profile intelligence"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {Object.entries(SOURCE_BADGE).map(([value, badge]) => (
              <SelectItem key={value} value={value}>
                {badge.icon} {badge.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} facts</span>
      </div>

      {PROFILE_CATEGORIES.map((category) => {
        const rows = filtered.filter((d) => d.category === category.value);
        if (!rows.length) return null;
        return (
          <Card key={category.value}>
            <CardHeader>
              <CardTitle className="text-base">
                {category.label}{" "}
                <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((d) => {
                const badge = SOURCE_BADGE[d.source_type] ?? SOURCE_BADGE["manual"]!;
                return (
                  <div key={d.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{d.field_name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[11px]">
                          {badge.icon} {badge.label}
                        </Badge>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            CONFIDENCE_STYLE[d.confidence] ?? CONFIDENCE_STYLE["medium"]
                          }`}
                        >
                          {d.confidence}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await supabase.from("org_profile_data_points").delete().eq("id", d.id);
                            await onChange();
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <Input
                      className="mt-2"
                      defaultValue={d.field_value}
                      onBlur={(e) => {
                        if (e.target.value !== d.field_value) void updateValue(d.id, e.target.value);
                      }}
                    />
                    {d.source_label && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Source: {d.source_label}
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — scan your website or upload documents to build your profile intelligence.
        </p>
      )}
    </div>
  );
}
