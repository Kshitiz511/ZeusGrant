# Phase 2 — Context Handoff

> Read this first when starting **Phase 3**. Companion to
> [../../architecture.md](../../architecture.md), [phase-0-context.md](phase-0-context.md)
> and [phase-1-context.md](phase-1-context.md).

**Status:** Phase 2 complete. 27 tests pass, ruff clean, both services boot,
AI extraction verified live on local Ollama.
**Date:** 2026-09-10

---

## 1. What Phase 2 delivered

The goal was **the first real module service, end to end, plus the AI path and
local infra parity**. Done:

- **Auth polish (re-applied).** Platform-core now uses FastAPI `HTTPBearer`
  (`Security(_bearer)`), so Swagger shows the **Authorize** button. A dev-only
  `/dev/token` minter (gated by `ZEUS_DEV_TOKENS=true`) issues a signed JWT for
  local testing. NOTE: a Lovable sync reverted these in the prior session — see
  §7 "Guardrails".
- **Local Docker parity** ([../docker-compose.yml](../docker-compose.yml) +
  [../Dockerfile](../Dockerfile)): Postgres + Redis + a one-shot migrate step +
  both services. Serverless stays the prod target; this is for dev only.
- **Seed migration** ([0002_seed_plans.sql](../services/platform-core/migrations/0002_seed_plans.sql)):
  plans, plan_limits and (placeholder) Stripe price ids for all three modules,
  ported from the legacy `src/lib/modules.ts` + `entitlements.ts`. `plan_for_price`
  now resolves and the guard has real limits.
- **Shared service kit** ([../packages/service-kit](../packages/service-kit)):
  `ServiceSecurity` + `require_module` — reusable auth + entitlement guard that
  every module service mounts. Reads the same Redis claims platform-core writes
  (`entitlements:{tenant_id}`), with a `platform.entitlements` table fallback.
  This is how a module **independently** enforces access (defense in depth).
- **Contract Compliance service** ([../services/contract-compliance](../services/contract-compliance)):
  its own `contract_compliance` schema (contracts + obligations), FastAPI app,
  CRUD, the entitlement guard on every route, and `contracts_max` plan-limit
  enforcement (402 when exceeded).
- **AI extraction** (`extraction.py`): turns raw contract text into structured
  obligations via the pluggable `LlmProvider` and the **live, admin-editable**
  prompt from `platform.prompt_registry` (`contract.extract_obligations`). No
  prompt hardcoded. Proven end to end against Ollama `gemma3:4b`.
- **Async AI path** (`jobs.py`): `POST /contracts/{id}/analyze?async_mode=true`
  enqueues to the `Queue` adapter (topic `contract.analyze`) and returns 202;
  the queue calls back into `POST /internal/jobs/analyze` (machine-to-machine,
  authenticated by `ZEUS_WORKER_SECRET`) to do the work. Serverless-native: the
  "worker" is an HTTP endpoint QStash posts to, not a long-lived process.

## 2. The layered enforcement (proven by tests)

```
request → module service guard (service-kit require_module) → 403 if not entitled
        → plan-limit check (contracts_max)                    → 402 if exceeded
        → business logic
```

`test_contracts.py` proves: unentitled tenant → 403, limit reached → 402,
entitled create → 201, sync analyze persists 2 obligations, async analyze →
202 + queued job, worker endpoint requires the secret and processes the job.

## 3. Layout added this phase

```
platform/
  Dockerfile  docker-compose.yml  .dockerignore
  packages/service-kit/                     # shared auth + guard
    src/zeus_service_kit/{__init__,security}.py
  services/platform-core/
    migrations/0002_seed_plans.sql
    src/zeus_platform_core/routers/dev.py   # dev token minter (re-added)
  services/contract-compliance/
    migrations/0001_contract_compliance.sql
    src/zeus_contract_compliance/
      {__init__,__main__,app,container,domain,repository,extraction,routers,jobs}.py
    tests/test_contracts.py
```

New workspace members registered in [../pyproject.toml](../pyproject.toml):
`zeus-service-kit`, `zeus-contract-compliance`.

## 4. New env vars

```
ZEUS_DEV_TOKENS=false            # true mounts /dev/token (local only)
ZEUS_WORKER_SECRET=              # shared secret for /internal/jobs/* callbacks
ZEUS_OLLAMA_BASE_URL=http://localhost:11434/v1   # (from Phase 1.5)
```

## 5. How to run

Local, no infra (fakes + Ollama):
```bash
cd platform && export PATH="$HOME/.local/bin:$PATH"
uv sync --all-extras && uv pip install "openai>=1.40"   # openai client used by ollama provider
.venv/bin/python -m pytest -q                            # 27 passing
```

Full stack with Postgres + Redis:
```bash
cd platform
docker compose up --build          # applies migrations, starts both services
# platform-core → :8000, contract-compliance → :8001
```

Exercise the AI path (Ollama must be running; use a non-reasoning model like
gemma3:4b — qwen3 "thinks" and can exceed the timeout):
```bash
ZEUS_LLM_PROVIDER=ollama ZEUS_LLM_MODEL=gemma3:4b ZEUS_LLM_TIMEOUT_SECONDS=180 ...
```

## 6. Deliberately NOT done (Phase 3 backlog)

1. **RLS policies.** Tables are RLS-ready; policies (tenant_id-scoped) still
   need writing before exposing module data broadly.
2. **Real Stripe price ids.** 0002 uses legacy placeholders. Create Stripe
   products and update via admin config / a follow-up migration.
3. **Signup → provision → tenant-scoped token** round trip is still not wired
   end to end (issue_claims exists; the flow is not assembled).
4. **Remaining modules.** Audit Vault and Grant Intelligence services, same
   pattern as Contract Compliance.
5. **BFF / frontends.** Marketing site, app shell, admin dashboard.
6. **Observability.** OTel → Grafana Cloud is still just config flags.
7. **QStash wiring.** The async path works with the memory queue locally; wiring
   real QStash destinations to `/internal/jobs/analyze` is deployment config.
8. **Trial-once / duplicate-subscription** billing rules from the legacy app.

## 7. Guardrails / invariants (unchanged + new)

- Entitlement decisions go through `compute_claims` (core) or the shared
  `require_module` guard (services) — never ad hoc.
- SQL only in repositories, always parameterized.
- Adapters only via factories / the container; routers never import them.
- Secrets via `SecretStr` / `SecretBox`; `/dev/token` and `/internal/jobs/*`
  are disabled unless their env flags/secrets are set.
- **Lovable sync risk:** a sync reverted platform-core edits between sessions
  once. Commit platform changes promptly; if platform-core auth looks reverted
  (Header-based `get_session`, no `dev.py`), re-apply from this doc's §1.

## 8. uv workflow note

Editable installs intermittently break after edits. Fix:
`rm -rf .venv uv.lock && uv sync --all-extras && uv pip install "openai>=1.40"`.
Run tests with `.venv/bin/python -m pytest -q`; lint with
`uv run --no-sync ruff check .`.
