-- Migration: drop unique constraint on stripe_customer_id to allow
-- multiple subscriptions per Stripe customer.
-- Safe to run multiple times.

-- Drop the unique index if it exists
drop index if exists uq_user_stripe_customer_id;

-- Ensure non-unique index on customer_id exists for lookups
create index if not exists idx_user_stripe_customer on public.user_stripe (stripe_customer_id);
