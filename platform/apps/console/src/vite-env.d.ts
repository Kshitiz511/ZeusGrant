/// <reference types="vite/client" />

// Build-time configuration exposed to the browser. Only VITE_-prefixed values
// are inlined by Vite, which is the guard against leaking server secrets.
interface ImportMetaEnv {
  /** Stripe publishable key. Safe to ship to the client by design. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
