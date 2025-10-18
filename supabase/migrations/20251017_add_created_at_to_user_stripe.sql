-- Add created_at column to public.user_stripe while keeping updated_at
-- Idempotent and safe for existing data.

begin;

-- 1) Add column if missing
alter table if exists public.user_stripe
  add column if not exists created_at timestamptz;

-- 2) Backfill from updated_at when null; fallback to now()
update public.user_stripe
   set created_at = coalesce(created_at, updated_at, now())
 where created_at is null;

-- 3) Enforce not null and default
alter table if exists public.user_stripe
  alter column created_at set not null,
  alter column created_at set default now();

commit;

