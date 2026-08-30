create extension if not exists "pgcrypto";

create table if not exists routers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  kind text not null check (kind in ('fibra', 'inalambrico')),
  vpn_host text not null,
  api_port integer not null default 8728,
  api_tls boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  router_id uuid references routers(id),
  full_name text not null,
  ci text not null,
  phone text,
  sector text not null default 'fibra',
  plan_name text not null,
  monthly_price numeric(10,2) not null default 0,
  pppoe_user text,
  queue_name text,
  ip_address text,
  status text not null default 'activo' check (status in ('activo', 'vencido', 'cortado')),
  paid_until timestamptz,
  auto_cut_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_ci_idx on customers(ci);
create index if not exists customers_router_idx on customers(router_id);
create index if not exists customers_pppoe_idx on customers(pppoe_user);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  amount numeric(10,2) not null,
  method text not null default 'manual',
  reference text,
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'rechazado')),
  paid_at timestamptz not null default now(),
  service_days integer not null default 30,
  extra_hours integer not null default 12,
  qr_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table payments add column if not exists qr_payload jsonb not null default '{}';
alter table payments alter column extra_hours set default 3;

create table if not exists router_actions (
  id uuid primary key default gen_random_uuid(),
  router_id uuid references routers(id),
  customer_id uuid references customers(id) on delete cascade,
  action text not null check (action in ('cut', 'enable', 'payment', 'sync')),
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists router_actions_status_idx on router_actions(status, created_at);

create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id) on delete set null,
  provider text not null default 'qr-api',
  payload jsonb not null default '{}',
  processed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists payment_webhook_events_payment_idx on payment_webhook_events(payment_id, created_at);
create index if not exists payment_webhook_events_provider_idx on payment_webhook_events(provider, created_at desc);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  category text not null,
  brand text,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  image_url text,
  stock integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null,
  category text,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_phone text,
  customer_ci text,
  subtotal numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  coupon_code text,
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'entregado', 'cancelado')),
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  quantity integer not null default 1,
  unit_price numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0
);

insert into coupons (code, discount_type, discount_value, active)
values ('INFINIT10', 'percent', 10, true)
on conflict (code) do nothing;

insert into coupons (code, discount_type, discount_value, category, active)
values ('HGW20', 'percent', 20, 'hgw', true)
on conflict (code) do nothing;
