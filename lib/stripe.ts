import Stripe from "stripe";

// Configure Stripe client with conservative retries to reduce rate-limit impact
const MAX_NETWORK_RETRIES = Number(process.env.STRIPE_MAX_NETWORK_RETRIES ?? 2);

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  maxNetworkRetries: isFinite(MAX_NETWORK_RETRIES) ? MAX_NETWORK_RETRIES : 2,
});
