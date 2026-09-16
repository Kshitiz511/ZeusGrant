# Platform architecture

What is actually running under `platform/`. Root `src/` is the old Lovable app and is not part of this.

One Vercel function serves the console and both APIs. Two FastAPI services, one Postgres, one job ledger.

```mermaid
flowchart TB
  Browser["Browser"]
  Agent["MCP client / agent"]

  subgraph Vercel["Vercel — one function"]
    SPA["Console SPA"]
    Entry["api/index.py"]
    Core["platform-core  /api/core"]
    CC["contract-compliance  /api/cc"]
  end

  subgraph CoreSvc["platform-core"]
    Auth["Auth<br/>password · Google · sessions"]
    Tenancy["Tenancy<br/>memberships"]
    Billing["Billing · entitlements"]
    Grants["Grant Intelligence<br/>profile · scan · match"]
    Admin["Admin · runtime config"]
  end

  subgraph CCSvc["contract-compliance"]
    Contracts["Contracts · documents"]
    Extract["Extract · obligations"]
    Audit["Audit log"]
  end

  subgraph Shared["Shared"]
    Kit["service-kit<br/>guard · jobs · worker"]
    Adapters["adapters"]
  end

  MCP["MCP  zeus-grants<br/>stdio · DB queries only"]

  subgraph Jobs["Jobs"]
    Ledger["platform.jobs"]
    Wake["QStash wake"]
    Worker["In-process worker"]
  end

  subgraph Data["Postgres + RLS"]
    P["platform.*"]
    CCs["contract_compliance.*"]
  end

  Ext["Stripe · Redis · Resend · OpenAI · Google · storage"]

  Browser --> SPA
  Browser --> Entry
  SPA -.->|"same origin"| Entry
  Entry --> Core
  Entry --> CC
  Entry --> SPA

  Core --> CoreSvc
  CC --> CCSvc
  CoreSvc --> Kit
  CCSvc --> Kit
  Kit --> Adapters
  Agent --> MCP
  MCP --> Grants

  CoreSvc -->|"bind_tenant"| P
  CCSvc -->|"bind_tenant"| CCs
  Kit --> Ledger
  Ledger --> Wake
  Wake --> Worker
  Worker --> Grants
  Worker --> Extract

  Adapters --> Data
  Adapters --> Ext
```

## Request path

Every authenticated call goes through the same four checks.

```mermaid
sequenceDiagram
  participant UI as Console
  participant API as Service
  participant DB as Postgres

  UI->>API: cookie + optional X-Tenant-Id
  API->>API: JWT → user + default tenant
  alt header names a different tenant
    API->>DB: memberships + tenant is active
    API-->>UI: 404 if not a member
  end
  API->>DB: entitlements for that tenant
  API-->>UI: 403 / 402 if locked or over quota
  API->>DB: SET app.current_tenant then query
  Note over DB: RLS on every tenant-scoped table
  DB-->>API: only that tenant's rows
```

## What sits where

| Piece | Role |
|---|---|
| Console | `apps/console` — login, billing, grants, contracts |
| Entrypoint | `api/index.py` — mounts both APIs and serves the SPA |
| platform-core | identity, tenancy, billing, Grant Intelligence, admin |
| contract-compliance | contracts, documents, extraction, obligations |
| MCP `zeus-grants` | stdio tools over the same grant data; no model in the tool path |
| service-kit | membership check, module guard, job ledger, worker |
| adapters | db, cache, queue, llm, billing, email, storage, auth — swapped by env |

Auth is first-party: email/password and Google OAuth, sessions as JWTs. Not Supabase Auth.

## Jobs

Slow work (grant scan, contract extraction) is a row in `platform.jobs`. Enqueue publishes a QStash wake. The same serverless function drains the ledger for its own module. A failed publish does not lose the row.

## Data

Two schemas. Tenant-scoped tables have RLS enabled and forced.

- `platform.*` — users, sessions, tenants, memberships, subscriptions, entitlements, jobs, org_profiles, opportunities, matches
- `contract_compliance.*` — contracts, documents, obligations, audit_log

Shared catalogue and config tables have no `tenant_id` and no RLS.

## Local vs production

Same paths in both. Vite proxies `/api/core` and `/api/cc` locally; production mounts them in one function. MCP is a separate stdio process, not part of the HTTP function.
