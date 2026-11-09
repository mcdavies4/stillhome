-- Nolgic account (sign in with an emailed code): order history + saved meters/smartcards/numbers that follow the customer across devices.
-- Stores only what is needed to fill the pay form. No owner names, no tokens. The name is checked again before every payment.

create table if not exists account_codes (
  email       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  tries       int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists account_saved (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  nickname    text not null default 'Saved',
  tab         text not null default '',
  biller_code text not null,
  biller_name text not null default '',
  item_code   text not null,
  item_key    text not null default '',
  item_name   text not null default '',
  identifier  text not null,
  label       text not null default 'Number',
  created_at  timestamptz not null default now(),
  used_at     timestamptz not null default now(),
  unique (email, biller_code, item_code, identifier)
);
create index if not exists account_saved_email_idx on account_saved (email, used_at desc);

alter table account_codes enable row level security;
alter table account_saved enable row level security;
