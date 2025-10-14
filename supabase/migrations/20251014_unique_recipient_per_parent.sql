-- Ensure unique recipient per subscription(parent)
-- Safe to run multiple times. This migration:
-- 1) Deduplicates rows by (user_stripe_id, email) keeping the smallest id
-- 2) Adds a UNIQUE index on (user_stripe_id, email)

begin;

-- 1) Deduplicate duplicates within same parent/email
with dups as (
  select id
  from (
    select id,
           row_number() over (
             partition by coalesce(user_stripe_id, -1), lower(email)
             order by id
           ) as rn
    from public.recipient_emails
  ) t
  where t.rn > 1
)
delete from public.recipient_emails re
using dups
where re.id = dups.id;

-- 2) Add UNIQUE index on (user_stripe_id, email)
do $$ begin
  create unique index if not exists uq_recipient_per_parent
    on public.recipient_emails (user_stripe_id, email);
exception when duplicate_table then null; end $$;

commit;

