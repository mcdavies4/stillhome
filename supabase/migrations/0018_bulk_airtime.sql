-- 0018: bulk airtime. One customer payment (Flutterwave) buys airtime for many numbers through Paybeta's
-- bulk API. A parent row per batch, one child row per phone number. Safe to run more than once.

create table if not exists public.bulk_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null default 'airtime',
  email text not null,
  ip text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','processing','settling','settled','needs_review','refund_failed','expired')),
  recipients_count int not null,
  amount_total numeric not null,          -- sum of all airtime amounts (naira)
  service_fee numeric not null default 0, -- our fee (naira)
  payment_provider text not null default 'flutterwave',
  flw_pay_ref text,
  flw_pay_id text,
  pb_reference text,                       -- our unique batch reference sent to Paybeta
  pb_batch_id text,                        -- Paybeta's BLK-... id
  pb_charged numeric,                      -- what Paybeta says it took from our wallet
  delivered_count int not null default 0,
  failed_count int not null default 0,
  delivered_ngn numeric not null default 0,
  refunded_ngn numeric not null default 0,
  paid_at timestamptz,
  settled_at timestamptz,
  error text,
  is_test boolean not null default false
);
create index if not exists bulk_orders_status_idx on public.bulk_orders (status, updated_at);
create index if not exists bulk_orders_email_idx on public.bulk_orders (email, created_at desc);

create table if not exists public.bulk_recipients (
  id uuid primary key default gen_random_uuid(),
  bulk_id uuid not null references public.bulk_orders(id) on delete cascade,
  row_no int not null,
  network text not null check (network in ('mtn','glo','airtel','9mobile')),
  phone text not null,
  amount numeric not null,
  status text not null default 'queued' check (status in ('queued','delivered','failed')),
  detail text,
  unique (bulk_id, row_no)
);
create index if not exists bulk_recipients_bulk_idx on public.bulk_recipients (bulk_id);

-- Only the server (service role) touches these tables.
alter table public.bulk_orders enable row level security;
alter table public.bulk_recipients enable row level security;
