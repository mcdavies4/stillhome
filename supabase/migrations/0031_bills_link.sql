-- 0031: "Bills link". A person keeps one standing link, like nolgic.com/for/ada. Friends, family or a benefactor open it,
-- choose what to pay (light, TV, airtime, data) and an amount, and pay in naira. Each payment is an ordinary Pay for Me
-- request underneath, so delivery, receipts and refunds are the same as everything else.
-- Needs 0023 (Pay for Me) first. Safe to run more than once.

create table if not exists public.pay_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  owner_name text not null,                      -- the name people see ("Ada")
  owner_email text,                              -- tokens are emailed here when someone pays (optional)
  owner_key uuid not null default gen_random_uuid(), -- secret that lets the owner pause or delete the link from the website
  owner_chat bigint,                             -- the Telegram chat that made it, if any (they are told when someone pays)
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_paid_at timestamptz
);
create index if not exists pay_links_chat_idx on public.pay_links (owner_chat) where owner_chat is not null;
create index if not exists pay_links_email_idx on public.pay_links (owner_email) where owner_email is not null;

create table if not exists public.pay_link_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.pay_links(id) on delete cascade,
  row_no int not null,
  label text not null,                           -- "Mum's light"
  biller_code text not null,
  item_code text not null,
  biller_name text not null,
  item_name text,
  identifier text not null,                      -- never shown in full on the public page
  identifier_label text,
  customer_name text,                            -- the name the provider returned; never shown on the public page
  amount_ngn numeric,                            -- set for a fixed-price plan; empty = the person paying chooses
  created_at timestamptz not null default now(),
  unique (link_id, row_no)
);

-- Which standing link a payment came through.
alter table public.pay_requests add column if not exists link_id uuid;
create index if not exists pay_requests_link_idx on public.pay_requests (link_id, created_at desc) where link_id is not null;

-- The Telegram bot can follow these payments too.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.tg_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.tg_links drop constraint %I', c);
  end loop;
  alter table public.tg_links add constraint tg_links_kind_check check (kind in ('ask', 'give', 'link', 'bill'));
exception when undefined_table then null;
end $$;

alter table public.pay_links enable row level security;
alter table public.pay_link_items enable row level security;
