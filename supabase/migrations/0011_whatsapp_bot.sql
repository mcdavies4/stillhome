-- 0011_whatsapp_bot.sql
-- WhatsApp ordering channel for Nolgic
-- Renumber if 0011 is taken in your migrations folder.

create table if not exists wa_users (
  id uuid primary key default gen_random_uuid(),
  wa_phone text unique not null,              -- E.164 without '+', as Meta sends it (e.g. 447700900123)
  display_name text,
  welcomed boolean not null default false,
  order_count int not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists wa_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  wa_user_id uuid not null references wa_users(id) on delete cascade,
  alias text not null,                        -- lowercased: "mum", "lagos shop"
  biller_code text not null,
  item_code text not null,
  meter_number text not null,
  customer_name text,
  meter_type text,                            -- 'prepaid' | 'postpaid'
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

-- Webhook dedupe: Meta redelivers messages on slow/failed responses
create table if not exists wa_processed_messages (
  message_id text primary key,
  processed_at timestamptz not null default now()
);

-- Extend existing orders table
alter table orders add column if not exists source text not null default 'web';       -- 'web' | 'whatsapp'
alter table orders add column if not exists wa_user_id uuid references wa_users(id);

create index if not exists idx_wa_beneficiaries_user on wa_beneficiaries (wa_user_id);
create index if not exists idx_wa_conversations_expiry on wa_conversations (state, expires_at);
create index if not exists idx_orders_wa_user on orders (wa_user_id) where wa_user_id is not null;

-- RLS: these tables are only touched by server-side service role. Lock them down.
alter table wa_users enable row level security;
alter table wa_beneficiaries enable row level security;
alter table wa_conversations enable row level security;
alter table wa_processed_messages enable row level security;
-- No policies created: anon/authenticated get nothing; service role bypasses RLS.

-- Housekeeping: clear old dedupe rows (call from cron or pg_cron)
create or replace function wa_prune_processed_messages() returns void
language sql security definer as $$
  delete from wa_processed_messages where processed_at < now() - interval '7 days';
$$;
