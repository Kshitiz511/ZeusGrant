# Phase 3 Context — Tenant tokens, web console, RLS

_Read after `phase-2-context.md`. September 2026._

## What Phase 3 delivered

1. **Tenant-scoped token exchange** — `POST /tenancy/token` on platform-core.
2. **Web console** — `apps/console/`: Vite + React + TS with the legacy Zeus
   design system, served by nginx in compose.
3. **Row-Level Security** — Postgres enforces tenant isolation on module data;
   the adapter binds `app.current_tenant` per request.

## 1. Token exchange (`services/platform-core/.../routers/tenancy.py`)

Flow: user authenticates → gets a user-level JWT → calls
`POST /tenancy/token {tenant_id}` → platform-core verifies membership via
`TenantRepository.get_membership_role` (403 if not a member) → mints a JWT
carrying `tenant_id` + merged roles via `auth.issue_claims`. Module services
then have tenant context from the token itself; no `X-Tenant-Id` header needed.

Tests: `services/platform-core/tests/test_token_exchange.py` (401 unauthenticated,
200 + correct claims for members, 403 for non-members, nothing minted on reject).

## 2. Console (`apps/console/`)

- **Stack**: Vite 5, React 18, TS strict, Tailwind v4 (`@tailwindcss/vite`),
  React Query, lucide-react. Design tokens ported from the legacy app
  (`src/styles.css`: oklch palette, sidebar tokens, Figtree, `shadow-lift`,
  `bg-brand-gradient`).
- **UX decisions (user-driven, don't regress these)**:
  - Login is **email + password only**. Dev builds map any credentials to the
    demo identity (`DEV_IDENTITY` in `LoginView.tsx`); production swaps in the
    real auth backend behind the same form. Never expose tenant/user ID inputs.
  - Sidebar is navigation, **not a sales surface**: active modules show their
    nav items; unowned modules collapse into one quiet "Available modules"
    group with a lock icon — **no per-item prices, no upsell buttons**.
  - Module pages open with KPI stat cards (AWS/Stripe console pattern).
- **Security**: JWT kept in memory only; non-secret identity in sessionStorage
  for silent re-mint. Prod path: httpOnly cookie via a BFF.
- **Networking**: dev uses Vite proxy, prod uses nginx (`nginx.conf`), both map
  `/api/core → platform-core` and `/api/cc → contract-compliance` (same-origin;
  no CORS, no service URLs in the bundle).
- **Compose**: `console` service (multi-stage node build → nginx) on
  http://localhost:5174. Local dev server: `npm run dev` → :5173.

## 3. Row-Level Security

Three cooperating layers:

- **Migration `services/contract-compliance/migrations/0002_rls.sql`**
  - Creates `zeus_app` (LOGIN, NOSUPERUSER) — services connect as this role
    because superusers/table owners bypass RLS. Migrations still run as `zeus`.
  - Grants CRUD on `platform` + `contract_compliance` schemas (+ default
    privileges for future tables).
  - `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policies (USING + WITH
    CHECK) on `contracts` and `obligations`, matching
    `current_setting('app.current_tenant', true)::uuid`. Unset context → NULL
    → zero rows. **Fail closed.**
- **Adapter (`packages/adapters/.../db/postgres_db.py` + `tenant_context.py`)**
  - `tenant_context.py`: ContextVar with `bind_tenant()` / `tenant_scope()`.
  - When a tenant is bound, every query runs in a transaction with
    `set_config('app.current_tenant', $1, true)` — `is_local=true` so the
    setting can never leak across pooled connections. Unbound queries
    (platform lookups, migrations) run directly.
- **Binding points**
  - `zeus_service_kit/security.py::require_module` calls `bind_tenant()` after
    the entitlement check — every guarded route is covered automatically.
  - `zeus_contract_compliance/jobs.py` wraps worker jobs in
    `tenant_scope(job.tenant_id)` (jobs run outside request context).

Verified live: `zeus_app` with no context sees 0 rows; wrong tenant sees 0
rows; bound tenant sees its rows; `scripts/demo.sh` E2E passes end-to-end.

## Compose topology (all local)

| Service | Port | Notes |
|---|---|---|
| postgres | 5433→5432 | superuser `zeus` (migrations only) |
| redis | 6379 | claims cache |
| migrate | one-shot | applies `services/*/migrations/*.sql` in order |
| platform-core | 8000 | DSN uses `zeus_app` |
| contract-compliance | 8001 | DSN uses `zeus_app` |
| console | 5174 | nginx, proxies `/api/*` |

## Gotchas

- **Adding a tenant-data table?** Add tenant_id, enable+force nothing else —
  copy the policy block from `0002_rls.sql`. Grants for new tables are covered
  by default privileges, policies are not.
- **New guarded routes** get RLS for free via `require_module`. Anything that
  touches tenant data *outside* a guard (jobs, scripts) must use
  `tenant_scope()` or it will read/write zero rows.
- The migrate one-shot re-runs all SQL; new files must be idempotent
  (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, guarded `DO` blocks).
- The repo root is Lovable-connected: commit `platform/` changes promptly or a
  Lovable sync may clobber them.

## What's next (Phase 4 candidates)

- Real auth (Supabase GoTrue) behind the login form; BFF cookie session.
- Billing integration (Stripe) driving `platform.subscriptions`.
- Obligation status workflow (complete/overdue) + My Tasks view.
- RLS on future module schemas as they land.
