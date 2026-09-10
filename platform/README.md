# Zeus Platform — Monorepo

Modular, multi-tenant SaaS platform. See [../architecture.md](../architecture.md) for the full design.

This monorepo is built in **phases** (strangler pattern) alongside the legacy app.
Current phase status and handoff notes live in [docs/](docs/).

## Layout

```
platform/
├── apps/            # Frontends + BFF (added in later phases)
├── services/        # Python FastAPI services
│   └── platform-core/
├── packages/        # Shared Python libraries
│   ├── config/      # Typed settings + secure secrets (no hardcoding)
│   └── adapters/    # Vendor-neutral interfaces + implementations
├── docs/            # Phase handoff context
├── pyproject.toml   # uv workspace root
└── turbo.json       # Task orchestration
```

## Principles

- **No hardcoding.** All configuration flows through `zeus_config` (pydantic-settings) from environment variables.
- **No vendor lock-in.** Every external dependency sits behind an adapter interface; swap providers via env.
- **Secrets are never committed.** Infrastructure secrets come from env (Vercel encrypted env in prod). Admin-managed secrets (LLM keys) are stored encrypted at rest.

## Getting started (local dev)

Requires Python 3.12+ and [uv](https://github.com/astral-sh/uv).

```bash
cd platform
cp .env.example .env      # fill in real values locally (never commit .env)
uv sync                   # install the workspace
uv run zeus-core          # start platform-core (health check)
```

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundations + de-lock-in | in progress |
| 1 | Platform core + tenancy + entitlements | not started |
| 2 | Migrate services | not started |
| 3 | Ads funnel + observability + launch | not started |
