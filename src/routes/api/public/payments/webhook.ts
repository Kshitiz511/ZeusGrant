import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);
  }
  return _supabase;
}

function iso(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function priceIdOf(item: any) {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
}

async function handleSubscriptionUpsert(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        product_id: item?.price?.product,
        price_id: priceIdOf(item),
        status: subscription.status,
        current_period_start: iso(periodStart),
        current_period_end: iso(periodEnd),
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        trial_end: iso(subscription.trial_end),
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );

  // One free trial per account: burn the entitlement as soon as a trial starts.
  if (subscription.trial_end || subscription.status === "trialing") {
    await getSupabase().from("profiles").update({ trial_used: true }).eq("id", userId);
  }
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({
      status: "canceled",
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function handleInvoiceStatus(invoice: any, env: StripeEnv, status: "past_due" | "active") {
  const subscriptionId = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription;
  if (!subscriptionId) return;
  await getSupabase()
    .from("subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId)
    .eq("environment", env);
}

/**
 * One-time add-on purchase. Idempotent on the Stripe session id: the unique
 * index on proposal_addon_purchases.stripe_session_id makes replays no-ops.
 */
async function handleAddOnPurchase(session: any, env: StripeEnv) {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const userId = session.metadata?.userId;
  const addonId = session.metadata?.addonId;
  const priceId = session.metadata?.priceId ?? "";
  const drafts = Number(session.metadata?.drafts ?? 0) || 0;
  const cycleStart = session.metadata?.cycleStart ?? null;
  const cycleEnd = session.metadata?.cycleEnd ?? null;
  if (!userId || !addonId) return;

  const db = getSupabase();
  const { error } = await db.from("proposal_addon_purchases").insert({
    user_id: userId,
    addon_id: addonId,
    price_id: priceId,
    drafts_granted: drafts,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    stripe_session_id: session.id,
    status: "paid",
    environment: env,
    cycle_start: cycleStart,
  });

  // Duplicate delivery of the same session: nothing more to do.
  if (error) {
    if (error.code === "23505") return;
    throw new Error(error.message);
  }

  if (drafts > 0 && cycleStart) {
    const { data: counter } = await db
      .from("usage_counters")
      .select("id,addon_drafts_purchased")
      .eq("user_id", userId)
      .eq("period_start", cycleStart)
      .maybeSingle();
    if (counter) {
      await db
        .from("usage_counters")
        .update({ addon_drafts_purchased: (counter.addon_drafts_purchased ?? 0) + drafts })
        .eq("id", counter.id);
    } else {
      await db.from("usage_counters").insert({
        user_id: userId,
        period_start: cycleStart,
        period_end: cycleEnd,
        addon_drafts_purchased: drafts,
      });
    }
  }

  await db.from("proposal_events").insert({
    user_id: userId,
    event: "addon.purchased",
    metadata: { addonId, drafts, amount_total: session.amount_total, environment: env } as never,
  });
}

/** Reverses granted add-on drafts when a purchase is refunded or disputed. */
async function handleAddOnReversal(session: any, env: StripeEnv) {
  const db = getSupabase();
  const { data: purchase } = await db
    .from("proposal_addon_purchases")
    .select("id,user_id,addon_id,drafts_granted,cycle_start,status")
    .eq("stripe_session_id", session.id)
    .eq("environment", env)
    .maybeSingle();
  if (!purchase || purchase.status === "refunded") return;

  await db.from("proposal_addon_purchases").update({ status: "refunded" }).eq("id", purchase.id);

  if (purchase.drafts_granted > 0 && purchase.cycle_start) {
    const { data: counter } = await db
      .from("usage_counters")
      .select("id,addon_drafts_purchased")
      .eq("user_id", purchase.user_id)
      .eq("period_start", purchase.cycle_start)
      .maybeSingle();
    if (counter) {
      await db
        .from("usage_counters")
        .update({
          addon_drafts_purchased: Math.max(
            0,
            (counter.addon_drafts_purchased ?? 0) - purchase.drafts_granted,
          ),
        })
        .eq("id", counter.id);
    }
  }

  await db.from("proposal_events").insert({
    user_id: purchase.user_id,
    event: "addon.reversed",
    metadata: { addonId: purchase.addon_id, drafts: purchase.drafts_granted } as never,
  });
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.trial_will_end":
      await handleSubscriptionUpsert(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    case "invoice.payment_failed":
      await handleInvoiceStatus(event.data.object, env, "past_due");
      break;
    case "invoice.paid":
      await handleInvoiceStatus(event.data.object, env, "active");
      break;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleAddOnPurchase(event.data.object, env);
      break;
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      await handleAddOnReversal(event.data.object, env);
      break;

    default:
      console.log("Unhandled event:", event.type);
  }
}


export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received with invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv as StripeEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
