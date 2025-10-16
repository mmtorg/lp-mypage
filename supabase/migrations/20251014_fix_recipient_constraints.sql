-- This migration corrects the unique constraints on the recipient_emails table.
-- It removes the incorrect global unique constraint on 'email' and
-- adds the correct composite unique index on '(user_stripe_id, email)'.
-- This is idempotent and safe to run multiple times.

begin;

-- 1. Drop the global unique constraint on email, if it exists.
-- The original constraint might have been named recipient_unique_email or recipients_email_key.
-- We will try to drop both for robustness.
alter table if exists public.recipient_emails
  drop constraint if exists recipient_unique_email;

alter table if exists public.recipient_emails
  drop constraint if exists recipients_email_key;

-- 2. Ensure a non-unique index on email exists for fast lookups (optional but good practice).
create index if not exists idx_recipient_emails_email
  on public.recipient_emails (email);

-- 3. Deduplicate any existing rows that would violate the new constraint.
-- This keeps the first-created row for each (user_stripe_id, email) pair.
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


-- 4. Add the correct composite UNIQUE index on (user_stripe_id, email).
-- This allows an email to be used by multiple parents, but only once per parent.
do $$ begin
  create unique index if not exists uq_recipient_per_parent
    on public.recipient_emails (user_stripe_id, email);
exception when duplicate_table then null; end $$;

commit;
