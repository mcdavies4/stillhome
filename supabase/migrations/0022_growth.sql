-- 0022: status line, top-up reminders, referral credit. Safe to run more than once.
-- Only the server (service role) touches these tables.

-- One row: the notice shown across the top of the site (empty message = nothing shown).
create table if not exists public.site_status (
  id int primary key default 1 check (id = 1),
  level text not null default 'info',          -- info | warn
  message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.site_status (id) values (1) on conflict do nothing;

-- Top-up reminders: one email per delivered order at most, and people who asked to stop.
create table if not exists public.reminder_log (
  order_id uuid primary key,                    -- the delivered order the reminder was about
  email text not null,
  identifier text,
  token uuid not null default gen_random_uuid() unique, -- the private "stop" link in the email
  sent_at timestamptz not null default now()
);
create index if not exists reminder_log_email_idx on public.reminder_log (email, sent_at desc);
create table if not exists public.reminder_optout (
  email text primary key,
  at timestamptz not null default now()
);

-- Referral credit (switched on with REFERRALS_ENABLED=1). A credit is a waived service fee.
create table if not exists public.referral_codes (
  code text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.referral_codes(code),
  referrer_email text not null,
  referee_email text not null unique,           -- a person can only ever be referred once
  referee_order_id uuid,                        -- their first order (fee waived)
  referee_waived_ngn numeric(12,2) not null default 0,
  referrer_credit_order_id uuid,                -- the referrer's order that used the credit
  referrer_waived_ngn numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_email);

alter table public.site_status enable row level security;
alter table public.reminder_log enable row level security;
alter table public.reminder_optout enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
