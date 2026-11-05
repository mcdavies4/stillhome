-- 0024: first-party visit and usage counts. Safe to run more than once.
-- No cookies, no IP address and no user agent are stored. The "vid" is a one-way hash that changes every day,
-- so it can count how many different browsers came today but cannot follow anyone from one day to the next.
-- Only the server (service role) reads or writes this table.

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'event')),
  name text not null,            -- view: the page (ids removed, e.g. /order/:id). event: what happened (e.g. lookup_ok)
  path text,                     -- the page it happened on
  detail text,                   -- optional short detail (e.g. the service tab)
  vid text not null,             -- daily anonymous visitor hash
  src text,                      -- where they came from: direct, google, instagram, a utm_source, ...
  medium text,
  campaign text,
  country text,                  -- two letters, from the hosting network
  device text,                   -- mobile | tablet | desktop
  browser text
);
create index if not exists site_events_created_idx on public.site_events (created_at desc);
create index if not exists site_events_kind_name_idx on public.site_events (kind, name, created_at desc);

alter table public.site_events enable row level security;  -- no policies: the public can't read or write it

-- Optional housekeeping: keep 400 days. Run by hand now and then, or schedule it in Supabase.
create or replace function public.purge_site_events() returns void
language sql security definer set search_path = public as $$
  delete from public.site_events where created_at < now() - interval '400 days';
$$;
revoke all on function public.purge_site_events() from public, anon, authenticated;
