import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createAddOnCheckoutSession } from "@/utils/payments.functions";

/** Embedded checkout for a one-time add-on purchase. */
export function AddOnCheckout({ addonId, returnUrl }: { addonId: string; returnUrl?: string }) {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createAddOnCheckoutSession({
      data: {
        addonId,
        returnUrl: returnUrl || window.location.href,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Checkout could not be started");
    return result.clientSecret;
  };

  return (
    <div id="addon-checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
