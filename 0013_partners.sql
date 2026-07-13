-- 0013_partners.sql
-- Nolgic B2B partner layer: multi-tenant API keys, prepaid GBP wallets,
-- atomic wallet-funded orders, and a webhook delivery outbox.
--
-- Design notes
--   * Partners NEVER connect to Supabase directly. All access goes through
--     Next.js API routes using the service role. RLS on these tables is
--     deny-all by default (enable RLS + no policies = no anon/auth access).
--   * API keys: only a SHA-256 hash is stored. Format handed to partner:
--       nolgic_live_<43 chars base64url>   (or nolgic_test_...)
--     key_prefix stores the first 16 chars for O(1) lookup before hashing.
--   * Money: all GBP amounts in integer pence (matches amount_gbp_pence).
--   * API orders are prepaid from the partner wallet, so they are inserted
--     with status 'paid' and vend immediately. On vend failure the wallet
--     is credited back — no Stripe involvement, no chargeback exposure.
--   * Idempotent: safe to re-run.

-- ============================================================
-- 1. Partners
-- ============================================================

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,                       -- e.g. 'acme-remit'
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  contact_email text not null,

  -- pricing (per-partner overrides; sensible launch defaults)
  fee_bps integer not null default 150,            -- 1.50% platform fee on NGN value
  fee_min_pence integer not null default 30,       -- floor per transaction
  fx_margin_bps integer not null default 0,        -- extra margin vs your NGN_PER_GBP, if any

  -- partner webhook target (signed with webhook_secret, HMAC-SHA256)
  webhook_url text,
  webhook_secret text not null default encode(gen_random_bytes(32), 'hex'),

  -- guardrails
  max_order_ngn numeric(12,2) not null default 200000,   -- per-transaction cap
  daily_cap_pence integer not null default 500000,        -- £5,000/day default

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. API keys (hash only, prefix for lookup)
-- ============================================================

create table if not exists partner_api_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  environment text not null default 'live'
    check (environment in ('live', 'test')),
  key_prefix text not null,                        -- e.g. 'nolgic_live_Ab3d'
  key_hash text not null unique,                   -- sha256 hex of full key
  label text not null default 'default',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_prefix
  on partner_api_keys (key_prefix) where revoked_at is null;

-- ============================================================
-- 3. Prepaid wallet ledger (balance = sum of entries; cached on partner_wallets)
-- ============================================================

create table if not exists partner_wallets (
  partner_id uuid primary key references partners(id) on delete cascade,
  balance_pence integer not null default 0 check (balance_pence >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists partner_ledger (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  entry_type text not null
    check (entry_type in ('topup', 'vend_debit', 'refund_credit', 'adjustment')),
  amount_pence integer not null,                   -- signed: debits negative
  balance_after_pence integer not null,
  order_id uuid references orders(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_partner
  on partner_ledger (partner_id, created_at desc);

-- ============================================================
-- 4. Orders: attach partner context
-- ============================================================

-- Third channel alongside 'web' and 'whatsapp'
alter table orders add column if not exists partner_id uuid references partners(id) on delete set null;
alter table orders add column if not exists partner_ref text;   -- partner's idempotency key

-- One partner_ref per partner — retries can never double-vend
create unique index if not exists idx_orders_partner_ref
  on orders (partner_id, partner_ref)
  where partner_id is not null and partner_ref is not null;

create index if not exists idx_orders_partner
  on orders (partner_id, created_at desc)
  where partner_id is not null;

-- If a check constraint restricts orders.source, extend it; if source is
-- free text with a default (as in 0012), this is a no-op guard.
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'orders' and column_name = 'source'
  ) then
    -- best-effort: drop and recreate a known constraint name if present
    begin
      alter table orders drop constraint if exists orders_source_check;
      alter table orders add constraint orders_source_check
        check (source in ('web', 'whatsapp', 'api'));
    exception when others then null;
    end;
  end if;
end $$;

-- ============================================================
-- 5. Webhook outbox (partner notifications, retried by cron)
-- ============================================================

create table if not exists partner_webhook_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  event_type text not null
    check (event_type in ('vend.success', 'vend.failed', 'vend.refunded', 'wallet.low_balance')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_pending
  on partner_webhook_events (next_attempt_at)
  where status = 'pending';

-- ============================================================
-- 6. Atomic RPC: debit wallet + create order in one transaction
-- ============================================================
-- Mirrors the atomic order-claiming pattern: row-lock the wallet,
-- check funds, write ledger + order together. Any failure rolls
-- back everything. Called only with the service role.

create or replace function partner_create_order(
  p_partner_id uuid,
  p_partner_ref text,
  p_biller_code text,
  p_item_code text,
  p_biller_name text,
  p_identifier text,
  p_identifier_label text,
  p_customer_name text,
  p_recipient_whatsapp text,
  p_amount_ngn numeric,
  p_fx_ngn_per_gbp numeric,
  p_service_fee_pence integer,
  p_amount_gbp_pence integer
) returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet partner_wallets%rowtype;
  v_order orders%rowtype;
  v_existing orders%rowtype;
begin
  -- Idempotency: if this partner_ref already exists, return it untouched.
  select * into v_existing
  from orders
  where partner_id = p_partner_id and partner_ref = p_partner_ref;
  if found then
    return v_existing;
  end if;

  -- Lock the wallet row for the duration of the transaction.
  select * into v_wallet
  from partner_wallets
  where partner_id = p_partner_id
  for update;

  if not found then
    raise exception 'NO_WALLET';
  end if;

  if v_wallet.balance_pence < p_amount_gbp_pence then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  update partner_wallets
  set balance_pence = balance_pence - p_amount_gbp_pence,
      updated_at = now()
  where partner_id = p_partner_id;

  insert into orders (
    email, source, partner_id, partner_ref,
    biller_code, item_code, biller_name,
    identifier, identifier_label, customer_name, recipient_whatsapp,
    amount_ngn, fx_ngn_per_gbp, service_fee_pence, amount_gbp_pence,
    status
  ) values (
    null, 'api', p_partner_id, p_partner_ref,
    p_biller_code, p_item_code, p_biller_name,
    p_identifier, p_identifier_label, p_customer_name, p_recipient_whatsapp,
    p_amount_ngn, p_fx_ngn_per_gbp, p_service_fee_pence, p_amount_gbp_pence,
    'paid'                                   -- prepaid: skip pending_payment
  ) returning * into v_order;

  insert into partner_ledger (
    partner_id, entry_type, amount_pence, balance_after_pence, order_id, note
  ) values (
    p_partner_id, 'vend_debit', -p_amount_gbp_pence,
    v_wallet.balance_pence - p_amount_gbp_pence, v_order.id,
    p_biller_name || ' / ' || p_identifier
  );

  return v_order;
end;
$$;

-- ============================================================
-- 7. Atomic RPC: refund a failed API vend back to the wallet
-- ============================================================
-- The Stripe-refund path in the webhook must NOT run for source='api'.
-- Call this instead; it is idempotent per order.

create or replace function partner_refund_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_wallet partner_wallets%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found or v_order.partner_id is null then
    raise exception 'NOT_A_PARTNER_ORDER';
  end if;

  -- Idempotency: only refund once.
  if exists (
    select 1 from partner_ledger
    where order_id = p_order_id and entry_type = 'refund_credit'
  ) then
    return;
  end if;

  select * into v_wallet
  from partner_wallets
  where partner_id = v_order.partner_id
  for update;

  update partner_wallets
  set balance_pence = balance_pence + v_order.amount_gbp_pence,
      updated_at = now()
  where partner_id = v_order.partner_id;

  insert into partner_ledger (
    partner_id, entry_type, amount_pence, balance_after_pence, order_id, note
  ) values (
    v_order.partner_id, 'refund_credit', v_order.amount_gbp_pence,
    v_wallet.balance_pence + v_order.amount_gbp_pence, p_order_id,
    'auto-refund on vend failure'
  );

  update orders
  set status = 'failed_refunded', updated_at = now()
  where id = p_order_id;
end;
$$;

-- ============================================================
-- 8. Daily cap helper (call before partner_create_order)
-- ============================================================

create or replace function partner_spent_today_pence(p_partner_id uuid)
returns integer
language sql
stable
as $$
  select coalesce(-sum(amount_pence), 0)::integer
  from partner_ledger
  where partner_id = p_partner_id
    and entry_type = 'vend_debit'
    and created_at >= date_trunc('day', now());
$$;

-- ============================================================
-- 9. RLS: deny-all (service-role access only)
-- ============================================================

alter table partners enable row level security;
alter table partner_api_keys enable row level security;
alter table partner_wallets enable row level security;
alter table partner_ledger enable row level security;
alter table partner_webhook_events enable row level security;

-- No policies created: anon/authenticated get nothing; service role bypasses RLS.

-- Lock down the RPCs the same way.
revoke execute on function partner_create_order(uuid,text,text,text,text,text,text,text,text,numeric,numeric,integer,integer) from anon, authenticated;
revoke execute on function partner_refund_order(uuid) from anon, authenticated;
revoke execute on function partner_spent_today_pence(uuid) from anon, authenticated;
