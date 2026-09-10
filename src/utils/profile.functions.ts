import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSafeExternalUrl } from "@/lib/security";
import type {
  ScrapedProfile,
  ExtractedPerson,
  ExtractedCapability,
  ExtractedPriorProposal,
} from "@/lib/profile-intelligence";

const MODEL = "google/gemini-2.5-flash";
const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
  const json = (await res.json()) as Record<string, unknown>;
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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const INTERESTING = [
  "about",
  "who-we-are",
  "our-work",
  "services",
  "programs",
  "team",
  "leadership",
  "staff",
  "contact",
  "capabilit",
  "impact",
  "results",
  "projects",
  "clients",
];

function internalLinks(html: string, base: URL): string[] {
  const found = new Set<string>();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp)$/i.test(url.pathname)) continue;
    const path = url.pathname.toLowerCase();
    if (path === "/" || INTERESTING.some((k) => path.includes(k))) {
      url.hash = "";
      url.search = "";
      found.add(url.toString());
    }
  }
  return [...found];
}

const SCRAPE_SYSTEM = `You are a grants intelligence analyst. You read an organization's public
website content and build a structured organization profile used for grant applications.

Rules:
- Extract only facts stated on the website. Never invent numbers, names or claims.
- Use null or empty arrays when the site does not state something.
- confidence is "high", "medium" or "low" — use low when you inferred rather than read.
- source_page must be the page URL the fact came from.

Return ONLY JSON matching:
{"org_name":string|null,"dba_name":string|null,"org_type":string|null,"mission":string|null,
"vision":string|null,"year_founded":number|null,"service_area":string|null,"address":string|null,
"phone":string|null,"email":string|null,"social_links":string[],
"programs":[{"name":string,"description":string}],
"populations_served":string[],"focus_areas":string[],"geographic_reach":string|null,
"staff_count":number|null,"volunteer_count":number|null,
"leadership":[{"name":string,"title":string}],
"partners":string[],"board_members":string[],"accreditations":string[],"awards":string[],
"annual_budget":number|null,"funding_sources":string[],"grant_awards":string[],
"testimonials":string[],"impact_statistics":[{"stat_text":string,"numeric_value":number|null,"unit":string|null,"time_period":string|null}],
"case_studies":string[],"media_mentions":string[],
"data_points":[{"category":string,"field_name":string,"field_value":string,"confidence":string,"source_page":string}]}

category is one of: identity, certifications, programs, geography, population, capacity, financial, past_performance.`;

export const scrapeWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => ({
    url: assertSafeExternalUrl(data?.url ?? "").toString(),
  }))
  .handler(async ({ data }): Promise<{ pages: string[]; profile: ScrapedProfile }> => {
    const base = new URL(data.url);
    const queue = [base.toString()];
    const visited: string[] = [];
    const chunks: string[] = [];

    while (queue.length && visited.length < 10) {
      const next = queue.shift()!;
      if (visited.includes(next)) continue;
      try {
        assertSafeExternalUrl(next);
      } catch {
        continue;
      }
      let html = "";
      try {
        const res = await fetch(next, {
          headers: { "User-Agent": "GrantMatchBot/1.0" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) continue;
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("html")) continue;
        html = await res.text();
      } catch {
        continue;
      }
      visited.push(next);
      const text = htmlToText(html);
      if (text.length > 80) chunks.push(`--- PAGE: ${next} ---\n${text.slice(0, 12_000)}`);
      for (const link of internalLinks(html, base)) {
        if (!visited.includes(link) && !queue.includes(link)) queue.push(link);
      }
    }

    if (!chunks.length) throw new Error("We could not read any content from that website.");

    const raw = await ai(SCRAPE_SYSTEM, `Website: ${base.toString()}\n\n${chunks.join("\n\n").slice(0, 120_000)}`);
    const profile = parseJson<ScrapedProfile>(raw, {} as ScrapedProfile);
    return { pages: visited, profile };
  });

const RESUME_SYSTEM = `You read a resume, CV or biography and extract a structured person profile
used in grant proposals. Extract only what the document states; use null or [] otherwise.
Also write two bios in third person, grounded strictly in the document: a 100-word short bio and a
300-word long bio.

Return ONLY JSON matching:
{"full_name":string,"title":string|null,"role_on_proposals":string[],
"education":[{"degree":string,"field":string,"institution":string,"year":string|null}],
"certifications":string[],"years_of_experience":number|null,"areas_of_expertise":string[],
"relevant_skills":string[],"languages":string[],
"selected_projects":[{"title":string,"client":string|null,"year":string|null,"role":string|null,"description":string,"dollar_value":number|null}],
"publications":string[],"awards":string[],"teaming_org_name":string|null,
"bio_short":string,"bio_long":string,"confidence":"high"|"medium"|"low"}`;

export const extractResume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; fileName: string }) => {
    if (!data?.text || data.text.trim().length < 50) {
      throw new Error("We could not read enough text from that file.");
    }
    return { text: data.text.slice(0, 60_000), fileName: data.fileName ?? "resume" };
  })
  .handler(async ({ data }): Promise<ExtractedPerson> => {
    const raw = await ai(RESUME_SYSTEM, `File: ${data.fileName}\n\n"""\n${data.text}\n"""`);
    const parsed = parseJson<ExtractedPerson>(raw, {} as ExtractedPerson);
    return {
      full_name: parsed.full_name || data.fileName.replace(/\.[^.]+$/, ""),
      title: parsed.title ?? null,
      role_on_proposals: parsed.role_on_proposals ?? [],
      education: parsed.education ?? [],
      certifications: parsed.certifications ?? [],
      years_of_experience: parsed.years_of_experience ?? null,
      areas_of_expertise: parsed.areas_of_expertise ?? [],
      relevant_skills: parsed.relevant_skills ?? [],
      languages: parsed.languages ?? [],
      selected_projects: parsed.selected_projects ?? [],
      publications: parsed.publications ?? [],
      awards: parsed.awards ?? [],
      teaming_org_name: parsed.teaming_org_name ?? null,
      bio_short: parsed.bio_short ?? "",
      bio_long: parsed.bio_long ?? "",
      confidence: parsed.confidence ?? "medium",
    };
  });

const CAPABILITY_SYSTEM = `You read an organization capability statement and extract the
registration, certification and competency data used in nearly every proposal. Extract only what
the document states.

Return ONLY JSON matching:
{"org_name":string|null,"uei":string|null,"duns":string|null,"cage":string|null,
"sam_registered":boolean|null,"naics_codes":string[],"psc_codes":string[],
"certifications":string[],"contract_vehicles":string[],"core_competencies":string[],
"differentiators":string[],"past_performance_summary":string|null,
"data_points":[{"category":string,"field_name":string,"field_value":string,"confidence":string}]}`;

export const extractCapabilityStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; fileName: string }) => {
    if (!data?.text || data.text.trim().length < 50) {
      throw new Error("We could not read enough text from that file.");
    }
    return { text: data.text.slice(0, 60_000), fileName: data.fileName ?? "capability statement" };
  })
  .handler(async ({ data }): Promise<ExtractedCapability> => {
    const raw = await ai(CAPABILITY_SYSTEM, `File: ${data.fileName}\n\n"""\n${data.text}\n"""`);
    const parsed = parseJson<ExtractedCapability>(raw, {} as ExtractedCapability);
    return {
      org_name: parsed.org_name ?? null,
      uei: parsed.uei ?? null,
      duns: parsed.duns ?? null,
      cage: parsed.cage ?? null,
      sam_registered: parsed.sam_registered ?? null,
      naics_codes: parsed.naics_codes ?? [],
      psc_codes: parsed.psc_codes ?? [],
      certifications: parsed.certifications ?? [],
      contract_vehicles: parsed.contract_vehicles ?? [],
      core_competencies: parsed.core_competencies ?? [],
      differentiators: parsed.differentiators ?? [],
      past_performance_summary: parsed.past_performance_summary ?? null,
      data_points: parsed.data_points ?? [],
    };
  });

const PROPOSAL_SYSTEM = `You read a previously submitted grant proposal, award notice, solicitation
or past performance write-up and extract reusable material for future proposals.

Rules:
- Copy narrative blocks verbatim from the document. Do not rewrite or invent content.
- block_type is one of: executive_summary, org_background, mission, problem_statement,
  program_description, theory_of_change, evaluation_plan, sustainability_plan, budget_narrative,
  certifications, partnerships, community_engagement, dei, past_performance, other.
- tone is one of: formal, narrative, technical, community_centered.
- Extract every quantified impact statistic stated in the document.
- Extract past performance entries (funder, opportunity title, award amount, award year, program area).

Return ONLY JSON matching:
{"funder_name":string|null,"opportunity_title":string|null,"program_area":string|null,
"funder_type":string|null,"award_amount":number|null,"award_year":string|null,
"blocks":[{"block_type":string,"title":string,"content":string,"tone":string}],
"impact_statistics":[{"stat_text":string,"numeric_value":number|null,"unit":string|null,"program_area":string|null,"time_period":string|null}],
"key_personnel":[{"name":string,"role":string}],
"partners":[{"name":string,"role":string}]}`;

export const extractPriorProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; fileName: string }) => {
    if (!data?.text || data.text.trim().length < 50) {
      throw new Error("We could not read enough text from that file.");
    }
    return { text: data.text.slice(0, 120_000), fileName: data.fileName ?? "document" };
  })
  .handler(async ({ data }): Promise<ExtractedPriorProposal> => {
    const raw = await ai(PROPOSAL_SYSTEM, `File: ${data.fileName}\n\n"""\n${data.text}\n"""`);
    const parsed = parseJson<ExtractedPriorProposal>(raw, {} as ExtractedPriorProposal);
    return {
      funder_name: parsed.funder_name ?? null,
      opportunity_title: parsed.opportunity_title ?? null,
      program_area: parsed.program_area ?? null,
      funder_type: parsed.funder_type ?? null,
      award_amount: parsed.award_amount ?? null,
      award_year: parsed.award_year ?? null,
      blocks: parsed.blocks ?? [],
      impact_statistics: parsed.impact_statistics ?? [],
      key_personnel: parsed.key_personnel ?? [],
      partners: parsed.partners ?? [],
    };
  });
