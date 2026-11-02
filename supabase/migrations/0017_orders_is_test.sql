-- 0017: mark orders made in test mode (sandbox bills provider, test card, test pay-in key) so the
-- dashboard and the daily reconciliation email can leave them out of the real numbers.
-- Safe to run more than once.
alter table public.orders add column if not exists is_test boolean not null default false;
create index if not exists orders_is_test_idx on public.orders (is_test, created_at desc);
