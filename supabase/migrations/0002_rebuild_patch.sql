-- 0002_rebuild_patch.sql
-- Everything the live code needs that was originally added by hand (not in any earlier
-- migration file). Run AFTER 0001_init.sql and BEFORE 0012_whatsapp_bot.sql.
-- Idempotent: safe to re-run.

-- Statuses the pipeline uses beyond the original five.
alter type order_status add value if not exists 'needs_review';
alter type order_status add value if not exists 'expired';

-- Order columns written by /api/checkout and the velocity check.
alter table orders add column if not exists ip text;
alter table orders add column if not exists country text not null default 'NG';
alter table orders add column if not exists currency text not null default 'NGN';

create index if not exists orders_ip_created_idx    on orders (ip, created_at);
create index if not exists orders_email_created_idx on orders (email, created_at);

-- Per-IP rate limiting (src/lib/ratelimit.ts).
create table if not exists request_log (
  id bigint generated always as identity primary key,
  ip text not null,
  route text not null,
  created_at timestamptz not null default now()
);
create index if not exists request_log_lookup_idx on request_log (ip, route, created_at desc);
alter table request_log enable row level security;
-- No policies: service role only.
