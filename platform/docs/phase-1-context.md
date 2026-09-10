# Phase 1 — Context Handoff

> Read this first when starting **Phase 2**. Records what exists, the decisions
> behind it, and where to plug in next. Companion to
> [../../architecture.md](../../architecture.md) and
> [phase-0-context.md](phase-0-context.md).

**Status:** Phase 1 complete. 18 tests pass, ruff clean, app boots.
**Date:** 2026-09-10

---

## 1. What Phase 1 delivered

The goal was **platform core + tenancy + entitlements** — making services
independently sellable and access-controlled. Done:

- A **`Database` adapter** (async) added to the anti-lock-in layer: asyncpg
  Postgres impl, a `FakeDatabase` for tests, and a config-driven factory.
- The **platform-core schema** ([migrations/0001_platform_core.sql](../services/platform-core/migrations/0001_platform_core.sql)):
  tenants, users, memberships, modules, plans, plan_limits, subscriptions,
  entitlements, platform_config, prompt_registry — in a dedicated `platform`
  schema (schema-per-service). Seeds the three sellable modules.
- **Pure entitlement logic** (`domain/entitlements.py`) — the single source of
  truth. `compute_claims(subs, catalog)` folds subscriptions into an access
  snapshot. No I/O, exhaustively unit-tested. Replaces the legacy 3-way
  duplication.
- **Repositories** (thin, parameterized SQL): tenants, plans, billing
  (subscriptions + entitlements), config_registry (config + prompts).
- **Services** (orchestration): `EntitlementsService` (compute + Redis cache +
  persist), `TenancyService` (provision/ensure tenant), `BillingService`
  (checkout + webhook apply + entitlement refresh).
- **Security** (`security.py`): bearer-token auth via `AuthProvider.verify`,
  tenant resolution, the **entitlement guard** (`require_module(...)`) that
  returns 403 before service logic runs, and a platform-admin guard.
- **Routers**: `/tenancy`, `/entitlements`, `/billing`, `/admin`.
- **Container** (`container.py`): lazy composition root, injectable for tests.
- **App** wires it all with a lifespan that opens/closes the DB pool.

## 2. The selling mechanic (proven by tests)

`test_guard.py` stands up the real app with a fake DB returning **one active
Grant Intelligence subscription**, then asserts:

- no/invalid token -> 401
- `/probe/grant` (entitled) -> 200
- `/probe/contract` (not purchased) -> **403**
- `/entitlements/me` lists only `grant_intelligence`

This is the core promise: **buy one service, the others are invisible and
unreachable.** Defense in depth: gateway guard -> (future) service re-check ->
DB RLS.

## 3. Layout added this phase

```
packages/adapters/src/zeus_adapters/
  interfaces.py                 # + Database ABC
  db/  postgres_db.py  fake_db.py  __init__.py   # + factory

services/platform-core/
  migrations/0001_platform_core.sql
  src/zeus_platform_core/
    container.py                # lazy DI composition root
    security.py                 # auth + entitlement guard + admin guard
    domain/    models.py  entitlements.py
    repositories/ tenants.py  plans.py  billing.py  config_registry.py
    services/  entitlements_service.py  tenancy_service.py  billing_service.py
    routers/   tenancy.py  entitlements.py  billing.py  admin.py
  tests/  test_entitlements_logic.py  test_guard.py
```

## 4. Key decisions (do not relitigate without reason)

| Decision | Choice | Why |
| --- | --- | --- |
| Entitlement claims | Pure function, cached in Redis | One source of truth; fast reads |
| past_due access | Still granted | Dunning window before canceled |
| Tenant resolution | `X-Tenant-Id` header else JWT claim | Supports multi-tenant users |
| Guard placement | FastAPI dependency (`require_module`) | Blocks before route body |
| Container | Lazy `cached_property`, injectable | Import without full config; testable |
| Secrets in DB | `SecretBox` in ConfigRepository | Ciphertext only; keys never echoed |
| Access status set | trialing, active, past_due | Defined in `ACCESS_GRANTING_STATUSES` |

## 5. New env vars (added to `.env.example`)

```
ZEUS_DATABASE_PROVIDER=postgres      # postgres | fake
ZEUS_DATABASE_URL=                   # postgresql://...supabase.co:5432/postgres
ZEUS_DATABASE_POOL_MIN=1
ZEUS_DATABASE_POOL_MAX=10
```

For local boot without infra: `ZEUS_DATABASE_PROVIDER=fake ZEUS_CACHE_PROVIDER=memory`.

## 6. How to run

```bash
cd platform
export PATH="$HOME/.local/bin:$PATH"
uv sync --all-extras
uv run --no-sync python -m pytest -q         # 18 passing
# Apply the migration to your Supabase Postgres:
psql "$ZEUS_DATABASE_URL" -f services/platform-core/migrations/0001_platform_core.sql
# Boot:
ZEUS_DATABASE_PROVIDER=fake ZEUS_CACHE_PROVIDER=memory uv run zeus-core
```

## 7. Deliberately NOT done (Phase 2 backlog)

1. **Seed plans + plan_limits + Stripe price ids.** The schema and module seed
   exist, but `plans`/`plan_limits` rows and their Stripe price mappings must be
   loaded (port from legacy `src/lib/plans.ts` + `modules.ts` + `entitlements.ts`).
   Until then, `plan_for_price` returns nothing and webhooks can't map prices.
2. **RLS policies.** Tables are RLS-ready but policies aren't written yet. Add
   `tenant_id`-scoped policies before exposing module data services.
3. **Trial-once + duplicate-subscription rules.** Legacy billing enforced one
   trial per account and no duplicate subs; re-implement in `BillingService`.
4. **Stripe customer linkage.** `tenants.stripe_customer_id` +
   `set_stripe_customer` exist but aren't populated on checkout yet; wire the
   customer create/lookup and the billing portal endpoint.
5. **Signup flow / JWT claim issuance.** `AuthProvider.issue_claims` exists;
   the actual signup -> Supabase user -> provision tenant -> tenant-scoped token
   round trip isn't wired end to end.
6. **Module services (the real work of Phase 2).** Extract Contract Compliance
   first (cleanest boundaries), then Audit Vault, then Grant Intelligence —
   each its own schema + FastAPI service that re-checks entitlements and uses
   the `LlmProvider` + prompt registry.
7. **AI worker + queue wiring.** `Queue` adapter exists; no worker consumes it
   yet. Build `ai-worker` for async extraction (fixes the "AI too naive" issue
   with the prompt registry + better models).
8. **Observability.** OTel package + Grafana wiring still just config flags.
9. **BFF/marketing/admin frontends.** Still to build; platform-core is the API.

## 8. Extension points (concrete)

- **Guard a new module route:** `dependencies=[Depends(require_module("<id>"))]`.
- **New repository:** take `Database` in the constructor, keep SQL parameterized.
- **New service:** add a `cached_property` to `Container`, inject repos/adapters.
- **Add a plan limit:** insert into `platform.plan_limits`; it flows into claims
  automatically via `PlanRepository.limit_catalog`.
- **Live prompt change (Phase 2 AI):** `PromptRepository.add_version` +
  `activate`; workers read `active_body(name)`.

## 9. Invariants to keep (guardrails)

- Entitlement decisions go through `compute_claims` / the guard — never ad hoc.
- SQL only in repositories, always parameterized ($1, $2 ...).
- Adapters only via the container / factories, never imported by routers.
- Secrets via `SecretStr` / `SecretBox`; never returned by read endpoints.
- Domain logic stays pure (no I/O) so it remains unit-testable.
