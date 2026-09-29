-- Customers of the signed-in user. Every table: RLS on, one policy per operation, owner check.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  cpf text not null check (cpf ~ '^\d{11}$'),
  created_at timestamptz not null default now()
);

create index customers_owner_id_idx on public.customers (owner_id);

alter table public.customers enable row level security;

-- (select auth.uid()) is evaluated once per query instead of once per row.
create policy customers_select_own on public.customers
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy customers_insert_own on public.customers
  for insert to authenticated with check ((select auth.uid()) = owner_id);

create policy customers_update_own on public.customers
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy customers_delete_own on public.customers
  for delete to authenticated using ((select auth.uid()) = owner_id);
