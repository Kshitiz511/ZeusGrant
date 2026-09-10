import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ExtractedContract } from "@/lib/compliance";
import { assertSafeExternalUrl } from "@/lib/security";

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

const EMPTY: ExtractedContract = {
  name: "",
  funder: "",
  contract_number: null,
  award_amount: null,
  period_start: null,
  period_end: null,
  compensation_type: "lump_sum",
  lump_sum_amount: null,
  reimbursable_cap: null,
  reimbursable_multiplier: null,
  invoicing_basis: null,
  summary: "",
  obligations: [],
  budget_categories: [],
  rate_cards: [],
};

const SYSTEM = `You are a grants compliance analyst. You read award agreements, grant
contracts and consulting scopes of services and extract every binding obligation and all
financial terms.

Rules:
- Extract ONLY what the document states. Never invent dates, amounts or requirements.
- Every obligation MUST include a verbatim source_quote copied from the document, the page
  number if the text contains "[page N]" markers (else null), and a confidence from 0 to 1.
- Dates must be ISO (YYYY-MM-DD) or null when the document gives only a relative timing;
  in that case put the relative timing in the description.
- category is one of: reporting, financial, deliverable, administrative, legal.
- recurrence is one of: one_time, monthly, quarterly, semi_annual, annual.
- priority is one of: low, medium, high.
- compensation_type is one of: lump_sum, hourly, cost_reimbursement, mixed.
- Capture reimbursable caps and multipliers (e.g. "cost times 1.1, not to exceed $650").
- Capture hourly rate tables into rate_cards.

Return ONLY JSON matching:
{"name":string,"funder":string,"contract_number":string|null,"award_amount":number|null,
"period_start":string|null,"period_end":string|null,"compensation_type":string,
"lump_sum_amount":number|null,"reimbursable_cap":number|null,"reimbursable_multiplier":number|null,
"invoicing_basis":string|null,"summary":string,
"obligations":[{"category":string,"title":string,"description":string,"due_date":string|null,
"recurrence":string,"priority":string,"prior_approval_required":boolean,"amount":number|null,
"source_quote":string,"source_page":number|null,"confidence":number}],
"budget_categories":[{"name":string,"category_type":string,"budgeted_amount":number}],
"rate_cards":[{"labor_category":string,"level":string|null,"hourly_rate":number}]}`;

export const extractContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; fileName: string }) => {
    if (!data?.text || data.text.trim().length < 50) {
      throw new Error("We could not read enough text from that file.");
    }
    return { text: data.text.slice(0, 120_000), fileName: data.fileName ?? "contract" };
  })
  .handler(async ({ data }): Promise<ExtractedContract> => {
    const raw = await ai(
      SYSTEM,
      `File name: ${data.fileName}\n\nDocument text:\n"""\n${data.text}\n"""`,
    );
    const parsed = parseJson<ExtractedContract>(raw, EMPTY);
    return {
      ...EMPTY,
      ...parsed,
      name: parsed.name || data.fileName.replace(/\.[^.]+$/, ""),
      obligations: Array.isArray(parsed.obligations) ? parsed.obligations : [],
      budget_categories: Array.isArray(parsed.budget_categories) ? parsed.budget_categories : [],
      rate_cards: Array.isArray(parsed.rate_cards) ? parsed.rate_cards : [],
    };
  });

/** Fetch a publicly reachable contract URL server-side and return plain text. */
export const fetchContractUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => ({
    url: assertSafeExternalUrl(data?.url ?? "").toString(),
  }))
  .handler(async ({ data }): Promise<{ text: string; fileName: string }> => {
    const res = await fetch(data.url, { headers: { "User-Agent": "GrantMatchBot/1.0" } });
    if (!res.ok) throw new Error(`Could not fetch that URL (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("pdf") || type.includes("officedocument")) {
      throw new Error("That link is a binary document. Please download it and upload the file.");
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 50) throw new Error("We could not read enough text from that page.");
    const name = new URL(data.url).pathname.split("/").filter(Boolean).pop() ?? "contract";
    return { text: text.slice(0, 120_000), fileName: name };
  });
