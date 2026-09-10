# Zeus Console

A thin, **decoupled** frontend over the Zeus platform APIs (platform-core +
Contract Compliance). It reuses the legacy app's **Zeus Consulting design
system** verbatim — same Tailwind v4 oklch tokens, Figtree font, and shadcn/ui
primitives — so it is visually identical while staying its own app.

## Architecture

- **Same-origin only.** The browser never calls services directly. Everything
  goes through `/api/core` and `/api/cc`, which Vite proxies to platform-core
  (`:8000`) and contract-compliance (`:8001`). This mirrors the production
  reverse-proxy / BFF topology → no CORS, no cross-site token leakage.
- **Caching = React Query.** Responses are cached per query key, deduped, and
  served stale-while-revalidate. Fewer calls to the pay-per-invoke serverless
  backend → cost-effective by default.
- **Entitlement-aware UI.** The Contract Compliance module only renders when
  `entitlements/me` grants it — the frontend mirror of the backend guard.
- **Responsive.** Fluid layout with `max-w-6xl`, `dvh` units, wrapping
  toolbars, and horizontally-scrollable tables. No fixed widths → no breakage
  when resizing on desktop or phone.

## Security notes

- The access token (short-lived JWT) is held **only in memory** (a ref), never
  in `localStorage`/`sessionStorage` — keeps it out of reach of persistent XSS
  token theft.
- Only the **non-secret identity** (user/tenant id) is persisted to
  `sessionStorage` to silently re-mint a dev token on reload; it clears when the
  tab closes.
- **Production target:** replace the dev-token dance with an httpOnly, Secure,
  SameSite cookie issued by a BFF — the UI then never sees a token at all.

## Run

Backend must be up (`docker compose up -d` in `platform/`), then:

```bash
cd platform/apps/console
npm install
npm run dev            # http://localhost:5173
```

Sign in uses the seeded demo tenant by default — press **Continue**, create a
contract, and click **Analyze with AI** to run obligation extraction through
the configured LLM (local Ollama gemma3 by default).

Override proxy targets if your services run elsewhere:

```bash
ZEUS_CORE_URL=http://127.0.0.1:8000 ZEUS_CC_URL=http://127.0.0.1:8001 npm run dev
```
