-- Drop UNIQUE constraint on recipient_emails.email to allow duplicates
-- Safe to run multiple times

begin;

-- Drop UNIQUE constraint if present
alter table if exists public.recipient_emails
  drop constraint if exists recipient_unique_email;

-- Ensure a non-unique index exists for lookups by email
create index if not exists idx_recipient_emails_email
  on public.recipient_emails (email);

commit;

