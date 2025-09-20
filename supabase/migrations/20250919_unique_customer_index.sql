-- Ensure unique customer_id for user_stripe to support customer-based upserts
create unique index if not exists uq_user_stripe_customer_id
  on public.user_stripe (stripe_customer_id)
  where stripe_customer_id is not null;

