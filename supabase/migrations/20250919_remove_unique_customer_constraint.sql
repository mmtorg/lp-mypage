-- Allow multiple subscriptions per customer by removing the UNIQUE constraint
-- on stripe_customer_id. Keep regular index usage for lookups.

do $$ begin
  alter table public.user_stripe
    drop constraint if exists uq_user_stripe_customer_id;
exception when undefined_object then null; end $$;

-- Ensure there is a non-unique index for fast lookups (usually already present)
create index if not exists idx_user_stripe_customer on public.user_stripe (stripe_customer_id);

