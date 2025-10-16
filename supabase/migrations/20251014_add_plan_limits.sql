-- Plan base recipient slots table
-- Allows changing free base slots per plan without code changes

begin;

create table if not exists public.plan_limits (
  plan text primary key,
  base_recipient_slots integer not null,
  updated_at timestamptz not null default now()
);

-- Seed defaults only if not exists (Lite=1, Business=4)
insert into public.plan_limits (plan, base_recipient_slots)
values ('lite', 1)
on conflict (plan) do nothing;

insert into public.plan_limits (plan, base_recipient_slots)
values ('business', 4)
on conflict (plan) do nothing;

commit;

