import Stripe from "stripe";

// Configure Stripe client. Use fetch-based HTTP client so it works on
// Cloudflare Workers/edge runtimes as well as Node during local dev.
const MAX_NETWORK_RETRIES = Number(process.env.STRIPE_MAX_NETWORK_RETRIES ?? 2);

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  // Pin an API version if desired; omit to use account default.
  // apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
  maxNetworkRetries: isFinite(MAX_NETWORK_RETRIES) ? MAX_NETWORK_RETRIES : 2,
});
