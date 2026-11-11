-- 0028: Telegram bot. A chat is a customer; their conversation state lives on the row.
-- Orders made in the bot are ordinary rows in `orders` (source = 'telegram'), linked here so the bot
-- can message the chat when the order is delivered, refunded or needs checking. Safe to run more than once.

create table if not exists public.tg_users (
  chat_id bigint primary key,
  first_name text,
  username text,
  email text,                                   -- where receipts go (asked once)
  state text not null default 'idle',
  draft jsonb not null default '{}'::jsonb,
  order_count int not null default 0,
  blocked boolean not null default false,       -- set when Telegram says the user blocked the bot
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Telegram retries an update until we answer 200; this makes every update count once.
create table if not exists public.tg_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.tg_orders (
  order_id uuid primary key references public.orders(id) on delete cascade,
  chat_id bigint not null references public.tg_users(chat_id) on delete cascade,
  notified text,                                -- last outcome message sent for this order
  created_at timestamptz not null default now()
);
create index if not exists tg_orders_chat_idx on public.tg_orders (chat_id, created_at desc);
create index if not exists tg_orders_open_idx on public.tg_orders (created_at) where notified is distinct from 'done';

-- Only the server (service role) touches these tables.
alter table public.tg_users enable row level security;
alter table public.tg_updates enable row level security;
alter table public.tg_orders enable row level security;
