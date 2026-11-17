-- Records when an order was first marked fulfilled, so delivery speed can be measured.
-- A trigger covers every code path that sets status = 'fulfilled', so no app code changes are needed.
alter table orders add column if not exists delivered_at timestamptz;

create or replace function set_delivered_at() returns trigger
language plpgsql as $$
begin
  if new.status::text = 'fulfilled' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_delivered_at on orders;
create trigger orders_set_delivered_at
  before insert or update of status on orders
  for each row execute function set_delivered_at();

create index if not exists orders_delivered_at_idx on orders (delivered_at) where delivered_at is not null;
