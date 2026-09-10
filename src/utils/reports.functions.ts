import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rankOpportunities, type Opportunity, type OrgProfile } from "@/lib/matching";

export type ReportRow = {
  slug: string;
  title: string;
  funder: string;
  score: number;
  deadline: string | null;
  application_url: string | null;
};

export type ReportPayload = {
  orgName: string;
  generatedAt: string;
  rows: ReportRow[];
};

export function reportHtml(payload: ReportPayload): string {
  const items = payload.rows
    .map(
      (r) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">
        <strong>${escapeHtml(r.title)}</strong><br />
        <span style="color:#555">${escapeHtml(r.funder)}</span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${r.score}%</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">${r.deadline ?? "Rolling"}</td>
    </tr>`,
    )
    .join("");

  return `<div style="font-family:Figtree,Arial,sans-serif;color:#111">
    <h1 style="color:#022eeb;font-size:20px">Your funding opportunity report</h1>
    <p style="color:#444">${escapeHtml(payload.orgName)} — ${payload.rows.length} matching opportunities as of ${payload.generatedAt}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr>
        <th align="left" style="padding:8px">Opportunity</th>
        <th style="padding:8px">Fit</th>
        <th align="left" style="padding:8px">Deadline</th>
      </tr></thead>
      <tbody>${items}</tbody>
    </table>
    <p style="color:#666;font-size:12px;margin-top:20px">Sent by ZCS GrantMatch Innovation.</p>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Build the report payload for the signed-in user. */
export const buildOpportunityReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReportPayload> => {
    const { supabase, userId } = context;
    const [{ data: org }, { data: opps }, { data: settings }] = await Promise.all([
      supabase.from("org_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("opportunities").select("*").eq("is_active", true),
      supabase.from("email_report_settings").select("min_fit_score").eq("user_id", userId).maybeSingle(),
    ]);

    const min = settings?.min_fit_score ?? 60;
    const matches = rankOpportunities((org ?? null) as OrgProfile | null, (opps ?? []) as Opportunity[])
      .filter((m) => m.score >= min)
      .slice(0, 25);

    return {
      orgName: org?.org_name ?? "Your organization",
      generatedAt: new Date().toISOString().slice(0, 10),
      rows: matches.map((m) => ({
        slug: m.opportunity.slug,
        title: m.opportunity.title,
        funder: m.opportunity.funder,
        score: m.score,
        deadline: m.opportunity.deadline,
        application_url: m.opportunity.application_url,
      })),
    };
  });

/** Send the report now to the account email plus any extra recipients. */
export const sendOpportunityReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const { sendEmail } = await import("@/lib/email.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: org }, { data: opps }, { data: settings }] = await Promise.all([
      supabase.from("org_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("opportunities").select("*").eq("is_active", true),
      supabase.from("email_report_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    const min = settings?.min_fit_score ?? 60;
    const matches = rankOpportunities((org ?? null) as OrgProfile | null, (opps ?? []) as Opportunity[])
      .filter((m) => m.score >= min)
      .slice(0, 25);

    const payload: ReportPayload = {
      orgName: org?.org_name ?? "Your organization",
      generatedAt: new Date().toISOString().slice(0, 10),
      rows: matches.map((m) => ({
        slug: m.opportunity.slug,
        title: m.opportunity.title,
        funder: m.opportunity.funder,
        score: m.score,
        deadline: m.opportunity.deadline,
        application_url: m.opportunity.application_url,
      })),
    };

    const primary = (claims as { email?: string }).email ?? "";
    const recipients = [primary, ...(settings?.recipients ?? [])].filter(Boolean);
    const subject = `${payload.rows.length} funding matches for ${payload.orgName}`;
    const html = reportHtml(payload);

    let sent = 0;
    let lastStatus: string = "not_configured";
    for (const to of recipients) {
      const result = await sendEmail({ to, subject, html });
      lastStatus = result.status;
      if (result.status === "sent") sent += 1;
      await supabaseAdmin.from("email_report_log").insert({
        user_id: userId,
        recipient: to,
        subject,
        opportunity_count: payload.rows.length,
        trigger_source: "manual",
        status: result.status,
        error: result.error ?? null,
      });
    }

    if (sent > 0) {
      await supabaseAdmin
        .from("email_report_settings")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    return { sent, recipients: recipients.length, status: lastStatus, count: payload.rows.length };
  });
