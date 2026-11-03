-- 0021: follow-up emails to people who started an order but did not pay. Safe to run more than once.
-- Only the server (service role) touches these tables.

create table if not exists public.order_followups (
  order_id uuid primary key,                         -- one follow-up per order, ever
  email text not null,
  sent_at timestamptz not null default now(),
  token uuid not null default gen_random_uuid() unique, -- the private link in the email
  reason text,                                        -- what the customer told us (see lib/followup.ts REASONS)
  note text,                                          -- their own words, optional
  responded_at timestamptz
);
create index if not exists order_followups_email_idx on public.order_followups (email, sent_at desc);
create index if not exists order_followups_sent_idx on public.order_followups (sent_at desc);

-- People who asked not to get these emails.
create table if not exists public.followup_optout (
  email text primary key,
  at timestamptz not null default now()
);

alter table public.order_followups enable row level security;
alter table public.followup_optout enable row level security;
