import { createServerFn } from "@tanstack/react-start";
import type Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { ADD_ONS } from "@/lib/addons";

type CheckoutSessionResult = { clientSecret: string } | { error: string };
type PortalSessionResult = { url: string } | { error: string };
type PlanChangeResult = { status: string; priceId: string } | { error: string };
type SyncResult = { synced: number } | { error: string };

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

/**
 * Each module (Grant Intelligence, Contract Compliance, Audit Compliance) is
 * bought and billed on its own, so "already subscribed" is judged per module,
 * not per account. Legacy price ids without a module prefix belong to Grant
 * Intelligence.
 */
function moduleOf(priceId: string | null | undefined): string {
  if (!priceId) return "unknown";
  const m = /^(gi|cc|ac)_/.exec(priceId);
  return m ? m[1]! : "gi";
}


async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length && found.data[0]) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    const customer = existing.data[0];
    if (customer) {
      if (options.userId && customer.metadata?.['userId'] !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

function iso(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function priceIdOf(item: any) {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
}

/**
 * Creates an embedded checkout session.
 * - Refuses to start a second subscription when one is already active
 *   (the caller must use changeSubscriptionPlan instead).
 * - Grants the free trial only once per account.
 */
export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { priceId: string; returnUrl: string; environment: StripeEnv; trialDays?: number }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const {
        data: { user },
      } = await context.supabase.auth.getUser();
      const userId = context.userId;

      const wantedModule = moduleOf(data.priceId);

      const { data: allRows } = await context.supabase
        .from("subscriptions")
        .select("status,price_id,current_period_end")
        .eq("user_id", userId)
        .eq("environment", data.environment);

      const moduleRows = (allRows ?? []).filter((s) => moduleOf(s.price_id) === wantedModule);

      const hasActive = moduleRows.some(
        (s) =>
          ACTIVE_STATUSES.includes(s.status) &&
          (!s.current_period_end || new Date(s.current_period_end) > new Date()),
      );
      if (hasActive) {
        return {
          error:
            "You already have this module. Use “Change plan” to switch tiers instead of buying it again.",
        };
      }

      // One free trial per module, ever.
      const trialAllowed = moduleRows.length === 0;


      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      const stripePrice = prices.data[0];
      if (!stripePrice) throw new Error("Price not found");
      const isRecurring = stripePrice.type === "recurring";

      const customerId = await resolveOrCreateCustomer(stripe, {
        ...(user?.email ? { email: user.email } : {}),
        userId,
      });

      let productDescription: string | undefined;
      if (!isRecurring) {
        const productId =
          typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
        const product = await stripe.products.retrieve(productId);
        productDescription = (product as Stripe.Product).name;
      }

      const trialDays = trialAllowed && data.trialDays ? data.trialDays : 0;

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        managed_payments: { enabled: true },
        metadata: { userId, managed_payments: "true" },
        ...(!isRecurring && { payment_intent_data: { description: productDescription } }),
        ...(isRecurring && {
          subscription_data: {
            metadata: { userId },
            ...(trialDays ? { trial_period_days: trialDays } : {}),
          },
        }),
      } as Stripe.Checkout.SessionCreateParams);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Reports whether the signed-in account is still eligible for the free trial. */
export const getTrialEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ trialAvailable: boolean }> => {
    const { data } = await context.supabase
      .from("profiles")
      .select("trial_used")
      .eq("id", context.userId)
      .maybeSingle();
    return { trialAvailable: !data?.trial_used };
  });

/** Switches an existing subscription to a different price, with proration. */
export const changeSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    return data;
  })
  .handler(async ({ data, context }): Promise<PlanChangeResult> => {
    const { supabase, userId } = context;

    const { data: rows } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id,status,price_id,current_period_end")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false });

    // Only switch tiers inside the same module.
    const current = (rows ?? [])
      .filter((s) => moduleOf(s.price_id) === moduleOf(data.priceId))
      .find((s) => !s.current_period_end || new Date(s.current_period_end) > new Date());
    if (!current) return { error: "No active subscription for this module. Start it first." };
    if (current.price_id === data.priceId) return { error: "You are already on this plan." };


    try {
      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      const target = prices.data[0];
      if (!target) return { error: "Price not found" };

      const subscription = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
      const item = subscription.items.data[0];
      if (!item) return { error: "Subscription has no billable item" };

      const updated = await stripe.subscriptions.update(current.stripe_subscription_id, {
        items: [{ id: item.id, price: target.id }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata: { ...(subscription.metadata ?? {}), userId },
      });

      return { status: updated.status, priceId: data.priceId };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Cancels at period end, or resumes a subscription already set to cancel. */
export const setCancelAtPeriodEnd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cancel: boolean; environment: StripeEnv; priceId?: string }) => data)
  .handler(async ({ data, context }): Promise<PlanChangeResult> => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id,price_id,current_period_end")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false });

    // When a module is named, cancel/resume only that module's subscription.
    const pool = data.priceId
      ? (rows ?? []).filter((s) => moduleOf(s.price_id) === moduleOf(data.priceId))
      : (rows ?? []);
    const current = pool[0];
    if (!current) return { error: "No active subscription found." };


    try {
      const stripe = createStripeClient(data.environment);
      const updated = await stripe.subscriptions.update(current.stripe_subscription_id, {
        cancel_at_period_end: data.cancel,
      });
      return { status: updated.status, priceId: current.price_id };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * Pulls the caller's subscriptions straight from Stripe and writes them to the
 * database. Used right after checkout so the UI is correct even if the webhook
 * is delayed, and as a self-heal for missed events.
 */
export const syncSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<SyncResult> => {
    const userId = context.userId;
    try {
      const stripe = createStripeClient(data.environment);
      const {
        data: { user },
      } = await context.supabase.auth.getUser();

      const customerId = await resolveOrCreateCustomer(stripe, {
        ...(user?.email ? { email: user.email } : {}),
        userId,
      });

      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
        expand: ["data.items.data.price"],
      });

      if (!subs.data.length) return { synced: 0 };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const rows = subs.data.map((s) => {
        const item: any = s.items?.data?.[0];
        const periodStart = item?.current_period_start ?? (s as any).current_period_start;
        const periodEnd = item?.current_period_end ?? (s as any).current_period_end;
        return {
          user_id: userId,
          stripe_subscription_id: s.id,
          stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer.id,
          product_id: String(item?.price?.product ?? ""),
          price_id: String(priceIdOf(item) ?? ""),
          status: s.status,
          current_period_start: iso(periodStart),
          current_period_end: iso(periodEnd),
          cancel_at_period_end: s.cancel_at_period_end ?? false,
          trial_end: iso(s.trial_end),
          environment: data.environment,
          updated_at: new Date().toISOString(),
        };
      });

      await supabaseAdmin.from("subscriptions").upsert(rows, { onConflict: "stripe_subscription_id" });

      if (rows.some((r) => r.trial_end)) {
        await supabaseAdmin.from("profiles").update({ trial_used: true }).eq("id", userId);
      }

      return { synced: rows.length };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalSessionResult> => {
    const { supabase, userId } = context;

    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError || !sub?.stripe_customer_id) return { error: "No subscription found" };

    try {
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * One-time add-on checkout (extra proposal drafts, human review, templates,
 * full-service writing). Kept separate from createCheckoutSession because
 * add-ons are purchasable while a subscription is active.
 */
export const createAddOnCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { addonId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.addonId)) throw new Error("Invalid addonId");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const addon = ADD_ONS.find((a) => a.id === data.addonId);
    if (!addon) return { error: "Unknown add-on" };

    try {
      const stripe = createStripeClient(data.environment);
      const userId = context.userId;
      const {
        data: { user },
      } = await context.supabase.auth.getUser();

      // Add-on drafts are credited to the caller's current billing cycle.
      const { data: cycleStart } = await context.supabase.rpc("my_billing_cycle_start", {
        _env: data.environment,
      });
      const start = (cycleStart as string | null) ?? new Date().toISOString().slice(0, 10);
      const endDate = new Date(`${start}T00:00:00Z`);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1);

      const prices = await stripe.prices.list({ lookup_keys: [addon.priceId] });
      const stripePrice = prices.data[0];
      if (!stripePrice) return { error: "Price not found" };

      const customerId = await resolveOrCreateCustomer(stripe, {
        ...(user?.email ? { email: user.email } : {}),
        userId,
      });

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        managed_payments: { enabled: true },
        payment_intent_data: { description: addon.name },
        metadata: {
          userId,
          addonId: addon.id,
          priceId: addon.priceId,
          drafts: String(addon.drafts),
          contractSlots: String(addon.contractSlots ?? 0),
          cycleStart: start,
          cycleEnd: endDate.toISOString().slice(0, 10),
          managed_payments: "true",
        },
      } as Stripe.Checkout.SessionCreateParams);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
