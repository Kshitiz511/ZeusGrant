# Zeus Platform — Architecture

> Modular, multi-tenant SaaS platform. A shared **Platform Core** provides identity, tenancy, billing and entitlements. Each capability is an **independently sellable service**. Runs on managed free tiers; the only variable cost is LLM usage.

## Stack (locked decisions)

| Concern | Choice | Notes |
| --- | --- | --- |
| Frontend | React (Vite) SPA + SSG marketing | Hosted on Vercel (free) |
| BFF / Gateway | Python **FastAPI** | Single-language backend, Vercel Functions |
| Services | Python **FastAPI** | One per module, schema-per-service |
| Auth | **Supabase Auth** now → Keycloak-ready adapter | Open-source, no lock-in |
| Database | **Supabase Postgres** + RLS | Schema-per-service isolation |
| Cache | **Redis** (Upstash) | Sessions, entitlements, prompt cache |
| Queue / eventing | **QStash** (HTTP MQ) behind `Queue` adapter | RabbitMQ swappable later |
| Storage | Supabase Storage | Evidence, documents |
| Billing | **Stripe** | Per-module subscriptions |
| Observability | **Grafana Cloud** (free) | Logs, metrics, traces via OTel |
| AI | Pluggable `LlmProvider` | OpenAI / Anthropic / Gemini |

Every external dependency sits behind an **adapter interface** (`AuthProvider`, `LlmProvider`, `Queue`, `Cache`, `Storage`, `BillingProvider`) so nothing is a hard lock-in.

---

## 1. High-Level Design (HLD)

### 1.1 System context

```mermaid
flowchart TB
    subgraph Users["Users"]
        Visitor["Prospect<br/>(from Google Ads)"]
        Customer["Tenant user"]
        Admin["Platform admin"]
    end

    subgraph Vercel["Vercel — free tier (stateless)"]
        Marketing["Marketing site + Ads funnel<br/>(SSG)"]
        WebApp["React application<br/>(SPA)"]
        AdminApp["Admin dashboard<br/>(SPA)"]
        BFF["BFF / API Gateway<br/>(FastAPI)"]
    end

    subgraph Core["Platform Core (FastAPI)"]
        Identity["Identity"]
        Tenancy["Tenancy"]
        Entitlements["Entitlements"]
        BillingSvc["Billing webhooks"]
        AdminAPI["Admin API"]
    end

    subgraph Services["Sellable Services (FastAPI)"]
        Grant["Grant Intelligence"]
        Contract["Contract Compliance"]
        Audit["Audit Vault"]
        Worker["AI Worker (async)"]
    end

    subgraph Backbone["Managed Backbone — free tiers"]
        DB[("Supabase Postgres<br/>+ Auth + Storage")]
        Redis[("Redis cache")]
        MQ[["QStash queue"]]
        Grafana["Grafana Cloud"]
    end

    Stripe["Stripe"]
    LLM["LLM provider<br/>(pluggable)"]

    Visitor --> Marketing
    Customer --> WebApp
    Admin --> AdminApp
    Marketing --> WebApp

    WebApp --> BFF
    AdminApp --> BFF
    BFF --> Core
    BFF --> Services

    Core --> DB
    Core --> Redis
    Services --> DB
    Services --> Redis
    Services --> MQ
    MQ --> Worker
    Worker --> LLM
    Worker --> DB

    Stripe -->|webhooks| BillingSvc
    BillingSvc --> Entitlements
    Core -.OTel.-> Grafana
    Services -.OTel.-> Grafana
```

### 1.2 Logical layers

```mermaid
flowchart LR
    subgraph L1["Experience"]
        direction TB
        A1["Marketing / SEO"]
        A2["Tenant app"]
        A3["Admin console"]
    end
    subgraph L2["Edge / BFF"]
        direction TB
        B1["AuthN"]
        B2["Tenant resolve"]
        B3["Entitlement guard"]
        B4["Routing + aggregation"]
    end
    subgraph L3["Domain services"]
        direction TB
        C1["Grant Intelligence"]
        C2["Contract Compliance"]
        C3["Audit Vault"]
    end
    subgraph L4["Async"]
        direction TB
        D1["Queue"]
        D2["AI Worker"]
    end
    subgraph L5["Platform core"]
        direction TB
        E1["Identity"]
        E2["Tenancy"]
        E3["Entitlements"]
        E4["Billing"]
        E5["Prompt + config registry"]
    end
    subgraph L6["Data + infra"]
        direction TB
        F1[("Postgres + RLS")]
        F2[("Redis")]
        F3["Object storage"]
        F4["Observability"]
    end

    L1 --> L2 --> L3 --> L4
    L2 --> L5
    L3 --> L5
    L3 --> L6
    L4 --> L6
    L5 --> L6
```

### 1.3 Entitlement-driven access (the core selling mechanic)

```mermaid
flowchart TD
    Start(["Request hits BFF"]) --> Auth{"Valid session?"}
    Auth -- No --> Reject401["401 Unauthorized"]
    Auth -- Yes --> Tenant["Resolve tenant_id<br/>from JWT claim"]
    Tenant --> Claims["Load entitlement claims<br/>(cached in Redis)"]
    Claims --> Guard{"Tenant owns<br/>this module?"}
    Guard -- No --> Reject403["403 — module locked<br/>(never reaches service)"]
    Guard -- Yes --> Route["Route to module service"]
    Route --> SvcCheck{"Service re-verifies<br/>entitlement"}
    SvcCheck -- No --> Reject403b["403 (defense in depth)"]
    SvcCheck -- Yes --> RLS["DB query under RLS<br/>tenant_id enforced"]
    RLS --> Done(["Response"])
```

---

## 2. Low-Level Design (LLD)

### 2.1 Repository / deployment topology

```mermaid
flowchart TB
    subgraph Monorepo["Turborepo monorepo"]
        subgraph apps["apps/"]
            web["web (React SPA)"]
            mkt["marketing (SSG)"]
            adm["admin (React SPA)"]
            bff["bff (FastAPI)"]
        end
        subgraph svc["services/"]
            core["platform-core"]
            gi["grant-intelligence"]
            cc["contract-compliance"]
            av["audit-vault"]
            aiw["ai-worker"]
        end
        subgraph pkg["packages/"]
            adapters["adapters<br/>(auth,llm,queue,cache,storage,billing)"]
            ent["entitlements<br/>(single source of truth)"]
            ui["ui (shared React)"]
            contracts["contracts<br/>(Pydantic + TS types)"]
            obs["observability (OTel)"]
        end
    end

    web --> ui
    adm --> ui
    web --> contracts
    bff --> contracts
    bff --> ent
    core --> ent
    core --> adapters
    gi --> adapters
    cc --> adapters
    av --> adapters
    aiw --> adapters
    core --> obs
    gi --> obs
    cc --> obs
    av --> obs
```

### 2.2 Adapter interfaces (removes vendor lock-in)

```mermaid
classDiagram
    class LlmProvider {
        <<interface>>
        +generate(prompt, opts) Completion
        +extract(schema, text) Json
        +embed(text) Vector
    }
    class Queue {
        <<interface>>
        +publish(topic, payload) MsgId
        +schedule(topic, payload, delay) MsgId
    }
    class Cache {
        <<interface>>
        +get(key) Value
        +set(key, value, ttl) void
        +invalidate(pattern) void
    }
    class AuthProvider {
        <<interface>>
        +verify(token) Session
        +issueClaims(userId, tenantId) Jwt
    }
    class Storage {
        <<interface>>
        +put(bucket, key, bytes) Url
        +signedUrl(bucket, key, ttl) Url
    }
    class BillingProvider {
        <<interface>>
        +createCheckout(tenant, priceId) Session
        +handleWebhook(event) EntitlementChange
    }

    LlmProvider <|.. OpenAIAdapter
    LlmProvider <|.. AnthropicAdapter
    LlmProvider <|.. GeminiAdapter
    Queue <|.. QStashAdapter
    Queue <|.. RabbitMQAdapter
    Cache <|.. RedisAdapter
    AuthProvider <|.. SupabaseAuthAdapter
    AuthProvider <|.. KeycloakAdapter
    Storage <|.. SupabaseStorageAdapter
    BillingProvider <|.. StripeAdapter
```

### 2.3 Multi-tenant data model (platform core)

```mermaid
erDiagram
    TENANTS ||--o{ MEMBERSHIPS : has
    TENANTS ||--o{ SUBSCRIPTIONS : owns
    TENANTS ||--o{ ENTITLEMENTS : granted
    USERS ||--o{ MEMBERSHIPS : joins
    SUBSCRIPTIONS ||--|| ENTITLEMENTS : produces
    MODULES ||--o{ PLANS : offers
    PLANS ||--o{ SUBSCRIPTIONS : billed_as
    PLANS ||--o{ PLAN_LIMITS : defines

    TENANTS {
        uuid id PK
        string name
        uuid owner_user_id
        string status
        timestamptz created_at
    }
    USERS {
        uuid id PK
        string email
        string auth_provider
    }
    MEMBERSHIPS {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        string role "owner|admin|member|viewer"
    }
    MODULES {
        string id PK "grant|contract|audit"
        string name
    }
    PLANS {
        string id PK
        string module_id FK
        int monthly_cents
        int annual_cents
        string stripe_price_id
    }
    PLAN_LIMITS {
        string plan_id FK
        string limit_key
        int limit_value
    }
    SUBSCRIPTIONS {
        uuid id PK
        uuid tenant_id FK
        string plan_id FK
        string module_id
        string status "trialing|active|past_due|canceled"
        string stripe_subscription_id
        timestamptz period_end
    }
    ENTITLEMENTS {
        uuid id PK
        uuid tenant_id FK
        string module_id
        string plan_id
        string status
        jsonb limits
        timestamptz refreshed_at
    }
```

### 2.4 Checkout → provisioning sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as Tenant user
    participant W as React app
    participant B as BFF
    participant C as Platform Core
    participant S as Stripe
    participant R as Redis

    U->>W: Pick "Grant Intelligence" plan
    W->>B: POST /checkout {module, plan}
    B->>C: createCheckout(tenant, priceId)
    C->>S: Create Checkout Session (per-module)
    S-->>C: clientSecret
    C-->>B: clientSecret
    B-->>W: clientSecret
    W->>S: Complete payment (embedded)
    S-->>C: webhook: checkout.completed / subscription.updated
    C->>C: Upsert subscription + entitlement (module=grant)
    C->>R: Invalidate entitlement cache(tenant)
    C-->>S: 200
    U->>W: Next request
    W->>B: GET /grant/...
    B->>R: Load entitlement claims (miss → DB → cache)
    B->>B: Guard: tenant owns "grant" ✔
    B-->>W: Access granted (others still locked)
```

### 2.5 Async AI job (queue + worker)

```mermaid
sequenceDiagram
    autonumber
    participant W as React app
    participant B as BFF
    participant CC as Contract svc
    participant Q as Queue (QStash)
    participant AW as AI Worker
    participant L as LlmProvider
    participant DB as Postgres

    W->>B: POST /contract/{id}/extract
    B->>CC: extract(contractId) [entitlement ok]
    CC->>DB: insert job (status=queued)
    CC->>Q: publish("contract.extract", {jobId})
    CC-->>W: 202 Accepted {jobId}
    Q->>AW: deliver job (HTTP)
    AW->>DB: load contract text + prompt (from registry)
    AW->>L: extract(schema, text)
    L-->>AW: structured obligations
    AW->>DB: save results, status=done
    AW->>Q: publish("contract.extract.done", {jobId})
    W->>B: poll GET /contract/jobs/{jobId}
    B->>CC: status(jobId)
    CC-->>W: done + results
```

### 2.6 Admin control plane (live config, no redeploy)

```mermaid
flowchart LR
    Admin["Platform admin"] --> AdminApp["Admin dashboard"]
    AdminApp --> AdminAPI["Admin API (core)"]

    AdminAPI --> Keys["LLM keys + model<br/>(encrypted at rest)"]
    AdminAPI --> Prompts["Versioned prompt registry"]
    AdminAPI --> Pricing["Plans + pricing"]
    AdminAPI --> Flags["Feature flags / kill switch"]
    AdminAPI --> Tenants["Tenant management"]

    Keys --> DB[("Postgres")]
    Prompts --> DB
    Pricing --> DB
    Flags --> DB
    Tenants --> DB

    DB --> Cache[("Redis")]
    Cache -.hot config.-> Worker["AI Worker"]
    Cache -.hot config.-> Services["Module services"]
```

---

## 3. Cross-cutting concerns

```mermaid
mindmap
  root((Platform<br/>concerns))
    Security
      Gateway entitlement guard
      Service re-check
      Postgres RLS
      Append-only audit log
    Observability
      OTel traces
      Structured logs
      Per-tenant cost metrics
    Reliability
      Async retries
      Idempotent webhooks
      Circuit breaker on LLM
    Cost
      Free-tier backbone
      LLM usage only
      Redis-cached prompts
    Portability
      Adapter interfaces
      Schema-per-service
      Open-source stack
```

---

## 4. Migration path (strangler pattern)

```mermaid
flowchart LR
    P0["Phase 0<br/>Foundations<br/>+ de-lock-in"] --> P1["Phase 1<br/>Platform core<br/>+ tenancy + entitlements"]
    P1 --> P2["Phase 2<br/>Migrate services<br/>Contract → Audit → Grant"]
    P2 --> P3["Phase 3<br/>Ads funnel + observability<br/>+ launch hardening"]

    P0 -.deliverable.-> d0["AI abstraction live,<br/>vendor config removed"]
    P1 -.deliverable.-> d1["Self-serve signup →<br/>checkout → auto-provision"]
    P2 -.deliverable.-> d2["Each module its own<br/>service + schema"]
    P3 -.deliverable.-> d3["100-user load test passed"]
```

**Order of service extraction:** Contract Compliance first (cleanest boundaries, `compliance_*` tables already isolated), then Audit Vault, then Grant Intelligence.
