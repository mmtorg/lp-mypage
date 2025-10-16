-- Create views to determine effective and scheduled plans per email
-- Priority: trial first, else latest by id desc

begin;

-- Unified view across recipient_emails and user_stripe
create or replace view public.unified_plans as
select
  id::bigint as id,
  'recipient_emails'::text as source,
  email,
  plan
from public.recipient_emails
union all
select
  id::bigint as id,
  'user_stripe'::text as source,
  email,
  current_plan as plan
from public.user_stripe
where current_plan is not null;

create or replace view public.effective_plan_v as
with ranked as (
  select
    up.*,
    row_number() over (
      partition by lower(email)
      order by (plan in ('lite','business')) desc, id desc
    ) as rn
  from public.unified_plans up
  where plan is not null
)
select
  email,
  source,
  id as source_id,
  plan
from ranked
where rn = 1;

-- Scheduled plan per email: latest non-trial (lite|business)
create or replace view public.scheduled_plan_v as
with ranked as (
  select
    up.*,
    row_number() over (
      partition by lower(email)
      order by id desc
    ) as rn
  from public.unified_plans up
  where plan in ('lite','business')
)
select
  email,
  source,
  id as source_id,
  plan
from ranked
where rn = 1;

commit;
