/**
 * Privacy policy and terms of service.
 *
 * Single source: rendered by LegalPage in the app AND prerendered into static
 * HTML by scripts/prerender.mjs, so crawlers and the Ads reviewer read exactly
 * what a visitor reads. Every statement here must stay true of the running
 * system -- the sub-processor list in particular mirrors the providers the
 * platform is actually configured to call.
 */

export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDoc = {
  path: "/privacy" | "/terms";
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
};

const CONTACT = "Contact us through zeusconsultingservices.com.";

export const PRIVACY: LegalDoc = {
  path: "/privacy",
  title: "Privacy Policy",
  description:
    "How Zeus collects, uses, stores and protects personal data and the documents you upload.",
  updated: "2026-10-09",
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        "Zeus is operated by Zeus Consulting (\"we\", \"us\"). This policy explains what personal data the Zeus platform processes, why, and the choices you have. " +
          CONTACT,
      ],
    },
    {
      heading: "What we collect",
      paragraphs: [
        "Account data: your name, email address, a one-way hash of your password (never the password itself), and, if you sign in with Google, your Google account identifier and verified email.",
        "Workspace data: your organisation profile, the documents you upload, the obligations and matches generated from them, and the actions your team takes. This content belongs to your organisation.",
        "Usage and security data: sign-in sessions, IP address and browser user agent on security-relevant events, and records of AI processing (model, token counts, cost) used for billing and limits.",
        "Billing data: handled by Stripe. We store your Stripe customer and subscription identifiers; we never receive or store card numbers.",
      ],
    },
    {
      heading: "How we use it",
      paragraphs: [
        "To provide the service: authenticate you, score funding opportunities against your profile, extract obligations from documents you upload, and send the emails the service depends on (verification codes, password resets, invitations).",
        "To secure the service: detect session theft, rate-limit abuse, and keep an append-only audit trail of administrative actions.",
        "To bill you and enforce the limits of your plan.",
        "We do not sell personal data, we do not use your documents to train AI models, and we do not show advertising inside the product.",
      ],
    },
    {
      heading: "AI processing",
      paragraphs: [
        "Documents you upload are sent to our AI provider (OpenAI) solely to extract structured obligations for you. Under the provider's API terms, data submitted through the API is not used to train its models. Uploaded content is treated as data, never as instructions.",
      ],
    },
    {
      heading: "Sub-processors",
      paragraphs: [
        "Vercel (hosting), Supabase (database and file storage), Upstash (cache and job queue), OpenAI (document analysis), Resend (transactional email), Stripe (payments) and Google (optional sign-in). Each processes data only as needed to provide its part of the service.",
      ],
    },
    {
      heading: "Isolation and security",
      paragraphs: [
        "Each organisation's data is separated by row-level security enforced in the database. Passwords are hashed with scrypt; verification and reset codes are stored only as hashes, expire after 15 minutes and are limited to ten attempts. Refresh tokens are held in cookies scripts cannot read and are rotated on every use.",
      ],
    },
    {
      heading: "Retention",
      paragraphs: [
        "Workspace content is kept while your account is active. When you ask us to delete your account or workspace, we delete the associated content, except records we must keep for legal, tax or security reasons (such as billing records and the administrative audit trail).",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "Depending on where you live (including under the GDPR and UK GDPR, and US state privacy laws such as the CCPA), you may have the right to access, correct, export or delete your personal data, and to object to or restrict processing. " +
          CONTACT +
          " We will respond within 30 days.",
      ],
    },
    {
      heading: "Cookies",
      paragraphs: [
        "We use only cookies that are strictly necessary to keep you signed in and protect against cross-site request forgery. We do not use advertising or cross-site tracking cookies in the product.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "We will update this page when our practices change and revise the date above. Material changes will be notified to account owners by email.",
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  path: "/terms",
  title: "Terms of Service",
  description: "The terms that govern use of the Zeus platform.",
  updated: "2026-10-09",
  sections: [
    {
      heading: "Agreement",
      paragraphs: [
        "These terms govern your use of the Zeus platform, operated by Zeus Consulting. By creating an account you agree to them on behalf of yourself and the organisation whose workspace you use.",
      ],
    },
    {
      heading: "Accounts",
      paragraphs: [
        "You must provide accurate information and keep your credentials secure. Workspace owners and admins are responsible for who they invite and the roles they grant. Tell us promptly if you suspect unauthorised access.",
      ],
    },
    {
      heading: "Your content",
      paragraphs: [
        "You keep all rights to the documents and data you upload. You grant us only the permission needed to host and process that content to provide the service. You confirm you have the right to upload it.",
      ],
    },
    {
      heading: "AI output",
      paragraphs: [
        "Grant scores and extracted obligations are generated automatically and can be wrong or incomplete. Each obligation cites the clause it came from so you can check it. Zeus is a tool to help you track commitments; it is not legal, financial or compliance advice, and you remain responsible for meeting your obligations to your funders.",
      ],
    },
    {
      heading: "Plans, billing and trials",
      paragraphs: [
        "Services are billed per module, monthly, through Stripe. Trials end automatically unless you add a payment method. You can cancel at any time; cancellation takes effect at the end of the current billing period and fees already paid are not refunded except where the law requires. Plan limits are enforced by the service.",
      ],
    },
    {
      heading: "Acceptable use",
      paragraphs: [
        "Do not attempt to access another organisation's data, probe or disrupt the service, upload malware, circumvent plan limits, or use the service for unlawful purposes. We may suspend a workspace that breaches these terms or endangers other customers.",
      ],
    },
    {
      heading: "Availability",
      paragraphs: [
        "We work to keep the service available and your data safe, but the service is provided \"as is\" without guarantees of uninterrupted operation.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "To the extent permitted by law, we are not liable for indirect or consequential losses, including lost funding or missed deadlines, and our total liability is limited to the fees you paid in the twelve months before the claim.",
      ],
    },
    {
      heading: "Termination",
      paragraphs: [
        "You may stop using the service at any time. We may terminate accounts that breach these terms. On termination you may request an export of your content within 30 days.",
      ],
    },
    {
      heading: "Changes and contact",
      paragraphs: [
        "We may update these terms and will notify account owners of material changes. " + CONTACT,
      ],
    },
  ],
};

export const LEGAL_DOCS = [PRIVACY, TERMS] as const;
