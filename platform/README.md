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
| 0 | Foundations + de-lock-in (adapters, config, service-kit) | done |
| 1 | Platform core + tenancy + entitlements + RLS | done |
| 2 | Contract Compliance service + console | done |
| 3 | Real auth (email/password, scrypt, tenant-scoped tokens) | done |
| 4 | Document ingestion, obligation lifecycle, audit trail | done |
| 5 | AI hardening + billing correctness | done |
| 6 | Observability, BFF cookie sessions, remaining modules | not started |

### Verification

Three end-to-end suites run against a live `docker compose up` stack:

```bash
bash   scripts/e2e_documents.sh      # upload -> analyze -> workflow -> tenant isolation
python3 scripts/e2e_ai_robustness.py # prompt injection, long documents, junk input
python3 scripts/e2e_billing.py       # plan catalog, portal/checkout refusals, webhook auth
```

`uv run pytest -q` covers the unit and route layers; `uv run ruff check .` must be clean.

### Known gaps before taking real payments

1. **Stripe price ids are placeholders.** `platform.plans` ships with ids like
   `cc_growth_monthly`. Create the real prices in Stripe and update the rows.
   Checkout refuses any price that does not map to a known plan, so a
   misconfigured id fails at checkout rather than after a customer is charged.
2. **`VITE_STRIPE_PUBLISHABLE_KEY` must be set** for the console build, or the
   billing page renders the catalog but disables checkout.

Closed:

- ~~Sessions are memory-only.~~ Logins now persist across a reload via a
  rotating refresh token in an httpOnly cookie, with double-submit CSRF and
  reuse detection. See [Sessions](#sessions).
- ~~`/dev/token` must be disabled in production.~~ `Settings` refuses to
  construct with `ZEUS_DEV_TOKENS` on when `ZEUS_ENV=production`, and the
  router is neither mounted nor reachable there.

### Sessions

The access JWT is short-lived and lives only in a JavaScript variable, so
persistent XSS cannot lift it out of storage. Staying signed in across a reload
is handled instead by an opaque refresh token in an httpOnly cookie:

- Only `sha256(token)` is stored, so a database dump is not replayable.
- Every `POST /auth/refresh` burns the presented token and issues a new one,
  without extending the family's absolute deadline.
- Replaying an already-rotated token revokes the entire family — the standard
  reuse-detection response, which turns silent cookie theft into a forced
  re-login for both parties.
- CSRF uses double submit: a second, deliberately readable cookie must be
  echoed in the `X-CSRF-Token` header, which a cross-site caller cannot read.

| Variable | Default | Notes |
| --- | --- | --- |
| `ZEUS_SESSION_COOKIE_NAME` | `zeus_session` | Must match `CSRF_COOKIE`/cookie name in the console client. |
| `ZEUS_SESSION_CSRF_COOKIE_NAME` | `zeus_csrf` | Readable by design. |
| `ZEUS_SESSION_COOKIE_SECURE` | `false` | Forced to `true` when `ZEUS_ENV=production`. |
| `ZEUS_SESSION_COOKIE_SAMESITE` | `lax` | `strict` breaks the return trip from Stripe Checkout. |
| `ZEUS_SESSION_COOKIE_DOMAIN` | unset | Set only if the API and console are on different subdomains. |
| `ZEUS_SESSION_TTL_DAYS` | `14` | Absolute lifetime; rotation never extends it. |

Verify with `python3 scripts/e2e_sessions.py` against a running stack.

