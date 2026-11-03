-- 0019: customer support chat. Visitors leave a message on the site; a person replies later from /admin/inbox
-- and the reply is emailed to them (and shown in the chat if they come back). Safe to run more than once.

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,            -- secret held only by the visitor's browser
  email text not null,
  name text,
  status text not null default 'open' check (status in ('open','closed')),
  unread_admin boolean not null default true,
  page text,
  ip text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists support_threads_inbox_idx on public.support_threads (status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender text not null check (sender in ('customer','agent')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread_idx on public.support_messages (thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
