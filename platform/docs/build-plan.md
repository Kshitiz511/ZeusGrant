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

### D5 — No path to `platform_admin` — **CLOSED (Phase 4, `0748d2c`)**
`routers/admin.py` guards on `"platform_admin" in session.roles`. Roles come from the JWT. The only issuer is the **dev-only** token router. There is no table, no flag, no bootstrap. **The admin API is unreachable in production.**
**Fixed in Phase 4.** `platform.users.is_platform_admin` (migration 0016), read from the database on every token mint, granted by `scripts/grant_platform_admin.py`. Held in production by `beboyshitij@gmail.com` since 2026-09-16.

### D6 — Membership cache has no invalidation hook
`membership:{user}:{tenant}` has a 60 s TTL and no explicit delete. Removing a member leaves them with access for up to 60 s.
**Fix in Phase 1** (delete the key on role change and removal).

### D7 — Model price cache has no TTL and no invalidation — **CLOSED (Phase 5b)**
`AiUsageRecorder._prices` is a plain in-process dict on a `@cached_property` container. A price edit is only picked up on process restart. On serverless that is "whenever the instance recycles" — unpredictable, and different per instance, so two identical calls could be costed differently at the same moment.
**Fixed in Phase 5b.** The memo is gone. `price_for` now reads through the shared `Cache` under the `modelprice:` prefix with a 900 s TTL, and `PUT`/`DELETE /admin/models/{model}` delete the key on write, so an edit is visible to every instance at once. A model with no price is cached as an explicit `none` sentinel rather than a miss, so an unpriced model does not pay for a round trip on every call. A corrupt cache entry is treated as a miss and logged, never as an error — a malformed cache value must not be able to fail a model call that has already been paid for. Where no cache is configured the recorder deliberately reads through on every call: one indexed lookup against a tiny table is slower and always right, which is the trade the old dict got backwards.
Verified by removing the `cache.delete` in `break_test_phase5.py` and watching the test fail.

### D8 — Two divergent `ai_usage` tables
`platform.ai_usage` (real tokens, `cost_usd`, append-only) and `contract_compliance.ai_usage` (estimated tokens, no cost, FORCE RLS). Reporting off the wrong one gives wrong numbers.
**Decide in Phase 2.** Decision recorded in §3.

### D9 — Grant Intelligence records no AI usage
`grep ai_usage services/platform-core/src` → zero matches. Only contract-compliance meters. Enrichment uses an LLM and is unmetered, so spend is invisible.
**Fix in Phase 2.**

### D10 — `cancelled` job status is unreachable — **CLOSED (Phase 6)**
It is in the CHECK constraint; nothing writes it.
**Fixed in Phase 6.** `platform.cancel_job` is the writer. Cancelling clears the lease as well as setting the status, which is what makes it bite: `heartbeat_job` requires `status = 'running'`, so the handler's next heartbeat is rejected, `ctx.progress` raises `JobLost`, and the worker abandons the job without consuming a retry. A cancel that only relabelled the row would leave an expensive handler running and still spending, which is the opposite of what the operator asked for.

### D11 — `heartbeat_job` and progress columns are dead — **LARGELY FALSE; the real defect was worse (Phase 6)**
The original claim was that `heartbeat()` and `set_progress()` have zero call sites. Reading the code showed otherwise: `set_progress()` never existed (heartbeat *is* the progress setter), and `heartbeat()` is called from two places — `ctx.progress`, used by grant ingest, rescore fan-out and enrichment, and a background keepalive the worker runs for every job.

The wiring was there. **It had never worked.** See D20. The lesson recorded: this entry was written from the schema and a grep, not from reading the call path, and it sent Phase 6 looking for missing code instead of broken code.
The one genuine gap — contract-compliance's LLM extraction handler never reporting progress — is now closed, which also makes that job cancellable.

### D12 — Lease recovery only runs inside `claim_job` — **CLOSED (Phase 6)**
There is no reaper. If nothing claims, expired leases are never swept, and a stuck job stays "running" forever with no observer.
**Fixed in Phase 6.** `platform.reap_expired_leases` is extracted from inside `claim_job` rather than duplicated — two copies that drifted would recover jobs differently depending on which path found them. `claim_job` now calls it, so recovery stays prompt on the path about to pick up work, and `POST /admin/jobs/reap` runs it for the case the inline sweep cannot reach: no worker is claiming, so nothing triggers the sweep. Bounded per call so one sweep cannot become an unbounded UPDATE holding locks while the queue stalls behind it.

### D19 — retry backoff was applied twice — **CLOSED (Phase 6)**
The worker computes `min(60 * 2^(attempts-1), 3600)` and passes it to `finish_job`, which multiplied it *again* by `power(2, attempts - 1)` with no ceiling of its own. Attempt 2 waited 240s instead of the intended 120s, and the error compounded without bound as `max_attempts` rose.
It survived because `max_attempts` is 3, so the visible damage was one wrong delay. Fixed now because Phase 6 puts "next retry at" in front of an operator, and a displayed time wrong by a growing multiple is worse than no time at all. The delay is used as given: the caller owns the policy, the function records the decision. A second multiplier also made the delay depend on who called it, so an operator retry would have been silently rescaled by an attempt count they had just reset.

### D20 — `heartbeat()` raised on every call, so no lease was ever extended — **CLOSED (Phase 6)**
`JobRepository.heartbeat` read `bool(row or {}).get("ok", False)` — `bool(...)` evaluates first, so `.get` was called on a boolean and every invocation raised `AttributeError`.

**It had never worked, in any environment.** Two things hid it. The worker's background keepalive wraps the call in `except Exception: log.warning(...); continue`, so the failure appeared as a log line on a path nobody reads. And no test ever called `heartbeat` with a database that returned a row — the SQL smoke test exercised the *function*, not the Python wrapper.

The consequences were real: no lease was ever renewed, so any handler running longer than the five-minute lease was reaped and retried mid-flight — doubling spend on exactly the expensive jobs the heartbeat exists to protect — and any handler calling `ctx.progress` failed outright at its first checkpoint. It was found by writing a test for cancel semantics, which needed a working heartbeat to assert against.

**Fixed** by reading the row before coercing, and covered by two regression tests: one asserting a true result, one asserting the `NULL` a non-match produces is read as a lost lease rather than truthy.

### D21 — `migrate.py` defaulted to production — **CLOSED (Phase 6)**
The script resolved `ZEUS_MIGRATE_URL` from `.env.production.local` when nothing else was set, so the shortest command in the file — the one typed while developing — ran DDL against the live database. Migration 0018 reached production hours before its code did, during Phase 6.

No harm done: `platform.jobs` held zero rows, nothing deployed called the new functions, and the two replaced functions were signature- and behaviour-compatible with the running worker. One function had landed with a signature later revised, and production was corrected to match the file its ledger claimed. That the blast radius was nil was luck, not design.

**This is D17 repeating.** D17 put a local-only guard on the e2e scripts after a probe created real users in production. The guard was never extended to the one script whose entire purpose is to change the schema — the most dangerous tool in the repository had the least protection and the shortest command.
**Fixed.** The default target is local. Production requires `--production` *and* typing the hostname back; `--yes` exists only for CI. The host is printed before anything runs.

### D22 — enterprise plans were billed unlimited and served the free tier — **CLOSED (Phase 7)**
`GrantService._limit()` ended `return default if value is None else int(value)`. Its comment argued that a missing limit is a configuration gap and the safe reading of a gap is the free tier. That is a reasonable instinct and it was wrong here, because DEC-10 had already given the absence a meaning: **unlimited**. The seed data relies on it — every one of the five `*_enterprise` plans ships with **zero** `plan_limits` rows, verified against the live catalogue.

So the most expensive plans on the price list resolved to `DEFAULT_SCANS_PER_MONTH = 3` and `DEFAULT_MATCHES_VISIBLE = 25`: an enterprise tenant got three scans a month, saw 25 of their 312 matches, and was shown the *upgrade* banner, because `truncated` was computed against the free-tier number. Nothing errored. Nothing logged. The customer simply received less than they paid for, and the only symptom would have been a support ticket.

Contract Compliance read the identical condition correctly — `if limit is None: return` — from the same claims. **Two modules, the same data, opposite answers, neither aware of the other.** That is the part worth remembering: the defect was not a typo, it was two people independently guessing what an absent row meant.

The root cause is that `EntitlementClaims.limit()` returns `None` for two opposite situations — "the plan says unlimited" and "this tenant has no entitlement for this module" — so no caller reading it can distinguish them, and every caller must guess.

**Fixed.** `EntitlementClaims.limit_ceiling(module_id, key, *, fallback)` makes the three answers distinct: `None` unlimited, `int` a ceiling, `fallback` only when the module entitlement is missing or inactive. `_limit()` returns `int | None`; `scan_usage`, `request_scan` and `list_matches` handle unlimited. `visible_limit`/`limit`/`remaining` are now nullable across the API and the console renders "Unlimited" rather than coercing to `0` and greying out the button. An unlimited match window still pages to `UNLIMITED_MATCHES_WINDOW = 10_000` — unlimited is an entitlement, not permission to run an unbounded query.

Fallback is kept for the entitlement-missing case rather than raising: a limit check is the wrong place to discover an authorisation problem — the route's entitlement guard is — but if that guard is ever bypassed, the free-tier number is the safe thing to be left holding.

`tests/test_grant_limits.py` (19 tests) pins all three cases on both scans and matches. Verified by restoring the old semantics: **7 fail**.

**Answers §10.5's open question.** Zero limit rows on enterprise *was* intended. The bug was the reader, not the data.

### D23 — operational scripts silently targeted production — **CLOSED (Phase 7)**
`verify_schema.py` resolved its DSN by reading `.env.production.local` unconditionally and printed no host. Running it during Phase 7 reported "migration ledger 23/24, 1 unapplied" while the local database was fully migrated — it had been describing **production** all along, and the discrepancy was the only reason anyone noticed.

Read-only, so nothing broke. But eleven other scripts resolve a DSN the same way, two of them write: `backfill_trials.py` and `provision_db_role.py`.

**This is D21 repeating, which was itself D17 repeating.** Each time the guard was applied to the single script that had just caused a problem, and never to the class. D17 guarded the e2e probes. D21 guarded `migrate.py`. Neither guarded the other ten.

**Fixed by building the guard once.** `scripts/_dsn.py` provides `resolve_dsn(production=...)`, `confirm_production()` and `require_local()`: local by default, production behind an explicit flag, the host **printed to stderr** before anything runs — stderr specifically, because these scripts are routinely piped through `tail`, and a banner on stdout is exactly the banner that scrolled away when 0018 reached production. `verify_schema.py` now takes `--production` and reports 10/10 local, 23/24 production, each saying which it read.

**The first attempt broke CI**, which was the useful part. The new resolver read the env file before the environment, so CI's exported `ZEUS_MIGRATE_URL` — pointing at its ephemeral Postgres — was ignored and the run fell through to `localhost:5433`. Split into `env_dsn()` and `file_dsn()`, an exported DSN winning over everything, and the banner now names its source as well as its host. A guard that resolves differently from the thing it is guarding is not a guard.

**Then applied to the class, not the instance** — the whole point of the entry. All eleven remaining scripts now resolve through `_dsn.py`. They divided into two kinds, and the distinction matters:

- Scripts that *could* target either database take `resolve_dsn(production=...)`: local unless asked.
- Scripts whose *purpose* is production — provisioning the runtime role, auditing live RLS, checking live connectivity — take `required_dsn()` / `announce()`. A flag would be noise; what they need is to say out loud what they are touching.

The two that **write** got both: `provision_db_role.py` and `backfill_trials.py` announce and then call `confirm_production()` before rotating a password or creating subscriptions. `audit_rls.py` deliberately connects as the runtime role rather than the owner — an owner bypasses the very policies the script exists to audit, so it would have reported success no matter what the policies said.

**The banner immediately found the mirror-image fault.** `who_is_in_prod.py` — a script named for production — reported on `localhost:5433`, because a shell had `ZEUS_DATABASE_URL` exported to local. Harmless, read-only, and invisible for as long as it had existed. Env-wins is still correct (CI depends on it); what was missing was ever saying so. Both directions now verified: unset, it reaches `aws-0-us-east-2.pooler.supabase.com:6543` and prints `PRODUCTION`; exported, it reaches local and prints `local`.

### D13 — No admin authorization tests — **CLOSED (Phase 4, `0748d2c`)**
Zero tests assert that a non-admin gets 403 from admin routes, or that `platform_admin` cannot be self-granted via token exchange.
**Fixed in Phase 4.** `tests/test_platform_admin.py` (25 tests) covers both, parametrised over every admin route, plus a structural test asserting the parametrised list matches the router's registered routes so a new endpoint cannot escape it. Verified by breaking both guarantees and watching the tests fail.

### D14 — `ZEUS_JWT_SECRET` is in `BOOTSTRAP_ENV_VARS` but is not a settings field — **CLOSED (Phase 5a)**
The real field is `ZEUS_SUPABASE_JWT_SECRET`. The frozenset entry protected nothing.
**Fixed in Phase 5a.** Name corrected in `services/runtime_config.py`. The test that covered this was itself part of the problem: it asserted three hand-written names were absent from `MANAGED_KEYS`, which a name that exists nowhere trivially satisfies. Replaced with two tests — one asserting `MANAGED_KEYS` and `BOOTSTRAP_ENV_VARS` are disjoint as whole sets, and one walking the `Settings` model classes to assert every bootstrap name is a real alias. The second is the one that would have caught D14. Verified by reinstating the old name and watching it fail.

### D16 — `platform.tenants` and `platform.users` have no RLS — **OPEN (found Phase 5a)**
Every table carrying a `tenant_id` column is row-isolated in the database. `tenants` and `users` are not: they are keyed by `id`, so the standard policy predicate does not apply, and token exchange and signup must read them before any tenant is bound. Isolation for those two is therefore an application-layer property only — a query bug in a tenant-scoped path could enumerate all tenants, and the database would not stop it.
Not a live exploit: no tenant-scoped route currently reads them unfiltered. Recorded rather than fixed because adding RLS here touches auth and signup, which is not a change to make in passing.
`scripts/probe_phase5_tenants.py` asserts the gap as it stands, so if someone adds RLS the probe fails and forces this entry to be updated instead of silently going stale.
**Fix in Phase 7 (guardrails).**

### D17 — e2e scripts could write to production — **CLOSED (Phase 5a)**
The e2e scripts create accounts, grant platform-admin rights and suspend tenants. They took their target from `ZEUS_DATABASE_URL` and the API from `API`, with no check on either. During Phase 5a a shell had `ZEUS_DATABASE_URL` exported to Supabase; a locally-launched uvicorn inherited it and a probe signup created a real user and tenant **in production** before failing on the not-yet-deployed migration. Rows were removed.
**Fixed in Phase 5a.** Both `e2e_tenant_suspension.py` and `e2e_platform_admin.py` now refuse to start unless the DSN host and the API host are local. Verified by running with the production DSN still exported and watching the refusal.

### D15 — Stripe price ids are placeholders — **PARTIALLY CLOSED (Phase 5b)**
All 15 seeded plans carry ids like `gi_starter_monthly`. These are not live Stripe ids. Checkout cannot work for a real purchase until they are replaced.
**Phase 5b supplied the means, not the data.** `PATCH /admin/plans/{id}` can now set the real ids, and `_validate_price_ids` checks each one against Stripe on save — reporting an id Stripe does not recognise, an archived price, an amount that disagrees with the catalogue figure, or a billing interval that does not match the column it was put in.
Validation **warns rather than refuses**, deliberately. A hard check would make the catalogue uneditable while the placeholders are still in place (the exact state this defect describes), and would block edits whenever Stripe is unreachable or unconfigured. Reporting loudly and saving anyway keeps the operator in control while making a typo impossible to miss.
The remaining work is data entry against a real Stripe account, which cannot be done from here. `GET /admin/plans` returns `unsellable_active_plans` so the outstanding set is visible on the screen rather than having to be inferred from a storefront that silently drops them.

### D18 — settings never refreshed on a warm instance — **CLOSED (Phase 5c)**
Found while investigating why a rotated Stripe key did not take effect (§8.5). `Container.effective_settings()` merges the managed overrides over the environment and carries `SETTINGS_REFRESH_SECONDS = 60.0`, documented as a sixty-second refresh. It was called from exactly one place: `Container.startup()`. Nothing on the request path ever called it, so the refresh interval was unreachable and the merged settings were frozen at boot for the life of the instance.

The scope was much wider than the Stripe symptom that exposed it. **Every managed key was affected** — an admin changing any setting saw it written to the database and returned by `GET /admin/settings`, while the running code went on using the boot-time value until the instance happened to recycle. The admin API appeared to work, which is why it survived Phases 5a and 5b.

**Fixed** with an HTTP middleware in `app.py` that awaits `effective_settings()` per request; the existing interval and the `cfg:` cache mean the actual database reads stay at roughly one per key per minute. Verified by a test that changes a setting mid-flight and asserts the next request observes it, and in the break-test by disabling the middleware and confirming that test fails.

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
Consistent with the existing `plan_limits` convention. A missing row means unlimited, not zero. This must be asserted in tests, because the opposite default would lock out every existing tenant on deploy. *Violated in Grant Intelligence from the start — see D22, closed Phase 7.*

**DEC-11 — A page is what the customer would call a page. (Answers Q4.)**
Decided by the owner, 2026-09-18, and implemented in `documents.py`:

| Upload | Page count |
|---|---|
| PDF | The pages in the file. The format stores them; we count them. |
| DOCX | The pages the author marked — `lastRenderedPageBreak` if Word recorded one, otherwise manual breaks, plus one. |
| Anything else, or DOCX with no breaks | `ceil(chars / 3000)` |

Two asymmetries are deliberate and were each found by a test rather than by reasoning:

* **A PDF's count is the truth and the estimate must never override it.** Taking the larger of count and estimate — which is right for DOCX — billed a dense but genuinely 3-page contract as **14 pages**, because 40k tightly-set characters divided by 3000 says 14.
* **A DOCX's count is a floor, not the truth.** Word stores no page count; it paginates at render time against the installed fonts, paper size and printer driver, so the same file is honestly 11 pages on one machine and 12 on another. python-docx cannot render. Most real documents contain no manual breaks at all, so counting breaks alone would bill a 40-page report as **one page**. Hence: larger of the break count and the estimate.

Pages beyond `MAX_PDF_PAGES` are not extracted, not analysed, and not billed. `ExtractedDocument` carries `page_basis` (`"counted"` / `"estimated"`) so an invoice line can be explained to a customer rather than merely asserted. 3000 chars ≈ 500 words of dense contract prose at 12pt on US Letter; it is an estimate and is named as one wherever a customer sees it.

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

> **Status: DONE 2026-09-16.** Migration 0015 applied locally. 303 tests green, ruff clean, and `scripts/probe_usage.py` passes 15/15 against a real database as `zeus_app`. Closed D3, D9; D8 and Q8 resolved below.
>
> **Two traps found while building this, both of which would have silently produced wrong numbers.**
>
> *Model names disagreed.* Contract extraction recorded `gpt-5-mini`; grant enrichment recorded `openai:gpt-5-mini` (it builds the name as `f"{provider}:{model}"`). `model_pricing` is keyed on the unqualified name, so every enrichment row would have missed the price table and grouped separately in every rollup. `normalise_model()` in `metering.py` now strips the prefix once, before both lookup and insert. Any future caller inherits this; nobody has to remember the convention.
>
> *Enrichment has no tenant.* It reads prose for the **shared** opportunity catalogue — every tenant benefits from the same enriched record, and the job carries no tenant context. `ai_usage.tenant_id` was `NOT NULL`, so metering it at all required a decision. Attributing it to whoever triggered the batch would put shared infrastructure cost on one customer's usage page, which is wrong on their screen and wrong in any budget guard built on it. 0015 drops `NOT NULL`; **NULL now means "platform-wide, attributable to no tenant"**. Tenant queries filter on an explicit tenant id and so exclude these by construction.
>
> **Q8 answered by measurement, not judgement:** production has **zero** rows in both `platform.ai_usage` and `contract_compliance.ai_usage`. There is nothing to backfill. The question was moot.
>
> **D8 resolved as already-decided:** `contract_compliance.ai_usage` was consciously superseded — its own container comments say so — because it stored a character-count estimate with no output tokens and no cost, and being module-scoped it could not answer the owner's cross-tenant question. `AiUsageRepository` and `summary_for_tenant` are dead code with no callers. Left in place for now; removal belongs in a cleanup commit, not one that also changes billing behaviour.
>
> **Prices were seeded from the provider's published list on 2026-09-16**, recorded with that date. Cached-input rates are deliberately **not** modelled: we do not read cache-hit counts back from the provider, and a discount we cannot measure would understate real cost. Over-reporting is the safe direction for a budget guard. `ON CONFLICT DO NOTHING`, so re-running migrations cannot revert a price the owner later edits.
>
> Note `/usage/me` is unrelated to the pre-existing `/grants/usage`, which reports *scan quota* rather than money. Similar names, different questions.

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
- [ ] All three views render against a live local stack — **not done.** Verified by
      typecheck, production build, and a string check of the deployed bundle, but not
      by signing in and looking at them. Do this before relying on the screens.
- [x] A member (non-admin) cannot see or reach admin views; direct API calls are refused
      — server side covered by `test_tenancy_routes.py` and `test_usage.py`; nav hiding
      is cosmetic and gated on `useIsTenantAdmin`
- [x] Seat-limit-reached path shows a usable message, not a raw 402
- [x] `tsc --noEmit` clean, `vite build` clean

### DONE — commit `9d2ec86`, deployed and verified in production

**Shipped:** `TeamView.tsx`, `UsageView.tsx`, `SettingsView.tsx`; nav in `AppShell.tsx`
gated on `useIsTenantAdmin`; routes in `App.tsx` replacing the `/settings` fallthrough;
`lib/types.ts`, `lib/api.ts`, `lib/hooks.ts`, `lib/format.ts` extended.

**Verified:** 303 tests pass, ruff clean, `vite build` clean, CI and Deploy both green,
and the deployed bundle was checked by string match for the new views rather than
trusted on the deploy badge alone.

**Two findings worth carrying forward:**

1. *TypeScript checking a component against my own hand-written types proves nothing
   about the server.* The usage views were written against a guessed shape — `daily`,
   `input_tokens`, a wrapped `by_actor` — and compiled clean, because the error was in
   the types too. It only surfaced when the response models were read directly. Console
   types are now confirmed field-for-field against `routers/usage.py` and
   `routers/tenancy.py`, and every request path against the router decorators. Do this
   check for every future phase that adds endpoints; the compiler will not do it.

2. *`git add -A platform` committed the vendored reference checkouts* (`graphify`,
   `ponytail`, `ui-ux-pro-max-skill`) as mode-160000 gitlinks that no clone could
   resolve. Caught before push, commit reset, and the paths are now in
   `platform/.gitignore` so it cannot recur. They were already excluded from pytest
   `testpaths` and ruff, but being ignored by tooling is not the same as being ignored
   by git.

**Knowingly not built** (deferred, not forgotten):
- "Last active" per member — no column records it; adding one is a migration, and
  nothing yet needs it.
- Plan-limit consumption bars on Usage — plan limits are about scan quota
  (`GET /grants/usage`), a different question from spend. Mixing the two on one screen
  invites reading a token cost as a quota. Revisit with Phase 7 (guardrails).
- Password change in Settings — blocked by Q9 (Resend rejects production sends). The
  view says so plainly rather than offering a form that would strand the user.

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
- [x] Your account holds the flag in production — `beboyshitij@gmail.com`, granted
      2026-09-16, audited. Unauthenticated `/admin/*` returns 401 in production; a
      non-admin gets 403 (covered by tests). **Not yet confirmed by signing in** — no
      admin UI exists to sign into until Phase 8; the flow is proven end-to-end locally.
- [x] Every existing `/admin` route writes an audit row — enforced by a structural test
      that compares the guard list against the router's registered routes, so a new
      endpoint cannot be added and silently escape it
- [x] D5, D13 closed

### DONE — commits `0748d2c` + `8d815ae`, deployed and verified in production

**Shipped:** migration `0016_platform_admin.sql`; `repositories/audit.py`;
`repositories/tenants.py` (`is_platform_admin`, `set_platform_admin`,
`list_platform_admins`); `routers/admin.py` (audit on every mutation, plus
`GET /admin/audit`); `routers/tenancy.py` and `services/auth_service.py` (token mint);
`domain/models.py` (`PLATFORM_ADMIN_ROLE`); `tests/test_platform_admin.py` (25);
`scripts/grant_platform_admin.py`, `scripts/probe_platform_admin.py`,
`scripts/e2e_platform_admin.py`.

**The security property, stated precisely.** `POST /tenancy/token` returns a *more*
privileged token than it consumes. It previously merged `session.roles` forward, so a
token claiming `platform_admin` would have been believed, and anyone who ever held the
role would have kept it permanently. Roles are now rebuilt from authoritative sources on
every mint — membership from `platform.memberships`, the platform flag from
`platform.users`. The same change is what makes a revoke meaningful: it takes effect at
the next mint rather than whenever an outstanding token expires.

**Append-only is a database privilege, not a convention.** `zeus_app` holds INSERT and
SELECT on `admin_audit`; UPDATE and DELETE are revoked. The REVOKE is load-bearing, not
belt-and-braces: `provision_db_role` sets `ALTER DEFAULT PRIVILEGES` granting UPDATE and
DELETE on future tables in this schema, so without it the table would have arrived
quietly editable. Verified against real Postgres as `zeus_app` — 14/14 locally and 14/14
in production.

**Why the bootstrap is a script.** An endpoint that creates platform admins must itself
be guarded by platform admin. The usual escapes from that circle — a hardcoded email in a
migration, a setup route open until first use, an env var read at startup — each create a
path to the highest privilege in the system that is not a deliberate recorded act. The
script audits its own first grant; a trail with a gap at the beginning cannot answer the
most interesting question about itself.

**Three findings:**

1. *The end-to-end probe caught a defect the unit tests did not.* Audit rows were written
   with `actor_email` NULL, because first-party tokens carry only a subject and roles and
   `Session.email` is None for them. It matters most in the case the schema was designed
   for: `actor_user_id` is set to NULL when an account is deleted, leaving the flat email
   as the only identification. Now read from the database, with a unit test.

2. *A test that passed locally and failed in CI.* It set `llm.openai_api_key`, a secret,
   which needs a SecretBox built from `ZEUS_SECRETS_ENCRYPTION_KEY` — set in my shell, not
   in CI. It now uses a non-secret key, which is the stronger assertion anyway since
   `put_setting` redacts unconditionally. **Rule going forward:** verify with the
   environment stripped (`env -i`), not by rerunning in the shell where it already passed.

3. *Both guarantees were confirmed by breaking them.* Reinstating the carry-forward failed
   the two forgery tests; deleting one `_audit` call failed the audit test.

**Knowingly not built:**
- Hiding admin routes from the OpenAPI schema for non-admins. They are unusable without
  the role, and a schema that varies by caller makes the API harder to reason about for
  no security gain — the guard is the control, not the concealment.
- A general role/permission system. There is one platform-wide privilege and no second
  use case yet; a boolean that is trivially auditable beats a framework whose first real
  use is a single row.
- Audit retention and pruning. Nothing can delete rows today, by design. Revisit when
  volume justifies it, as an owner-role job rather than an application capability.

---

## 8. Phase 5 — Admin control: tenants, pricing, models, config

**Goal:** Your stated control surface — tenants, models, payment, AI config.

**Depends on:** Phase 4.

### 8.1 Tenant management — **DONE (Phase 5a)**

Shipped routes (all under `AdminDep`, all mutations audited):
```
GET    /admin/tenants                          list + total, filter by status, search name/slug/owner email
GET    /admin/tenants/{id}                     members, subscriptions, overrides, freshly computed entitlements
POST   /admin/tenants/{id}/status              {status: active|suspended, reason}
GET    /admin/tenants/{id}/limits              current overrides + the keys that may be overridden
PUT    /admin/tenants/{id}/limits/{limit_key}  {limit_value, reason}
DELETE /admin/tenants/{id}/limits/{limit_key}
```
One status route rather than separate `/suspend` and `/activate`: the two differ only in the value written, and a single route means the audit row records the transition (`before`/`after`) rather than just the fact a button was pressed.

`deleted` is a valid value of the column but is **not** accepted by the route. Deletion has to deal with retention and Stripe cancellation; a status flip that merely looks like a delete is worse than having no delete.

**Suspension semantics — DECIDED (answers Q5).** Suspension is immediate for new work and does not touch work already running.
- `compute_claims` returns an empty snapshot for any non-active tenant. The check lives in the pure function rather than at each call site, so it holds everywhere entitlements are read — including from guards written later by someone who never read that file.
- The route invalidates *and* recomputes the entitlement cache. Without that the 300s TTL means a suspended tenant keeps working for up to five minutes and the operator concludes the button is broken.
- `get_membership_role` already refused to mint a tenant token for a non-active tenant, so token exchange was a second, pre-existing enforcement point.
- **Queued jobs run to completion.** The worker authenticates by shared secret and claims work from its own ledger; it never consults entitlements. A customer who submitted work while in good standing gets the result, and tearing down half-finished work leaves documents in a state nobody can explain. This is a decision, not an oversight — `test_tenant_suspension.py` has a characterisation test that fails if the worker ever starts reading entitlements, so reversing the policy has to be deliberate.
- Suspension never touches subscriptions. It is an access decision, not a billing one, so reactivating restores exactly what the tenant had.

**Per-tenant overrides.** Migration `0017_tenant_limit_overrides.sql`: PK `(tenant_id, limit_key)`, `reason NOT NULL`, `set_by` nullable `ON DELETE SET NULL`, RLS enabled and forced. Resolution is override → plan limit → unlimited.
- `limit_value` is nullable and NULL means *explicitly unlimited*. That is deliberately **not** the same as having no row, which falls through to the plan. Collapsing the two would make it impossible to lift a cap without editing the plan, which is the entire reason the table exists.
- Overrides are merged into the plan's limits per key, not substituted wholesale. Substituting would silently drop every limit the operator did not happen to mention, turning a raised ceiling into an accidental removal of all the others.
- `reason` is required because the only moment anyone reliably knows it is at write time. Without it nobody can later tell a sales concession from a forgotten debugging change, and the override becomes permanent by default.
- Unknown limit keys are rejected against the union of keys across all plans. A typo would otherwise write a row that resolves against nothing — silent, and indistinguishable from success to the operator who made it.

**Verification.** 362 unit tests green; `scripts/probe_phase5_tenants.py` 18/18 against real Postgres as the non-superuser `zeus_app` (schema, nullability, partial index, RLS forced, upsert idempotence, cross-tenant isolation via `tenant_scope`, cascade on delete); `scripts/e2e_tenant_suspension.py` 28/28 through HTTP against the running API; `scripts/break_test_phase5.py` deliberately defeats five guarantees in turn and confirms a test catches each.

The break-test harness earned its keep immediately: it found that the override audit was untested, and then that the replacement assertion used substring containment (`"tenant.limit.set" in ...`), which a renamed action still satisfied. Both are now positional equality checks against the INSERT's argument order.

**A test must not read the ambient environment.** Phase 5c shipped with a fixture that wrote a Stripe secret through the real code path. It passed locally because the shell had `ZEUS_SECRETS_ENCRYPTION_KEY` exported and failed on the first clean CI runner, where nothing does. Fixtures now supply what they need — that one builds its own throwaway `SecretBox` — and the suite is run with `env -u` for any variable the developer machine happens to carry before it is called green.

### 8.1b Tenant management — remaining
Usage and cost series are not yet on the detail response; the list shows member, module and override counts only. Deferred to Phase 8 when the screen that consumes them is built, rather than guessing at the shape now.

### 8.2 Pricing and plans (fixes D15) — **DONE (Phase 5b)**
```
GET    /admin/plans                  list + unsellable_active_plans
GET    /admin/plans/{id}
POST   /admin/plans                  409 on a taken id, never an overwrite
PATCH  /admin/plans/{id}             name, prices, stripe ids, is_active
PUT    /admin/plans/{id}/limits      replaces the limit set wholesale
POST   /admin/billing/test-connection
```
**How the guardrails were met, and the reasoning behind each:**

- *Changing a price must not silently re-price existing subscribers.* It does not, and the API says so rather than relying on the operator knowing. Every price-changing response carries `PRICE_WARNING` with the **concrete subscriber count** — "3 subscriber(s) are unaffected" reads as a fact about their data; generic boilerplate is something people learn to skip. The failure being prevented is an operator believing they have given a discount they have not given.
- *Deactivating a plan must not revoke access.* `is_active` controls whether the plan is *offered*; entitlements come from the subscription, so subscribers keep exactly what they bought. That is the right behaviour and it is not what "deactivate" sounds like, so `DEACTIVATE_WARNING` states it.
- *A plan with no Stripe price id cannot be offered for checkout.* Already true in the storefront query, and the consequence was that such a plan silently vanished from `/billing/plans` — which from outside looks like the pricing page being broken. `GET /admin/plans` now names the condition in `unsellable_active_plans`.
- *Price ids validated against Stripe before saving.* Done, as **warnings not errors** — see D15 for why refusing the save would be worse than accepting it.

**Two further decisions, neither of which the spec asked for:**

- `module_id` is **not editable**. Moving a plan between modules would change what every existing subscriber is entitled to with no billing event anywhere. That is not an edit, it is a silent re-grant. `EDITABLE_PLAN_COLUMNS` is a frozen set and the `SET` clause is built from it, never from caller input — a caller-supplied column name reaching that f-string would be SQL injection through the admin API.
- `PATCH` uses `model_dump(exclude_unset=True)`, so `null` is distinguishable from omitted. Without that there is no way to *clear* a Stripe id, and a plan wrongly marked sellable could never be corrected.

Plan limits **replace** rather than merge (a key the caller omitted is a key the plan no longer has) whereas per-tenant overrides merge — one is the plan's definition, the other an adjustment to it. Limits *do* apply to existing subscribers immediately, so every affected tenant's cached entitlement is invalidated; otherwise the change appears to do nothing until the TTL lapses and the operator applies it twice.

### 8.3 Models and AI — **DONE (Phase 5b)**
```
GET    /admin/models                 priced models + unpriced_models
PUT    /admin/models/{model}         input/output price per million
DELETE /admin/models/{model}
```
`unpriced_models` — models being called with no price row — is the point of the screen, not a footnote. Every call to one records NULL cost, so its spend is invisible in every rollup: the exact condition that hides a runaway bill. It is returned alongside the priced list rather than behind a separate endpoint so it cannot be missed, and `DELETE` warns in those terms rather than returning a bare 204.

Model names are normalised with the same `normalise_model` the metering read path uses. Storing the raw string would let a price be saved under a spelling the recorder never looks up — the operator sees their edit accepted and their costs stay NULL, which is indistinguishable from having made no edit at all.

Prices accept zero (`ge=0`, not `gt=0`): a genuinely free model is real, and rejecting zero forces an operator to either lie or leave it unpriced, and unpriced records NULL, which is worse.

**Fix D7:** done — see D7.

**Extending `MANAGED_KEYS`** (LLM timeout, max attempts, chunk chars, max chunks, breaker thresholds) is **deferred to §8.4**, which is where the bounds work lives. Adding managed keys without the bounds is the part of that change that can do harm.

**Fix D14:** done in Phase 5a.

### 8.4 Cache TTL control — **DONE (Phase 5c)**
TTLs were compile-time constants:

| Key | TTL | Where |
|---|---|---|
| `entitlements:` | 300 s | `entitlements_service.py` |
| `membership:` | 60 s | `service-kit/security.py` |
| `cfg:` | 60 s | `runtime_config.py` |
| `oauth:google:` | 600 s | `google_oauth.py` |
| model price | none | `metering.py` |

**DONE (Phase 5c).** All four became fields on `CacheSettings` and bounded managed keys. The fifth, `cfg:`, deliberately did not: resolving its TTL would mean reading the store that TTL governs, the same circularity that keeps `ZEUS_DATABASE_URL` out of the registry. A test asserts it stays out, so a later attempt to "finish the job" is caught where the reason is written down rather than as a puzzling recursion.

| Key | Bound | Why that ceiling |
|---|---|---|
| `cache.membership_ttl_seconds` | 10–300 s | How long a removed colleague keeps reading a workspace |
| `cache.entitlements_ttl_seconds` | 30–900 s | How long a suspended tenant keeps working on an instance that missed the invalidation |
| `cache.oauth_state_ttl_seconds` | 60–1800 s | The replay window for a stolen OAuth state value |
| `cache.model_price_ttl_seconds` | 60–86400 s | Only bounds drift for a price changed outside the admin API, since an edit deletes the key |

Also extended `MANAGED_KEYS` with the LLM resilience settings §8.3 deferred here, all bounded: `llm.timeout_seconds` (5–300, must stay under the job lease or a slow call is reaped and retried having already been paid for), `llm.max_attempts` (1–10, every attempt is billed), `llm.chunk_chars` (1k–200k, above the context window every call fails), `llm.max_chunks` (1–500, the ceiling on what one upload can cost), and both breaker settings.

**Three decisions worth recording:**

- **Bounds are enforced on read as well as write.** Checking only on write means the one value that matters — the one actually in use — is the one never checked. Bounds get tightened, rows get edited by hand, backups get restored. An out-of-range stored value is discarded on read and the environment default applies, with a warning; it does not raise, because this runs on the request path and a bad row must degrade rather than take the platform down.
- **A structural test asserts every numeric key declares both bounds**, and a second asserts each range admits the shipped default. The parametrised bound tests can only cover keys somebody remembered to think about; these two mean an unbounded number cannot be added to the registry at all, and a range written round the wrong way is caught immediately.
- **TTLs are read per use, not captured at construction.** These services are `cached_property` on a container that outlives every request, so a value read once at boot is pinned until the instance recycles — the same shape as D7 and D18. Each takes a `Callable[[], int]` instead.

**Flush cache per prefix:** `POST /admin/cache/flush` against an allowlist, with `GET /admin/cache/prefixes` returning each option *and the consequence of choosing it*, because the person reaching for this is usually doing so under pressure. An allowlist rather than a free-text pattern is the whole design: `Cache.invalidate` takes a glob, and a caller who could send `*` would clear sessions, entitlements and OAuth state in one request and sign out every user of the platform. No operational need is served by the wildcard that a targeted prefix does not serve, so it is unreachable. Audited, and the key count is returned because "it worked" and "there was nothing there" are different answers.

### 8.5 Stripe key rotation — **DONE (Phase 5c)**
Rotating `stripe_secret_key` while requests are in flight must not break them. `BillingService._provider_instance` was cached for the life of the container, so on a warm instance a rotated key was never picked up — and, worse, a "test connection" built on the cached provider would confidently report success for a key no longer in use.

`reset_provider()` (Phase 5b) is now called by `PUT`/`DELETE /admin/settings/{key}` whenever the key changes starts with `billing.`, so a rotation takes effect on the instance serving the operator immediately, without them having to press test-connection first. Unrelated settings do not touch it — rebuilding a Stripe client on every model-name edit would be waste. The reset is best-effort: a config write that succeeded must not be reported as failed because a cache could not be dropped, and the settings refresh is the backstop.

Other instances pick the change up through the settings refresh, which **Phase 5c had to make work at all** — see D18.

`POST /admin/billing/test-connection` probes with `Account.retrieve`: the cheapest authenticated read Stripe offers, needs no arguments, creates nothing, and fails only if the credentials are bad. It reports `livemode`, because the most expensive Stripe mistake is not a broken key but a working *test* key in production, which accepts every checkout and charges nobody. A failure returns **200 with `ok: false`**, not a 5xx — the request succeeded and the answer is that the credentials do not work. Raising would make "your Stripe key is wrong" indistinguishable in logs and alerting from "the admin API is broken".

### Exit criteria
- [x] Tenant list, detail, suspend/activate, limit override all work end to end
- [x] Plan and price edits reflect in `/billing/plans` immediately
- [x] Model price edit takes effect without a restart (D7 closed)
- [x] TTL bounds enforced and tested — Phase 5c
- [x] Every mutation audited
- [x] D7, D14 closed; D15 closed as far as code can close it (see D15)

---

## 9. Phase 6 — Job and queue observability — **DONE**

**Goal:** You can see what is stuck and do something about it.

**Depends on:** Phase 4.

### 9.1 Why this is needed
There is currently **no way to see a job**. No list endpoint, no retry, no cancel. Lease recovery only runs inside `claim_job`, so if nothing claims, an expired lease is never swept (D12). A job can be stuck indefinitely with no observer.

### 9.2 Routes — **DONE**
```
GET  /admin/jobs              filter: status, module_id, tenant, kind, stuck; paginated
GET  /admin/jobs/health       depth + oldest queued age per module, expired leases,
                              overdue queued, 24h failure rate
GET  /admin/jobs/{id}         full detail incl. payload and result — audited
POST /admin/jobs/{id}/retry   attempts reset to 0 (Q6); 409 on live or superseded
POST /admin/jobs/{id}/cancel  clears the lease so the handler stops (fixes D10)
POST /admin/jobs/reap         recover dead leases when nothing is claiming (D12)
```
Reads cross module boundaries, which no other caller may do: each service's `JobRepository` is bound to one `module_id`, and that binding is what keeps the services independently sellable. Rather than add an optional argument to defeat it — putting the escape hatch one keyword away from every caller — `JobAdminRepository` is a separate class reachable only from this router, behind `AdminDep`.

### 9.3 Reaper (fixes D12)
**DONE.** A real scheduled sweep, `platform.reap_expired_leases`, extracted from inside `claim_job` rather than copied. Not run from the health endpoint: an endpoint that repaired the thing it reported on could never tell you whether you were observing a problem or causing one. `claim_job` still calls it, because recovering on the path about to pick up work is what keeps a retry prompt; the admin route covers the case that sweep cannot reach, where nothing is claiming at all.

### 9.4 Heartbeat (fixes D11)
**Superseded by D20.** The wiring already existed and was broken, not missing. Contract-compliance extraction now reports progress too, which is what makes it cancellable.

### 9.5 Payload redaction
**DONE.** The list returns neither `payload` nor `result` — it is read casually and often, and those columns hold document text and model output. It returns a 500-character error excerpt instead, which is enough to triage from. The detail endpoint returns everything and is audited as `job.viewed`: it is the only route on the platform that hands an operator another tenant's data, and a record of who opened which job is what separates a support tool from an unaccountable one.

### 9.6 Stuck definition
**DONE.** One predicate, `_STUCK_SQL`, shared by the list filter and the health counters so the number on the dashboard and the rows behind it cannot disagree:
- expired lease and still `running` — the worker died
- `queued` with `run_after` more than five minutes past — nothing is claiming; five minutes is one lease, shorter and ordinary scheduling delay looks like a fault
- `failed` with `attempts >= max_attempts` — the retries are over and it needs a human

`failure_rate_24h` is `None`, not `0.0`, when nothing finished. Zero out of zero renders as a healthy green on a dashboard when it in fact means the queue did no work at all, which is the more alarming of the two states.

### Exit criteria
- [x] Job list, detail, retry, cancel work
- [x] Reaper recovers an expired lease with no claim traffic
- [x] Heartbeat keeps a long job alive past the lease window (proven with a test)
- [x] Queue health reports accurate depth against a seeded ledger
- [x] D10, D11, D12 closed — plus D19, D20, D21 found and closed on the way

---

## 10. Phase 7 — Guardrails: tokens, documents, pages

**Goal:** The limits you asked for. None of these exist today.

**Depends on:** Phases 2, 5.

### 10.1 New limit keys
| Key | Meaning | Enforced where | Status |
|---|---|---|---|
| `pages_per_document` | Page cap per document | Ingestion, after extraction, before storage | **DONE** |
| `pages_per_month` | Total pages | Ingestion | **DONE** |
| `documents_per_month` | Documents processed | Ingestion, before extraction | **DONE** |
| `tokens_per_month` | AI token ceiling | Pre-flight in extraction and enrichment | TODO |
| `ai_cost_per_month_usd` | Spend ceiling | Same | TODO |
| `storage_mb` | Stored bytes | Upload | TODO |

The three ingestion keys are enforced but **not yet seeded on any plan**, so they are absent everywhere and therefore unlimited everywhere (DEC-10). That is the correct resting state: the mechanism ships before the numbers, so seeding a plan is a data change rather than a deploy. Seeding them is the next task.

### 10.1b Superseded
The original table proposed enforcing `pages_per_document` *before* extraction. That is not possible: the page count is a product of extraction, so the check has to follow it. It still runs before any byte is stored and before any row is written, which is what the ordering was actually protecting.

### 10.2 Page counting — **DONE (counting); storage outstanding**
**There was no page concept anywhere in the codebase.** PDFs give a page count via `pypdf`. DOCX does not have pages in any meaningful sense until rendered. Plain text has none.

**Decided — see DEC-11**, which answers Q4 and is written down there in the form a customer could be shown. `extract_document()` now returns `pages` and `page_basis`; 15 tests in `test_documents.py` pin the rule, including the two asymmetries. Verified by breaking the rule in both directions: forcing the estimate over a PDF's real count fails 2 tests, and letting a DOCX break count undercut the estimate fails 1.

The PDF test fixture was rewritten as part of this. It previously called `PdfWriter.add_blank_page`, which produces pages with **no text at all** — so every "PDF extraction" test was really asserting that an empty document is rejected, and could not have exercised extraction or a page count. It now writes a real PDF with a text content stream, by hand, rather than adding a rendering dependency for a fixture.

**Still outstanding:** none — migration `0006_document_pages.sql` stores `pages` and `page_basis` on every document row, backfilling existing rows with the character estimate (the rule's own answer for a format that cannot tell us) and marking them `estimated` so they are never mistaken for parser counts. `pages >= 1` and `page_basis IN ('counted','estimated')` are CHECK constraints, because a zero-page document cannot be billed and the basis is shown to customers verbatim.

`pages_per_document`, `pages_per_month` and `documents_per_month` are enforced in `IngestionService.ingest` via an `IngestQuota`, resolved by the router from the tenant's claims. The check order is deliberate: document count first (known before parsing, so a tenant at their cap never pays for the parse), then page checks after extraction but **before** any byte reaches storage and before any row is inserted — a refused upload leaves nothing behind and costs no AI spend. `pages_per_month` counts the document being uploaded, so 95 used plus a 10-page file against a cap of 100 is a refusal rather than a silent overshoot to 105.

The monthly totals are summed from `contract_compliance.documents` rather than a counter table, for the same reason grant scans are counted from the job ledger: the rows are the record of what was actually accepted, so the total cannot drift and there is no counter for a client to write to. This is affordable where summing `ai_usage` would not be — `documents` gains one row per upload, not one per model call, and `idx_cc_documents_tenant_month` covers the sum with `pages` INCLUDEd.

**The probe caught an index defect.** The planner preferred the pre-existing `idx_cc_documents_tenant(tenant_id)` and turned what should have been an index-only scan into a heap fetch. That index is redundant now — the new one leads with the same column — so 0006 drops it, removing both the wrong plan and a write on every upload.

### 10.3 Enforcement (per DEC-5)
Pre-flight against remaining budget, post-flight recording actual. The token overshoot is bounded by one operation and is a documented property.

Needs a `usage_counters` read path efficient enough for the request path — a monthly aggregate, either a materialized counter table or a cached rollup. **Do not sum `ai_usage` on every request**; it is append-only and will grow without bound.

### 10.4 Warnings before walls
At 80% of a limit, surface a warning in the UI and optionally email. Hitting a hard 402 with no warning is the single most common cause of angry support tickets.

### 10.5 Enterprise plans — **DONE**
The five `*_enterprise` plans have **no limit rows at all**, which under DEC-10 means unlimited. **Confirmed intended.** The code disagreed with itself about what that meant — see **D22**, closed. Grant Intelligence read the absence as the free tier and handed enterprise customers three scans a month; Contract Compliance read it as unlimited. Both now resolve limits through `EntitlementClaims.limit_ceiling()`, which cannot express the two as the same value.

### Exit criteria
- [ ] Every new key enforced with a test proving both allow and deny
- [x] Missing limit row → unlimited, proven by test (DEC-10) — `tests/test_grant_limits.py`, 19 tests, 7 fail when the old semantics are restored
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
| Q4 | Page definition — how is a page counted for DOCX and plain text? Proposal: `ceil(chars / 3000)`. | **ANSWERED 2026-09-18 — DEC-11.** PDF page = a page; DOCX page = an authored page break; otherwise `ceil(chars / 3000)`. |
| ~~Q5~~ | ~~Suspension semantics — hard lockout or read-only?~~ **Answered 2026-09-16:** hard lockout for *new* work, and queued jobs run to completion. Implemented in Phase 5a — see §8.1. The drain half needed no new machinery: the worker authenticates by shared secret and never consults entitlements, so it was already the behaviour. What it needed was a test that fails if anyone changes it by accident. | ~~Phase 5~~ |
| Q6 | Retry semantics — does an admin retry reset `attempts` to 0 or continue the count? | **Answered (Phase 6): reset.** An operator pressing retry is asserting the cause is fixed. Continuing the count means an exhausted job is retried once, immediately fails as exhausted again, and the button looks broken. The history is not lost — the prior count and error are kept in `last_error`, and the action is audited. |
| Q7 | Enterprise plans have no limit rows, so unlimited. Intended? | Phase 7 |
| ~~Q8~~ | ~~`ai_usage` cost backfill.~~ **Answered 2026-09-16 by measurement:** production has zero rows in both usage tables, so there is nothing to reconstruct. Moot. | ~~Phase 2~~ |
| Q9 | Resend is rejecting production sends. Fix now? Invites and password reset both depend on email. | Phase 1 |
| Q10 | Grants.gov catalogue — production has 0 opportunities. Load it? | Any demo |

---

## 14. Operational rules for this repo

**Traps that have already cost time. Do not rediscover these.**

- **Heredocs mangle this terminal.** Use `create_file` then `git commit -F <file>`. Avoid embedded quotes in long `python -c` strings. (Happened again in Phase 5a. For multi-step shell logic, write a script file and run it.)
- **Check `echo $ZEUS_DATABASE_URL` before starting a local server or running any e2e script.** A shell with the production DSN exported gets inherited by a locally-launched uvicorn, and `localhost:8000` then writes to Supabase. This created a real user and tenant in production during Phase 5a (removed). The e2e scripts now refuse to start unless both the DSN host and the API host are local — but only the scripts are guarded; a manual `curl` against a mis-pointed local server is not.
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
