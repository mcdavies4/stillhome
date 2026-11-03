-- 0020: finance records. Safe to run more than once. Only the server (service role) touches these tables.

-- Real money per order, filled by the admin "Sync" button (never by the payment path).
alter table public.orders add column if not exists commission_ngn numeric;     -- what the provider (Paybeta) pays us on this order
alter table public.orders add column if not exists processor_fee_ngn numeric;  -- what Flutterwave actually charged us (from its own record)
alter table public.orders add column if not exists econ_at timestamptz;        -- when the two numbers above were captured

alter table public.bulk_orders add column if not exists processor_fee_ngn numeric;
alter table public.bulk_orders add column if not exists econ_at timestamptz;

-- Rates and business details the reports use (one row, key 'main').
create table if not exists public.finance_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Money we spend running the business (hosting, software, fees, accountant, marketing ...).
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  spent_on date not null,
  category text not null,
  vendor text,
  description text,
  amount_ngn numeric not null check (amount_ngn >= 0),   -- the full amount paid, VAT included
  vat_ngn numeric not null default 0 check (vat_ngn >= 0), -- the VAT part of it, if the receipt shows one
  receipt_ref text                                         -- invoice or receipt number
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on desc);

-- Who did what in the admin (settings changes, expenses, syncs, exports).
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  action text not null,
  target text,
  detail jsonb,
  ip text
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);

alter table public.finance_settings enable row level security;
alter table public.expenses enable row level security;
alter table public.admin_audit enable row level security;
