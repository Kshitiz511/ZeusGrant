import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  ComplianceResults,
  DraftSection,
  EligibilityItem,
  InterviewSection,
} from "@/lib/proposals";

const MODEL = "google/gemini-2.5-flash";
const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

type AnyRecord = Record<string, unknown>;

async function ai(system: string, user: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured for this project.");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit reached. Please try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in your workspace.");
  if (!res.ok) throw new Error(`AI request failed (${res.status}).`);

  const json = (await res.json()) as AnyRecord;
  const choices = json["choices"] as { message?: { content?: string } }[] | undefined;
  return choices?.[0]?.message?.content ?? "";
}

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return fallback;
  const candidate = cleaned.slice(start);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // try trimming to last closing bracket
    const last = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
    if (last > 0) {
      try {
        return JSON.parse(candidate.slice(0, last + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function summarize(value: unknown, max = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Reads the opportunity + org profile and produces (a) a hard-eligibility
 * checklist and (b) a grant-specific interview outline.
 */
export const buildProposalPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { opportunity: AnyRecord; org: AnyRecord | null; matchScore: number }) => data)
  .handler(async ({ data }) => {
    const raw = await ai(
      "You are a senior U.S. grant writer and compliance analyst. You reply with strict JSON only — no prose, no code fences.",
      `Grant opportunity (JSON):
${summarize(data.opportunity)}

Applicant organization profile (JSON, may be incomplete):
${summarize(data.org)}

Computed match score: ${data.matchScore}/100.

Task:
1. Build an eligibility checklist of every hard requirement implied by this opportunity (applicant type, geography, deadline, match/cost share, award range, registrations such as SAM.gov/UEI or 501(c)(3) status, populations served). Compare each against the profile. state must be "confirmed" (profile clearly satisfies it), "verify" (we must ask the user) or "issue" (profile suggests a gap).
2. Build the proposal interview: the sections this specific funder would require, in the order they must appear, each with targeted questions. Cover Organization & Background, Problem Statement, Project Description, Goals and Outcomes, Budget, Sustainability and Evaluation, plus any extra sections this grant type demands (e.g. logic model, partnership letters, technical approach for SBIR). 3-6 questions per section, asked in plain language, one idea per question. Set required=false only for genuinely optional items. "why" explains which part of the solicitation the answer serves. "prefill" is a suggested answer drawn ONLY from the profile JSON — omit when nothing applies; never invent facts.

Return JSON exactly:
{"eligibility":[{"label":string,"state":"confirmed"|"verify"|"issue","detail":string}],
 "sections":[{"id":string,"title":string,"purpose":string,"questions":[{"id":string,"prompt":string,"why":string,"required":boolean,"prefill":string}]}]}`,
    );

    const parsed = parseJson<{ eligibility: EligibilityItem[]; sections: InterviewSection[] }>(raw, {
      eligibility: [],
      sections: [],
    });
    if (!parsed.sections?.length) throw new Error("Could not build the interview. Please try again.");
    return parsed;
  });

/** Generates the full draft from the interview answers. */
export const generateProposalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      opportunity: AnyRecord;
      org: AnyRecord | null;
      sections: InterviewSection[];
      answers: Record<string, string>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const transcript = data.sections
      .map((s) => {
        const qa = s.questions
          .map((q) => `  Q: ${q.prompt}\n  A: ${data.answers[q.id]?.trim() || "(skipped)"}`)
          .join("\n");
        return `## ${s.title}\n${qa}`;
      })
      .join("\n\n");

    const raw = await ai(
      "You are a senior U.S. grant writer. You reply with strict JSON only — no prose, no code fences.",
      `Grant opportunity (JSON):
${summarize(data.opportunity)}

Applicant profile (JSON):
${summarize(data.org)}

Interview transcript:
${transcript}

Write the complete proposal draft.
Rules:
- One object per required section, in the exact order and naming this funder expects.
- Use ONLY the user's answers and profile for facts. Never invent history, outcomes, partners or numbers.
- Where an answer was skipped or too thin to write a complete section, insert "[INFORMATION NEEDED: what is missing]" inline and set source to "placeholder".
- Set source to "profile" when the section leans mainly on pre-filled profile data, otherwise "ai".
- Tone: formal and technical for federal/state agencies; warm and narrative for community foundations and corporate funders.
- 200-500 words per section; use plain paragraphs separated by blank lines (no markdown headings inside content).
- "requirement" restates, in one sentence, what the solicitation asks this section to cover.

Return JSON exactly:
{"sections":[{"id":string,"title":string,"requirement":string,"content":string,"source":"ai"|"profile"|"placeholder"}]}`,
    );

    const parsed = parseJson<{ sections: DraftSection[] }>(raw, { sections: [] });
    if (!parsed.sections?.length) throw new Error("Draft generation failed. Please try again.");
    return parsed;
  });

/** Rewrites, expands, shortens or reviews a single section. */
export const reviseProposalSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      opportunity: AnyRecord;
      section: DraftSection;
      mode: "rewrite" | "expand" | "shorten" | "check";
      instruction?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const task =
      data.mode === "expand"
        ? "Expand this section with more depth and specificity, roughly 50% longer. Do not invent facts."
        : data.mode === "shorten"
          ? "Tighten this section to roughly 60% of its current length without losing required content."
          : data.mode === "check"
            ? "Do NOT rewrite. Assess whether this section fully addresses the funder's requirement and list concrete gaps."
            : `Rewrite this section following the user's instruction: ${data.instruction ?? "improve clarity and impact"}. Do not invent facts.`;

    const raw = await ai(
      "You are a senior U.S. grant writer. You reply with strict JSON only — no prose, no code fences.",
      `Grant opportunity (JSON):
${summarize(data.opportunity, 2500)}

Section title: ${data.section.title}
Funder requirement: ${data.section.requirement}
Current content:
"""${data.section.content}"""

Task: ${task}
Keep any "[INFORMATION NEEDED: ...]" markers unless the content now answers them.

Return JSON exactly:
{"content":string,"notes":string}
For "check", return the unchanged content and put the assessment in notes.`,
    );

    return parseJson<{ content: string; notes: string }>(raw, {
      content: data.section.content,
      notes: "No response from the reviewer.",
    });
  });

/** Pre-submission compliance review. */
export const runComplianceReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      opportunity: AnyRecord;
      org: AnyRecord | null;
      sections: DraftSection[];
      level: "basic" | "full" | "full_ai";
    }) => data,
  )
  .handler(async ({ data }) => {
    const body = data.sections
      .map((s) => `## ${s.title}\nRequirement: ${s.requirement}\n${s.content}`)
      .join("\n\n");

    const raw = await ai(
      "You are a grant compliance reviewer. You reply with strict JSON only — no prose, no code fences.",
      `Grant opportunity (JSON):
${summarize(data.opportunity)}

Applicant profile (JSON):
${summarize(data.org)}

Proposal draft:
${summarize(body, 12000)}

Review depth: ${data.level}.

Check each of these and return one item per check:
all required sections present; page limits (assume ~500 words per page) respected; formatting requirements met; required attachments identified; budget figures internally consistent; requested amount within the award floor/ceiling; no placeholder text remaining; organization name, EIN and address consistent; required certifications acknowledged.
${data.level === "full_ai" ? "Additionally add AI review items on responsiveness to the evaluation criteria and competitiveness." : ""}

Also produce:
- attachments: every document the applicant must submit alongside the narrative.
- submission_summary: one plain-language paragraph covering where to submit, the deadline, file-format requirements and who to contact.
- budget_narrative: a standalone budget narrative built only from what the draft states; empty string if there is no budget information.

Return JSON exactly:
{"items":[{"label":string,"state":"pass"|"warn"|"fail","detail":string}],"attachments":[string],"submission_summary":string,"budget_narrative":string}`,
    );

    const parsed = parseJson<Omit<ComplianceResults, "reviewed_at">>(raw, {
      items: [],
      attachments: [],
      submission_summary: "",
      budget_narrative: "",
    });
    return { ...parsed, reviewed_at: new Date().toISOString() } satisfies ComplianceResults;
  });
