import Stripe from "stripe";

// Stripe (£ payments) can be dormant: with no key the client still has to be constructible at build time.
// Nothing calls Stripe unless NEXT_PUBLIC_UK_PAY_ENABLED=1, and a call with this placeholder simply fails.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_not_configured", {
  apiVersion: "2024-06-20",
});
