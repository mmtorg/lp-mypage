-- Add linkage fields and origin tracking for subscription records

-- recipient_emails: created_via ('initial' | 'addon'), stripe_subscription_id
alter table if exists public.recipient_emails
  add column if not exists created_via text,
  add column if not exists stripe_subscription_id text,
  add column if not exists pending_removal boolean not null default false;

do $$ begin
  alter table public.recipient_emails
    add constraint recipient_emails_created_via_check
    check (created_via in ('initial','addon'));
exception when duplicate_object then null; end $$;

create index if not exists idx_recipient_emails_subscription
  on public.recipient_emails (stripe_subscription_id);

-- user_stripe: stripe_subscription_id
alter table if exists public.user_stripe
  add column if not exists stripe_subscription_id text;

create index if not exists idx_user_stripe_subscription
  on public.user_stripe (stripe_subscription_id);

