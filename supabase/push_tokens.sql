-- Run once in the Supabase SQL editor.
create table if not exists public.push_tokens (
  token text primary key,
  platform text not null default 'android',
  last_seen timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
