-- UpNEPA — initial schema
-- Orders move through: pending_payment -> paid -> fulfilled | failed_refunded

create type order_status as enum (
  'pending_payment',  -- Stripe session created, not yet paid
  'paid',             -- Stripe confirmed, fulfilment in flight
  'fulfilled',        -- Flutterwave bill payment succeeded
  'failed_refunded',  -- FLW failed, Stripe refund issued
  'refund_failed'     -- FLW failed AND refund failed -> manual attention
);

-- People the user tops up (Mum, the house in Enugu, ...)
create table recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,                     -- "Mum", "Enugu house"
  whatsapp_e164 text,                      -- receipt destination, e.g. +23480...
  created_at timestamptz not null default now()
);

-- Saved biller identifiers per recipient (meter / IUC / phone)
create table saved_billers (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  biller_code text not null,               -- e.g. BIL119
  item_code text not null,                 -- e.g. CB141
  biller_name text not null,               -- "DSTV"
  identifier text not null,                -- smartcard / meter / phone
  identifier_label text not null,          -- from FLW label_name
  customer_name text,                      -- from last successful validate
  created_at timestamptz not null default now(),
  unique (recipient_id, item_code, identifier)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,

  -- what is being bought (snapshot, independent of saved_billers)
  biller_code text not null,
  item_code text not null,
  biller_name text not null,
  identifier text not null,
  identifier_label text not null,
  customer_name text,                      -- validated name shown pre-payment
  recipient_whatsapp text,

  -- money
  amount_ngn numeric(12,2) not null,
  fx_ngn_per_gbp numeric(10,2) not null,
  service_fee_pence integer not null,
  amount_gbp_pence integer not null,       -- total charged incl. fee

  -- pipeline
  status order_status not null default 'pending_payment',
  stripe_session_id text unique,
  stripe_payment_intent text,
  flw_reference text unique,               -- our idempotency key at FLW
  flw_token text,                          -- prepaid electricity token
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on orders (status);
create index orders_user_idx on orders (user_id);

-- RLS
alter table recipients enable row level security;
alter table saved_billers enable row level security;
alter table orders enable row level security;

create policy "own recipients" on recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own saved billers" on saved_billers
  for all using (
    exists (select 1 from recipients r where r.id = recipient_id and r.user_id = auth.uid())
  ) with check (
    exists (select 1 from recipients r where r.id = recipient_id and r.user_id = auth.uid())
  );

-- Orders: users can read their own; all writes go through service role
create policy "read own orders" on orders
  for select using (auth.uid() = user_id);

create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger orders_touch before update on orders
  for each row execute function touch_updated_at();
