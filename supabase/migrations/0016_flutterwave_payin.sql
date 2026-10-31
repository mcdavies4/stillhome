-- 0016_flutterwave_payin.sql
-- Flutterwave as a second naira pay-in rail (alongside Paystack). Run once in the Supabase SQL editor.
alter table orders add column if not exists flw_pay_ref text;   -- our tx_ref, "NLGFW-<order id>"
alter table orders add column if not exists flw_pay_id text;    -- Flutterwave's transaction id (needed to refund)

create unique index if not exists orders_flw_pay_ref_key
  on orders (flw_pay_ref) where flw_pay_ref is not null;

-- allow 'flutterwave' as a payment_provider
alter table orders drop constraint if exists orders_payment_provider_chk;
alter table orders add constraint orders_payment_provider_chk
  check (payment_provider in ('stripe','paystack','flutterwave'));
