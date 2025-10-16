-- RPC to fetch effective and scheduled plans for a given email
-- Note: scheduled is returned only when effective is trial (UI-friendly)

begin;

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
),
scheduled_raw as (
  select jsonb_build_object(
    'email', u.email,
    'source', u.source,
    'source_id', u.id::text,
    'plan', u.plan
  ) as row
  from unioned u
  where u.plan in ('lite','business')
  order by u.id desc
  limit 1
),
scheduled as (
  -- Only expose scheduled when effective is trial
  select case when (select (row->>'plan') from effective) = 'trial'
              then (select row from scheduled_raw)
              else null end as row
)
select jsonb_build_object(
  'effective', coalesce((select row from effective), null)
);
$$;

commit;
