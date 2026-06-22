create index if not exists lender_variables_variable_key_idx
  on rental_lending.lender_variables (variable_key);

create index if not exists client_scenarios_owner_id_idx
  on rental_lending.client_scenarios (owner_id);

create index if not exists client_scenarios_lender_id_idx
  on rental_lending.client_scenarios (lender_id);

create index if not exists variables_default_reference_key_idx
  on rental_lending.variables (default_reference_key);

drop policy if exists lenders_owner_all on rental_lending.lenders;
create policy lenders_owner_all on rental_lending.lenders
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists client_scenarios_owner_all on rental_lending.client_scenarios;
create policy client_scenarios_owner_all on rental_lending.client_scenarios
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists lender_variables_owner_all on rental_lending.lender_variables;
create policy lender_variables_owner_all on rental_lending.lender_variables
for all
using (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_variables.lender_id
      and lenders.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from rental_lending.lenders lenders
    where lenders.id = lender_variables.lender_id
      and lenders.owner_id = (select auth.uid())
  )
);
