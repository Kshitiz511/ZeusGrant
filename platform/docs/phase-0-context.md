# Phase 0 — Context Handoff

> Read this first when starting **Phase 1**. It records exactly what exists, the
> decisions behind it, and where to plug in next. Companion to
> [../../architecture.md](../../architecture.md).

**Status:** Phase 0 complete. Foundation builds, tests pass, service boots.
**Date:** 2026-09-08

---

## 1. What Phase 0 delivered

The goal was **foundations + de-lock-in**, not features. Done:

- A Python monorepo under `platform/` (uv workspace + Turborepo task file), living
  alongside the legacy Lovable app (strangler pattern — nothing legacy was touched).
- A **typed, no-hardcoding config layer** (`zeus_config`) sourced entirely from env.
- **Encryption-at-rest helper** (`SecretBox`) for admin-managed secrets (LLM keys).
- **Six vendor-neutral adapter interfaces** with config-driven factories.
- **Three pluggable LLM providers** (OpenAI, Anthropic, Gemini) replacing the
  hardcoded Lovable AI gateway.
- **Backbone adapters**: Redis + in-memory cache, QStash + in-memory queue,
  Supabase auth, Supabase storage, Stripe billing.
- A **thin FastAPI `platform-core`** with `/health` and `/health/config` that
  reports provider wiring without leaking secrets.
- Tests (7 passing) proving factory selection is config-driven and fails loudly
  when misconfigured.

## 2. Layout (what lives where)

```
platform/
├── pyproject.toml                  # uv workspace root (members: packages/*, services/*)
├── turbo.json  .env.example  .gitignore  README.md
├── packages/
│   ├── config/   src/zeus_config/  # settings.py, secrets.py
│   └── adapters/ src/zeus_adapters/
│       ├── interfaces.py           # the 6 ABCs (anti-lock-in contract)
│       ├── models.py               # shared pydantic models
│       ├── llm/                    # openai, anthropic, gemini + factory
│       ├── cache/                  # redis, memory + factory
│       ├── queue/                  # qstash, memory + factory
│       ├── auth/                   # supabase + factory
│       ├── storage/                # supabase + factory
│       └── billing/                # stripe + factory
├── services/
│   └── platform-core/ src/zeus_platform_core/  # app.py, health.py, __main__.py
└── docs/phase-0-context.md         # this file
```

## 3. Key decisions (do not relitigate without reason)

| Decision | Choice | Why |
| --- | --- | --- |
| BFF + services language | Python / FastAPI | Single backend language, Vercel-native |
| Auth now | Supabase Auth (GoTrue) | Free, open-source, JWT; Keycloak adapter slots in later |
| Cache | Redis (Upstash) | HTTP/TLS, free tier; memory impl for local/dev |
| Queue | QStash | HTTP-based, serverless-safe; RabbitMQ swappable via `Queue` |
| DB | Supabase Postgres + RLS | Schema-per-service isolation (Phase 1) |
| Secrets (infra) | Env vars only | Never in DB, never committed |
| Secrets (admin-managed) | `SecretBox` (Fernet) | Ciphertext-only in DB; one master env key |
| Provider selection | `ZEUS_*_PROVIDER` env | Swap vendors with a config change, no code edit |

## 4. Secrets model (important)

Two tiers, deliberately separated:

1. **Infrastructure secrets** (Supabase, Stripe, Redis, QStash keys) →
   environment variables only. Local: `.env` (gitignored). Prod: Vercel encrypted
   env. Loaded as `SecretStr` so they never render in logs.
2. **Admin-managed secrets** (LLM API keys, later per-tenant keys, editable from
   the Phase 1 admin dashboard) → stored in Postgres **encrypted** with
   `SecretBox`. Only ciphertext (`zsb1:...`) touches the DB. The master key is
   `ZEUS_SECRETS_ENCRYPTION_KEY` (generate via
   `SecretBox.generate_key()`); rotating it re-encrypts stored values.

`.env.example` is the authoritative list of every variable.

## 5. How to run

```bash
cd platform
cp .env.example .env
export PATH="$HOME/.local/bin:$PATH"   # uv installed here
uv sync --all-extras
uv run pytest -q                       # 7 passing
# Boot with dev-safe providers:
ZEUS_CACHE_PROVIDER=memory ZEUS_QUEUE_PROVIDER=memory uv run zeus-core
# -> GET http://localhost:8000/health , /health/config
```

## 6. Deliberately NOT done in Phase 0 (Phase 1 backlog)

These are the natural next steps — start here in the next session:

1. **Tenancy schema + migrations** — `tenants`, `users`, `memberships`,
   `modules`, `plans`, `plan_limits`, `subscriptions`, `entitlements`
   (ER model already in architecture.md §2.3). Schema-per-service.
2. **Entitlements service** — the single source of truth. Reads subscriptions,
   computes limits, caches claims in Redis. Retire the legacy 3-way duplication
   (client mirror + SQL functions + server checks).
3. **BFF gateway** — auth middleware (uses `AuthProvider.verify`), tenant
   resolution, **entitlement guard** that blocks unpaid-module requests before
   they reach a service (architecture.md §1.3).
4. **Billing wiring** — checkout endpoint (`BillingProvider.create_checkout`),
   webhook endpoint (`parse_webhook` → upsert entitlement → invalidate Redis),
   self-serve signup → auto-provision tenant.
5. **Prompt + config registry** — DB-backed, `SecretBox` for keys, Redis
   hot-cache. Foundation for the admin control plane and the Phase 2 AI rebuild.
6. **Add a `Database` adapter** — Phase 0 has no DB client yet; add an async
   Postgres/Supabase data layer behind an interface before writing services.
7. **Observability** — OTel setup in a `packages/observability`, wire to Grafana
   Cloud (currently only config flags exist).

## 7. Extension points (where to plug in, concretely)

- **New LLM provider:** add `llm/<name>_provider.py` implementing `LlmProvider`,
  register in `llm/factory.py`, add its key to settings + `.env.example`.
- **Keycloak auth:** add `auth/keycloak_auth.py` implementing `AuthProvider`,
  branch in `auth/__init__.py` on `ZEUS_AUTH_PROVIDER=keycloak`. Callers unchanged.
- **RabbitMQ queue:** add `queue/rabbitmq_queue.py` implementing `Queue`, branch
  in `queue/__init__.py`. Everything downstream keeps using `build_queue`.
- **New service:** create `services/<name>/` mirroring `platform-core`; depend on
  `zeus-config` + `zeus-adapters`; it inherits config, secrets and all adapters.

## 8. Invariants to keep (guardrails)

- No secret literal ever appears in code or logs. Use `SecretStr` / `SecretBox`.
- No adapter is imported directly by business code — always via a `build_*`
  factory or an injected interface.
- Concrete provider SDKs stay optional extras; missing SDK = clear install error.
- Factories **fail loudly** on missing/invalid config (no silent fallbacks).
