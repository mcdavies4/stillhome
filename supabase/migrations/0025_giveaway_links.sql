-- 0025_giveaway_links.sql
-- Giveaway links ("let them choose"): the giver shares ONE link, each person picks their own light, airtime, data
-- or TV and enters their own meter / smartcard / phone number, and the giver reviews the list and then pays for
-- everyone in one payment. Nothing is paid until the giver closes the link, so Nolgic never holds money for people
-- who haven't chosen yet.
--
-- Needs 0023_pay_for_me.sql first (a closed link becomes an ordinary Pay for Me giveaway).
-- Safe to run more than once. Touches no existing data.

create table if not exists pay_collects (
  id             uuid primary key default gen_random_uuid(),
  maker_name     text not null,                 -- shown to everyone who opens the link
  maker_email    text not null,                 -- gets the private link, the receipt and the tokens
  maker_key      uuid not null default gen_random_uuid(), -- secret: only the giver holds it (manage, close, pay)
  note           text,                          -- message shown to everyone who opens the link
  budget_ngn     numeric not null,              -- most each person can choose (the bill, before the fee)
  categories     text[] not null,               -- what they may pick: electricity | cable | airtime | data
  max_people     integer not null,
  status         text not null default 'open',  -- open | closing | converted | cancelled | expired
  request_id     uuid references pay_requests(id),  -- the Pay for Me giveaway it became when closed
  ip             text,
  error          text,
  expires_at     timestamptz not null,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists pay_collect_entries (
  id               uuid primary key default gen_random_uuid(),
  collect_id       uuid not null references pay_collects(id) on delete cascade,
  entry_key        uuid not null default gen_random_uuid(), -- secret: only the person who joined holds it (their status and token)
  who              text not null,               -- the name they gave
  whatsapp         text,                        -- optional: lets the giver message them in one tap (234XXXXXXXXXX)
  category         text not null,
  biller_code      text not null,
  item_code        text not null,
  biller_name      text not null,
  item_name        text,
  identifier       text not null,               -- meter / smartcard / phone number
  identifier_label text,
  customer_name    text,                        -- the name the provider returned when they joined
  amount_ngn       numeric not null,
  fee_ngn          numeric not null,
  status           text not null default 'active', -- active | removed
  request_row      integer,                     -- row_no of this person in pay_request_items once the link is closed
  ip               text,
  created_at       timestamptz not null default now()
);

create index if not exists pay_collect_entries_collect_idx on pay_collect_entries(collect_id, created_at);
-- One place per meter / number in each giveaway (a removed entry frees it again).
create unique index if not exists pay_collect_entries_one_each on pay_collect_entries(collect_id, identifier) where status = 'active';
create index if not exists pay_collects_status_idx on pay_collects(status, created_at);

alter table pay_collects enable row level security;
alter table pay_collect_entries enable row level security;

-- Adding a person, atomically: the link is locked while it is checked and the row is written, so two people
-- joining at the same moment can never take it past its limit or its total.
create or replace function pfc_add_entry(
  p_collect uuid, p_max_total numeric,
  p_who text, p_whatsapp text, p_category text,
  p_biller_code text, p_item_code text, p_biller_name text, p_item_name text,
  p_identifier text, p_identifier_label text, p_customer_name text,
  p_amount numeric, p_fee numeric, p_ip text
) returns table (entry_id uuid, entry_key uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  c pay_collects%rowtype;
  n integer;
  total numeric;
  e pay_collect_entries%rowtype;
begin
  select * into c from pay_collects where id = p_collect for update;
  if not found then raise exception 'PFC_NOT_FOUND'; end if;
  if c.status <> 'open' or c.expires_at < now() then raise exception 'PFC_CLOSED'; end if;
  if not (p_category = any (c.categories)) then raise exception 'PFC_CATEGORY'; end if;
  if p_amount > c.budget_ngn then raise exception 'PFC_BUDGET'; end if;

  select count(*), coalesce(sum(amount_ngn + fee_ngn), 0) into n, total
    from pay_collect_entries where collect_id = p_collect and status = 'active';
  if n >= c.max_people then raise exception 'PFC_FULL'; end if;
  if total + p_amount + p_fee > p_max_total then raise exception 'PFC_FULL'; end if;
  if exists (select 1 from pay_collect_entries where collect_id = p_collect and status = 'active' and identifier = p_identifier) then
    raise exception 'PFC_DUPLICATE';
  end if;

  insert into pay_collect_entries (collect_id, who, whatsapp, category, biller_code, item_code, biller_name, item_name,
    identifier, identifier_label, customer_name, amount_ngn, fee_ngn, ip)
  values (p_collect, p_who, p_whatsapp, p_category, p_biller_code, p_item_code, p_biller_name, p_item_name,
    p_identifier, p_identifier_label, p_customer_name, p_amount, p_fee, p_ip)
  returning * into e;

  update pay_collects set updated_at = now() where id = p_collect;
  return query select e.id, e.entry_key;
end;
$$;

-- Only the server (service role) may call it.
revoke all on function pfc_add_entry(uuid, numeric, text, text, text, text, text, text, text, text, text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function pfc_add_entry(uuid, numeric, text, text, text, text, text, text, text, text, text, text, numeric, numeric, text) to service_role;
