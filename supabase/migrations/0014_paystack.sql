-- 0014_paystack.sql
-- Nigeria-domestic (₦) payments via Paystack. Existing orders stay 'stripe'.
alter table orders add column if not exists payment_provider text not null default 'stripe';
alter table orders add column if not exists paystack_reference text;
alter table orders add column if not exists service_fee_local numeric not null default 0;

create unique index if not exists orders_paystack_reference_key
  on orders (paystack_reference) where paystack_reference is not null;

-- sanity: allowed providers
do $$ begin
  alter table orders add constraint orders_payment_provider_chk check (payment_provider in ('stripe','paystack'));
exception when duplicate_object then null; end $$;
