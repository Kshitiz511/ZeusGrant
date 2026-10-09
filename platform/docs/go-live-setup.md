# Go-live setup: domain, email, Google sign-in, Stripe

All other phases are parked. This is the checklist to put Zeus on a real
domain and switch on email, Google sign-in and payments.

Do the steps **in order**. Later steps need the domain from step 1.

In this guide `yourdomain.com` stands for your real domain. Replace it
everywhere.

Settings that say "Vercel" go here:
**Vercel → project zeus-platform → Settings → Environment Variables →
Production**. After changing any variable, **redeploy**: Deployments → latest →
⋯ → Redeploy. Variables only apply to new deployments.

When you finish a step, send me what the "Send to me" line asks for. I'll set it
up and test it.

---

## Step 0 — What you need (and costs)

| Item | Where | Cost |
|---|---|---|
| Domain name | Cloudflare, Namecheap, GoDaddy, etc. | ~$10–15 / year |
| Vercel | already set up | free (Pro $20/mo for commercial use) |
| Resend (email) | resend.com | free up to 3,000 emails / month |
| Google sign-in | console.cloud.google.com | free |
| Stripe | stripe.com | 2.9% + 30¢ per payment, no monthly fee |
| Supabase (database) | already set up | free; Pro $25/mo recommended before real customers (daily backups, no pausing) |

Vercel's free plan is for non-commercial use only. Upgrade to Pro before you
take real money.

---

## Step 1 — Buy the domain and point it at Vercel

1. Buy `yourdomain.com` from any registrar.
2. In Vercel: **project → Settings → Domains → Add**.
   - Add `yourdomain.com`.
   - Add `www.yourdomain.com`, and set it to redirect to `yourdomain.com`.
3. Vercel shows the DNS records to create. Usually they are:
   - `A` record, name `@`, value `76.76.21.21`
   - `CNAME` record, name `www`, value `cname.vercel-dns.com`
4. Add those records at your registrar's DNS page.
5. Wait until Vercel shows **Valid Configuration**. This takes 5 minutes to a
   few hours. HTTPS is set up automatically.

**Send to me:** the domain name. I'll update:
- the sitemap, canonical links and social-preview links (they currently point
  at `zeus-platform-dun.vercel.app`);
- the login-cookie settings;
- the old `.vercel.app` address, so it redirects to the new domain.

---

## Step 2 — Email from your own domain (Resend)

Right now email is sent from `onboarding@resend.dev`, Resend's test sender. It
can only deliver to the Resend account owner, so other users never receive their
verification or password-reset codes.

1. Log in at **resend.com → Domains → Add Domain**. Enter `yourdomain.com`.
   (Or a subdomain like `mail.yourdomain.com`, which keeps your main domain's
   email reputation separate.)
2. Resend shows 3–4 DNS records (one MX record and TXT records for SPF and
   DKIM). Add each one at your registrar exactly as shown.
3. Click **Verify** in Resend. Wait until it says **Verified**.
4. Recommended: add one more TXT record, for DMARC, so Gmail and Outlook trust
   your mail:
   - name: `_dmarc`
   - value: `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`
5. In Vercel, set:
   - `ZEUS_EMAIL_FROM` = `Zeus <no-reply@yourdomain.com>`
   - `ZEUS_RESEND_API_KEY` = keep the existing one, or create a new key in
     Resend → API Keys
6. Redeploy.

**Test:** sign up with a different email address, or use "Forgot password?".
The code should arrive within a minute and not land in spam.

**Send to me:** "email done". I'll run the signup and reset tests against
production.

---

## Step 3 — Google sign-in

The code for Google sign-in is already built. It is switched off because the
Google keys are missing. Once the three variables below are set, a **Continue
with Google** button appears automatically.

### 3a. Create the Google project

1. Go to **console.cloud.google.com**. Top bar → project picker → **New
   Project** → name it "Zeus" → Create.
2. Left menu → **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - App name: `Zeus`. Support email: your email. Logo: optional.
   - App domain: `https://yourdomain.com`.
   - Privacy policy: `https://yourdomain.com/privacy`.
   - Terms: `https://yourdomain.com/terms`.
   - Authorised domain: `yourdomain.com`.
   - Scopes: add `openid`, `email` and `profile` (nothing else, so Google does
     not need to review the app).
   - Save.
3. On the consent screen page, click **Publish App** so it leaves "Testing"
   mode. In testing mode, only email addresses you list by hand can sign in.

### 3b. Create the keys

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Zeus web`.
3. Authorised JavaScript origins: `https://yourdomain.com`
4. Authorised redirect URIs:
   `https://yourdomain.com/api/core/auth/google/callback`
5. Create. Copy the **Client ID** and **Client Secret**.

### 3c. Add them to Vercel

| Variable | Value |
|---|---|
| `ZEUS_GOOGLE_CLIENT_ID` | the Client ID |
| `ZEUS_GOOGLE_CLIENT_SECRET` | the Client Secret |
| `ZEUS_GOOGLE_REDIRECT_URI` | `https://yourdomain.com/api/core/auth/google/callback` |

Then redeploy.

**Test:** open `https://yourdomain.com/login` → **Continue with Google** → you
should land in the app, signed in.

**Send to me:** "google done". **Never** paste the secret in chat. It goes only
into Vercel.

---

## Step 4 — Stripe payments

The plans exist in the database, but their Stripe price IDs are placeholders
(for example `cc_starter_monthly`). Each one must become a real Stripe ID
(`price_...`).

### 4a. Account

1. Sign up at **stripe.com**. Finish **Activate payments**: business details
   and a bank account. Until this is done you can only use test mode.
2. Build everything in **Test mode** first (toggle at the top right), test it,
   then repeat in Live mode.

### 4b. Create products and prices

**Product catalogue → Add product**. Make one product per paid plan. Give each
product two prices: **Monthly** (recurring, monthly) and **Yearly** (recurring,
yearly). Use USD.

| Product name | Monthly | Yearly |
|---|---|---|
| Contract Compliance – Starter | $39 | $388.44 |
| Contract Compliance – Growth | $79 | $786.84 |
| Contract Compliance – Professional | $149 | $1,484.04 |
| Contract Compliance – Agency | $299 | $2,978.04 |
| Grant Intelligence – Starter | $49 | $488.04 |
| Grant Intelligence – Growth | $99 | $986.04 |
| Grant Intelligence – Professional | $199 | $1,982.04 |
| Grant Intelligence – Agency | $399 | $3,974.04 |
| Audit Compliance – Starter | $59 | $587.64 |
| Audit Compliance – Growth | $129 | $1,284.84 |
| Audit Compliance – Professional | $249 | $2,478.84 |
| Audit Compliance – Agency | $449 | $4,470.84 |

Enterprise plans are "contact us", so they get no Stripe price.

Change the prices if you like. Tell me, and I'll update the prices shown on the
website to match.

After saving each price, open it and copy its **Price ID** (`price_1Q...`).

### 4c. Webhook (how Stripe tells Zeus a payment happened)

1. **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://yourdomain.com/api/core/billing/webhook`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Save, then copy the **Signing secret** (`whsec_...`).

### 4d. Keys into Vercel

| Variable | Value |
|---|---|
| `ZEUS_STRIPE_SECRET_KEY` | Developers → API keys → Secret key (`sk_test_...` first, later `sk_live_...`) |
| `ZEUS_STRIPE_WEBHOOK_SECRET` | the `whsec_...` from 4c |
| `ZEUS_BILLING_PROVIDER` | `stripe` |

Then redeploy.

### 4e. Customer portal

**Settings → Billing → Customer portal**. Turn on cancelling, switching plans
and updating payment methods. This is the page users reach through **Manage
billing**.

**Send to me:** the list of Price IDs, for example
`cc_starter monthly = price_..., yearly = price_...`. Price IDs are not secret,
so pasting them in chat is fine. I'll load them into the plans and run a test
purchase with Stripe's test card (`4242 4242 4242 4242`).

### 4f. Going live

Repeat 4b–4d in **Live mode**. Live mode has its own price IDs, webhook and
keys. Send me the live price IDs.

---

## Step 5 — Database: Supabase Pro (recommended)

On the free plan, the project **pauses after 7 days without traffic** and has
**no daily backups**. Before real customers: **Supabase → Organisation →
Billing → upgrade to Pro**. Nothing else changes.

---

## Step 6 — Final checks (I do these)

When you tell me steps 1–4 are done, I will:

- [ ] Switch every URL in the code and sitemap to `yourdomain.com`
- [ ] Redirect `zeus-platform-dun.vercel.app` → `yourdomain.com`
- [ ] Run signup, verification email and password reset end to end on
      production
- [ ] Run Google sign-in end to end
- [ ] Run a test purchase, then check that the plan unlocks and the webhook is
      received
- [ ] Check the privacy and terms pages: company name, contact email,
      jurisdiction
- [ ] Submit the sitemap to Google Search Console (you'll need to add one DNS
      TXT record I give you)

---

## Quick reference — everything you will add to Vercel

```
ZEUS_EMAIL_FROM            = Zeus <no-reply@yourdomain.com>
ZEUS_RESEND_API_KEY        = re_...
ZEUS_GOOGLE_CLIENT_ID      = ....apps.googleusercontent.com
ZEUS_GOOGLE_CLIENT_SECRET  = GOCSPX-...
ZEUS_GOOGLE_REDIRECT_URI   = https://yourdomain.com/api/core/auth/google/callback
ZEUS_STRIPE_SECRET_KEY     = sk_test_... / sk_live_...
ZEUS_STRIPE_WEBHOOK_SECRET = whsec_...
ZEUS_BILLING_PROVIDER      = stripe
```

**Secrets (never paste in chat):** Resend API key, Google client secret, Stripe
secret key, webhook secret.

**Safe to share:** domain, Google client ID, Stripe price IDs.
