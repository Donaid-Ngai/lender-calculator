create schema if not exists rental_lending;

create extension if not exists pgcrypto;

create table if not exists rental_lending.variables (
  key text primary key,
  label text not null,
  description text,
  input_kind text not null check (input_kind in ('currency', 'percent', 'number')),
  default_reference_key text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint variables_default_reference_fk
    foreign key (default_reference_key)
    references rental_lending.variables(key)
    on delete set null
);

create table if not exists rental_lending.lenders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  base_adjustment numeric(14, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table if not exists rental_lending.lender_rules (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references rental_lending.lenders(id) on delete cascade,
  variable_key text not null references rental_lending.variables(key) on delete cascade,
  impact_direction text not null check (impact_direction in ('increase', 'decrease')),
  calculation_mode text not null check (
    calculation_mode in ('ignore', 'value', 'value_times_factor', 'percent_of_reference')
  ),
  factor numeric(10, 4) not null default 1,
  reference_variable_key text references rental_lending.variables(key) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lender_id, variable_key)
);

create table if not exists rental_lending.client_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  lender_id uuid references rental_lending.lenders(id) on delete set null,
  client_name text not null,
  base_loan_amount numeric(14, 2) not null default 0,
  variable_values jsonb not null default '{}'::jsonb,
  calculated_loan_amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function rental_lending.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lenders_set_updated_at on rental_lending.lenders;
create trigger lenders_set_updated_at
before update on rental_lending.lenders
for each row execute procedure rental_lending.set_updated_at();

drop trigger if exists lender_rules_set_updated_at on rental_lending.lender_rules;
create trigger lender_rules_set_updated_at
before update on rental_lending.lender_rules
for each row execute procedure rental_lending.set_updated_at();

drop trigger if exists client_scenarios_set_updated_at on rental_lending.client_scenarios;
create trigger client_scenarios_set_updated_at
before update on rental_lending.client_scenarios
for each row execute procedure rental_lending.set_updated_at();

alter table rental_lending.lenders enable row level security;
alter table rental_lending.lender_rules enable row level security;
alter table rental_lending.client_scenarios enable row level security;

drop policy if exists lenders_owner_all on rental_lending.lenders;
create policy lenders_owner_all on rental_lending.lenders
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists lender_rules_owner_all on rental_lending.lender_rules;
create policy lender_rules_owner_all on rental_lending.lender_rules
for all
using (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_rules.lender_id
      and lenders.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_rules.lender_id
      and lenders.owner_id = auth.uid()
  )
);

drop policy if exists client_scenarios_owner_all on rental_lending.client_scenarios;
create policy client_scenarios_owner_all on rental_lending.client_scenarios
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

insert into rental_lending.variables (
  key,
  label,
  description,
  input_kind,
  default_reference_key,
  display_order
)
values
  ('rent_income', 'Rent Income', 'Gross annual rental income from the subject properties.', 'currency', null, 1),
  ('property_tax', 'Property Tax', 'Annual property tax expense.', 'currency', null, 2),
  ('mortgage_payment', 'Mortgage Payments', 'Annual mortgage payments tied to the rental properties.', 'currency', null, 3),
  ('condo_fees', 'Condo Fees', 'Annual condo or strata fees.', 'currency', null, 4),
  ('insurance', 'Insurance', 'Annual insurance costs.', 'currency', null, 5),
  ('maintenance', 'Maintenance', 'Annual maintenance or repair allowance.', 'currency', null, 6),
  ('vacancy_rate', 'Vacancy Rate', 'Vacancy allowance entered as a decimal percent such as 0.05 for 5%.', 'percent', 'rent_income', 7),
  ('utilities', 'Utilities', 'Annual utilities paid by the owner.', 'currency', null, 8),
  ('other_income', 'Other Income', 'Other annual income related to the rental portfolio.', 'currency', null, 9),
  ('other_expenses', 'Other Expenses', 'Other annual expenses related to the rental portfolio.', 'currency', null, 10)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  input_kind = excluded.input_kind,
  default_reference_key = excluded.default_reference_key,
  display_order = excluded.display_order;
