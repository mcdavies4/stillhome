-- 0035: monthly plans. The new price waiting for the customer's approval after a biller price change.
alter table public.recurring_plans add column if not exists pending_amount_ngn integer;
