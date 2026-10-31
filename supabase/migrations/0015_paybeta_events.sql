-- 0015_paybeta_events.sql
-- Paybeta has no "requery" endpoint: the only way to learn the final result of a vend that came back
-- pending (or never answered) is its webhook. /api/paybeta/webhook records every event here and
-- the order pipeline reads it (src/lib/paybeta.ts -> pbStatus). Run once in the Supabase SQL editor.
create table if not exists paybeta_events (
  reference   text primary key,           -- our vend reference, "PB" + order id without dashes
  state       text not null check (state in ('success','failed','pending')),
  token       text,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Server-only table (service role bypasses RLS). Lock it for everyone else.
alter table paybeta_events enable row level security;
