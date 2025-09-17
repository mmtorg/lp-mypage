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

-- 追加配信先メールアドレスの保存テーブル
create table if not exists public.recipient_emails (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text, -- 'lite' | 'business' | null（保存時点のプランをメモ）
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_recipient_emails_user on public.recipient_emails (user_id);
create index if not exists idx_recipient_emails_email on public.recipient_emails (email);
-- 同一ユーザー内で同一メールを重複登録しない
do $$ begin
  alter table public.recipient_emails
    add constraint recipient_unique_per_user unique (user_id, email);
exception when duplicate_object then null; end $$;

-- 全体としてもメールをユニークにする（ニュース配信先として重複しない運用）
-- （運用方針）メールはユーザー単位でユニーク。全体ユニークは付与しない

alter table public.recipient_emails enable row level security;

-- 本人は自分の受信者のみ参照可能（必要に応じて拡張）
create policy "Self can read own recipients"
on public.recipient_emails for select
using (auth.uid() = user_id);

-- Override: enforce global uniqueness on recipient_emails.email
alter table public.recipient_emails drop constraint if exists recipient_unique_per_user;
do $$ begin
  alter table public.recipient_emails
    add constraint recipient_unique_email unique (email);
exception when duplicate_object then null; end $$;
