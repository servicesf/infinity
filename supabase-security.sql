alter table routers enable row level security;
alter table customers enable row level security;
alter table payments enable row level security;
alter table router_actions enable row level security;
alter table payment_webhook_events enable row level security;
alter table products enable row level security;
alter table coupons enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

drop policy if exists "public can read active products" on products;
create policy "public can read active products"
on products for select
using (active = true);

drop policy if exists "public can read active coupons" on coupons;
create policy "public can read active coupons"
on coupons for select
using (active = true and (expires_at is null or expires_at > now()));

-- Clientes, pagos y acciones MikroTik deben manejarse desde API/bridge con service role.
-- No se habilita lectura publica directa para evitar exponer nombres, CI, PPPoE o IP.

drop policy if exists "service role full routers" on routers;
create policy "service role full routers"
on routers for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full customers" on customers;
create policy "service role full customers"
on customers for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full payments" on payments;
create policy "service role full payments"
on payments for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full router actions" on router_actions;
create policy "service role full router actions"
on router_actions for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full payment webhook events" on payment_webhook_events;
create policy "service role full payment webhook events"
on payment_webhook_events for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full products" on products;
create policy "service role full products"
on products for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full coupons" on coupons;
create policy "service role full coupons"
on coupons for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full orders" on orders;
create policy "service role full orders"
on orders for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service role full order items" on order_items;
create policy "service role full order items"
on order_items for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
