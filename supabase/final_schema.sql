-- ============================================================
-- Final schema for Stripe-integrated MyPage
-- Purpose:
--   - Persist linkage to Stripe customer and cached plan (user_stripe)
--   - Store newsletter/notification recipients (recipient_emails)
-- Notes:
--   - Writes are performed by server (service role) via webhooks/APIs
--   - Clients read only their own rows (RLS)
--   - Auth users table: auth.users (managed by Supabase)
-- ============================================================

-- ========================
-- Table: public.user_stripe
-- ========================
create table if not exists public.user_stripe (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  stripe_customer_id text unique,
  current_plan text,             -- 'lite' | 'business' | null (cached)
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_user_stripe_customer on public.user_stripe (stripe_customer_id);

-- RLS (read own rows)
alter table public.user_stripe enable row level security;
do $$ begin
  create policy "Self can read own row"
  on public.user_stripe for select
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ===============================
-- Table: public.recipient_emails
-- ===============================
create table if not exists public.recipient_emails (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text,                      -- 'lite' | 'business' | null (snapshot)
  email text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_recipient_emails_user on public.recipient_emails (user_id);
create index if not exists idx_recipient_emails_email on public.recipient_emails (email);

-- Uniqueness: per user only (global duplicate allowed across different users)
do $$ begin
  alter table public.recipient_emails
    add constraint recipient_unique_per_user unique (user_id, email);
exception when duplicate_object then null; end $$;

-- RLS (read own recipients)
alter table public.recipient_emails enable row level security;
do $$ begin
  create policy "Self can read own recipients"
  on public.recipient_emails for select
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ============================================================
-- Operational notes (documentation, not executed by DB):
-- - Webhook (checkout.session.completed): auto-create user if missing,
--   upsert user_stripe, upsert purchaser email into recipient_emails
-- - Webhook (customer.subscription.*): update user_stripe.current_plan
-- - API (/api/recipients): upsert ownerEmail + additional recipients
-- - API (/api/stripe/subscription-by-email): read-through cache
--   (TTL via env SUBSCRIPTION_CACHE_TTL_SECONDS), update user_stripe,
--   ensure purchaser email exists in recipient_emails
-- ============================================================

