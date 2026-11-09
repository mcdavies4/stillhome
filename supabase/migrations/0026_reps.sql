-- 0026: sales reps. A rep gets a link like nolgic.com/?rep=chika and every order that link brings in is tagged with it.
-- Safe to run more than once. Only the server (service role) touches the reps table.

create table if not exists public.reps (
  code text primary key check (code ~ '^[a-z0-9]{3,20}$'),
  name text not null,
  active boolean not null default true,
  commission_ngn integer not null default 0 check (commission_ngn >= 0),  -- paid per NEW customer whose first delivered order came through this rep
  note text,
  created_at timestamptz not null default now()
);
alter table public.reps enable row level security;   -- no policies: the public can't read or write it

alter table public.orders add column if not exists rep text;
create index if not exists orders_rep_idx on public.orders (rep, created_at desc) where rep is not null;
