-- trial_requests: トライアル申込トークンを管理（期限・一回限り）
create table if not exists public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  product_id text not null,
  token text not null,
  status text not null default 'requested', -- requested | activated | consumed | expired
  expires_at timestamptz not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  consumed_at timestamptz
);

create index if not exists idx_trial_requests_token on public.trial_requests (token);
create index if not exists idx_trial_requests_email on public.trial_requests (email);
create index if not exists idx_trial_requests_status on public.trial_requests (status);

-- トークンはグローバル一意
do $$ begin
  alter table public.trial_requests
    add constraint uq_trial_requests_token unique (token);
exception when duplicate_object then null; end $$;

