-- 0033: Repeat monthly. A customer who pays a Nigerian bill by card can agree to repeat it each month.
-- Each month we create an ordinary order and charge the saved card with Paystack's charge_authorization.
-- Nothing runs until the customer has ticked the consent box on checkout, and every plan can be cancelled
-- from the link in every email. Not applied to production until approved. Safe to run more than once.

create table if not exists public.recurring_plans (
  id uuid primary key default gen_random_uuid(),
  manage_key uuid not null unique default gen_random_uuid(),   -- secret link for cancel / manage
  email text not null,                                          -- the payer; Paystack only charges with this email
  biller_code text not null,
  item_code text not null,
  biller_name text not null,
  identifier text not null,
  identifier_label text not null,
  customer_name text,
  fee_kind text not null default 'electricity',
  amount_ngn integer not null check (amount_ngn > 0),           -- the bill amount each month, fee is added on top
  status text not null default 'pending'
    check (status in ('pending','active','needs_action','paused','cancelled','declined')),
  authorization_code text,                                      -- Paystack card token (only if reusable)
  card_last4 text,
  card_brand text,
  next_run_on date,                                             -- the day the next monthly order is due
  last_attempt_on date,                                         -- guards against two cron runs charging the same day
  failures integer not null default 0,
  last_order_id uuid,
  consent_text text not null,
  consent_version text not null,
  consent_at timestamptz not null,
  consent_ip text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_plans_due_idx on public.recurring_plans (next_run_on) where status = 'active';
create index if not exists recurring_plans_email_idx on public.recurring_plans (email);

create table if not exists public.recurring_charge_log (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.recurring_plans(id) on delete cascade,
  order_id uuid,
  outcome text not null,                                        -- charged | paused_for_customer | failed | skipped
  note text,
  created_at timestamptz not null default now()
);
create index if not exists recurring_charge_log_plan_idx on public.recurring_charge_log (plan_id, created_at desc);

-- Only the server (service role) reads or writes these tables.
alter table public.recurring_plans enable row level security;
alter table public.recurring_charge_log enable row level security;
