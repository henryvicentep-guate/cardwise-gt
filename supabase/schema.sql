create table if not exists public.cardwise_cards (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cardwise_payments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cardwise_installments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cardwise_balance_snapshots (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cardwise_payables (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cardwise_payable_payments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists cardwise_cards_user_updated_idx on public.cardwise_cards(user_id, updated_at desc);
create index if not exists cardwise_payments_user_updated_idx on public.cardwise_payments(user_id, updated_at desc);
create index if not exists cardwise_installments_user_updated_idx on public.cardwise_installments(user_id, updated_at desc);
create index if not exists cardwise_balance_snapshots_user_updated_idx on public.cardwise_balance_snapshots(user_id, updated_at desc);
create index if not exists cardwise_payables_user_updated_idx on public.cardwise_payables(user_id, updated_at desc);
create index if not exists cardwise_payable_payments_user_updated_idx on public.cardwise_payable_payments(user_id, updated_at desc);

create or replace function public.set_cardwise_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cardwise_cards_updated_at on public.cardwise_cards;
create trigger set_cardwise_cards_updated_at
before update on public.cardwise_cards
for each row execute function public.set_cardwise_updated_at();

drop trigger if exists set_cardwise_payments_updated_at on public.cardwise_payments;
create trigger set_cardwise_payments_updated_at
before update on public.cardwise_payments
for each row execute function public.set_cardwise_updated_at();

drop trigger if exists set_cardwise_installments_updated_at on public.cardwise_installments;
create trigger set_cardwise_installments_updated_at
before update on public.cardwise_installments
for each row execute function public.set_cardwise_updated_at();

drop trigger if exists set_cardwise_balance_snapshots_updated_at on public.cardwise_balance_snapshots;
create trigger set_cardwise_balance_snapshots_updated_at
before update on public.cardwise_balance_snapshots
for each row execute function public.set_cardwise_updated_at();

drop trigger if exists set_cardwise_payables_updated_at on public.cardwise_payables;
create trigger set_cardwise_payables_updated_at
before update on public.cardwise_payables
for each row execute function public.set_cardwise_updated_at();

drop trigger if exists set_cardwise_payable_payments_updated_at on public.cardwise_payable_payments;
create trigger set_cardwise_payable_payments_updated_at
before update on public.cardwise_payable_payments
for each row execute function public.set_cardwise_updated_at();

alter table public.cardwise_cards enable row level security;
alter table public.cardwise_payments enable row level security;
alter table public.cardwise_installments enable row level security;
alter table public.cardwise_balance_snapshots enable row level security;
alter table public.cardwise_payables enable row level security;
alter table public.cardwise_payable_payments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.cardwise_cards to authenticated;
grant select, insert, update, delete on public.cardwise_payments to authenticated;
grant select, insert, update, delete on public.cardwise_installments to authenticated;
grant select, insert, update, delete on public.cardwise_balance_snapshots to authenticated;
grant select, insert, update, delete on public.cardwise_payables to authenticated;
grant select, insert, update, delete on public.cardwise_payable_payments to authenticated;

drop policy if exists "cardwise_cards_owner_all" on public.cardwise_cards;
create policy "cardwise_cards_owner_all"
on public.cardwise_cards
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cardwise_payments_owner_all" on public.cardwise_payments;
create policy "cardwise_payments_owner_all"
on public.cardwise_payments
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cardwise_installments_owner_all" on public.cardwise_installments;
create policy "cardwise_installments_owner_all"
on public.cardwise_installments
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cardwise_balance_snapshots_owner_all" on public.cardwise_balance_snapshots;
create policy "cardwise_balance_snapshots_owner_all"
on public.cardwise_balance_snapshots
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cardwise_payables_owner_all" on public.cardwise_payables;
create policy "cardwise_payables_owner_all"
on public.cardwise_payables
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cardwise_payable_payments_owner_all" on public.cardwise_payable_payments;
create policy "cardwise_payable_payments_owner_all"
on public.cardwise_payable_payments
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
