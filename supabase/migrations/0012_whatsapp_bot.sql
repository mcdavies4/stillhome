-- 0012_whatsapp_bot.sql
-- WhatsApp ordering channel — integrated with the live Nolgic orders schema.
-- Fully idempotent: safe to run whether or not the earlier 0011 draft ran.

create table if not exists wa_users (
  id uuid primary key default gen_random_uuid(),
  wa_phone text unique not null,              -- E.164 without '+', as Meta sends it
  display_name text,
  welcomed boolean not null default false,
  order_count int not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists wa_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  wa_user_id uuid not null references wa_users(id) on delete cascade,
  alias text not null,
  biller_code text not null,
  item_code text not null,
  biller_name text,
  identifier text not null,                   -- meter number (matches orders.identifier)
  customer_name text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (wa_user_id, alias)
);

create table if not exists wa_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_user_id uuid not null unique references wa_users(id) on delete cascade,
  state text not null default 'idle',
  -- idle | collecting | confirming | awaiting_payment | vending | failed
  draft jsonb not null default '{}'::jsonb,
  order_id uuid,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists wa_processed_messages (
  message_id text primary key,
  processed_at timestamptz not null default now()
);

-- Extend live orders table (statuses stay exactly as the site uses them:
-- pending_payment → paid → fulfilled | failed_refunded | refund_failed | expired)
alter table orders add column if not exists source text not null default 'web';
alter table orders add column if not exists wa_user_id uuid references wa_users(id);

-- WhatsApp orders have no email address. The existing checkout always sets
-- email, so relaxing the constraint changes nothing for the web flow.
alter table orders alter column email drop not null;

create index if not exists idx_wa_beneficiaries_user on wa_beneficiaries (wa_user_id);
create index if not exists idx_wa_conversations_expiry on wa_conversations (state, expires_at);
create index if not exists idx_orders_wa_user on orders (wa_user_id) where wa_user_id is not null;

alter table wa_users enable row level security;
alter table wa_beneficiaries enable row level security;
alter table wa_conversations enable row level security;
alter table wa_processed_messages enable row level security;
-- No policies: only the service role (which bypasses RLS) touches these.

create or replace function wa_prune_processed_messages() returns void
language sql security definer as $$
  delete from wa_processed_messages where processed_at < now() - interval '7 days';
$$;

create or replace function increment_wa_order_count(p_user uuid) returns void
language sql security definer as $$
  update wa_users set order_count = order_count + 1 where id = p_user;
$$;
