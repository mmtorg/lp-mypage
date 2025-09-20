-- Migrate from partial unique indexes to proper UNIQUE constraints
-- so that ON CONFLICT can be used reliably.

-- 1) Drop partial unique indexes (safe if not present)
drop index if exists uq_user_stripe_subscription_id;
drop index if exists uq_user_stripe_customer_id;

-- 2) Add UNIQUE constraints (allow multiple NULLs by Postgres semantics)
do $$ begin
  alter table public.user_stripe
    add constraint uq_user_stripe_subscription_id unique (stripe_subscription_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_stripe
    add constraint uq_user_stripe_customer_id unique (stripe_customer_id);
exception when duplicate_object then null; end $$;

