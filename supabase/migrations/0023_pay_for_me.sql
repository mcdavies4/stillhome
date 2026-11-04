-- 0023_pay_for_me.sql
-- "Ask someone to pay": a person in Nigeria lists what they need (light, TV, airtime, data), shares a link,
-- and a friend or relative anywhere pays for all of it in one payment. Off until NEXT_PUBLIC_PAYFORME_ENABLED=1.
--
-- Safe to run more than once. Touches no existing data; the only change to an existing table is one new,
-- empty, optional column on orders.

create table if not exists pay_requests (
  id               uuid primary key default gen_random_uuid(),
  receiver_name    text not null,                 -- who the request is from ("Mummy Ada")
  receiver_email   text,                          -- optional: gets the tokens by email when they land
  receiver_key     uuid not null default gen_random_uuid(), -- secret only the person who made the request holds; unlocks tokens on the page
  note             text,                          -- optional short message to the payer
  status           text not null default 'open',  -- open | pending_payment | paid | settled | cancelled | expired | needs_review
  payer_name       text,
  payer_email      text,
  amount_ngn       numeric not null,              -- sum of the bills
  fee_ngn          numeric not null,              -- sum of the service fees
  payment_provider text,                          -- paystack | flutterwave
  attempt          integer not null default 0,    -- each press of "Pay" starts a new attempt (new reference)
  pay_ref          text,                          -- reference of the latest attempt
  pay_id           text,                          -- the gateway's own transaction id, once paid
  is_test          boolean not null default false,
  ip               text,
  error            text,
  expires_at       timestamptz not null,
  paid_at          timestamptz,
  settled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists pay_request_items (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references pay_requests(id) on delete cascade,
  row_no           integer not null,
  biller_code      text not null,
  item_code        text not null,
  biller_name      text not null,
  item_name        text,
  identifier       text not null,                 -- meter / smartcard / phone number
  identifier_label text,
  customer_name    text,                          -- the name the provider returned when the request was made
  amount_ngn       numeric not null,
  fee_ngn          numeric not null,
  status           text not null default 'queued', -- queued | vending | done
  order_id         uuid,                          -- id of the normal order for this item (chosen BEFORE the order is created, so a retry can never buy twice)
  vending_at       timestamptz,                   -- when this item was claimed for buying
  created_at       timestamptz not null default now(),
  unique (request_id, row_no)
);

create index if not exists pay_request_items_request_idx on pay_request_items(request_id);
create index if not exists pay_requests_status_idx on pay_requests(status, created_at);

-- Each bought item is an ordinary row in orders, so receipts, finance and support all keep working.
alter table orders add column if not exists pay_request_id uuid;
create index if not exists orders_pay_request_idx on orders(pay_request_id) where pay_request_id is not null;

-- Only the server (service role) ever touches these.
alter table pay_requests enable row level security;
alter table pay_request_items enable row level security;
