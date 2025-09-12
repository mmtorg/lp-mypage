-- user_stripe: ユーザーとStripeの顧客紐付け + 簡易メモ
create table if not exists public.user_stripe (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  stripe_customer_id text unique,
  current_plan text,         -- 'lite' | 'business' | null
  updated_at timestamptz not null default now()
);

-- 参照しやすい簡易インデックス
create index if not exists idx_user_stripe_customer on public.user_stripe (stripe_customer_id);

-- RLS（必要に応じて。最低限、本人のみ読み取り可）
alter table public.user_stripe enable row level security;

create policy "Self can read own row"
on public.user_stripe for select
using (auth.uid() = user_id);

-- WebhookからSRKで書き込むので、サービスロールはRLSをバイパスします

