import { useRef, useState } from "react";
import { Loader2, Trash2, Upload, UserRound, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { extractResume, extractCapabilityStatement } from "@/utils/profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { extractText } from "@/lib/compliance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { openProfileFile, uploadProfileFile } from "@/hooks/useProfileIntelligence";
import type { PersonProfile, SourceDocument, OrgProfile } from "@/hooks/useProfileIntelligence";

const MAX_BYTES = 10 * 1024 * 1024;

export function TeamResumesTab({
  userId,
  people,
  documents,
  org,
  onChange,
}: {
  userId: string;
  people: PersonProfile[];
  documents: SourceDocument[];
  org: OrgProfile | null;
  onChange: () => Promise<void> | void;
}) {
  const runResume = useServerFn(extractResume);
  const runCapability = useServerFn(extractCapabilityStatement);
  const [busy, setBusy] = useState<string | null>(null);
  const staffRef = useRef<HTMLInputElement>(null);
  const partnerRef = useRef<HTMLInputElement>(null);
  const capRef = useRef<HTMLInputElement>(null);

  async function handleResumes(files: FileList | null, personType: "staff" | "teaming_partner") {
    if (!files?.length) return;
    setBusy("resumes");
    let done = 0;
    for (const file of Array.from(files).slice(0, 50)) {
      try {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 10MB.`);
        const text = await extractText(file);
        const path = await uploadProfileFile(userId, file, "resumes");
        const { data: doc, error: docError } = await supabase
          .from("profile_source_documents")
          .insert({
            user_id: userId,
            document_type: personType === "staff" ? "resume_staff" : "resume_teaming",
            file_name: file.name,
            file_path: path,
            file_size: file.size,
            extraction_status: "pending",
          })
          .select("id")
          .single();
        if (docError) throw new Error(docError.message);

        const person = await runResume({ data: { text, fileName: file.name } });
        const { error } = await supabase.from("person_profiles").insert({
          user_id: userId,
          source_document_id: doc.id,
          person_type: personType,
          teaming_org_name: personType === "teaming_partner" ? person.teaming_org_name : null,
          full_name: person.full_name,
          title: person.title,
          role_on_proposals: person.role_on_proposals,
          education: person.education as never,
          certifications: person.certifications,
          years_of_experience: person.years_of_experience,
          areas_of_expertise: person.areas_of_expertise,
          relevant_skills: person.relevant_skills,
          languages: person.languages,
          selected_projects: person.selected_projects as never,
          publications: person.publications,
          awards: person.awards,
          ai_generated_bio_short: person.bio_short,
          ai_generated_bio_long: person.bio_long,
          confidence: person.confidence,
        });
        if (error) throw new Error(error.message);
        await supabase
          .from("profile_source_documents")
          .update({
            extraction_status: "complete",
            extraction_completed_at: new Date().toISOString(),
            extracted_count: 1,
          })
          .eq("id", doc.id);
        done += 1;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
    setBusy(null);
    if (done) toast.success(`Added ${done} ${done === 1 ? "person" : "people"} to your team.`);
    await onChange();
  }

  async function handleCapability(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("capability");
    try {
      if (file.size > MAX_BYTES) throw new Error("That file is larger than 10MB.");
      const text = await extractText(file);
      const path = await uploadProfileFile(userId, file, "capability");
      const { data: doc, error: docError } = await supabase
        .from("profile_source_documents")
        .insert({
          user_id: userId,
          document_type: "capability_statement",
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          extraction_status: "pending",
        })
        .select("id")
        .single();
      if (docError) throw new Error(docError.message);

      const cap = await runCapability({ data: { text, fileName: file.name } });
      await supabase
        .from("org_profiles")
        .update({
          uei: cap.uei ?? org?.uei ?? null,
          sam_registered: cap.sam_registered ?? org?.sam_registered ?? null,
          naics_codes: cap.naics_codes,
          certifications: cap.certifications,
          contract_vehicles: cap.contract_vehicles,
          core_competencies: cap.core_competencies,
          differentiators: cap.differentiators,
          capability_summary: cap.past_performance_summary,
        })
        .eq("user_id", userId);

      const points = [
        ...(cap.uei ? [["identity", "UEI", cap.uei]] : []),
        ...(cap.duns ? [["identity", "DUNS", cap.duns]] : []),
        ...(cap.cage ? [["identity", "CAGE code", cap.cage]] : []),
        ...(cap.sam_registered !== null
          ? [["certifications", "SAM.gov registered", cap.sam_registered ? "Yes" : "No"]]
          : []),
        ...(cap.naics_codes.length ? [["certifications", "NAICS codes", cap.naics_codes.join(", ")]] : []),
        ...(cap.psc_codes.length ? [["certifications", "PSC codes", cap.psc_codes.join(", ")]] : []),
        ...(cap.certifications.length
          ? [["certifications", "Socioeconomic certifications", cap.certifications.join(", ")]]
          : []),
        ...(cap.contract_vehicles.length
          ? [["certifications", "Contract vehicles", cap.contract_vehicles.join(", ")]]
          : []),
        ...(cap.core_competencies.length
          ? [["capacity", "Core competencies", cap.core_competencies.join(", ")]]
          : []),
        ...(cap.differentiators.length
          ? [["capacity", "Differentiators", cap.differentiators.join(", ")]]
          : []),
        ...(cap.past_performance_summary
          ? [["past_performance", "Past performance summary", cap.past_performance_summary]]
          : []),
      ] as [string, string, string][];

      if (points.length) {
        await supabase.from("org_profile_data_points").insert(
          points.map(([category, field_name, field_value]) => ({
            user_id: userId,
            category,
            field_name,
            field_value,
            source_type: "capability_statement",
            source_document_id: doc.id,
            source_label: file.name,
            confidence: "high",
          })),
        );
      }

      await supabase
        .from("profile_source_documents")
        .update({
          extraction_status: "complete",
          extraction_completed_at: new Date().toISOString(),
          extracted_count: points.length,
        })
        .eq("id", doc.id);

      toast.success(`Capability statement read — ${points.length} facts saved.`);
      await onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function removePerson(person: PersonProfile) {
    await supabase.from("person_profiles").delete().eq("id", person.id);
    toast.success(`Removed ${person.full_name}.`);
    await onChange();
  }

  const staff = people.filter((p) => p.person_type === "staff");
  const partners = people.filter((p) => p.person_type !== "staff");
  const partnerGroups = [...new Set(partners.map((p) => p.teaming_org_name ?? "Teaming partner"))];
  const capabilityDoc = documents.find((d) => d.document_type === "capability_statement");

  function Person({ person }: { person: PersonProfile }) {
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{person.full_name}</p>
            <p className="text-sm text-muted-foreground">{person.title ?? "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {person.confidence ?? "medium"} confidence
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => void removePerson(person)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        {person.areas_of_expertise.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {person.areas_of_expertise.slice(0, 8).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[11px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Used in {person.times_included_in_proposals} proposals
          {person.years_of_experience ? ` · ${person.years_of_experience} years experience` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload resumes and capability statement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <UserRound className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm font-semibold">Staff resumes / CVs</p>
            <p className="text-xs text-muted-foreground">PDF, DOCX, TXT · up to 10MB each</p>
            <Input
              ref={staffRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => void handleResumes(e.target.files, "staff")}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy !== null}
              onClick={() => staffRef.current?.click()}
            >
              {busy === "resumes" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Upload
            </Button>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <UserRound className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm font-semibold">Teaming partner resumes</p>
            <p className="text-xs text-muted-foreground">Partner and subcontractor personnel</p>
            <Input
              ref={partnerRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => void handleResumes(e.target.files, "teaming_partner")}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy !== null}
              onClick={() => partnerRef.current?.click()}
            >
              <Upload className="mr-2 size-4" /> Upload
            </Button>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <FileDown className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm font-semibold">Capability statement</p>
            <p className="text-xs text-muted-foreground">High-authority source for your profile</p>
            <Input
              ref={capRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => void handleCapability(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy !== null}
              onClick={() => capRef.current?.click()}
            >
              {busy === "capability" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Upload
            </Button>
            {capabilityDoc && (
              <button
                type="button"
                className="mt-2 block w-full truncate text-xs text-primary hover:underline"
                onClick={() =>
                  capabilityDoc.file_path && void openProfileFile(capabilityDoc.file_path)
                }
              >
                {capabilityDoc.file_name}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {(org?.naics_codes?.length ||
        org?.certifications?.length ||
        org?.contract_vehicles?.length ||
        org?.core_competencies?.length) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capability profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            {org?.uei && <p><span className="font-semibold">UEI:</span> {org.uei}</p>}
            {org?.sam_registered !== null && org?.sam_registered !== undefined && (
              <p><span className="font-semibold">SAM.gov:</span> {org.sam_registered ? "Registered" : "Not registered"}</p>
            )}
            {org?.naics_codes?.length ? <p><span className="font-semibold">NAICS:</span> {org.naics_codes.join(", ")}</p> : null}
            {org?.certifications?.length ? <p><span className="font-semibold">Certifications:</span> {org.certifications.join(", ")}</p> : null}
            {org?.contract_vehicles?.length ? <p><span className="font-semibold">Contract vehicles:</span> {org.contract_vehicles.join(", ")}</p> : null}
            {org?.core_competencies?.length ? <p className="md:col-span-2"><span className="font-semibold">Core competencies:</span> {org.core_competencies.join(", ")}</p> : null}
            {org?.differentiators?.length ? <p className="md:col-span-2"><span className="font-semibold">Differentiators:</span> {org.differentiators.join(", ")}</p> : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {staff.length === 0 && (
            <p className="text-sm text-muted-foreground">No staff resumes uploaded yet.</p>
          )}
          {staff.map((p) => (
            <Person key={p.id} person={p} />
          ))}
        </CardContent>
      </Card>

      {partners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Teaming partners ({partners.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {partnerGroups.map((group) => (
              <div key={group}>
                <p className="mb-2 text-sm font-bold text-foreground">{group}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {partners
                    .filter((p) => (p.teaming_org_name ?? "Teaming partner") === group)
                    .map((p) => (
                      <Person key={p.id} person={p} />
                    ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
