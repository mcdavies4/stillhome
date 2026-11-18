-- 0034: monthly plans v2. Customers can pause a plan, get a reminder the day before, manage every plan
-- from one sign-in link, and opt out of marketing email. Safe to run more than once.

alter table public.recurring_plans drop constraint if exists recurring_plans_status_check;
alter table public.recurring_plans add constraint recurring_plans_status_check
  check (status in ('pending','active','on_hold','needs_action','paused','cancelled','declined'));
alter table public.recurring_plans add column if not exists last_reminder_on date;
alter table public.recurring_plans add column if not exists paused_at timestamptz;

create table if not exists public.email_optouts (
  email text primary key,
  source text,
  created_at timestamptz not null default now()
);
alter table public.email_optouts enable row level security;
