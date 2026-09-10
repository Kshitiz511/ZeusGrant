/**
 * Server-only email sender.
 *
 * Uses the project's configured transactional email provider. Until a sender
 * domain is verified for the project, sends are reported as "not configured"
 * instead of failing, so scheduling and report history still work.
 */
export type SendResult = { status: "sent" | "not_configured" | "error"; error?: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["EMAIL_FROM"];
  if (!apiKey || !from) return { status: "not_configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    });
    if (!res.ok) {
      return { status: "error", error: `Email provider returned ${res.status}` };
    }
    return { status: "sent" };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Send failed" };
  }
}
