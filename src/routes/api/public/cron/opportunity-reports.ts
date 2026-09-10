import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { rankOpportunities, type Opportunity, type OrgProfile } from "@/lib/matching";
import { reportHtml, type ReportPayload } from "@/utils/reports.functions";

const INTERVAL_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

export const Route = createFileRoute("/api/public/cron/opportunity-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendEmail } = await import("@/lib/email.server");
        const now = new Date();

        const { data: due } = await supabaseAdmin
          .from("email_report_settings")
          .select("*")
          .eq("enabled", true)
          .or(`next_send_at.is.null,next_send_at.lte.${now.toISOString()}`)
          .limit(200);

        const { data: opps } = await supabaseAdmin
          .from("opportunities")
          .select("*")
          .eq("is_active", true);

        let processed = 0;
        for (const setting of due ?? []) {
          const { data: org } = await supabaseAdmin
            .from("org_profiles")
            .select("*")
            .eq("user_id", setting.user_id)
            .maybeSingle();

          const matches = rankOpportunities(
            (org ?? null) as OrgProfile | null,
            (opps ?? []) as Opportunity[],
          )
            .filter((m) => m.score >= (setting.min_fit_score ?? 60))
            .slice(0, 25);

          const payload: ReportPayload = {
            orgName: org?.org_name ?? "Your organization",
            generatedAt: now.toISOString().slice(0, 10),
            rows: matches.map((m) => ({
              slug: m.opportunity.slug,
              title: m.opportunity.title,
              funder: m.opportunity.funder,
              score: m.score,
              deadline: m.opportunity.deadline,
              application_url: m.opportunity.application_url,
            })),
          };

          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("email")
            .eq("id", setting.user_id)
            .maybeSingle();

          const recipients = [profile?.email ?? "", ...(setting.recipients ?? [])].filter(Boolean);
          const subject = `${payload.rows.length} funding matches for ${payload.orgName}`;
          const html = reportHtml(payload);

          for (const to of recipients) {
            const result = await sendEmail({ to, subject, html });
            await supabaseAdmin.from("email_report_log").insert({
              user_id: setting.user_id,
              recipient: to,
              subject,
              opportunity_count: payload.rows.length,
              trigger_source: "scheduled",
              status: result.status,
              error: result.error ?? null,
            });
          }

          const next = new Date(now);
          next.setUTCDate(next.getUTCDate() + (INTERVAL_DAYS[setting.frequency] ?? 7));
          await supabaseAdmin
            .from("email_report_settings")
            .update({ last_sent_at: now.toISOString(), next_send_at: next.toISOString() })
            .eq("user_id", setting.user_id);

          await supabaseAdmin.from("funding_scan_runs").insert({
            user_id: setting.user_id,
            scan_type: "scheduled",
            frequency: setting.frequency,
            matches_found: payload.rows.length,
            new_matches: payload.rows.length,
          });

          processed += 1;
        }

        return Response.json({ ok: true, processed });
      },
    },
  },
});
