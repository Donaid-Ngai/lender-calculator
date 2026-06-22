create table if not exists rental_lending.lender_variables (
  lender_id uuid not null references rental_lending.lenders(id) on delete cascade,
  variable_key text not null references rental_lending.variables(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lender_id, variable_key)
);

alter table rental_lending.lender_variables enable row level security;

drop policy if exists lender_variables_owner_all on rental_lending.lender_variables;
create policy lender_variables_owner_all on rental_lending.lender_variables
for all
using (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_variables.lender_id
      and lenders.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_variables.lender_id
      and lenders.owner_id = auth.uid()
  )
);

alter table rental_lending.lenders
  add column if not exists vacancy_rate_formula text not null default '0.05',
  add column if not exists maintenance_formula text not null default 'gross_monthly_rent * 0.15',
  add column if not exists vacancy_amount_formula text not null default 'gross_monthly_rent * vacancy_rate',
  add column if not exists surplus_shortfall_formula text not null default 'gross_monthly_rent + other_monthly_rent - monthly_mortgage_payment - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount',
  add column if not exists dcr_formula text not null default '(gross_monthly_rent + other_monthly_rent - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount) / monthly_mortgage_payment';

alter table rental_lending.client_scenarios
  add column if not exists summary_value numeric(14, 2) not null default 0,
  add column if not exists dcr numeric(12, 4) not null default 0;

update rental_lending.client_scenarios
set summary_value = coalesce(calculated_loan_amount, 0)
where summary_value = 0;

alter table rental_lending.lenders
  drop column if exists base_adjustment;

drop table if exists rental_lending.lender_rules cascade;

delete from rental_lending.variables;

insert into rental_lending.variables (
  key,
  label,
  description,
  input_kind,
  default_reference_key,
  display_order
)
values
  ('gross_monthly_rent', 'Gross monthly rent', 'Total gross monthly rent collected from the rental properties.', 'currency', null, 1),
  ('other_monthly_rent', 'Other monthly rent', 'Any additional monthly rental or secondary property income.', 'currency', null, 2),
  ('monthly_mortgage_payment', 'Monthly mortgage payment', 'Monthly mortgage payment across the rental properties.', 'currency', null, 3),
  ('monthly_property_taxes', 'Monthly property taxes', 'Monthly property tax cost across the rental properties.', 'currency', null, 4),
  ('monthly_condo_fees', 'Monthly condo fees', 'Monthly condo or strata fees across the rental properties.', 'currency', null, 5),
  ('other_expenses', 'Other expenses', 'Any remaining monthly expenses not covered by the other fields.', 'currency', null, 6);
