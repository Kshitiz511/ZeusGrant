# ZCS GrantMatch Innovation — Build Roadmap

## Done
- [x] Zeus Consulting design system (Figtree, #022eeb, #7ac43d, black/gray/white tokens)
- [x] Marketing landing page (hero, how it works, features, audiences, FAQ, CTA, legal disclaimer)
- [x] Pricing page (5 plans, monthly/annual toggle, trial terms, add-ons)

- [x] Lovable Cloud enabled: email + Google auth, profiles/roles/org_profiles/saved_opportunities with RLS
- [x] Protected app shell, dashboard with readiness score
- [x] 8-step onboarding wizard with "?" help tips

- [x] Payments: plans/prices, embedded checkout with 3-day trial, subscriptions table + webhook, billing page & portal
- [x] Entitlements: plan_limits + usage_counters, DB-enforced saved-opportunity cap, subscription gate on matches
- [x] Billing hardening: one trial per account, no duplicate subscriptions, in-app plan switch with proration, cancel/resume, past-due dunning, Stripe->DB sync fallback
- [x] Account settings page (name, job title, phone, email, password)

- [x] Proposal engine: eligibility checklist, AI interview, draft generation/editing, compliance review, DOCX/PDF export gated by plan, proposal management
- [x] Opportunity "Create Draft Proposal" CTA + official funder application links

## Next
- [x] Document Center: organization file library + unified view of grant and compliance attachments
- [ ] Team seats + client workspaces (limits already defined per plan)

- [ ] Dashboard (readiness score, new matches, deadlines, usage)
- [ ] Matching engine + seeded sample opportunities (20+), fit scores
- [ ] Opportunity list/detail, save, Kanban tracker
- [ ] Document center, team roles, notifications, help system
- [ ] Readiness assessment, reporting, agency workspaces, admin panel

- [x] Billing update for proposal drafting: plan matrix (trial/Starter preview-only, Growth export, Professional templates + AI review, Agency white-label), server-enforced draft allowance per billing cycle, add-on purchases (5/10 drafts, human review, template pack, full service), add-on webhook crediting, usage dashboard.

## Compliance Tracker (Phase 2) — done
- Contract upload (PDF/DOCX/TXT) with AI extraction of obligations, dates and financial terms (source quote, page, confidence)
- Review-before-build screen; obligation task board, timeline, dashboard with risk flags and health score
- Full financials: lump sum vs hourly rate card, reimbursable cap and multiplier, monthly percent-complete invoicing, budget lines
- Plan gating: contract limits, timeline/budget/assignment/CSV/PDF on Growth+, health score Professional+, white-label Agency

## Contract Compliance Tracker (Phase 3) — done
- Intake: file upload (PDF/DOCX/DOC/TXT/MD, 50MB), public URL fetch, or pasted contract text
- Contract project view: KPI tiles, 0–100 health gauge, board + task list + timeline + dashboard + financials + documents + team + settings
- Kanban lanes incl. derived Overdue; filters by category, priority, assignee and due window
- Task detail: details, assignees, evidence, activity log, threaded comments with @mentions
- Team management (owner/manager/contributor/viewer) and per-contract reminder schedule defaults
- My Tasks: personal cross-contract worklist grouped by urgency

- AI extraction record: raw extraction saved to Supabase the moment the AI finishes, resumable review, permanent AI Extraction tab with review actions, restore-as-task and timestamped re-run/compare/selective import — done.

## Plan feature parity (done)
- [x] Organization team seats + roles (`/team`), capped by plan seat allowance
- [x] Client workspaces for Consultant / Agency (`/team`)
- [x] Funding scan cadence (monthly / weekly / daily) with run history (`/reports`)
- [x] Scheduled email opportunity reports + send-now + delivery log (`/reports`, `/api/public/cron/opportunity-reports`)
- [x] Calendar .ics export for Professional+ (Grant Tracker calendar)
- [x] Proposal template library: list, apply, delete (Professional+)
- [x] Usage analytics tiles for Agency (`/reports`)

### Pending
- [ ] Verify a sender domain so scheduled reports actually deliver (currently logged as `not_configured`)
- [ ] Schedule the cron endpoint to run daily

## Modules restructure (done)
- Three independently purchasable modules: Grant Intelligence Suite ($49–$399), Contract Compliance Manager ($39–$299), Audit Compliance & Documentation Vault ($59–$449).
- Stripe products/prices created for every module plan, monthly + annual (17% off).
- Pricing page: module selection with plan dropdowns, live bundle discount (2 = 10%, 3 = 15%).
- Billing: per-module cards with independent 3-day trials and checkout.
- Sidebar: active-module sections, locked-module teasers, /modules/$slug teaser page.
- Module 3: Evidence Vault tab (hashed + server-stamped uploads, doc type, cycle, confirmation, notes, retrieval), Audit Readiness score/bands, compliance documentation package (PDF/file/read-only link), regulatory citations, Agency Portal invites, /audit overview.

## Security & compliance (done)
- [x] Append-only security activity trail (`security_audit_log`, no update/delete policies) + `/security` Security Center
- [x] Hourly rate limiting for AI/scan/export actions (`api_rate_log`, `check_rate_limit`) with 30-day usage view
- [x] Upload validation (size + type + safe file names) and SSRF screening on all user-supplied URLs
- [x] Security headers (HSTS, nosniff, frame, referrer, permissions policy) on every response
- [x] Leaked-password protection enabled; sign out of all devices; full data export; deletion request flow
