-- 0029: Telegram bot v2. Bulk airtime, gifts, and follow-ups for requests / giveaways started in the bot.
-- Safe to run more than once. Run after 0028.

-- A gift's message and sender, kept with the order so the delivery message can offer a note to forward.
alter table public.tg_orders add column if not exists gift jsonb;

-- Bulk airtime batches made in the bot, so the result can be messaged back to the chat.
create table if not exists public.tg_bulk (
  bulk_id uuid primary key references public.bulk_orders(id) on delete cascade,
  chat_id bigint not null references public.tg_users(chat_id) on delete cascade,
  notified text,                                -- last outcome message sent for this batch
  created_at timestamptz not null default now()
);
create index if not exists tg_bulk_chat_idx on public.tg_bulk (chat_id, created_at desc);

-- Requests ("ask someone to pay"), giveaways and giveaway links made in the bot. `ref` is the pay_requests / pay_collects id,
-- `key` its private key (it is only ever sent back to the same chat). `last` is the last status the chat was told about.
create table if not exists public.tg_links (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null references public.tg_users(chat_id) on delete cascade,
  kind text not null check (kind in ('ask','give','link')),
  ref uuid not null,
  key text not null,
  last text,
  created_at timestamptz not null default now()
);
create index if not exists tg_links_chat_idx on public.tg_links (chat_id, created_at desc);
create index if not exists tg_links_ref_idx on public.tg_links (ref);

alter table public.tg_bulk enable row level security;
alter table public.tg_links enable row level security;
