-- 0030: Telegram bot, round 3. Rep links, saved meters and phones, reminders, announcements, support chat, language.
-- Safe to run more than once. Run it BEFORE deploying the code that uses it (the bot still works without it,
-- but saving, reminders, rep tracking, announcements and language need these columns and tables).

alter table public.tg_users add column if not exists ref text;                              -- sales rep who first brought this person to the bot (first touch)
alter table public.tg_users add column if not exists src text;                              -- which Nolgic button they came from (hero, footer, ...)
alter table public.tg_users add column if not exists lang text;                             -- en | pcm | yo | ig | ha
alter table public.tg_users add column if not exists optout boolean not null default false; -- /stop: no announcements

-- Meters, smartcards and phones a customer chose to keep ("Mum's light").
create table if not exists public.tg_saved (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null references public.tg_users(chat_id) on delete cascade,
  label text not null,
  cat text not null,
  title text,
  biller_code text not null,
  item_code text not null,
  identifier text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (chat_id, biller_code, item_code, identifier)
);
create index if not exists tg_saved_chat_idx on public.tg_saved (chat_id, created_at);

-- A reminder the customer chose for one saved item: once after N days, or every N days.
create table if not exists public.tg_reminders (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null references public.tg_users(chat_id) on delete cascade,
  saved_id uuid not null references public.tg_saved(id) on delete cascade,
  due_at timestamptz not null,
  repeat_days int check (repeat_days is null or repeat_days between 1 and 365),
  active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tg_reminders_due_idx on public.tg_reminders (due_at) where active;

-- Announcements sent by the owner. cursor = the last chat id already handled, so a broadcast resumes where it stopped.
create table if not exists public.tg_broadcasts (
  id uuid primary key default gen_random_uuid(),
  admin_chat bigint not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'done', 'cancelled')),
  cursor bigint not null default 0,
  audience int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Customer messages forwarded to the owner, so a reply to the forwarded message finds its way back to the customer.
create table if not exists public.tg_support (
  id uuid primary key default gen_random_uuid(),
  batch uuid not null,
  chat_id bigint not null,
  admin_chat bigint not null,
  admin_msg_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists tg_support_admin_idx on public.tg_support (admin_chat, admin_msg_id);
create index if not exists tg_support_chat_idx on public.tg_support (chat_id, created_at desc);

-- Only the server (service role) touches these tables.
alter table public.tg_saved enable row level security;
alter table public.tg_reminders enable row level security;
alter table public.tg_broadcasts enable row level security;
alter table public.tg_support enable row level security;
