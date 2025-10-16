-- Remove scheduled output from RPC and drop scheduled view

begin;

-- Drop the scheduled view as the concept is no longer used
drop view if exists public.scheduled_plan_v;

-- Simplify RPC: return only effective plan info
create or replace function public.get_subscription_status(p_email text)
returns jsonb
language sql
stable
as $$
with unioned as (
  select id, source, email, plan
  from public.unified_plans
  where plan is not null
    and lower(email) = lower(p_email)
),
effective as (
  select jsonb_build_object(
    'email', u.email,
    'source', u.source,
    'source_id', u.id::text,
    'plan', u.plan
  ) as row
  from unioned u
  order by (u.plan in ('lite','business')) desc, u.id desc
  limit 1
)
select jsonb_build_object(
  'effective', coalesce((select row from effective), null)
);
$$;

commit;

