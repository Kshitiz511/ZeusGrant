# Grant Tracker + Compliance Tracker

Two large new features from the spec. I'll build them in two phases so you can use Phase 1 while Phase 2 lands.

## Phase 1 — Grant Tracker

**Data**
- `grant_records` — grant/funder details, stage, requested/submitted/awarded amounts, submission & decision dates, outcome, funder contact, notes, tags, links to opportunity + proposal.
- `grant_stage_history` — every stage change with date and who made it.
- `grant_activity_log` — notes, uploads, reminders, assignments.
- `grant_documents` — file records (private storage bucket) tagged by type.
- `grant_reporting_items` — reporting schedule for awarded grants.
- All owner-scoped with row-level security and grants.

**UI — new "Grant Tracker" nav item**
- Kanban board with the 11 lifecycle stages, per-column count + dollar totals, drag-and-drop, urgency colors, quick actions. Moving to Submitted/Awarded prompts for date and amount.
- List view: sortable table, filters (stage, date range, funder type, amount, outcome), CSV export (Growth+).
- Calendar view: submission deadlines, reporting deadlines, decision dates, compliance milestones, reminders; month/agenda views.
- Grant record page with tabs: Overview, Proposal, Activity Log, Documents, Reporting (awarded only), Team.
- Awards Dashboard: KPI tiles (Total Submitted, Total Awarded, Win Rate, Pipeline), plus pipeline-by-stage, awards by funder type, monthly submissions, win rate by type, awarded vs requested, funding by focus area, year-over-year. Filters + PDF export (Professional+, white-labeled for Agency).
- Automated prompts: deadline passed without submission, decision date passed without update.
- "Add to Tracker" from Opportunities and from proposal creation.

## Phase 2 — Compliance Tracker

**Data**
- `compliance_contracts`, `compliance_obligations`, `compliance_budget_categories`, `compliance_deliverable_progress`, evidence documents — owner-scoped with row-level security.

**Flow**
- Upload contract (PDF/DOCX) to private storage → AI extraction of reporting, financial, deliverable, administrative, legal obligations and key dates, each with source quote, page and confidence.
- Extraction review screen: confirm/edit/add obligations before building the tracker.
- Tracker views: Task Board (Kanban by status), Timeline/Gantt (Growth+), Compliance Dashboard (completion %, category donut, upcoming deadlines, budget utilization, deliverable progress, risk flags).
- Obligation detail panel: assignment, evidence upload, completion notes, recurrence.
- Alerts for upcoming/overdue items and prior-approval requirements; snooze/acknowledge.
- Organization-wide Compliance Health Score.
- Compliance Status PDF report (Growth+), white-labeled for Agency.
- Awarded grants auto-link into the Compliance Tracker from the Reporting tab.

## Plan gating (added to plan limits)
- Contract uploads: Trial 1 / Starter 2 / Growth 10 / Professional+ unlimited.
- Timeline view, team assignment, PDF + CSV export, budget tracking: Growth+.
- Multi-contract health score: Professional+.
- White-label reports: Agency+.

## Notes
- Uses the existing AI gateway server functions for extraction, the existing entitlement hooks for gating, and a new private storage bucket for grant/compliance documents.
- Team assignment uses existing accounts (invites are out of scope unless you want them).
