# Zeus Platform — Build Plan

**Written:** 2026-09-16
**Purpose:** This is the context-recovery document. If the build loses context at any point, read this file first. It records the current verified state, the defects found, every phase, every decision, and the exit criteria that make a phase shippable.

Nothing in this document is a guess. Every fact below was verified against the code on 2026-09-16.

---

## 0. How to use this document

1. **Section 1** — where the product actually is today. Read this to re-establish ground truth.
2. **Section 2** — defects found during planning. Several phases depend on these being fixed first.
3. **Section 3** — decisions taken, with reasoning. Do not silently reverse these.
4. **Sections 4-12** — the phases, in order. Each has scope, steps, exit criteria.
5. **Section 13** — open questions that block work.
6. **Section 14** — operational rules for this repo (how to run things, known traps).

When resuming: check `git log --oneline -15`, run the test suite, then find the first phase whose exit criteria are not met.

---

## 1. Verified current state (2026-09-16)

### Deployed
- Production: `https://zeus-platform-dun.vercel.app`, commit `9757d82`
- Migrations applied through **0013** (platform-core) and **0005** (contract-compliance)
- 7 tenants, each with `contract_compliance` + `grant_intelligence` trials
- **0 opportunities in the production catalogue** — grant scans return nothing until the Grants.gov extract is loaded
- **237 tests** across 21 files, ruff clean, `tsc --noEmit` clean

### What exists
| Area | State |
|---|---|
| Auth | Email/password + Google OAuth, first-party sessions, httpOnly refresh cookie, CSRF, reuse detection |
| Tenancy | Provision, list mine, tenant-scoped token exchange |
| Entitlements | Subscriptions → claims → Redis cache → `platform.entitlements` |
| Billing | Stripe checkout, portal, webhooks with idempotency ledger |
| Grant Intelligence | Opportunities, org profile, SQL scoring, matches, scan jobs, MCP server |
| Contract Compliance | Contracts, documents, AI obligation extraction, obligations, audit log |
| Jobs | Durable ledger `platform.jobs`, partitioned by module, QStash wake, in-process worker |
| RLS | Enabled + forced on every tenant-scoped table in both schemas |

### What does not exist
- Any admin UI
- Any team/member management UI **or backend**
- Any usage read path (data is written, never read)
- Any job list / retry / cancel endpoint
- Any way to grant `platform_admin` in production
- `/settings` route renders nothing
- Password reset
- Per-route SEO metadata (SPA, single `index.html`)

---

## 2. Defects found during planning

These are real and verified. Each is assigned to a phase. **Do not build on top of them.**

### D1 — Grant module id mismatch (breaks all grant limits)
`services/platform-core/src/zeus_platform_core/services/grant_service.py` uses `MODULE_ID = "grant-intelligence"` (hyphen). Everywhere else — the DB, the ledger, entitlement claims — uses `grant_intelligence` (underscore). The claims lookup can never match, so grant limits silently fall through to hardcoded defaults.
**Fix in Phase 1.**

### D2 — Grant limit keys are not seeded
The code reads `scans_per_month` and `matches_visible`. Neither is seeded in any migration. The seeded grant keys (`matches_per_month`, `proposal_drafts_per_month`, `client_workspaces`) are read by nothing.
**Fix in Phase 1.**

### D3 — `platform.model_pricing` is never seeded
No `INSERT` exists in any migration or script. `price_for()` returns `None` for every model, so **`cost_usd` is NULL on every `ai_usage` row ever written**. Any cost dashboard built today would show nothing.
**Fix in Phase 2, before the usage read path.**

### D4 — `team_seats` is seeded but never enforced
Eight plans carry a `team_seats` limit. Zero non-test code reads it. Invites must enforce it or seats are decorative.
**Fix in Phase 1.**

### D5 — No path to `platform_admin`
`routers/admin.py` guards on `"platform_admin" in session.roles`. Roles come from the JWT. The only issuer is the **dev-only** token router. There is no table, no flag, no bootstrap. **The admin API is unreachable in production.**
**Fix in Phase 4.**

### D6 — Membership cache has no invalidation hook
`membership:{user}:{tenant}` has a 60 s TTL and no explicit delete. Removing a member leaves them with access for up to 60 s.
**Fix in Phase 1** (delete the key on role change and removal).

### D7 — Model price cache has no TTL and no invalidation
`AiUsageRecorder._prices` is a plain in-process dict on a `@cached_property` container. A price edit is only picked up on process restart. On serverless that is "whenever the instance recycles" — unpredictable.
**Fix in Phase 5**, when prices become admin-editable.

### D8 — Two divergent `ai_usage` tables
`platform.ai_usage` (real tokens, `cost_usd`, append-only) and `contract_compliance.ai_usage` (estimated tokens, no cost, FORCE RLS). Reporting off the wrong one gives wrong numbers.
**Decide in Phase 2.** Decision recorded in §3.

### D9 — Grant Intelligence records no AI usage
`grep ai_usage services/platform-core/src` → zero matches. Only contract-compliance meters. Enrichment uses an LLM and is unmetered, so spend is invisible.
**Fix in Phase 2.**

### D10 — `cancelled` job status is unreachable
It is in the CHECK constraint; nothing writes it. Needed for admin job cancellation.
**Use in Phase 6.**

### D11 — `heartbeat_job` and progress columns are dead
`heartbeat()` and `set_progress()` have zero call sites. Long jobs cannot report progress and their leases cannot be extended, so a slow job gets reaped mid-flight.
**Fix in Phase 6.**

### D12 — Lease recovery only runs inside `claim_job`
There is no reaper. If nothing claims, expired leases are never swept, and a stuck job stays "running" forever with no observer.
**Fix in Phase 6.**

### D13 — No admin authorization tests
Zero tests assert that a non-admin gets 403 from admin routes, or that `platform_admin` cannot be self-granted via token exchange.
**Fix in Phase 4.**

### D14 — `ZEUS_JWT_SECRET` is in `BOOTSTRAP_KEYS` but is not a settings field
The real field is `ZEUS_SUPABASE_JWT_SECRET`. The frozenset entry protects nothing.
**Fix in Phase 5.**

### D15 — Stripe price ids are placeholders
All 15 seeded plans carry ids like `gi_starter_monthly`. These are not live Stripe ids. Checkout cannot work for a real purchase until they are replaced.
**Fix in Phase 5.**

---

## 3. Decisions

These are settled. Reversing one means revisiting the phases that depend on it.

**DEC-1 — Roles stay a three-value ladder: `owner` > `admin` > `member`.**
No custom roles, no per-resource ACLs. A tenant is a small team; anything richer is speculative. `owner` is unique per tenant and cannot be removed, only transferred.

**DEC-2 — `platform_admin` is a column on `platform.users`, not a table.**
There is one operator today. A boolean `is_platform_admin` plus an audit trail of who toggled it is sufficient and far less code than a role system. Revisit only if staff roles need to differ from each other.

**DEC-3 — The platform admin panel is a route inside the existing console, not a separate app.**
Same auth, same session, same deploy. Gated on the flag, hidden entirely when absent. A separate app would need its own login and its own build.

**DEC-4 — `platform.ai_usage` is the single source of truth for AI cost.** (resolves D8)
`contract_compliance.ai_usage` is legacy and estimated. It will be left in place but marked deprecated, and nothing new reads it. All reporting joins `platform.ai_usage`.

**DEC-5 — Limits are enforced at two points, always: pre-flight and post-flight.**
Pre-flight rejects with 402 before work starts. Post-flight records actual consumption. Token limits cannot be enforced pre-flight exactly (you do not know the token count until the call returns), so the pre-flight check is against *remaining budget* and the post-flight record can overshoot by at most one operation. This is stated explicitly so the overshoot is a known, bounded property and not a surprise.

**DEC-6 — Admin mutations are all audited, append-only, cross-tenant.**
A new `platform.admin_audit` table. Every price change, key rotation, tenant suspension and job cancellation writes a row with actor, before-value, after-value. Secrets record only the fact of a change, never the value.

**DEC-7 — Placeholder proof points are allowed, but only if they cannot ship by accident.** *(revised 2026-09-16)*

Originally this decision said nothing would be invented. The owner has since decided that illustrative figures are wanted now, to be replaced with the client's real numbers once the project is won. That is reasonable for a pitch, and dangerous for a live site, so the decision is not "invent freely" but "invent in one place, behind a switch".

Rules:

1. **One source.** Every claimable number lives in `apps/console/src/content/proof-points.ts`. Nowhere else. No figure is hardcoded into a component.
2. **Each is tagged** `verified` or `placeholder`. There is no third state and no default — a new entry that omits the tag fails to compile.
3. **A placeholder is visible in the UI** whenever the site is not in pitch mode, as a marker on the figure. This is the part that matters: a silent placeholder is indistinguishable from a real number, and the person who forgets to swap it will be us.
4. **Production refuses to build with placeholders** unless `ZEUS_ALLOW_PLACEHOLDER_PROOF=1` is set explicitly. The default is refusal, so the safe outcome is the one that requires no one to remember anything.
5. **Two kinds are still forbidden outright**, pitch or not: named customers and logos we do not have, and regulatory or certification claims (SOC 2, HIPAA, FedRAMP). The first is passing off; the second is a legal exposure, and neither becomes acceptable by being labelled.
6. **Mechanism claims are held to the original standard** — that we score deterministically with visible reasons, cite clauses, and enforce isolation in the database. These are true today, they are the actual differentiators, and they need no asterisk.

The Ads constraint survives intact: unverifiable claims risk disapproval, so before any campaign runs, every `placeholder` must have become `verified` or been removed. Phase 11's exit criteria enforce this.

**DEC-8 — Marketing routes get prerendered HTML; the app stays a SPA.**
`vite-plugin-ssg` style prerender for `/`, `/pricing`, and any future marketing route. The authenticated console does not need indexing and stays client-rendered.

**DEC-9 — Phases ship independently.**
Each phase ends in a deployable state with migrations applied, tests passing, and production verified. No phase leaves a half-built feature behind a flag unless the flag is explicitly part of that phase's exit criteria.

**DEC-10 — Every new limit is nullable-means-unlimited.**
Consistent with the existing `plan_limits` convention. A missing row means unlimited, not zero. This must be asserted in tests, because the opposite default would lock out every existing tenant on deploy.

---

## 4. Phase 1 — Tenant roles, membership, invites

> **Status: DONE, deployed as `cbb6984` on 2026-09-16.** Migration 0014 applied locally and in production; `verify_schema.py` 10/10 on both; 287 tests green; ruff clean; routes live and returning 401 unauthenticated at `/api/core/tenancy/*`. Closed D1, D2, D4, D6.
>
> Two things worth carrying forward. First, the API prefix is **`/api/core`**, not `/api` — `api/index.py` mounts the two services on exact prefixes and everything else falls through to the SPA catch-all, so an unprefixed probe returns the console's HTML with a 200 and looks like a pass. Second, both new test files were run against a deliberately broken build to confirm they fail when the behaviour is removed; a test that has never failed has not been shown to test anything.
>
> Q9 was worked around rather than fixed: invite creation returns the accept link alongside sending it, so an admin can copy it while Resend is still rejecting production sends. The underlying email problem remains open.

**Goal:** A tenant admin can see their team, invite people, assign roles, and remove them. Seats are enforced.

**Blocks:** Phase 3 (the UI has nothing to render without this).

### 4.1 Migration `0014_memberships_and_invites.sql`
- `platform.memberships`: add `created_at`, `updated_at`, `invited_by uuid`. Add a partial unique index guaranteeing exactly one `owner` per tenant.
- New `platform.invites`: `id`, `tenant_id`, `email` (citext or lower-cased), `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `revoked_at`, `created_at`. Unique on `(tenant_id, lower(email))` where not accepted and not revoked.
- **The invite token is stored hashed**, never plaintext — same discipline as email verification codes.
- Seed the missing limit keys (fixes D2): `scans_per_month` and `matches_visible` for all four grant plans. Values to confirm in §13.
- RLS: `invites` is tenant-scoped, so it must be ENABLE + FORCE + policy, or `verify_schema.py` will fail.

### 4.2 Repository layer — `repositories/tenants.py`
Add: `list_members(tenant_id)` (join users for email/name), `update_member_role`, `remove_member`, `count_members`, `transfer_ownership`, plus invite CRUD: `create_invite`, `get_invite_by_hash`, `list_invites`, `revoke_invite`, `accept_invite`.

### 4.3 Service layer — `services/tenancy_service.py`
- `invite_member` — checks caller is admin/owner, checks seat limit against `team_seats` (fixes D4), creates invite, sends email.
- `accept_invite` — validates hash, expiry, not revoked, not already accepted. Binds to the authenticated user's id, **not** to the email in the invite (an invite sent to one address must not be redeemable by someone who merely knows the token and has a different account — match on email, reject mismatch).
- `change_role` — cannot demote the last owner; cannot set a second owner except via `transfer_ownership`.
- `remove_member` — cannot remove the owner; **must delete `membership:{user}:{tenant}` from the cache** (fixes D6).

### 4.4 Authorization — `require_tenant_admin`
New dependency in platform-core security. Reuses `get_membership_role`, requires `owner` or `admin`. Returns **404 not 403** on a foreign tenant, consistent with the existing isolation fix.

### 4.5 Routes — `routers/tenancy.py`
```
GET    /tenancy/members           list (admin)
PATCH  /tenancy/members/{user_id} change role (admin)
DELETE /tenancy/members/{user_id} remove (admin)
POST   /tenancy/members/transfer  transfer ownership (owner only)
GET    /tenancy/invites           list pending (admin)
POST   /tenancy/invites           create + email (admin)
DELETE /tenancy/invites/{id}      revoke (admin)
POST   /tenancy/invites/accept    accept (any authenticated user)
```

### 4.6 Fix D1
Change `grant_service.MODULE_ID` to `grant_intelligence`. **This will activate limits that have been dormant**, so the seeded values in 4.1 must be correct before this ships, or existing tenants hit 402 unexpectedly.

### 4.7 Email
Invite template through the existing `EmailSender`. **Note:** Resend is currently rejecting sends in production (see §13). Invites will not deliver until that is fixed. The invite link must therefore also be copyable from the UI as a fallback.

### Exit criteria
- [ ] Migration 0014 applied locally and to production
- [ ] `verify_schema.py` passes (invites has RLS)
- [ ] Tests: seat limit enforced; last owner cannot be demoted or removed; invite cannot be redeemed by a different email; expired invite rejected; revoked invite rejected; membership cache cleared on removal; non-admin gets 403 on every admin-only route; foreign tenant gets 404
- [ ] D1, D2, D4, D6 closed
- [ ] ruff clean, full suite green

---

## 5. Phase 2 — Usage read path and real cost

**Goal:** A tenant admin sees what their workspace consumed. Cost figures are real, not NULL.

**Depends on:** nothing. **Blocks:** Phase 3 usage view, Phase 7 token limits.

### 5.1 Seed model pricing (fixes D3)
Migration `0015_model_pricing_seed.sql`. Seed current published rates for every model actually in use. **Prices change**; this seed is a starting point, and Phase 5 makes them editable. Record the date the prices were taken from the provider.

### 5.2 Meter Grant Intelligence (fixes D9)
Wire `AiUsageRecorder` into `grant_enrichment.py`. Without this, enrichment spend is invisible and any budget guard is blind to it.

### 5.3 Backfill decision
Existing rows have `cost_usd = NULL` because no price existed. **Decide:** backfill from the new price table, or leave NULL and start clean. Recommendation: backfill, with a note in the migration that pre-backfill rows are reconstructed, not observed. `ai_usage` has UPDATE revoked from `zeus_app`, so the backfill must run as the migration role.

### 5.4 Repository — `repositories/usage.py` (new)
- `tenant_totals(tenant_id, since, until)` — tokens, cost, calls, success rate
- `by_actor(tenant_id, period)` — per-seat attribution (the `ai_usage_tenant_actor_idx` index exists for exactly this)
- `by_module(tenant_id, period)`
- `daily_series(tenant_id, period)` — for a chart
- `platform_totals(period)` and `top_tenants_by_cost(period)` — admin only, cross-tenant

### 5.5 Routes
```
GET /usage/me          tenant totals + series (any member)
GET /usage/by-seat     per-actor (admin only)
```
Cross-tenant endpoints land in Phase 4 under `/admin`.

### 5.6 Cost display honesty
`cost_usd` NULL means "unknown", never zero. The UI must render "—", not "$0.00". A tenant seeing $0.00 for real usage is worse than seeing nothing.

### Exit criteria
- [ ] `model_pricing` seeded; a fresh extraction writes a non-NULL `cost_usd` (verified against the live DB)
- [ ] Grant enrichment writes `ai_usage` rows
- [ ] Tests: cost maths; NULL price → NULL cost not zero; per-actor attribution; period boundaries
- [ ] D3, D9 closed; D8 documented as decided

---

## 6. Phase 3 — Tenant admin UI (Priority 1)

**Goal:** The tenant-facing admin surface. This is your stated priority 1.

**Depends on:** Phases 1 and 2.

### 6.1 Views
- **Team** — member list (name, email, role, joined, last active), role picker, remove, pending invites with revoke and copy-link, invite form with seat counter ("3 of 10 seats used")
- **Usage** — tokens and cost for the period, per-seat table, per-module split, daily chart, plan limits with consumption bars
- **Settings** — workspace name, and the account settings that `/settings` currently fails to render (name, email, password change)

### 6.2 Client
Extend `lib/api.ts` with the tenancy and usage functions. Extend `lib/hooks.ts` with React Query hooks. **Invalidate the member query after any mutation** — a stale member list after a role change is the obvious bug here.

### 6.3 Gating
Nav items appear only for `owner`/`admin`. The role must come from the server (`/tenancy/mine` extended to return the caller's role), never inferred client-side. Client-side gating is cosmetic; the server checks are the real control.

### 6.4 Empty and error states
Single-member team, zero usage, unknown cost, seat limit reached, invite send failure (Resend down — show the copyable link). Each is a real state today.

### Exit criteria
- [ ] All three views render against a live local stack
- [ ] A member (non-admin) cannot see or reach admin views; direct API calls are refused
- [ ] Seat-limit-reached path shows a usable message, not a raw 402
- [ ] `tsc --noEmit` clean, `vite build` clean

---

## 7. Phase 4 — Platform admin identity and foundation

**Goal:** You can actually sign in as platform admin. Every admin action is audited.

**Depends on:** nothing. **Blocks:** Phases 5, 6, 7.

### 7.1 Migration `0016_platform_admin.sql` (fixes D5)
- `platform.users`: add `is_platform_admin boolean NOT NULL DEFAULT false`
- New `platform.admin_audit`: `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`, `created_at`. Append-only — REVOKE UPDATE/DELETE from `zeus_app`. No `tenant_id`, so it is correctly outside RLS.
- **Bootstrap:** grant the flag to one named email. This must be a deliberate, recorded act — a one-off script (`scripts/grant_platform_admin.py`) that requires the email as an argument and writes an audit row, not a migration that hardcodes an address.

### 7.2 Token path
`auth_service` and `session_service` must put `platform_admin` into `roles` when the flag is set. **Critical:** `POST /tenancy/token` must never allow the role to be self-granted — it carries roles forward, so the source must be the DB flag on every mint, not the incoming token.

### 7.3 Security tests (fixes D13)
- Non-admin gets 403 on every `/admin` route
- Token exchange cannot inject `platform_admin`
- A revoked flag takes effect on the next token mint
- Admin routes are absent from the OpenAPI schema for non-admins, or at minimum unusable

### 7.4 Admin audit helper
One function every admin mutation calls. Secrets record `{"changed": true}`, never the value.

### Exit criteria
- [ ] Your account holds the flag in production; `GET /admin/settings` returns 200 for you and 403 for everyone else
- [ ] Every existing `/admin` route writes an audit row
- [ ] D5, D13 closed

---

## 8. Phase 5 — Admin control: tenants, pricing, models, config

**Goal:** Your stated control surface — tenants, models, payment, AI config.

**Depends on:** Phase 4.

### 8.1 Tenant management
```
GET   /admin/tenants                 list: name, owner, members, plans, usage, cost, created
GET   /admin/tenants/{id}            detail: subscriptions, members, usage series, jobs, limits
POST  /admin/tenants/{id}/suspend    status → suspended
POST  /admin/tenants/{id}/activate
PATCH /admin/tenants/{id}/limits     per-tenant limit override
```
**Suspension semantics must be decided and documented:** does a suspended tenant lose API access immediately, or read-only? Immediate lockout needs the entitlement cache invalidated on suspend (5 min TTL otherwise). Recommendation: suspend sets tenant status, entitlement computation treats non-active tenants as granting nothing, and suspend explicitly invalidates the cache.

**Per-tenant overrides** need a new table `platform.tenant_limit_overrides` (`tenant_id`, `limit_key`, `limit_value`, `reason`, `set_by`, `created_at`). Resolution: override → plan limit → unlimited. This is how you give one customer a higher ceiling without inventing a plan.

### 8.2 Pricing and plans (fixes D15)
```
GET    /admin/plans
PATCH  /admin/plans/{id}             name, prices, stripe ids, is_active
PUT    /admin/plans/{id}/limits      limit keys
POST   /admin/plans                  new plan
```
**Guardrails that must exist:**
- Changing a price must not silently re-price existing subscribers — Stripe governs what they pay. The DB price is the *catalogue*. Make this explicit in the UI or you will misprice someone.
- Deactivating a plan must not revoke access for current subscribers.
- A plan with no Stripe price id cannot be offered for checkout (the repo already filters this).
- Price ids must be validated against Stripe before saving, or a typo breaks checkout silently.

### 8.3 Models and AI
```
GET    /admin/models
PUT    /admin/models/{model}         input/output price per million
DELETE /admin/models/{model}
```
Plus extending `MANAGED_KEYS` beyond the current five: LLM timeout, max attempts, chunk chars, max chunks, breaker thresholds.

**Fix D7:** the price cache must gain a TTL and an invalidation hook, or a price edit does not take effect until the serverless instance recycles. Move it into the `Cache` adapter with an explicit prefix and TTL, and delete the key on write.

**Fix D14:** correct `BOOTSTRAP_KEYS` to name `ZEUS_SUPABASE_JWT_SECRET`.

### 8.4 Cache TTL control
Current TTLs are compile-time constants:

| Key | TTL | Where |
|---|---|---|
| `entitlements:` | 300 s | `entitlements_service.py` |
| `membership:` | 60 s | `service-kit/security.py` |
| `cfg:` | 60 s | `runtime_config.py` |
| `oauth:google:` | 600 s | `google_oauth.py` |
| model price | none | `metering.py` |

To make these admin-controlled they must become managed keys read through `RuntimeConfigService`. **Guardrail:** bound every one (e.g. membership 10–300 s). An admin who sets an authorization cache to 24 hours has created a security hole, so the bound is not optional. Also add a "flush cache" action per prefix.

### 8.5 Stripe key rotation
Rotating `stripe_secret_key` while requests are in flight must not break them. The billing provider is built per-container; confirm a key change is picked up, and surface a "test connection" action so a bad key is caught at save time rather than at the next checkout.

### Exit criteria
- [ ] Tenant list, detail, suspend/activate, limit override all work end to end
- [ ] Plan and price edits reflect in `/billing/plans` immediately
- [ ] Model price edit takes effect without a restart (D7 closed)
- [ ] TTL bounds enforced and tested
- [ ] Every mutation audited
- [ ] D7, D14, D15 closed

---

## 9. Phase 6 — Job and queue observability

**Goal:** You can see what is stuck and do something about it.

**Depends on:** Phase 4.

### 9.1 Why this is needed
There is currently **no way to see a job**. No list endpoint, no retry, no cancel. Lease recovery only runs inside `claim_job`, so if nothing claims, an expired lease is never swept (D12). A job can be stuck indefinitely with no observer.

### 9.2 Routes
```
GET  /admin/jobs                  filter: status, module, tenant, kind, age
GET  /admin/jobs/{id}             detail + payload + error + attempts
POST /admin/jobs/{id}/retry       requeue: status→queued, attempts reset or not (decide)
POST /admin/jobs/{id}/cancel      status→cancelled (fixes D10)
GET  /admin/queue/health          depth by module/status, oldest queued age,
                                  expired leases, failure rate, dedupe collisions
```

### 9.3 Reaper (fixes D12)
A sweep that recovers expired leases independent of claims. Options: a scheduled QStash message, or run it on every `/admin/queue/health` call plus a cron. **Decide and document.** Recommendation: a real scheduled sweep, because health endpoints should observe, not mutate.

### 9.4 Heartbeat (fixes D11)
Wire `heartbeat()` and `set_progress()` into the long handlers — enrichment and extraction. Without it a genuinely slow job is reaped mid-flight and retried, doubling spend.

### 9.5 Payload redaction
Job payloads may contain tenant data. The admin job view must redact or gate raw payload display, and viewing one must be audited.

### 9.6 Stuck definition
Make it explicit and consistent across UI and alerts:
- expired lease and still `running`
- `queued` with `run_after` in the past by more than N minutes
- `attempts >= max_attempts` and `failed`

### Exit criteria
- [ ] Job list, detail, retry, cancel work
- [ ] Reaper recovers an expired lease with no claim traffic
- [ ] Heartbeat keeps a long job alive past the lease window (proven with a test)
- [ ] Queue health reports accurate depth against a seeded ledger
- [ ] D10, D11, D12 closed

---

## 10. Phase 7 — Guardrails: tokens, documents, pages

**Goal:** The limits you asked for. None of these exist today.

**Depends on:** Phases 2, 5.

### 10.1 New limit keys
| Key | Meaning | Enforced where |
|---|---|---|
| `tokens_per_month` | AI token ceiling | Pre-flight in extraction and enrichment |
| `ai_cost_per_month_usd` | Spend ceiling | Same |
| `documents_per_month` | Documents processed | Document upload/analyze |
| `pages_per_document` | Page cap per document | Ingestion, before extraction |
| `pages_per_month` | Total pages | Ingestion |
| `storage_mb` | Stored bytes | Upload |

### 10.2 Page counting — must be built
**There is no page concept anywhere in the codebase today.** PDFs give a page count via `pypdf`. DOCX does not have pages in any meaningful sense until rendered. Plain text has none.

**Decision required (§13):** define a "page" as a normalized unit — e.g. PDF actual pages; for DOCX and text, `ceil(chars / 3000)`. Whatever is chosen must be written down and shown to the customer, because they will be billed against it. Store the count on the document row at ingestion.

### 10.3 Enforcement (per DEC-5)
Pre-flight against remaining budget, post-flight recording actual. The token overshoot is bounded by one operation and is a documented property.

Needs a `usage_counters` read path efficient enough for the request path — a monthly aggregate, either a materialized counter table or a cached rollup. **Do not sum `ai_usage` on every request**; it is append-only and will grow without bound.

### 10.4 Warnings before walls
At 80% of a limit, surface a warning in the UI and optionally email. Hitting a hard 402 with no warning is the single most common cause of angry support tickets.

### 10.5 Enterprise plans
The five `*_enterprise` plans have **no limit rows at all**, which under DEC-10 means unlimited. Confirm that is intended.

### Exit criteria
- [ ] Every new key enforced with a test proving both allow and deny
- [ ] Missing limit row → unlimited, proven by test (DEC-10)
- [ ] Counters do not scan `ai_usage` per request
- [ ] 80% warning fires
- [ ] Admin can override per tenant (Phase 5 mechanism)

---

## 11. Phase 8 — Admin UI (Priority 2)

**Goal:** The single pane of glass.

**Depends on:** Phases 4, 5, 6, 7.

### 11.1 Sections
- **Overview** — tenants, signups, active subscriptions, MRR, AI spend today/month, queue depth, stuck jobs, error rate. **Every number must be real** — the legacy admin dashboard hardcoded "operational" service health and defaulted AI success to 100% with no data. Do not repeat that.
- **Tenants** — list, detail, suspend, limit overrides, usage, member list
- **Plans and pricing** — edit prices, limits, Stripe ids, activate/deactivate
- **AI** — models, prices, provider/model selection, chunking, breaker, spend by model
- **Queue** — job list, filters, retry, cancel, health, stuck
- **Config** — managed keys, cache TTLs with bounds, flush actions
- **Prompts** — the existing registry, versions, activate
- **Audit** — the admin audit trail

### 11.2 Destructive action discipline
Suspend, cancel, price change, key rotation: confirmation with the consequence spelled out, and an audit row. No silent destructive actions.

### Exit criteria
- [ ] Every section backed by a real endpoint; no placeholder numbers
- [ ] Non-admin sees no trace of admin routes
- [ ] Every mutation produces an audit entry visible in the audit view

---

## 12. Phase 9-11 — Legacy gap, UX, SEO

### Phase 9 — Legacy features (Priority 3)
The gap is larger than "leftover features". Missing items, by size:

**Whole modules** (weeks each): Proposals (eligibility → interview → draft → compliance review → export); Profile Intelligence (website scrape, resume extraction, content library, strength scoring).

**Large features**: Grant Tracker (pipeline board, calendar, stage history, awards, CSV export); Audit Vault (evidence store, hashing, retention, readiness scoring) — note this is already advertised as `coming_soon` in your module catalogue; Contract financials (budgets, rate cards, invoices).

**Quick wins** (do these first): `/settings` account page; password reset; home dashboard; matches search + geography filter; public pricing page; site footer; obligation Kanban; recurring obligations + reminders; org-wide document centre.

**Do not port** (verified as mock/dead in legacy): client-side "funding scan" that does not scan; hardcoded service-health `operational`; AI success rate defaulting to 100%; Lovable error plumbing and Supabase preview shim; client-side token minting via `crypto.randomUUID` for agency portal access; three competing pricing models.

**Scope: all of it.** *(decided 2026-09-16)* Every legacy module is in scope — Proposals, Profile Intelligence, Grant Tracker, Audit Vault and contract financials. The "do not port" list above is unaffected by this: those items are mock or dead code, so porting them would move the appearance of a feature without the feature.

This makes Phase 9 by far the largest phase, and it will not ship as one release. It is therefore split, and each part ships on its own (DEC-9):

- **9a — Quick wins.** The list above. Small, independent, and several are things a paying tenant would expect to already exist.
- **9b — Grant Tracker.** Pipeline, calendar, stage history, awards, export. Closest to the existing grants module, so it reuses the most.
- **9c — Profile Intelligence.** Scraping, extraction, content library, strength scoring. Feeds matching quality, so it lifts a module we already ship.
- **9d — Proposals.** The largest, and the one that most needs Phase 2's cost metering underneath it, because it is the heaviest AI consumer in the product.
- **9e — Audit Vault.** Evidence store, hashing, retention, readiness. Already advertised as `coming_soon` in the module catalogue, so this one is a promise outstanding.
- **9f — Contract financials.** Budgets, rate cards, invoices.

Ordering is deliberate: cheapest and most visible first, and the two AI-heavy modules after the metering and guardrails from Phases 2 and 7 exist, so they cannot quietly run up unbounded cost.

### Phase 10 — UI/UX
Use the `ui-ux-pro-max` prompt now present at `platform/.github/prompts/ui-ux-pro-max/`. Constraints: keep the existing Zeus tokens (Tailwind v4 oklch, Figtree); enterprise density, not consumer marketing; every state designed (loading, empty, error, locked, over-limit); accessibility — focus states, contrast, keyboard paths, `prefers-reduced-motion`.

### Phase 11 — Landing copy and SEO

**Copy.** Structure: a specific claim, the mechanism, then proof. The reason the current page reads as "AI-generated" is that it is all adjective and no mechanism — it asserts outcomes without ever saying how. Replace hedged phrasing with concrete nouns and numbers: catalogue size, deterministic scoring with visible reasons, clause-level citations, database-enforced isolation. Those are true today and read as confident rather than salesy.

Illustrative figures are permitted under the revised DEC-7, from `proof-points.ts`, tagged `placeholder`, visibly marked outside pitch mode. Before any Ads campaign runs, every placeholder must be verified or removed — see the exit criteria.

**SEO — the term you were reaching for is prerendering / SSG, plus structured data.** A SPA serves one empty `index.html`; crawlers and the Ads landing-page checker see nothing.

Required:
- Prerender `/` and `/pricing` to real HTML (DEC-8)
- Per-route `<title>`, meta description, canonical
- Open Graph + Twitter card, with a real OG image
- `sitemap.xml`, and review the existing `robots.txt`
- JSON-LD: `Organization`, `SoftwareApplication`, `FAQPage`
- Core Web Vitals — LCP, CLS, INP measured, not assumed
- Google Search Console verification

**Google Ads readiness** (separate from SEO):
- Conversion tracking (signup, checkout) with a real conversion action
- **Consent Mode v2** — required for EEA traffic
- Privacy policy and terms pages — Ads will not approve without them
- Landing page relevance: ad copy, headline and page must agree
- **Zero `placeholder` proof points remaining.** This is a hard gate, not a preference. Running ads against invented figures is the one version of DEC-7 that carries real consequences — Ads disapproval at best, a misrepresentation claim at worst. The build check exists so this cannot be forgotten; before a campaign it must also be confirmed by eye.

---

## 13. Open questions — these block work

| # | Question | Blocks |
|---|---|---|
| ~~Q1~~ | ~~Landing page proof points.~~ **Answered 2026-09-16:** invent illustrative figures for now, swap for the client's real data once the project is won. Implemented under the revised DEC-7 — single source, tagged, visibly marked, build refuses to ship them to production by default. Named customers, logos and compliance certifications remain forbidden. | ~~Phase 11~~ |
| ~~Q2~~ | ~~Legacy scope.~~ **Answered 2026-09-16:** all modules in scope. Phase 9 split into 9a–9f, ordered cheapest-and-most-visible first, with the AI-heavy modules deferred until metering (Phase 2) and guardrails (Phase 7) exist. | ~~Phase 9~~ |
| ~~Q3~~ | ~~Grant limit values.~~ **Answered 2026-09-16 by assumption:** seeded at the values the hardcoded fallbacks already used, so no existing tenant's behaviour changed. Those fallbacks are **3 scans and 25 matches** — the 4 and 50 previously recorded here were wrong. Seeded in migration 0014 as scans 3/10/30/100 and matches 25/100/unlimited/unlimited. Revisit when pricing is set commercially. | ~~Phase 1~~ |
| Q4 | Page definition — how is a page counted for DOCX and plain text? Proposal: `ceil(chars / 3000)`. | Phase 7 |
| Q5 | Suspension semantics — hard lockout or read-only? | Phase 5 |
| Q6 | Retry semantics — does an admin retry reset `attempts` to 0 or continue the count? | Phase 6 |
| Q7 | Enterprise plans have no limit rows, so unlimited. Intended? | Phase 7 |
| Q8 | `ai_usage` cost backfill — reconstruct historical cost, or start clean? | Phase 2 |
| Q9 | Resend is rejecting production sends. Fix now? Invites and password reset both depend on email. | Phase 1 |
| Q10 | Grants.gov catalogue — production has 0 opportunities. Load it? | Any demo |

---

## 14. Operational rules for this repo

**Traps that have already cost time. Do not rediscover these.**

- **Heredocs mangle this terminal.** Use `create_file` then `git commit -F <file>`. Avoid embedded quotes in long `python -c` strings.
- Run Python as `unset PYTHONPATH && .venv/bin/python ...` from `platform/`.
- The four-tree `PYTHONPATH` is required for workspace imports: `packages/config/src:packages/adapters/src:packages/service-kit/src:services/platform-core/src:services/contract-compliance/src`.
- **Test RLS as `zeus_app`, never `zeus`.** `zeus` is a superuser and bypasses RLS; production uses `zeus_app`, which is `NOBYPASSRLS`. A strict policy that passes as `zeus` broke signup as `zeus_app`.
- Postgres does not guarantee `OR` short-circuits — use `nullif()` before casting `current_setting`.
- Local migrations: `docker compose run --rm migrate`. Production: `scripts/migrate.py`, **session pooler `:5432` only** (`:6543` is refused — the transaction pooler cannot run DDL).
- Deploy applies migrations automatically via the `ZEUS_MIGRATE_URL` secret on the `production` environment.
- Root `src/` is the **legacy Lovable app, reference only**. The product is `platform/`.
- `platform/ponytail/`, `platform/graphify/` and `platform/.github/prompts/ui-ux-pro-max/` are tooling, not product. They sit inside the Vercel build root and should be excluded via `.vercelignore`.
- Real endpoint paths: `/entitlements/me`, `/tenancy/mine`.
- Schema names: `memberships`, `user_credentials`, `user_identities`. There is no `tenant_users`.
- DB adapter methods: `fetch`, `fetch_one`, `execute`. There is no `fetch_all`.
- QStash and Redis are already provisioned in production.

**Definition of done for every phase**
1. Migration applied locally, `verify_schema.py` passes
2. Tests written before the fix where the bug is provable; run `git stash` to confirm they fail without it
3. ruff clean, `tsc --noEmit` clean, `vite build` clean
4. Migration applied to production via the deploy pipeline
5. Verified live against production with a probe script, not by assumption
6. Any new tenant-scoped table has RLS enabled, forced, and a policy
